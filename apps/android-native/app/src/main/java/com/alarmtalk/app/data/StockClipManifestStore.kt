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

    /** 매니페스트를 저장한다. 실패해도 조용히 넘어간다 — 이번 세션은 메모리 값으로 돈다. */
    fun save(context: Context, response: StockClipListResponse) {
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
