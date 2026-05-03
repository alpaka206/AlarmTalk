package com.voicealarm.nativeapp

import androidx.compose.material3.Typography
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight


internal val VoiceAlarmFontFamily = FontFamily(
    Font(R.font.pretendard_regular, FontWeight.Normal),
    Font(R.font.pretendard_medium, FontWeight.Medium),
    Font(R.font.pretendard_semibold, FontWeight.SemiBold),
    Font(R.font.pretendard_bold, FontWeight.Bold),
)

internal val VoiceAlarmTypography = Typography().let { base ->
    base.copy(
        displayLarge = base.displayLarge.copy(fontFamily = VoiceAlarmFontFamily),
        displayMedium = base.displayMedium.copy(fontFamily = VoiceAlarmFontFamily),
        displaySmall = base.displaySmall.copy(fontFamily = VoiceAlarmFontFamily),
        headlineLarge = base.headlineLarge.copy(fontFamily = VoiceAlarmFontFamily),
        headlineMedium = base.headlineMedium.copy(fontFamily = VoiceAlarmFontFamily),
        headlineSmall = base.headlineSmall.copy(fontFamily = VoiceAlarmFontFamily),
        titleLarge = base.titleLarge.copy(fontFamily = VoiceAlarmFontFamily),
        titleMedium = base.titleMedium.copy(fontFamily = VoiceAlarmFontFamily),
        titleSmall = base.titleSmall.copy(fontFamily = VoiceAlarmFontFamily),
        bodyLarge = base.bodyLarge.copy(fontFamily = VoiceAlarmFontFamily),
        bodyMedium = base.bodyMedium.copy(fontFamily = VoiceAlarmFontFamily),
        bodySmall = base.bodySmall.copy(fontFamily = VoiceAlarmFontFamily),
        labelLarge = base.labelLarge.copy(fontFamily = VoiceAlarmFontFamily),
        labelMedium = base.labelMedium.copy(fontFamily = VoiceAlarmFontFamily),
        labelSmall = base.labelSmall.copy(fontFamily = VoiceAlarmFontFamily),
    )
}
