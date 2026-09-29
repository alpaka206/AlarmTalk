package com.alarmtalk.app.data

import android.content.Context
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.network.StockClipListResponse
import com.google.gson.Gson
import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * 스톡 클립 매니페스트(클립 목록 + 카테고리별 기대 개수)를 **디스크에 남긴다.**
 *
 * ⚠ **이게 없으면 '모른다' 라는 상태가 생기고, 관문과 저장이 정반대로 답한다**(2026-08-18).
 * - 관문(`AlarmEditorScreen` 의 `onNeedsClipPreparation`)은 `expectedVariants == null` 을
 *   **'막지 않음'** 으로 읽고,
 * - 저장(`hasCompleteCloneBucket`)은 같은 값을 `?: return false` 로 **'불완전'** 으로 읽는다.
 *
 * 즉 매니페스트 요청이 한 번 실패한 세션에서는 **고를 수는 있는데 저장은 안 된다.** 둘 다
 * 메모리 상태(`MainViewModel.expectedVariants`)라 그 세션 내내 그렇다. 지금은 라이브 랜덤
 * 생성이 이 모순을 덮고 있어 드러나지 않을 뿐이다.
 *
 * 그래서 판정을 한쪽으로 기울이는 대신 **'모른다' 상태 자체를 없앤다.**
 *
 * iOS 짝은 `StockClipManifestStore.swift` 이고 같은 규칙이다.
 */
object StockClipManifestStore {
    private const val FILE_NAME = "stock-clip-manifest.json"

    private fun file(context: Context) = File(context.filesDir, FILE_NAME)

    /**
     * 직렬화·파싱에 쓰는 Gson **하나**(효율 감사 M2). 호출마다 새로 만들면 약 168KB 파일을 다룰
     * 때마다 어댑터를 다시 짓는다. Gson 은 스레드 안전하다.
     */
    private val gson = Gson()

    /**
     * 이 파일의 **권위 세대**. 조회를 시작할 때 표를 뽑고([beginFetch]), 저장할 때 그 표를
     * 낸다([save]) — 뒤처진 표는 거절된다.
     *
     * ⚠ **이게 없으면 권위가 뒤로 간다**(Codex #703 P1). 매니페스트를 받는 곳이 둘이다
     * (전경 새로고침, 프리페치 워커). 교체 **전에** 출발한 요청이 나중에 끝나면 옛 매니페스트가
     * 새 것을 덮어쓰고, 그러면 캐시 쓰기의 '지나간 응답인가' 판정이 **되살아난 옛 주소**를
     * 기준으로 삼아 회수된 목소리를 그대로 남긴다. 프로세스 전역이어야 한다 — 저장소가
     * `object` 라 자연히 그렇다.
     */
    private val revisionLock = Any()
    private var nextFetchTicket: Long = 0

    /**
     * **여기까지의 응답은 이미 지나갔다**는 수위선.
     *
     * ⚠ 성공했을 때만 올리면 안 된다(Codex #703 P1). 교체 **뒤에** 출발한 B(표 7)의 쓰기가
     * 실패했는데 수위선이 6 에 머물면, 뒤늦게 도착한 교체 **전**의 A(표 6)가 통과해 옛
     * 매니페스트를 공개한다 — 그 뒤 캐시 대조가 되살아난 옛 주소를 기준으로 삼는다.
     * 그래서 **더 새 응답을 본 순간** 올린다. 실패한 B 는 자기 retry 로 고치면 되고, 그
     * 사이 디스크는 옛 상태로 남을 뿐 **더 나빠지지는 않는다.**
     */
    @Volatile
    private var seenTicket: Long = 0

    /**
     * 마지막으로 **실제로 공개된** 응답의 표. 쓰기에 실패한 응답은 여기 오르지 않는다.
     * 쓰기는 [revisionLock] 안에서만 하고, [latestPublishedTicket] 는 잠그지 않고 읽는다(메인에서 불린다).
     */
    @Volatile
    private var publishedTicket: Long = 0

