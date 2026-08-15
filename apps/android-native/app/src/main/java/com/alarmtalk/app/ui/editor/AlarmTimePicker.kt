package com.alarmtalk.app

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.isSpecified
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt
import com.alarmtalk.app.fitToWidthBoxScale
import com.alarmtalk.app.fitToWidthScale

@Composable
internal fun AlarmTimePickerCard(
    hour: Int,
    minute: Int,
    onTimeChange: (Int, Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val currentOnTimeChange by rememberUpdatedState(onTimeChange)
    // 휠 글자는 sp(폰트 스케일에 비례)인데 행 높이가 고정 dp 면 큰 글꼴 설정에서 숫자가 잘린다.
    // 시스템 폰트 스케일에 맞춰 행 높이를 키우되, 과도한 확대는 1.5배로 제한해 레이아웃 균형을 유지한다.
    val fontScale = LocalDensity.current.fontScale.coerceIn(1f, 1.5f)
    // 박스를 없앤 만큼 위아래 숫자 간격을 넉넉히(삼성 시계 편집기 수준) 벌린다.
    val itemHeight = 92.dp * fontScale
    val verticalWheelPadding = 24.dp
    var workingHour by remember { mutableIntStateOf(hour) }
    var workingMinute by remember { mutableIntStateOf(minute) }
    // 지금 그 자리에서 고쳐 쓰는 칼럼. 두 칼럼이 **함께** 본다 — 한쪽을 고치는 동안
    // 양쪽의 회색 이웃 숫자를 숨기기 위해서다(iOS `TimeWheelPicker` 의 `editingColumn` 과 같다).
    var editingColumn by remember { mutableStateOf<WheelColumn?>(null) }
    // 그 자리 입력에서 치고 있는 숫자. **칼럼이 아니라 여기 둔다**
    // (`DraggableTimeWheelColumn.draft` 주석 참조).
    var typeInDraft by remember { mutableStateOf("") }
    // 시계에 박스를 두지 않고 배경에 시간 휠만 띄운다(삼성 시계식). 글자는 배경 대비로.
    val wheelBackgroundColor = Color.Transparent
    val selectedTextColor = MaterialTheme.colorScheme.onSurface
    val unselectedTextColor = MaterialTheme.colorScheme.onSurface

    // 편집이 완전히 끝났을 때만 키보드를 내린다 — 시 → 분으로 옮겨가는 중에는 내리지 않는다
    // (`DraggableTimeWheelColumn` 의 `onEndEdit` 주석 참조).
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(editingColumn) {
        if (editingColumn == null) keyboard?.hide()
    }

    // 우리가 방금 부모에 올려보낸 값. 그게 되돌아왔을 때 **굴러가는 중인 숫자를 덮지 않으려고**
    // 기억한다(아래 sync `LaunchedEffect` 참조).
    var lastPushed by remember { mutableStateOf(hour to minute) }

    // 바깥에서 시각이 바뀌면(기존 알람을 열 때 등) 휠을 맞춘다.
    // ⚠ **우리가 올린 값이 되돌아온 것은 무시한다.** 값 확정은 손을 뗀 순간이고 숫자는 그
    // 뒤 최대 0.72초 동안 굴러가는데, 그 되돌이를 그대로 받으면 **굴러가던 숫자가 도착점으로
    // 순간이동해** 애니메이션이 잘린다.
    LaunchedEffect(hour, minute) {
        if (hour to minute == lastPushed) return@LaunchedEffect
        workingHour = hour
        workingMinute = minute
    }

    /** 보이는 숫자만 굴린다 — 편집기 상태는 건드리지 않는다. */
    fun rollTime(nextHour: Int, nextMinute: Int) {
        workingHour = nextHour
        workingMinute = nextMinute
    }

    /**
     * 값만 편집기로 올린다 — **보이는 숫자는 건드리지 않는다.**
     *
     * ⚠ **튕김 확정(`onSettle`)에는 반드시 이쪽을 쓴다.** `pushTime` 을 쓰면 두 가지가 한꺼번에
     * 망가진다(2026-08-15 실측, 이웃 숫자 한 번 탭에 값이 1 → 2 → 3):
     *  1. 보이는 숫자가 **즉시 최종치로 뛴다** — 굴러갈 게 남지 않아 "갑자기 결과치로 가 있다".
     *  2. 그 뒤 굴러가는 애니메이션이 `onStep` 으로 같은 칸을 **또 더해** 값이 넘친다.
     *
     * 굴리는 것은 애니메이션(`animateWheelSettle` → `onStep`)이 맡고, 여기서는 **그 애니메이션이
     * 도착할 값**을 미리 편집기에 알려 줄 뿐이다(도착 전에 저장을 눌러도 화면과 같은 값이 저장되게).
     */
    fun pushOnly(nextHour: Int, nextMinute: Int) {
        lastPushed = nextHour to nextMinute
        currentOnTimeChange(nextHour, nextMinute)
    }

    /**
     * 값을 확정해 편집기로 올린다.
     *
     * ⚠ **드래그 중에는 부르지 말 것**(`DraggableTimeWheelColumn.onSettle` 주석 참조).
     * 한 칸마다 부르면 편집기의 요약 카드·`LaunchedEffect` 가 **칸이 바뀌는 그 프레임**에
     * 함께 돌아 휠이 툭툭 끊긴다.
     */
    fun pushTime(nextHour: Int, nextMinute: Int) {
        rollTime(nextHour, nextMinute)
        pushOnly(nextHour, nextMinute)
    }


    /**
     * 그 자리 입력에서 친 숫자를 값으로 넣는다.
     *
     * 범위를 벗어나면 **거절하지 않고 잘라서** 넣는다 — 취소 버튼이 없어서 거절하면
     * 친 게 조용히 사라진다.
     */
    fun applyDraft(column: WheelColumn, typed: Int?) {
        if (typed == null) return
        when (column) {
            // 사용자는 화면에 보이는 **12시간** 숫자를 넣는다 — 지금 오전/오후를 유지한 채
            // 24시간으로 되돌린다(오전/오후는 그 칼럼으로 바꾼다).
            WheelColumn.Hour -> {
                val display = typed.coerceIn(1, 12)
                val base = if (display == 12) 0 else display
                pushTime(base + if (workingHour >= 12) 12 else 0, workingMinute)
            }
            WheelColumn.Minute -> pushTime(workingHour, typed.coerceIn(0, 59))
        }
    }

    /**
     * 그 자리 입력을 연다.
     *
     * ⚠ **다른 칼럼을 치던 중이면 그 값을 여기서 확정한다.** 이게 이 함수의 존재 이유다 —
     * 칼럼 전환과 값 확정이 **한 번의 상태 변경**이어야 옛 값이 한 프레임 비치지 않는다
     * (`DraggableTimeWheelColumn.draft` 주석의 실측 참조).
     */
    fun beginEdit(column: WheelColumn) {
        editingColumn?.takeIf { it != column }?.let { applyDraft(it, typeInDraft.toIntOrNull()) }
        typeInDraft = ""
        editingColumn = column
    }

    /** 입력이 끝났다(바깥 탭·키패드 완료). */
    fun endEdit(column: WheelColumn) {
        // 다른 칼럼이 이미 넘겨받았으면 값도 그쪽으로 넘어갔다 — 건드리지 않는다.
        if (editingAfterCommit(editingColumn, column) != null) return
        applyDraft(column, typeInDraft.toIntOrNull())
        typeInDraft = ""
        editingColumn = null
    }

    fun applyHourSteps(steps: Int) {
        if (steps == 0) return
        rollTime(floorMod(workingHour + steps, 24), workingMinute)
    }

    fun applyMinuteSteps(steps: Int) {
        if (steps == 0) return
        rollTime(workingHour, floorMod(workingMinute + steps, 60))
    }

    // ⚠ **이 컨트롤만 글꼴 배율에 상한을 둔다.** 타임휠은 3칸 높이·고정 폭이라 글자가
    // 흐를 데가 없고, 축소 하한(0.78)만으로는 배율 2.0 을 감당하지 못해 '오전/오후' 와
    // 분 숫자가 잘렸다 — 오전/오후를 못 읽으면 12시간 어긋난 알람을 저장하게 된다.
    // iOS 도 같은 이유로 `.dynamicTypeSize(...DynamicTypeSize.xxLarge)` 로 막는다.
    // ⚠ 앱 전체에 걸지 말 것 — 그건 사용자가 키운 글꼴을 도로 취소하는 셈이다(CLAUDE.md).
    val density = LocalDensity.current
    val cappedDensity = remember(density) {
        if (density.fontScale <= MaxWheelFontScale) density
        else Density(density.density, MaxWheelFontScale)
    }
    CompositionLocalProvider(LocalDensity provides cappedDensity) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        // 좁은 화면(360dp급, S22 등)에선 오전/오후 고정폭 + displayLarge 숫자가 컬럼 폭을
        // 넘어 분 숫자 오른쪽이 잘렸다 — 가용 폭에 비례해 휠 타이포·고정폭을 함께 줄인다.
        // 392dp 이상(대부분의 큰 폰)은 1.0 그대로.
        // ⚠ **글꼴 배율까지 함께 본다**(`fitToWidthScale`). 예전에는 폭만 나눠서, 폭이
        // 넉넉해도 사용자가 글꼴을 키우면 숫자가 컬럼을 넘어 잘렸다.
        val wheelScale = fitToWidthScale(maxWidth, 392.dp, minimumScale = 0.78f)
        // ⚠ **dp 치수에는 이쪽을 쓴다**(글꼴 배율로 나누지 않는 배율). sp 에 쓰는
        // `wheelScale` 을 dp 에 곱하면 글꼴을 키울수록 상자만 좁아져 글자가 잘린다.
        val wheelBoxScale = fitToWidthBoxScale(maxWidth, 392.dp, minimumScale = 0.78f)
        val scaledItemHeight = itemHeight * wheelBoxScale
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(34.dp),
            color = wheelBackgroundColor,
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(scaledItemHeight * 3 + verticalWheelPadding * 2)
                    // 외곽이 8→24dp 로 정렬되며 콘텐츠 폭이 32dp 줄어든 만큼, 숫자 컬럼 폭을
                    // 지키려고 비핵심 여백(행 패딩 22→12, 컬럼 간격 16→12)에서 정확히 32dp 회수.
                    .padding(horizontal = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AmPmWheelColumn(
                    hour = workingHour,
                    itemHeight = scaledItemHeight,
                    selectedTextColor = selectedTextColor,
                    unselectedTextColor = unselectedTextColor,
                    textScale = wheelScale,
                    boxScale = wheelBoxScale,
                    // 오전/오후는 두 값뿐이라 굴러가는 구간이 없다 — 곧바로 확정한다.
                    onStep = { steps ->
                        if (abs(steps) % 2 == 1) {
                            pushTime((workingHour + 12) % 24, workingMinute)
                        }
                    },
                )
                DraggableTimeWheelColumn(
                    itemHeight = scaledItemHeight,
                    selectedTextColor = selectedTextColor,
                    unselectedTextColor = unselectedTextColor,
                    itemLabel = { offset -> "%d".format(hour12(workingHour + offset)) },
                    maxStepsPerGesture = 15,
                    textScale = wheelScale,
                    onStep = ::applyHourSteps,
                    onSettle = { steps -> pushOnly(floorMod(workingHour + steps, 24), workingMinute) },
                    modifier = Modifier.weight(1f),
                    editable = true,
                    isEditing = editingColumn == WheelColumn.Hour,
                    anyEditing = editingColumn != null,
                    onBeginEdit = { beginEdit(WheelColumn.Hour) },
                    draft = typeInDraft,
                    onDraftChange = { typeInDraft = it },
                    onEndEdit = { endEdit(WheelColumn.Hour) },
                )
                Box(
                    modifier = Modifier
                        .width(36.dp * wheelScale)
                        .height(scaledItemHeight * 3),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = ":",
                        style = MaterialTheme.typography.displayLarge.scaledBy(wheelScale),
                        fontWeight = FontWeight.Bold,
                        color = selectedTextColor,
                        textAlign = TextAlign.Center,
                    )
                }
                DraggableTimeWheelColumn(
                    itemHeight = scaledItemHeight,
                    selectedTextColor = selectedTextColor,
                    unselectedTextColor = unselectedTextColor,
                    itemLabel = { offset -> "%02d".format(floorMod(workingMinute + offset, 60)) },
                    maxStepsPerGesture = 15,
                    textScale = wheelScale,
                    onStep = ::applyMinuteSteps,
                    onSettle = { steps -> pushOnly(workingHour, floorMod(workingMinute + steps, 60)) },
                    modifier = Modifier.weight(1f),
                    editable = true,
                    isEditing = editingColumn == WheelColumn.Minute,
                    anyEditing = editingColumn != null,
                    onBeginEdit = { beginEdit(WheelColumn.Minute) },
                    draft = typeInDraft,
                    onDraftChange = { typeInDraft = it },
                    onEndEdit = { endEdit(WheelColumn.Minute) },
                )
            }
        }
    }
    }
}

