package com.alarmtalk.app.data

import android.content.Context
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.network.StockClipListResponse
import com.google.gson.Gson
import java.io.File

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
    private var seenTicket: Long = 0

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

    fun clearAndInvalidate(context: Context) {
        synchronized(revisionLock) {
            seenTicket = nextFetchTicket + 1
            runCatching { ownerPrefs(context).edit().remove(OWNER_KEY).apply() }
            runCatching { file(context).delete() }
                .onFailure { AlarmTalkLog.reportError("Failed to clear the stock clip manifest", it) }
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
            // 파일과 임자는 **같은 임계구역에서** 함께 남긴다.
            ownerUserId?.takeIf { it.isNotBlank() }?.let {
                ownerPrefs(context).edit().putString(OWNER_KEY, it).commit()
            }
            return PublishResult.PUBLISHED
        }

    /** 파일을 원자적으로 갈아 끼운다. 실패하면 false — 호출자가 표를 올리지 않는다. */
    private fun writeManifest(context: Context, response: StockClipListResponse): Boolean =
        runCatching {
            // ⚠ 임시 파일에 쓴 뒤 옮긴다. 쓰다 죽으면 반쪽 JSON 이 남아 다음 실행이
            // 매니페스트를 못 읽고, 그러면 이 파일을 둔 이유가 그대로 사라진다.
            val target = file(context)
            val tmp = File(context.filesDir, "$FILE_NAME.tmp")
            tmp.writeText(Gson().toJson(response))
            if (!tmp.renameTo(target)) {
                target.writeText(tmp.readText())
                tmp.delete()
            }
            true
        }.onFailure {
            AlarmTalkLog.reportError("Failed to persist the stock clip manifest", it)
        }.getOrDefault(false)

    /** 디스크에 남은 매니페스트. 없거나 깨졌으면 null. */
    fun load(context: Context): StockClipListResponse? {
        val target = file(context)
        if (!target.exists()) return null
        return runCatching {
            Gson().fromJson(target.readText(), StockClipListResponse::class.java)
        }.getOrElse {
            // 깨진 파일은 지운다 — 남겨 두면 매번 파싱에 실패하며 같은 로그만 쌓인다.
            AlarmTalkLog.reportError("Discarding an unreadable stock clip manifest", it)
            target.delete()
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
