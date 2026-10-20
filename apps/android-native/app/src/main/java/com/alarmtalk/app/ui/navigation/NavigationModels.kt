package com.alarmtalk.app

internal data class SubscriptionPlanOption(
    val key: String,
    val name: String,
    val price: String,
    val features: List<String>,
)

internal enum class NativeTab {
    Voices,
    Alarms,
    Billing,
    Menu,
}