/// 그 자리에서 고쳐 쓸 수 있는 칼럼. 오전/오후는 두 값뿐이라 타이핑할 게 없어 빠져 있다.
internal enum class WheelColumn { Hour, Minute }

/**
 * 한 칼럼이 입력을 끝냈을 때 **다음 편집 대상**.
 *
 * ⚠ **무조건 null 을 넣지 말 것**(2026-08-15 지적: "시에서 분으로 눌렀을 때 입력이 꺼져").
 * 시를 치다가 분을 누르면 두 가지가 잇달아 일어난다 —
 *  1. 분이 `onBeginEdit` 으로 자리를 넘겨받는다(`editingColumn = Minute`).
 *  2. 시가 포커스를 잃어 `onEndEdit` 으로 들어온다.
 * (2)가 무조건 끄면 (1)을 덮어 **입력이 통째로 닫힌다.** 그래서 **자기 차례일 때만** 끈다.
 * 순서가 반대로 와도(먼저 끄고 나중에 넘겨받아도) 같은 결과라 어느 쪽에도 기대지 않는다.
 *
 * 짝이 되는 규약이 하나 더 있다: **키보드는 여기서 내리지 않는다.** 내리는 판단은
 * `editingColumn` 이 null 이 될 때 한 곳에서만 한다(`DraggableTimeWheelColumn` 의 `onEndEdit` 주석).
 */
internal fun editingAfterCommit(current: WheelColumn?, committed: WheelColumn): WheelColumn? =
    if (current == committed) null else current

/// 타임휠에 허용하는 글꼴 배율 상한. 이 위로는 글자가 컬럼을 넘어 잘린다.
private const val MaxWheelFontScale = 1.3f

// 휠 타이포를 축소 배율에 맞게 줄인다(fontSize·lineHeight 동시 축소, 미지정이면 그대로).
internal fun androidx.compose.ui.text.TextStyle.scaledBy(scale: Float): androidx.compose.ui.text.TextStyle =
    if (scale >= 1f) {
        this
    } else {
        copy(
            fontSize = if (fontSize.isSpecified) fontSize * scale else fontSize,
            lineHeight = if (lineHeight.isSpecified) lineHeight * scale else lineHeight,
        )
    }
