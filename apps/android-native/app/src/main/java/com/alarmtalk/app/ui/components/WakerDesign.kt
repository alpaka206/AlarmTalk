package com.alarmtalk.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.TextFieldColors
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.dp

// ─────────────────────────────────────────────────────────────────────────────
// 디자인 토큰 — 모서리 반경(코너 radius)의 단일 출처(single source of truth).
//
// 새 화면/컴포넌트는 생 RoundedCornerShape(n.dp) 대신 아래 토큰을 가져다 쓴다.
// MaterialTheme.shapes(AlarmTalkTheme.kt)도 이 값들에서 파생되므로, shape 를
// 지정하지 않은 M3 컴포넌트(Card/Dialog/Chip/TextField 기본형)까지 같은 스케일을 따른다.
//
// 예외(토큰화하지 않음): CircleShape(완전 원형 아바타/FAB/점), AlarmRow 스와이프
// 비대칭 shape, 타임휠 전용 컨테이너 — 의도적 형태이므로 토큰 스케일에 흡수하지 않는다.
// ─────────────────────────────────────────────────────────────────────────────
internal val WakerTileShape = RoundedCornerShape(12.dp)    // 작은 타일·아이콘 박스·인라인 배너
internal val WakerChipShape = RoundedCornerShape(14.dp)    // 칩·세그먼트·작은 카드/리스트 행
internal val WakerInputShape = RoundedCornerShape(18.dp)   // 입력 필드(OutlinedTextField)
internal val WakerButtonShape = RoundedCornerShape(18.dp)  // 버튼
internal val WakerPanelShape = RoundedCornerShape(18.dp)   // 표준 콘텐츠 카드/패널(구 16dp 흡수)
internal val WakerCardShape = RoundedCornerShape(22.dp)    // 큰 콘텐츠 카드
internal val WakerHeroShape = RoundedCornerShape(24.dp)    // 히어로/프로미넌트 카드(홈 NextAlarm), 타임피커 전용 다이얼로그
internal val WakerDialogShape = RoundedCornerShape(28.dp)  // 모든 모달 다이얼로그 컨테이너 표준(M3 extra-large=28dp, AlertDialog 기본과 일치)
internal val WakerSheetShape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp) // 바텀시트 컨테이너 표준(다이얼로그 28dp와 동일 스케일, 상단만)
internal val WakerPillShape = RoundedCornerShape(999.dp)   // 완전 캡슐(pill) — 진행바·세그먼트·상태 배지

/** 오버레이/코치마크 스크림 — 테마 무관 고정 농도 rgba(5,8,14,.74). */
internal val WakerScrimColor = Color(0xBD05080E)

/**
 * 랜딩 일출 팔레트의 웜 액센트(sunGlow #FFD494) — 홈 히어로 등 브랜드 '새벽' 글로우 전용.
 * colorScheme 밖의 문서화된 브랜드 비주얼 예외(WakerScrimColor 와 같은 층위).
 */
internal val WakerDawnGlowColor = Color(0xFFFFD494)

@Composable
internal fun wakerCardBorder(alpha: Float = 1f): BorderStroke {
    // 다크에서는 테두리를 옅게 깔아 '와이어프레임' 인상을 줄이고 표면 대비에 기댄다.
    // 라이트는 흰 카드가 배경과 붙지 않도록 기존 농도를 유지한다.
    val darkScheme = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val base = if (darkScheme) 0.62f else 1f
    return BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = base * alpha))
}

@Composable
internal fun wakerOutlinedTextFieldColors(): TextFieldColors =
    OutlinedTextFieldDefaults.colors(
        focusedBorderColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.78f),
        unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
        disabledBorderColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.42f),
        errorBorderColor = MaterialTheme.colorScheme.error,
        focusedContainerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.34f),
        unfocusedContainerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.74f),
        disabledContainerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.24f),
        cursorColor = MaterialTheme.colorScheme.primary,
        focusedLabelColor = MaterialTheme.colorScheme.primary,
        unfocusedLabelColor = MaterialTheme.colorScheme.onSurfaceVariant,
    )

@Composable
internal fun wakerOutlinedButtonColors() =
    ButtonDefaults.outlinedButtonColors(
        contentColor = MaterialTheme.colorScheme.onSurface,
        disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.42f),
    )