    /**
     * 공개가 일어날 때마다 그 표를 흘린다 — **누가 공개했든**(전경·프리페치 워커·접근권 워커).
     *
     * 뷰모델 메모리(`stockClips`)가 이걸 보고 **디스크의 공개본을 표 순서로 따라간다**(Codex #825).
     * 워커는 메모리를 모르므로, 따라가지 않으면 전경이 자기 응답을 실은 **직후** 워커가 더 새 것을
     * 공개해도 메모리는 옛 목록(교체 이전 주소)에 머문다 — 준비도·클론 다운로드가 그걸 읽는다.
     */
    private val publications = MutableStateFlow(0L)
    val publishedTickets: StateFlow<Long> get() = publications

    /**
     * 가장 최근에 본 표의 응답이 **실제로 공개됐으면** 그 표, 아니면 null. 잠그지 않는다 — 메인에서
     * 불리고, 값은 오르기만 한다. 확정 판단(싣기)은 [loadPublishedWinner] 가 한 잠금 안에서 한다.
     */
    fun latestPublishedTicket(): Long? {
        val published = publishedTicket
        return published.takeIf { it > 0 && it == seenTicket }
    }

    /**
     * 마지막으로 **실제로 공개된** 응답의 표(없으면 0) — 그 뒤에 본 표의 쓰기가 실패했어도 그대로다.
     * 잠그지 않는다(메인에서 불린다). '마지막인지 확인됐는가' 는 [latestPublishedTicket] 가 답한다.
     */
    fun lastPublishedTicket(): Long = publishedTicket

    /**
     * 디스크의 공개본과 그 표.
     *
     * @param confirmed 이게 **가장 최근에 본 표의 응답**인가. false 면 그 뒤에 본 더 새 표의 쓰기가
     *   실패했다(또는 무효화됐다) — 디스크의 가장 새 목록이긴 하지만 '새로 받았다' 로 세면 안 된다.
     */
    data class PublishedManifest(val ticket: Long, val response: StockClipListResponse, val confirmed: Boolean)

    /**
     * **디스크의 마지막 공개본**(임자 대조 포함)과, 그게 확인된 마지막인지([PublishedManifest.confirmed]).
     * 없거나 임자가 다르면 null. 물러난(SUPERSEDED) 회차가 이긴 것을 이어받을 때, 그리고 메모리가 다른
     * 쪽의 공개를 따라갈 때 쓴다(스펙 「공개 경합의 규칙」, iOS `publishedNewerResponse`).
     *
     * ⚠ 물러났다는 것만으로는 **더 새 매니페스트가 디스크에 있다는 보장이 없다**(Codex #825).
     * 더 새 표의 쓰기가 실패해도 수위선은 오르고(위 [seenTicket] 주석), 로그아웃·계정 전환의
     * 무효화도 수위선을 올린다. 그래서 '받았다' 로 셀지는 [PublishedManifest.confirmed] 로 가른다 —
     * 확인 못 한 것을 이긴 것으로 세면 준비도·클론 다운로드가 신호 전의 목록으로 돈다.
     *
     * ⚠ 그렇다고 확인 못 한 것을 **버리지는 않는다**(Codex #825). 실패한 쓰기는 공개하지 않았으므로
     * 디스크에는 여전히 마지막 공개본이 있고(쓰다 깨졌으면 [load] 가 버린다), 그게 가장 새 목록이다.
     * 워커가 공개한 직후 더 새 표의 쓰기가 실패하면 알림이 더 오지 않으므로, 여기서 null 을 주면
     * 메모리는 그 공개본을 영영 못 따라간 채 교체 수리도 건너뛴다.
     *
     * ⚠ **읽은 것이 확인한 그 공개본이어야 한다**(Codex #825). 확인만 하고 읽으면 그 틈에 더 새 표의
     * 쓰기가 실패하거나 파일이 갈려, 다른 목록을 그 표로 싣는다. 그렇다고 잠근 채 읽으면(약 168KB
     * 읽기·파싱) 같은 잠금을 잡는 쪽이 그동안 멎는다. 그래서 **확인 → 잠금 밖에서 읽기 → 잠금 안에서
     * 다시 확인**하고, 그 사이 공개 상태(본 표·공개한 표)가 바뀌었으면 다시 읽는다(파일 교체는 잠금
     * 안에서만 일어나므로, 앞뒤 확인이 같으면 읽은 것이 그 공개본이다). 읽은 뒤에 더 새 공개가 오면
     * [publishedTickets] 가 다시 알린다 — 표가 함께 오므로 싣는 쪽이 순서를 지킨다.
     *
     * 메인 스레드에서 부르지 말 것 — [load] 와 같다.
     */
    fun loadPublishedWinner(context: Context, userId: String): PublishedManifest? {
        repeat(MAX_WINNER_READS) {
            val (seen, published) = synchronized(revisionLock) { seenTicket to publishedTicket }
            if (published <= 0) return null
            val response = load(context, userId, requireOwner = true)
            val unchanged = synchronized(revisionLock) { seenTicket == seen && publishedTicket == published }
            if (unchanged) return response?.let { PublishedManifest(published, it, confirmed = seen == published) }
        }
        // 계속 바뀐다 — 이번에는 포기한다. 다음 공개 알림이 다시 부른다.
        return null
    }

