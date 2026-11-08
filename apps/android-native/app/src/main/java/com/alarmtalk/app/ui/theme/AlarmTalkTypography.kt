package com.alarmtalk.app

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineBreak
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

/**
 * 제목·머리말은 **균형 줄바꿈**이다(2026-11-09 오너 "두 줄씩 되는 거 적절하게 맞춰 놔").
 *
 * 기본 줄바꿈은 앞줄을 꽉 채워서, 두 줄로 넘어가면 마지막 줄에 어절 하나만 남는다 — 알럿 제목이
 * "알림 권한을 허용해야 알람을 설정할 수 / 있어요" 로 갈렸다. `LineBreak.Heading` 은 **같은 줄 수 안에서**
 * 줄 길이를 고르게 나눈다("알림 권한을 허용해야 / 알람을 설정할 수 있어요"). iOS 는 시스템이 이미 마지막 줄의
 * 외톨이 어절을 피한다(`NSLineBreakStrategy.pushOut` — 기본값에 들어 있다) — 이건 그 결을 맞추는 것이다.
 * API 29 아래에서는 기존 줄바꿈과 같다.
 *
 * ⚠ **글자 크기를 깎아 한 줄에 욱여넣지 말 것.** 사용자가 키운 시스템 글꼴을 앱이 도로 줄이는 셈이다(CLAUDE.md
 * 「글자 크기가 자리를 넘칠 때」). 본문은 그대로 둔다 — 긴 문단까지 고르게 나누면 행갈이가 어색해진다.
 */
private fun TextStyle.balancedLines(): TextStyle = copy(lineBreak = LineBreak.Heading)

internal val AlarmTalkTypography = Typography().let { base ->
    base.copy(
        displayLarge = base.displayLarge.alarmTalkTextStyle().balancedLines(),
        displayMedium = base.displayMedium.alarmTalkTextStyle().balancedLines(),
        displaySmall = base.displaySmall.alarmTalkTextStyle().balancedLines(),
        headlineLarge = base.headlineLarge.alarmTalkTextStyle().balancedLines(),
        headlineMedium = base.headlineMedium.alarmTalkTextStyle().balancedLines(),
        headlineSmall = base.headlineSmall.alarmTalkTextStyle().balancedLines(),
        titleLarge = base.titleLarge.alarmTalkTextStyle().balancedLines(),
        titleMedium = base.titleMedium.alarmTalkTextStyle().balancedLines(),
        titleSmall = base.titleSmall.alarmTalkTextStyle().balancedLines(),
        bodyLarge = base.bodyLarge.alarmTalkTextStyle(),
        bodyMedium = base.bodyMedium.alarmTalkTextStyle(),
        bodySmall = base.bodySmall.alarmTalkTextStyle(),
        labelLarge = base.labelLarge.alarmTalkTextStyle(),
        labelMedium = base.labelMedium.alarmTalkTextStyle(),
        labelSmall = base.labelSmall.alarmTalkTextStyle(),
    )
}
