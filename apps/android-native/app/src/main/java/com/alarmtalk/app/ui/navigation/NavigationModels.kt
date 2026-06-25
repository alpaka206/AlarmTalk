package com.alarmtalk.app

import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.People
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.VoucherItem

internal data class SocialSnapshot(
    val familyGroup: FamilyGroupCurrentResponse,
    val familyVoices: List<FamilyVoiceProfile>,
)

internal data class BillingSnapshot(
    val subscription: BillingSubscriptionResponse,
    val vouchers: List<VoucherItem>,
)

internal data class SubscriptionPlanOption(
    val key: String,
    val name: String,
    val price: String,
    val description: String,
    val features: List<String>,
)

internal enum class NativeTab {
    Home,
    Voices,
    Alarms,
    People,
    Messages,
    Billing,
}

internal const val MAX_VOICE_PROFILES = 1