    /** [loadPublishedWinner] 가 읽는 사이 공개가 계속 바뀔 때 다시 읽는 한도. */
    private const val MAX_WINNER_READS = 3

    /** 조회를 시작하며 표를 뽑는다. 그 응답을 저장할 때 [save] 에 그대로 낸다. */
    fun beginFetch(): Long = synchronized(revisionLock) { ++nextFetchTicket }

    /**
     * **떠 있는 표를 전부 무효화한다.** 로그아웃·계정 전환에서 [clear] 와 함께 부른다.
     *
     * ⚠ 이게 없으면 계정 A 의 요청이 로그아웃 뒤에 돌아와 A 의 **클론 매니페스트**(목소리
     * 이름·문구까지)를 공개하고, 계정 B 가 그걸 시드로 읽는다(Codex #703 P1). WorkManager
     * 의 요청은 세션과 무관하게 살아 있으므로 취소로는 못 막는다 — 표를 죽인다.
     */
    fun invalidateOutstandingTickets() {
        synchronized(revisionLock) { seenTicket = nextFetchTicket + 1 }
    }

    /**
     * **파일 삭제와 표 무효화를 한 번에** 한다. 로그아웃·계정 전환에서 이걸 부른다.
     *
     * ⚠ 둘로 나누면 그 사이에 앞 계정의 저장이 끼어들어 **지운 파일을 되살린다**
     * (Codex #703 P1) — 그러면 뒤 계정이 앞 계정의 클론 매니페스트(목소리 이름·문구 포함)를
     * 시드로 읽는다. 같은 잠금 안에서 지우고 무효화한다.
     */
    /**
     * **이 파일이 누구 것인지** 적어 둔다(계정 id). 파일 안에는 그 계정의 **클론 클립**
     * (목소리 이름·문구)이 들어 있다.
     *
     * ⚠ 자동 401 은 파일을 **일부러 남긴다**(같은 사람이 다시 로그인하는 경우가 대부분이고,
     * 지우면 오프라인에서 알람을 못 만든다). 그런데 다른 계정이 로그인하면 그 파일이 그대로
     * 시드된다 — 그래서 **임자 표시로 가른다**(Codex #703 P1).
     */
    private fun ownerPrefs(context: Context) =
        context.getSharedPreferences("stock_clip_manifest_owner", Context.MODE_PRIVATE)

