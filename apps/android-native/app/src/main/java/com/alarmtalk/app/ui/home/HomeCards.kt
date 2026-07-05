package com.alarmtalk.app

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.R
import com.alarmtalk.app.WakerHeroShape
import com.alarmtalk.app.WakerPillShape
import com.alarmtalk.app.data.AlarmEntity
import kotlin.math.PI
import kotlin.math.sin

@Composable
internal fun NextAlarmHeroCard(
    nextAlarm: AlarmEntity?,
    onClick: () -> Unit,
) {
    val hasAlarm = nextAlarm != null
    val scheme = MaterialTheme.colorScheme
    Card(
        onClick = onClick,
        shape = WakerHeroShape,
        colors = CardDefaults.cardColors(containerColor = scheme.surface),
        border = BorderStroke(1.dp, scheme.outlineVariant),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    Brush.linearGradient(
                        colors = listOf(
                            scheme.primaryContainer.copy(alpha = 0.55f),
                            scheme.surface,
                        ),
                    ),
                )
                // 하단에 랜딩 일출의 웜 글로우를 옅게 깔아 '새벽' 무드를 잇는다.
                .background(
                    Brush.verticalGradient(
                        0.5f to Color.Transparent,
                        1f to WakerDawnGlowColor.copy(alpha = 0.10f),
                    ),
                )
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    text = if (hasAlarm) stringResource(R.string.hs_next_alarm_label) else stringResource(R.string.hs_no_alarm_yet),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = scheme.primary,
                )
                Text(
                    text = nextAlarm?.let { "%02d:%02d".format(it.hour, it.minute) }
                        ?: stringResource(R.string.hs_reserve_alarm),
                    style = if (hasAlarm) {
                        MaterialTheme.typography.displayLarge
                    } else {
                        MaterialTheme.typography.displaySmall
                    },
                    color = scheme.onSurface,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            HomeVoiceWaveform(
                modifier = Modifier.fillMaxWidth(),
                active = hasAlarm,
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Text(
                        text = nextAlarm?.label?.takeIf { it.isNotBlank() }
                            ?: stringResource(R.string.hs_reserve_alarm_with_voice),
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = nextAlarm?.let {
                            stringResource(R.string.hs_edit_alarm)
                        } ?: stringResource(R.string.hs_start_now),
                        style = MaterialTheme.typography.bodyMedium,
                        color = scheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Surface(
                    modifier = Modifier.padding(start = 12.dp),
                    shape = CircleShape,
                    color = scheme.primary,
                    contentColor = scheme.onPrimary,
                ) {
                    Box(
                        modifier = Modifier.size(40.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.ArrowForward,
                            contentDescription = null,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun HomeVoiceWaveform(
    modifier: Modifier = Modifier,
    active: Boolean,
) {
    val transition = rememberInfiniteTransition(label = "home-waveform")
    val phase = transition.animateFloat(
        initialValue = 0f,
        targetValue = (PI * 2).toFloat(),
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1700, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "home-waveform-phase",
    ).value
    val levels = listOf(
        0.18f, 0.24f, 0.16f, 0.34f, 0.28f, 0.52f, 0.38f, 0.70f,
        0.42f, 0.60f, 0.32f, 0.56f, 0.24f, 0.66f, 0.46f, 0.78f,
        0.40f, 0.62f, 0.34f, 0.58f, 0.28f, 0.54f, 0.36f, 0.64f,
        0.44f, 0.72f, 0.30f, 0.48f, 0.22f, 0.42f, 0.18f, 0.36f,
        0.26f, 0.50f, 0.20f, 0.40f, 0.16f, 0.32f, 0.14f, 0.28f,
    )
    Row(
        modifier = modifier.height(44.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        levels.forEachIndexed { index, level ->
            val wave = ((sin(phase + index * 0.56f) + 1f) / 2f).coerceIn(0f, 1f)
            val animatedLevel = (level * (0.72f + 0.28f * wave)).coerceIn(0.12f, 0.88f)
            val alpha = if (active) {
                0.58f + 0.38f * wave
            } else {
                0.24f + 0.28f * wave
            }
            Box(
                modifier = Modifier
                    .width(2.dp)
                    .height((8 + animatedLevel * 34).dp)
                    .background(
                        color = MaterialTheme.colorScheme.primary.copy(alpha = alpha),
                        shape = WakerPillShape,
                    ),
            )
        }
    }
}


