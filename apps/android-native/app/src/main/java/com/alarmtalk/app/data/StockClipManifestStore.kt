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
    private var publishedTicket: Long = 0

    /** 조회를 시작하며 표를 뽑는다. 그 응답을 저장할 때 [save] 에 그대로 낸다. */
    fun beginFetch(): Long = synchronized(revisionLock) { ++nextFetchTicket }

    /**
     * 매니페스트를 저장한다. 실패해도 조용히 넘어간다 — 이번 세션은 메모리 값으로 돈다.
     *
     * @param fetchTicket [beginFetch] 로 받은 표. 더 뒤에 출발한 응답이 이미 저장됐으면
     *   **아무것도 하지 않는다**(false).
     * @return 실제로 공개했는가.
     */
    fun save(context: Context, response: StockClipListResponse, fetchTicket: Long): Boolean {
        synchronized(revisionLock) {
            if (fetchTicket < publishedTicket) return false
            publishedTicket = fetchTicket
        }
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
        }.onFailure {
            AlarmTalkLog.reportError("Failed to persist the stock clip manifest", it)
        }
        return true
    }

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
    fun clear(context: Context) {
        runCatching { file(context).delete() }
    }
}
