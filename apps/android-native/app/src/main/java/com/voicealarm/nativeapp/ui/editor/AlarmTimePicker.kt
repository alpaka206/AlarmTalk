package com.voicealarm.nativeapp

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt

@Composable
internal fun AlarmTimePickerCard(
    hour: Int,
    minute: Int,
    onTimeChange: (Int, Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val currentOnTimeChange by rememberUpdatedState(onTimeChange)
    val itemHeight = 72.dp
    val verticalWheelPadding = 24.dp
    var workingHour by remember { mutableIntStateOf(hour) }
    var workingMinute by remember { mutableIntStateOf(minute) }
    val wheelBackgroundColor = MaterialTheme.colorScheme.primaryContainer
    val selectedTextColor = MaterialTheme.colorScheme.onPrimaryContainer
    val unselectedTextColor = MaterialTheme.colorScheme.onPrimaryContainer

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

    Column(
        modifier = modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp),
            shape = RoundedCornerShape(34.dp),
            color = wheelBackgroundColor,
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(itemHeight * 3 + verticalWheelPadding * 2)
                    .padding(horizontal = 22.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AmPmWheelColumn(
                    hour = workingHour,
                    itemHeight = itemHeight,
                    selectedTextColor = selectedTextColor,
                    unselectedTextColor = unselectedTextColor,
                    onStep = { steps ->
                        if (abs(steps) % 2 == 1) {
                            commitTime((workingHour + 12) % 24, workingMinute)
                        }
                    },
                )
                DraggableTimeWheelColumn(
                    itemHeight = itemHeight,
                    selectedTextColor = selectedTextColor,
                    unselectedTextColor = unselectedTextColor,
                    itemLabel = { offset -> "%d".format(hour12(workingHour + offset)) },
                    maxStepsPerGesture = 15,
                    onStep = ::applyHourSteps,
                    modifier = Modifier.weight(1f),
                )
                Box(
                    modifier = Modifier
                        .width(36.dp)
                        .height(itemHeight * 3),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = ":",
                        style = MaterialTheme.typography.displayLarge,
                        fontWeight = FontWeight.Bold,
                        color = selectedTextColor,
                        textAlign = TextAlign.Center,
                    )
                }
                DraggableTimeWheelColumn(
                    itemHeight = itemHeight,
                    selectedTextColor = selectedTextColor,
                    unselectedTextColor = unselectedTextColor,
                    itemLabel = { offset -> "%02d".format(floorMod(workingMinute + offset, 60)) },
                    maxStepsPerGesture = 15,
                    onStep = ::applyMinuteSteps,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}
