package com.alarmtalk.app

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp


internal val AlarmTalkFontFamily = FontFamily(
    Font(R.font.pretendard_regular, FontWeight.Normal),
    Font(R.font.pretendard_medium, FontWeight.Medium),
    Font(R.font.pretendard_semibold, FontWeight.SemiBold),
    Font(R.font.pretendard_bold, FontWeight.Bold),
)

private fun TextStyle.alarmTalkTextStyle(): TextStyle = copy(
    fontFamily = AlarmTalkFontFamily,
    letterSpacing = 0.sp,
)

internal val AlarmTalkTypography = Typography().let { base ->
    base.copy(
        displayLarge = base.displayLarge.alarmTalkTextStyle(),
        displayMedium = base.displayMedium.alarmTalkTextStyle(),
        displaySmall = base.displaySmall.alarmTalkTextStyle(),
        headlineLarge = base.headlineLarge.alarmTalkTextStyle(),
        headlineMedium = base.headlineMedium.alarmTalkTextStyle(),
        headlineSmall = base.headlineSmall.alarmTalkTextStyle(),
        titleLarge = base.titleLarge.alarmTalkTextStyle(),
        titleMedium = base.titleMedium.alarmTalkTextStyle(),
        titleSmall = base.titleSmall.alarmTalkTextStyle(),
        bodyLarge = base.bodyLarge.alarmTalkTextStyle(),
        bodyMedium = base.bodyMedium.alarmTalkTextStyle(),
        bodySmall = base.bodySmall.alarmTalkTextStyle(),
        labelLarge = base.labelLarge.alarmTalkTextStyle(),
        labelMedium = base.labelMedium.alarmTalkTextStyle(),
        labelSmall = base.labelSmall.alarmTalkTextStyle(),
    )
}