    /** 다른 계정의 매니페스트가 남아 있으면 지운다. 세션이 시작될 때 부른다. */
    fun clearIfOwnedByAnotherUser(context: Context, userId: String?) {
        val current = userId?.takeIf { it.isNotBlank() } ?: return
        val owner = ownerPrefs(context).getString(OWNER_KEY, null)
        // ⚠ **임자가 없는 파일도 믿지 않는다**(Codex #703 P1). 이 표시가 생기기 **전** 버전이
        // 쓴 매니페스트는 owner 가 null 인데, 그걸 통과시키면 앞 계정의 파일이 그대로 남아
        // 다음 계정이 시드한다(오프라인이면 무기한). 지워도 잃는 것은 다음 조회 한 번이다.
        if (owner == current) return
        // 지울 파일도 표식도 없으면 **아무 일도 하지 않는다.** `clearAndInvalidate` 는 표
        // (`seenTicket`)를 올려 **이미 날아간 조회를 전부 버리는데**, 이 자리는 토큰이 갱신될
        // 때마다(rolling refresh) 다시 돈다 — 첫 조회가 아직 안 끝난 기기에서는 그 응답만
        // 계속 SUPERSEDED 로 버려진다.
        if (owner == null && !file(context).exists()) return
        clearAndInvalidate(context)
    }

    private const val OWNER_KEY = "owner_user_id"

    /**
     * **지우려 했는데 못 지운 파일이 남아 있다**는 표시. 이게 서 있는 동안 [load] 는 파일이
     * 있어도 **아무것도 돌려주지 않는다.**
     *
     * ⚠ `File.delete()` 는 거부당해도 **예외가 아니라 false** 를 돌려준다(Codex #703 P1).
     * `runCatching` 만 두면 실패가 성공으로 읽히는데, 임자 표시는 이미 지운 뒤라 살아남은
     * 파일이 **임자 없는 상태**가 된다 — 다음 계정이 그걸 그대로 시드해 앞 계정의 클론
     * 이름·문구를 읽는다. 그래서 지우지 못하면 **임자를 그대로 두고**(불일치가 유지돼 다음
     * 세션이 다시 시도한다) 이 표시를 세워 **읽는 쪽을 닫는다.**
     */
    private const val QUARANTINE_KEY = "needs_clear"

    fun clearAndInvalidate(context: Context) {
        synchronized(revisionLock) {
            seenTicket = nextFetchTicket + 1
            val target = file(context)
            // 없으면 지운 것과 같다. 있으면 `delete()` 의 **반환값**까지 본다.
            val removed = runCatching { !target.exists() || target.delete() }
                .onFailure { AlarmTalkLog.reportError("Failed to clear the stock clip manifest", it) }
                .getOrDefault(false)
            val prefs = ownerPrefs(context)
            if (removed) {
                runCatching { prefs.edit().remove(OWNER_KEY).remove(QUARANTINE_KEY).apply() }
            } else {
                // 임자는 **남긴다** — 지워 버리면 살아남은 파일이 임자 없는 상태가 돼
                // 다음 계정이 시드한다. 남겨 두면 불일치가 유지돼 다음 세션이 다시 지운다.
                AlarmTalkLog.reportError(
                    "Stock clip manifest deletion refused; quarantining the surviving file",
                    IllegalStateException("delete() returned false"),
                )
                // `commit()` 도 false 를 돌려줄 수 있다 — 그러면 이번 프로세스는 메모리
                // 맵으로 버티지만 재시작 뒤에는 표시를 잃는다. 임자는 남겨 뒀으므로 다음
                // 세션이 삭제를 다시 시도하긴 하나, 조용히 넘기지는 않는다.
                val marked = runCatching {
                    prefs.edit().putBoolean(QUARANTINE_KEY, true).commit()
                }.getOrDefault(false)
                if (!marked) {
                    AlarmTalkLog.reportError(
                        "Failed to mark the surviving stock clip manifest as quarantined",
                        IllegalStateException("commit() returned false"),
                    )
                }
            }
        }
    }

    /**
     * 매니페스트를 저장한다. 실패해도 조용히 넘어간다 — 이번 세션은 메모리 값으로 돈다.
     *
     * @param fetchTicket [beginFetch] 로 받은 표. 더 뒤에 출발한 응답이 이미 저장됐으면
     *   **아무것도 하지 않는다**(false).
     * @return 실제로 공개했는가.
     */
    /**
     * [save] 의 결과. **거절과 실패를 구분한다**(Codex #703 P1).
     *
     * 둘을 `false` 하나로 뭉치면 호출자가 잘못 판단한다 — 거절(더 새 매니페스트가 이미
     * 나왔다)은 물러나는 게 맞지만, 실패(디스크 I/O)는 **아무도 공개하지 못한 상태**라
     * 다시 시도해야 한다. 뭉치면 실패한 회차가 조용히 성공으로 끝나고, 완료 푸시를 놓친
     * 기기에는 회수된 프리셋을 갈아 끼울 폴백이 남지 않는다.
     */
    enum class PublishResult { PUBLISHED, SUPERSEDED, FAILED }

