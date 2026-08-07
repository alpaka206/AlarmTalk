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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.isSpecified
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt
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
    // 시계에 박스를 두지 않고 배경에 시간 휠만 띄운다(삼성 시계식). 글자는 배경 대비로.
    val wheelBackgroundColor = Color.Transparent
    val selectedTextColor = MaterialTheme.colorScheme.onSurface
    val unselectedTextColor = MaterialTheme.colorScheme.onSurface

    LaunchedEffect(hour, minute) {
        workingHour = hour
        workingMinute = minute
    }

    fun commitTime(nextHour: Int, nextMinute: Int) {
        workingHour = nextHour
        workingMinute = nextMinute
        currentOnTimeChange(nextHour, nextMinute)
    }

    fun applyHourSteps(steps: Int) {
        if (steps == 0) return
        commitTime(floorMod(workingHour + steps, 24), workingMinute)
    }

    fun applyMinuteSteps(steps: Int) {
        if (steps == 0) return
        commitTime(workingHour, floorMod(workingMinute + steps, 60))
    }

    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        // 좁은 화면(360dp급, S22 등)에선 오전/오후 고정폭 + displayLarge 숫자가 컬럼 폭을
        // 넘어 분 숫자 오른쪽이 잘렸다 — 가용 폭에 비례해 휠 타이포·고정폭을 함께 줄인다.
        // 392dp 이상(대부분의 큰 폰)은 1.0 그대로.
        // ⚠ **글꼴 배율까지 함께 본다**(`fitToWidthScale`). 예전에는 폭만 나눠서, 폭이
        // 넉넉해도 사용자가 글꼴을 키우면 숫자가 컬럼을 넘어 잘렸다.
        val wheelScale = fitToWidthScale(maxWidth, 392.dp, minimumScale = 0.78f)
        val scaledItemHeight = itemHeight * wheelScale
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
                    onStep = { steps ->
                        if (abs(steps) % 2 == 1) {
                            commitTime((workingHour + 12) % 24, workingMinute)
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
                    modifier = Modifier.weight(1f),
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
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

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
