package com.alarmtalk.app

/** `/auth/me`(또는 plan 을 싣는 결제 전 조회)를 **보내기 직전에** 뜬 표 — 보낸 순번을 응답까지 들고 간다. */
internal data class AccountRequest(val seq: Long)

/**
 * 계정 요청의 **순번 장부** — 어느 응답이 plan 을 써도 되는가, 이번 실행에서 plan 답이 반영됐는가, 계정 설정 올리기의
 * 울타리가 어디까지인가(`promptSettingsAnswerFence`).
 *
 * `MainViewModel` 이 하나 들고 같은 이름의 멤버로 위임한다(`beginAccountRequest`). 규칙을 여기 모은 이유는 **테스트**다 —
 * 뷰모델은 암호화 저장소·Room·워커를 통째로 물고 있어 단위 테스트에서 세울 수 없는데, 늦게 온 옛 응답 버리기·계정 전환은
 * 상태를 거쳐야만 드러난다(`AccountRequestLedgerTest`).
 */
internal class AccountRequestLedger {

    /**
     * 이번 실행에서 서버의 plan 답(`/auth/me`·결제 전 조회)이 **plan 스냅샷에 반영됐는가**([recordPlanApplied]).
     * 받았던 알람의 승격(`promoteFormerReceivedAlarms`)이 이걸 기다린다 — 저장해 둔 판정만으로 되돌릴 수 없는 결정을 내리지
     * 않는다. 계정이 바뀌면 내린다.
     */
    var planAnsweredThisRun: Boolean = false
        private set

    /** 계정 요청의 순번 — 늦게 도착한 옛 응답이 새 응답을 덮지 않게 한다. */
    private var requestSeq: Long = 0L

    /** plan(세션·권한 스냅샷의 plan)에 쓴 가장 새 응답의 순번([claimPlanAnswer]). */
    private var planAnswerSeq: Long = 0L

    fun beginAccountRequest(): AccountRequest = AccountRequest(seq = ++requestSeq)

    /** 지금까지 뜬 계정 요청 표의 마지막 순번 — 표를 새로 뜨지 않는다(계정 설정 올리기의 울타리 `promptSettingsAnswerFence`). */
    fun latestRequestSeq(): Long = requestSeq

    /**
     * [request] 의 응답으로 **plan 을 써도 되는가**(세션의 plan 과 권한 스냅샷의 plan). 나중에 보낸 요청의 답이 이미 plan 에
     * 쓰였으면 false — 늦게 도착한 옛 답이 새 답을 되돌리면 안 된다(iOS `AuthViewModel.applyFreshPlan` 의 순번 가드와 같다).
     *
     * 예: 진입 갱신이 떠 있는 동안 결제 뒤의 갱신이 먼저 돌아와 `plus` 를 적었는데, 진입 갱신의 옛 `free` 가 뒤에 도착해
     * 덮으면 방금 산 사람을 다음 조회까지 무료로 그린다.
     *
     * ⚠ **쓰기 전에** 부른다. true 면 그 순번을 잡는다 — 쓰기가 뒤에 문에서 거절돼도 옛 답이 그 자리를 차지하지 못한다.
     */
    fun claimPlanAnswer(request: AccountRequest): Boolean {
        if (request.seq < planAnswerSeq) return false
        planAnswerSeq = request.seq
        return true
    }

    /**
     * [request] 의 응답이 **plan 스냅샷에 반영됐다**([planAnsweredThisRun]). [claimPlanAnswer] 를 지난 답만 부른다 — 그래도
     * 한 번 더 본다: 더 새 답이 plan 을 차지했으면 옛 답은 지금의 plan 이 아니다.
     */
    fun recordPlanApplied(request: AccountRequest) {
        if (request.seq < planAnswerSeq) return
        planAnsweredThisRun = true
    }

    /**
     * 계정이 바뀐다(세션 정리) — 앞 계정의 값이 새 계정에 새면 안 된다.
     *
     * ⚠ **순번은 되돌리지 않고 앞지른다.** 떠 있던 요청의 응답은 앞 계정의 것이다 — plan 순번을 지금까지 뜬 요청보다 크게
     * 두면 그 응답들이 전부 옛 것으로 버려지고, 이 뒤에 뜨는 요청은 그 값과 같은 순번을 받아 통과한다.
     */
    fun resetForAccountSwitch() {
        planAnsweredThisRun = false
        planAnswerSeq = requestSeq + 1
    }
}