    /**
     * ⚠ **메인 스레드에서 부르지 말 것**(효율 감사 M2). 약 168KB 를 직렬화해 파일을 갈아 끼우고
     * prefs 를 `commit()` 한다 — 그것도 워커와 같은 잠금 안에서라, 워커가 쓰는 동안 메인이 멎는다.
     *
     * @param ownerUserId 이 매니페스트를 받은 계정. **공개하는 쪽이 반드시 준다** —
     *   따로 찍게 두면 한 경로만 빠져도(실제로 프리페치 워커가 그랬다) 임자가 null 로 남아
     *   다른 계정이 그 파일을 시드한다(Codex #703 P1).
     */
    fun save(
        context: Context,
        response: StockClipListResponse,
        fetchTicket: Long,
        ownerUserId: String?,
    ): PublishResult =
        // ⚠ **비교·쓰기·표 갱신이 한 임계구역이다**(Codex #703 P1). 비교만 잠그면 A 와 B 가
        // 둘 다 통과한 뒤 **쓰는 순서가 뒤집혀** A 가 B 를 덮을 수 있고, 두 writer 가 같은
        // `.tmp` 경로를 나눠 쓰기까지 한다. 파일 교체까지 잠근 채로 한다.
        synchronized(revisionLock) {
            if (fetchTicket < seenTicket) return PublishResult.SUPERSEDED
            // 더 새 응답을 봤다 — 성패와 무관하게 수위선을 올린다(위 `seenTicket` 주석).
            seenTicket = fetchTicket
            // 쓰기가 실패하면 **공개되지 않았다**고 답한다. 호출자가 다시 시도한다.
            if (!writeManifest(context, response)) return PublishResult.FAILED
            publishedTicket = fetchTicket
            // 파일과 임자는 **같은 임계구역에서** 함께 남긴다. 방금 이 계정의 내용으로
            // 갈아 끼웠으므로 격리 표시도 함께 내린다 — 지우지 못했던 파일이 **덮여** 없어진
            // 것이라, 계속 세워 두면 멀쩡한 파일을 영영 못 읽는다.
            ownerUserId?.takeIf { it.isNotBlank() }?.let {
                ownerPrefs(context).edit()
                    .putString(OWNER_KEY, it)
                    .remove(QUARANTINE_KEY)
                    .commit()
            }
            // 파일·임자까지 남긴 **뒤에** 알린다 — 따라가는 쪽이 읽을 때 임자 대조가 통과하게.
            publications.value = fetchTicket
            return PublishResult.PUBLISHED
        }

    /** 파일을 원자적으로 갈아 끼운다. 실패하면 false — 호출자가 표를 올리지 않는다. */
    private fun writeManifest(context: Context, response: StockClipListResponse): Boolean =
        runCatching {
            // ⚠ 임시 파일에 쓴 뒤 옮긴다. 쓰다 죽으면 반쪽 JSON 이 남아 다음 실행이
            // 매니페스트를 못 읽고, 그러면 이 파일을 둔 이유가 그대로 사라진다.
            val target = file(context)
            val tmp = File(context.filesDir, "$FILE_NAME.tmp")
            tmp.writeText(gson.toJson(response))
            if (!tmp.renameTo(target)) {
                target.writeText(tmp.readText())
                tmp.delete()
            }
            true
        }.onFailure {
            AlarmTalkLog.reportError("Failed to persist the stock clip manifest", it)
        }.getOrDefault(false)

