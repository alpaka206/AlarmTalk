package com.alarmtalk.app

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.TextFieldColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp

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
/**
 * 한 줄에 나란히 놓이는 컨트롤의 **공통 치수** — 입력칸과 그 옆 버튼이 같이 쓴다.
 *
 * ⚠ **기본값끼리 두면 어긋난다.** M3 `OutlinedTextField` 는 56, `Button` 은 40 이라
 * 그냥 나란히 두면 **버튼만 16dp 낮게** 앉는다(코드 등록 화면이 그랬다 — 2026-08-17).
 *
 * ⚠ **맞추는 방향은 '버튼을 키우기' 가 아니라 '입력칸을 줄이기' 다**(같은 날 지시).
 * 56 짜리 버튼은 한 줄 액션치고 너무 크다. 그래서 **48**(안드로이드 최소 터치 타깃)로
 * 내리고, 입력칸은 M3 기본형 대신 컴팩트 필드(`IosAlertField`)를 쓴다 —
 * `OutlinedTextField` 는 최소 높이가 56이라 48로 내리면 글자가 잘린다.
 *
 * **iOS 도 같은 값을 쓴다**(`AlarmTalkControl`) — 두 앱의 버튼 크기를 맞춘 기준점이라
 * 한쪽만 바꾸지 말 것. 폭도 마찬가지다: 라벨이 짧아도 이 최소 폭은 지킨다(번역이 길어지면
 * 자연히 늘어난다).
 */
internal val WakerControlHeight = 48.dp
internal val WakerControlMinWidth = 88.dp

internal val WakerScrimColor = Color(0xBD05080E)

// 탭·하위 전체화면이 공유하는 새벽 네이비 그라데이션 배경(로그인 딥네이비 감성)의 단일 출처.
// 탭(AlarmListScreen)과 설정/구성원 관리/약관 동의 등 하위 화면이 같은 브러시를 써서
// 화면 전환 시 배경 톤이 튀지 않는다. 라이트/다크 2종.
internal val HomeGradientDark = androidx.compose.ui.graphics.Brush.verticalGradient(
    0f to Color(0xFF1A2A52),
    0.55f to Color(0xFF0E1938),
    1f to Color(0xFF070C1D),
)
internal val HomeGradientLight = androidx.compose.ui.graphics.Brush.verticalGradient(
    0f to Color(0xFFF4F7FD),
    0.5f to Color(0xFFDBE6F7),
    1f to Color(0xFFBED2EF),
)

/** 현재 테마 명암에 맞는 홈 그라데이션 — 시스템 값이 아니라 앱이 실제 쓰는 컬러스킴 기준. */
@Composable
internal fun homeGradientBrush(): androidx.compose.ui.graphics.Brush =
    if (MaterialTheme.colorScheme.background.luminance() < 0.5f) HomeGradientDark else HomeGradientLight


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
/**
 * 채움 버튼 색 — **비활성일 때 글자가 읽히도록** 한다.
 *
 * ⚠ **M3 기본값을 그대로 쓰지 말 것**(2026-08-17 "등록 버튼 글씨가 안 보인다").
 * 기본 비활성은 컨테이너 `onSurface@12%` + 글자 `onSurface@38%` 인데, 우리 딥네이비
 * 위에서는 그 둘이 **대비 2.8:1** 까지 떨어진다(코드 등록 버튼 실측). 비활성은 '못 누른다'
 * 는 신호이지 **글자를 지우라는 뜻이 아니다** — 무엇을 누르려 했는지는 계속 보여야 한다.
 *
 * 값: 컨테이너 `surfaceVariant`(카드 위에서 버튼 모양이 남는 최소 밝기) + 글자
 * `onSurfaceVariant`(대비 약 5:1). 활성 색은 기본값 그대로다.
 */
@Composable
internal fun wakerButtonColors() =
    ButtonDefaults.buttonColors(
        disabledContainerColor = MaterialTheme.colorScheme.surfaceVariant,
        disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
    )

internal fun wakerOutlinedButtonColors() =
    ButtonDefaults.outlinedButtonColors(
        contentColor = MaterialTheme.colorScheme.onSurface,
        // ⚠ **알파를 다시 깎지 말 것**(2026-08-17). 42% 는 딥네이비 위에서 대비 **2.34:1**
        // 이라 글자가 지워진 것처럼 보였다. 비활성은 '못 누른다' 는 신호이지 무엇을 누르려
        // 했는지까지 감추라는 뜻이 아니다 — 색을 한 단계 낮추는 것으로 충분하다(약 6:1).
        disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
    )

