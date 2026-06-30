package com.alarmtalk.app

import androidx.compose.material3.Typography
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight


internal val AlarmTalkFontFamily = FontFamily(
    Font(R.font.pretendard_regular, FontWeight.Normal),
    Font(R.font.pretendard_medium, FontWeight.Medium),
    Font(R.font.pretendard_semibold, FontWeight.SemiBold),
    Font(R.font.pretendard_bold, FontWeight.Bold),
)

internal val AlarmTalkTypography = Typography().let { base ->
    base.copy(
        displayLarge = base.displayLarge.copy(fontFamily = AlarmTalkFontFamily),
        displayMedium = base.displayMedium.copy(fontFamily = AlarmTalkFontFamily),
        displaySmall = base.displaySmall.copy(fontFamily = AlarmTalkFontFamily),
        headlineLarge = base.headlineLarge.copy(fontFamily = AlarmTalkFontFamily),
        headlineMedium = base.headlineMedium.copy(fontFamily = AlarmTalkFontFamily),
        headlineSmall = base.headlineSmall.copy(fontFamily = AlarmTalkFontFamily),
        titleLarge = base.titleLarge.copy(fontFamily = AlarmTalkFontFamily),
        titleMedium = base.titleMedium.copy(fontFamily = AlarmTalkFontFamily),
        titleSmall = base.titleSmall.copy(fontFamily = AlarmTalkFontFamily),
        bodyLarge = base.bodyLarge.copy(fontFamily = AlarmTalkFontFamily),
        bodyMedium = base.bodyMedium.copy(fontFamily = AlarmTalkFontFamily),
        bodySmall = base.bodySmall.copy(fontFamily = AlarmTalkFontFamily),
        labelLarge = base.labelLarge.copy(fontFamily = AlarmTalkFontFamily),
        labelMedium = base.labelMedium.copy(fontFamily = AlarmTalkFontFamily),
        labelSmall = base.labelSmall.copy(fontFamily = AlarmTalkFontFamily),
    )
}