    /**
     * 디스크에 남은 매니페스트. 없거나 깨졌으면 null.
     *
     * ⚠ **메인 스레드에서 부르지 말 것**(효율 감사 M2) — 약 168KB 를 읽어 파싱한다.
     *
     * @param currentUserId 지금 로그인한 계정. **격리된 파일을 읽을 수 있는지**를 이걸로 가른다
     *   (아래). 모르면 null 을 넘긴다 — 그때는 격리 중 읽지 않는다(fail-closed).
     * @param requireOwner true 면 **임자가 [currentUserId] 인 파일만** 읽는다. 공개 경합에서 물러난
     *   회차가 이긴 매니페스트를 이어받을 때 쓴다(스펙 「공개 경합의 규칙」 — 임자 대조).
     */
    fun load(
        context: Context,
        currentUserId: String? = null,
        requireOwner: Boolean = false,
    ): StockClipListResponse? {
        // ⚠ **지우지 못한 파일은 남에게 읽히지 않는다**(Codex #703 P1 — 위 `QUARANTINE_KEY`).
        // 그 표시가 서 있는 동안 파일은 **지우기로 한 계정의 것**이라, 다른 계정이 읽으면
        // 그 계정의 클론 이름·문구가 남의 화면에 시드된다.
        //
        // 다만 **임자 본인은 계속 읽는다.** 로그아웃에서 삭제가 거부돼 격리된 뒤 같은 사람이
        // 다시 로그인한 경우까지 막으면, 이 파일을 둔 이유였던 '모른다' 상태(파일 머리말 주석
        // — 관문은 '막지 않음', 저장은 '불완전' 으로 정반대로 답한다)로 오프라인 사용자가
        // 그대로 돌아간다. 임자는 `save` 가 조회한 계정으로만 찍히므로 믿을 수 있다.
        val prefs = ownerPrefs(context)
        if (requireOwner) {
            val me = currentUserId?.takeIf { it.isNotBlank() } ?: return null
            if (prefs.getString(OWNER_KEY, null) != me) return null
        }
        if (prefs.getBoolean(QUARANTINE_KEY, false)) {
            val owner = prefs.getString(OWNER_KEY, null)
            val me = currentUserId?.takeIf { it.isNotBlank() }
            if (me == null || owner == null || owner != me) return null
        }
        val target = file(context)
        if (!target.exists()) return null
        // 읽기는 잠그지 않는다 — 그사이 [save] 가 더 새 파일로 갈아 끼울 수 있다(아래 삭제 조건).
        val publishedBeforeRead = publishedTicket
        return runCatching {
            gson.fromJson(target.readText(), StockClipListResponse::class.java)
        }.getOrElse {
            // 깨진 파일은 지운다 — 남겨 두면 매번 파싱에 실패하며 같은 로그만 쌓인다.
            AlarmTalkLog.reportError("Discarding an unreadable stock clip manifest", it)
            // ⚠ **읽은 뒤에 공개된 새 파일은 지우지 않는다**(Codex #825). 파일 교체는 잠금 안에서만
            // 일어나고 공개마다 [publishedTicket] 이 오르므로, 잠근 채 그 값이 읽기 전과 같을 때만
            // 지운다 — 아니면 깨진 것은 이미 갈려 나갔다. 그냥 지우면 방금 공개된 후속본을 지워
            // [publishedTicket] 이 없는 파일을 가리키고, 이긴 것 이어받기·교체 수리가 다음 조회까지 멎는다.
            synchronized(revisionLock) {
                if (publishedTicket == publishedBeforeRead) target.delete()
            }
            null
        }
    }

    /**
     * 계정이 바뀔 때 지운다. 매니페스트에는 **그 계정의 클론 클립**이 들어 있어, 안 지우면
     * 다음 사람에게 남의 목록을 시드하게 된다. 지워도 다음 조회가 다시 채우므로 오프라인
     * 판정은 그때부터 정상으로 돌아온다.
     */
    @Deprecated(
        "표를 무효화하지 않아 앞 계정의 늦은 저장이 파일을 되살린다. clearAndInvalidate 를 쓸 것.",
        ReplaceWith("clearAndInvalidate(context)"),
    )
    fun clear(context: Context) = clearAndInvalidate(context)
}