/**
 * 눌림 스케일 피드백(0.97) — 카드형 프레서블 공통 토큰. 리플과 별개로 누르는 순간
 * 살짝 눌리는 물성을 줘 '듣고 있다'는 즉각 반응을 만든다. 스와이프 등 드래그 제스처와
 * 겹치는 행(AlarmRow)에는 쓰지 않는다(제스처 시작마다 움찔거림).
 * 사용: 컴포넌트에 같은 interactionSource 를 넘기고 이 Modifier 를 붙인다.
 */
@Composable
internal fun Modifier.wakerPressScale(interactionSource: InteractionSource): Modifier {
    val pressed by interactionSource.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.97f else 1f,
        animationSpec = spring(
            dampingRatio = Spring.DampingRatioNoBouncy,
            stiffness = Spring.StiffnessMedium,
        ),
        label = "wakerPressScale",
    )
    return graphicsLayer {
        scaleX = scale
        scaleY = scale
    }
}

/**
 * **고정 자리에 들어가는 큰 한 줄 글자**를 가용 폭에 맞춰 줄이는 배율.
 *
 * ⚠ **아무 데나 쓰지 말 것.** 글꼴을 키운 사용자의 설정을 앱이 도로 취소하는 셈이 된다.
 * 쓰는 기준은 하나다 — **줄바꿈으로 흐를 수 없는 자리**인가:
 *
 * | 쓴다 | 안 쓴다 |
 * | --- | --- |
 * | 울림 화면 시계 — 자다 깬 사람이 읽는 유일한 정보. 겹치면 화면이 무용지물 | 본문·설명 — 커지면 스크롤로 흐르게 둔다 |
 * | 편집기 타임휠 — 3칸 높이가 고정된 컨트롤 | 섹션 제목 — 줄이 늘어나도 된다 |
 * | 하단 액션 버튼 라벨 — 폭이 반으로 고정 | 알람 목록 행 — 행 높이가 늘어날 뿐 안 깨진다 |
 *
 * 식은 `가용 폭 ÷ (기준 폭 × 글꼴 배율)` 이다. **글꼴 배율로 나누는 것이 핵심** —
 * 폭은 dp 라 사용자가 글꼴을 키워도 그대로인데 글자만 커져서 넘치기 때문이다.
 *
 * @param availableWidth `BoxWithConstraints` 의 `maxWidth`
 * @param referenceWidth 축소 없이 들어가는 폭
 * @param minimumScale 아무리 좁아도 이보다 더 줄이지 않는다(읽을 수 없어지면 의미가 없다)
 */
@Composable
internal fun fitToWidthScale(
    availableWidth: Dp,
    referenceWidth: Dp,
    minimumScale: Float = 0.45f,
): Float {
    val fontScale = LocalDensity.current.fontScale
    if (referenceWidth <= 0.dp || fontScale <= 0f) return 1f
    return (availableWidth / (referenceWidth * fontScale)).coerceIn(minimumScale, 1f)
}

/**
 * 위 배율과 **짝을 이루는 `dp` 치수용 배율**. 글꼴 배율로 나누지 **않는다.**
 *
 * ⚠ **`fitToWidthScale` 을 dp 에 곱하지 말 것.** 그게 실제 버그였다 — 타임휠의
 * '오전/오후' 상자가 `96.dp * fitToWidthScale(...)` 이었는데, 글자 크기는 `sp` 라
 * 글꼴 배율이 이미 반영돼 배율의 나눗셈과 상쇄되는 반면 **상자만 글꼴 배율만큼
 * 좁아졌다.** 그래서 화면 폭과 무관하게 **글꼴 배율 1.26 을 넘는 순간**(삼성 기본
 * 슬라이더 최대치가 1.3이다) 글자가 상자를 넘고, `clipToBounds` 가 좌우를 잘라내
 * 오전인지 오후인지 읽을 수 없었다 — 12시간 어긋난 알람을 저장하게 된다.
 *
 * 정리하면: **`sp` 에는 [fitToWidthScale], `dp` 에는 이 함수.**
 */
@Composable
internal fun fitToWidthBoxScale(
    availableWidth: Dp,
    referenceWidth: Dp,
    minimumScale: Float = 0.45f,
): Float {
    if (referenceWidth <= 0.dp) return 1f
    return (availableWidth / referenceWidth).coerceIn(minimumScale, 1f)
}
