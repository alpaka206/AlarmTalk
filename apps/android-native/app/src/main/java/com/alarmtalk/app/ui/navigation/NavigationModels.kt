package com.alarmtalk.app

internal data class SubscriptionPlanOption(
    val key: String,
    val name: String,
    val price: String,
    val features: List<String>,
    /** 지금 받을 수 있는 무료 체험 기간 표시("1개월") — 스토어가 체험 오퍼를 줄 때만. */
    val trialPeriod: String? = null,
)

internal enum class NativeTab {
    Voices,
    Alarms,
    Billing,
    Menu,
}
