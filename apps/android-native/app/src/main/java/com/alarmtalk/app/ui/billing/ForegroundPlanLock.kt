package com.alarmtalk.app

/** 전경 잠금 이펙트(`AlarmTalkApp`)가 **이번에** 할 일([foregroundPlanLockAction]). */
internal enum class ForegroundPlanLockAction {
    /** 유료 목소리 알람을 기본 알람으로 바꾼다(`MainViewModel.applyFreePlanVoiceLock`). */
    Lock,

    /** 유료로 확정됐다 — 잠근 것을 되돌린다(`MainViewModel.restorePaidVoiceAlarmsIfLocked`). */
    Restore,

    /** 구독 응답은 무권한인데 plan 이 아직 유료일 수 있다 — `/auth/me` 로 plan 을 다시 받는다. */
    RefreshPlan,

    /** 할 일 없다. */
    None,
}

/**
 * 전경 잠금 이펙트의 갈래 — 이펙트는 입력을 모아 이걸 부르고 답대로만 움직인다.
 *
 * 순서가 규칙이다: **확실한 무료가 먼저**(살아 있는 구독 행이 있으면 보류라 잠그지 않는다),
 * 그다음 유료 확정이면 복원, 그다음 구독 응답과 plan 이 어긋나면 plan 재조회.
 *
 * @param definitelyFree `MainViewModel.isDefinitelyFreePlan` — 스토어 확인이 끝났고 판정기가 무료.
 * @param subscriptionRowAlive 구독 응답에 유료 행이 살아 있다(보류 — 되돌릴 수 없는 잠금 금지).
 * @param paidEntitled 판정기가 유료로 확정했다(`PaidVoiceAccess.Entitled`).
 * @param billingNotEntitled 구독 응답이 무권한이다.
 */
internal fun foregroundPlanLockAction(
    signedIn: Boolean,
    definitelyFree: Boolean,
    subscriptionRowAlive: Boolean,
    paidEntitled: Boolean,
    billingNotEntitled: Boolean,
): ForegroundPlanLockAction = when {
    signedIn && definitelyFree && !subscriptionRowAlive -> ForegroundPlanLockAction.Lock
    signedIn && paidEntitled -> ForegroundPlanLockAction.Restore
    billingNotEntitled -> ForegroundPlanLockAction.RefreshPlan
    else -> ForegroundPlanLockAction.None
}
