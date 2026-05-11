package com.voicealarm.nativeapp

import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.People
import com.voicealarm.nativeapp.network.BillingSubscriptionResponse
import com.voicealarm.nativeapp.network.CharacterResponse
import com.voicealarm.nativeapp.network.FamilyGroupCurrentResponse
import com.voicealarm.nativeapp.network.FamilyVoiceProfile
import com.voicealarm.nativeapp.network.VoucherItem

internal data class SocialSnapshot(
    val familyGroup: FamilyGroupCurrentResponse,
    val familyVoices: List<FamilyVoiceProfile>,
)

internal data class CharacterBillingSnapshot(
    val character: CharacterResponse,
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
    Growth,
    Billing,
}

internal const val MAX_VOICE_PROFILES = 1
