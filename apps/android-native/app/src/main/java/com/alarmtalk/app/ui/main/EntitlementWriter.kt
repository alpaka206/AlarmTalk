package com.alarmtalk.app

import android.content.Context
import android.util.Log
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.network.AuthSessionStore

/**
 * 권한 스냅샷을 쓰려면 **요청을 시작할 때** 뜨는 표.
 *
 * 여기 담긴 두 값이 "누구 것이고 언제 것인가" 의 전부다 — 지금까지 호출부마다
 * `ownerUserId` / `startedByUserId` / `expectedOwnerUserId` / `requestOwner` / `activeUserID`
 * 다섯 철자로 흩어져 있던 것이 이 타입 하나로 접힌다.
 */
internal data class AccessTicket(
    val userId: String,
    /** 세션 세대. 로그아웃·계정전환·재로그인에서만 바뀐다(토큰 갱신으로는 안 바뀐다). */
    val epoch: Long,
)

/** [EntitlementWriter.write] 의 결과. **`Applied` 가 아니면 아무것도 쓰이지 않았다.** */
internal enum class EntitlementWrite {
    /** 반영됐다. 화면 상태(메모리 사본)도 이때만 같이 갱신한다. */
    Applied,

    /** 밀려났다 — 그 사이 로그아웃·계정전환·재로그인이 있었다. 조용히 버린다. */
    Superseded,
}

/**
 * **권한 스냅샷에 쓰는 유일한 문**(2026-09-02).
 *
 * ## 왜 문이 하나여야 하는가
 *
 * 그전에는 스냅샷을 쓰는 곳이 안드로이드 9곳·iOS 8곳이었고, **각자 자기 가드를 손으로**
 * 들고 있었다 — 계정 대조, 세션 세대, 토큰 에폭, 조회 세대, 취소 확인. PR #709 에서 그
 * 가드를 82줄 붙였는데, 국소 가드끼리 서로 어긋나면서 리뷰가 37회·119건까지 갔다.
 * 실제로 일어난 것들:
 *
 * - 에폭 가드를 넣었더니 그 앞의 토큰 회전 때문에 **항상 거짓**이 되어 plan 반영이 죽었다.
 * - CAS 를 넣었는데 발행이 **락 밖**이라 창이 그대로 남았다.
 * - 조회 세대를 넣었더니 실패한 조회가 **남의 성공까지** 무효로 만들었다.
 *
 * 전역 불변식이 어디에도 없는 시스템에 국소 불변식을 하나씩 붙이면 이렇게 된다.
 * 그래서 판단을 **여기 한 곳**으로 옮긴다. 쓰는 쪽은 "누가·언제·무엇을" 만 넘기고,
 * **받아들일지는 문이 정한다.**
 *
 * ## 규칙
 *
 * 1. 네트워크·SDK 호출 **전에** [ticket] 을 뜬다.
 * 2. 응답이 오면 [write] 에 그 표와 함께 넘긴다.
 * 3. 결과가 [EntitlementWrite.Applied] 일 때만 화면 상태(메모리 사본)를 갱신한다.
 *
 * ⚠ **[write] 밖에서 스냅샷을 쓰지 말 것.** `AccessSnapshotStore.patchWithoutOwnershipCheck`
 * 는 소유권 판단이 없다 — `scripts/check-entitlement-writer.py` 가 CI 에서 우회를 막는다.
 */
internal class EntitlementWriter(context: Context) {
    private val app = context.applicationContext
    private val snapshots = AccessSnapshotStore(app)
    private val sessions = AuthSessionStore(app)

    /**
     * 지금 세션으로 표를 뜬다. 세션이 없으면 null.
     *
     * ⚠ **세대를 세션보다 먼저 읽는다.** 순서가 반대면 두 읽기 사이의 A→B 전환에서
     * **세션은 A, 세대는 B** 가 잡혀 짝이 어긋난다. 이 순서면 세대가 옛것이라
     * [write] 가 안전하게 거절한다.
     */
    fun ticket(): AccessTicket? {
        val epoch = sessions.sessionGeneration()
        val userId = sessions.read()?.user?.id?.takeIf { it.isNotBlank() } ?: return null
        return AccessTicket(userId, epoch)
    }

    /** 이 표가 가리키는 계정의 스냅샷을 읽는다. */
    fun read(ticket: AccessTicket): AccessSnapshot = snapshots.read(ticket.userId)

    /**
     * 표가 아직 유효할 때만 [transform] 을 반영한다.
     *
     * 세 가지를 **한 덩어리로** 본다(세션 쓰기와 같은 락 안에서):
     * 1. 세션 세대가 그대로인가 — 로그아웃·재로그인이 없었는가
     * 2. 지금 계정이 표의 계정과 같은가 — 계정 전환이 없었는가
     * 3. 스냅샷 갱신 자체의 직렬화 — 필드끼리 서로를 지우지 않는가
     *
     * 검사와 쓰기가 나뉘면 그 사이가 창이다. 그래서 나누지 않는다.
     *
     * ⚠ 이름이 `apply` 가 아닌 이유: Kotlin 표준 스코프 함수 `apply` 와 이름이 겹치면
     * `EntitlementWriter(ctx).apply { ... }` 가 **조용히 스코프 함수로 해석된다** —
     * 컴파일은 되는데 아무것도 쓰이지 않는다.
     */
    fun write(
        ticket: AccessTicket,
        /** 로그에 남길 이유(예: "play entitlement"). 밀려났을 때만 찍힌다. */
        reason: String,
        transform: (AccessSnapshot) -> AccessSnapshot,
    ): EntitlementWrite {
        var applied = false
        val aliveByEpoch = sessions.runIfGeneration(ticket.epoch) {
            val current = sessions.read()
            if (current == null || current.user.id != ticket.userId) return@runIfGeneration
            snapshots.patchWithoutOwnershipCheck(ticket.userId, transform)
            applied = true
        }
        if (applied) return EntitlementWrite.Applied
        Log.i(
            TAG,
            "Dropping entitlement write ($reason): " +
                if (aliveByEpoch) "account changed" else "session generation changed",
        )
        return EntitlementWrite.Superseded
    }
}
