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
    // 공유 목소리 목록이 이번에 API 로 '신선하게' 로드됐는지(실패 시 옛 목록 폴백이면 false).
    // 접근권 잃은 목소리 알람 강등 판단은 신선 로드일 때만 신뢰한다.
    val familyVoicesFresh: Boolean = false,
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
    Voices,
    Alarms,
    People,
    Billing,
    Menu,
}

internal const val MAX_VOICE_PROFILES = 1
