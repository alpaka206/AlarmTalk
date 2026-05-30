package com.alarmtalk.app

import android.media.MediaPlayer
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.Image
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

private val LandingBackground = Color(0xFF090A0F)
private val LandingSurface = Color(0xFF14161E)
private val LandingSurfaceRaised = Color(0xFF191C25)
private val LandingLine = Color(0xFF2D313D)
private val LandingText = Color(0xFFF7F7FA)
private val LandingMuted = Color(0xFFA8AEBA)
private val LandingAccent = Color(0xFFA8D4FF)
private val LandingAccentText = Color(0xFF08243C)
private val LandingBlue = Color(0xFFC7E5D6)

@Composable
internal fun LandingScreen(
    contentPadding: PaddingValues,
    busy: Boolean,
    onGoToLogin: () -> Unit,
    onGoToRegister: () -> Unit,
    onGoogleSignIn: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(LandingBackground)
            .padding(contentPadding),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 22.dp, vertical = 22.dp),
            verticalArrangement = Arrangement.Top,
        ) {
            WakerBrandHeader()
            Spacer(Modifier.height(48.dp))
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 20.dp),
                verticalArrangement = Arrangement.spacedBy(34.dp),
            ) {
                Text(
                    text = "좋아하는 목소리로\n깨어나는 알람",
                    style = MaterialTheme.typography.displaySmall,
                    color = LandingText,
                    fontWeight = FontWeight.Bold,
                )
                AlarmIdentityPreview()
            }
            Spacer(Modifier.weight(1f))
            LandingAuthPanel(
                busy = busy,
                onGoToLogin = onGoToLogin,
                onGoToRegister = onGoToRegister,
                onGoogleSignIn = onGoogleSignIn,
            )
        }
    }
}

@Composable
private fun WakerBrandHeader() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Image(
            painter = painterResource(R.drawable.ic_brand_logo),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .size(42.dp)
                .clip(RoundedCornerShape(12.dp)),
        )
        Spacer(Modifier.width(10.dp))
        Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(
                text = "AlarmTalk",
                style = MaterialTheme.typography.titleLarge,
                color = LandingText,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = "Voice alarm",
                style = MaterialTheme.typography.labelMedium,
                color = LandingMuted,
            )
        }
    }
}

@Composable
private fun AlarmIdentityPreview() {
    val context = LocalContext.current
    val previewPlayer = remember(context) {
        MediaPlayer.create(context, R.raw.landing_voice_preview)
    }
    var isPlaying by remember { mutableStateOf(false) }
    var playbackProgress by remember { mutableStateOf(0f) }

    DisposableEffect(previewPlayer) {
        previewPlayer?.setOnCompletionListener { player ->
            isPlaying = false
            playbackProgress = 0f
            player.seekTo(0)
        }
        onDispose {
            previewPlayer?.release()
        }
    }

    LaunchedEffect(isPlaying, previewPlayer) {
        val duration = previewPlayer?.duration?.coerceAtLeast(1) ?: 1
        while (isPlaying && previewPlayer != null) {
            playbackProgress = (previewPlayer.currentPosition / duration.toFloat()).coerceIn(0f, 1f)
            delay(80)
        }
    }

    fun togglePreview() {
        val player = previewPlayer ?: return
        if (player.isPlaying) {
            player.pause()
            isPlaying = false
            return
        }
        if (playbackProgress >= 0.98f) {
            player.seekTo(0)
            playbackProgress = 0f
        }
        player.start()
        isPlaying = true
    }

    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(26.dp),
        color = LandingSurface,
        border = BorderStroke(1.dp, LandingLine),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(28.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(
                        text = "내일 아침",
                        style = MaterialTheme.typography.bodyMedium,
                        color = LandingMuted,
                    )
                    Text(
                        text = "07:30",
                        style = MaterialTheme.typography.displaySmall,
                        color = LandingText,
                        fontWeight = FontWeight.Bold,
                    )
                }
                Surface(
                    onClick = ::togglePreview,
                    modifier = Modifier.size(54.dp),
                    shape = RoundedCornerShape(999.dp),
                    color = LandingAccent.copy(alpha = 0.14f),
                    contentColor = LandingAccent,
                    border = BorderStroke(1.dp, LandingAccent.copy(alpha = 0.28f)),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = if (isPlaying) Icons.Outlined.Pause else Icons.Outlined.PlayArrow,
                            contentDescription = if (isPlaying) "미리듣기 일시정지" else "목소리 미리듣기",
                            modifier = Modifier.size(29.dp),
                        )
                    }
                }
            }
            LandingPreviewWaveform(
                progress = playbackProgress,
                isPlaying = isPlaying,
            )
        }
    }
}

@Composable
private fun LandingPreviewWaveform(
    progress: Float,
    isPlaying: Boolean,
) {
    val levels = listOf(
        0.12f, 0.28f, 0.18f, 0.44f, 0.26f, 0.60f, 0.34f, 0.76f,
        0.48f, 0.70f, 0.38f, 0.64f, 0.30f, 0.58f, 0.42f, 0.82f,
        0.52f, 0.74f, 0.46f, 0.68f, 0.36f, 0.62f, 0.28f, 0.54f,
        0.40f, 0.66f, 0.32f, 0.50f, 0.22f, 0.42f, 0.18f, 0.34f,
    )
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(50.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        levels.forEachIndexed { index, level ->
            val barProgress = index / levels.lastIndex.toFloat()
            val played = progress > 0f && barProgress <= progress
            val color = if (played) LandingAccent else LandingLine
            Box(
                modifier = Modifier
                    .width(2.dp)
                    .height((9 + level * 34).dp)
                    .background(
                        color = color.copy(alpha = if (played) 1f else 0.78f),
                        shape = RoundedCornerShape(999.dp),
                    ),
            )
        }
    }
}

@Composable
private fun LandingAuthPanel(
    busy: Boolean,
    onGoToLogin: () -> Unit,
    onGoToRegister: () -> Unit,
    onGoogleSignIn: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(30.dp),
        color = LandingSurfaceRaised,
        border = BorderStroke(1.dp, LandingLine),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(
                modifier = Modifier.padding(start = 18.dp, end = 18.dp, top = 18.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = "시작하기",
                    style = MaterialTheme.typography.titleMedium,
                    color = LandingText,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = "로그인하면 목소리 알람을 만들 수 있어요.",
                    style = MaterialTheme.typography.bodySmall,
                    color = LandingMuted,
                )
            }
            Column(
                modifier = Modifier.padding(horizontal = 18.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                GoogleSignInButton(
                    enabled = !busy,
                    onClick = onGoogleSignIn,
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = onGoToLogin,
                    enabled = !busy,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(56.dp),
                    shape = WakerButtonShape,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = LandingAccent,
                        contentColor = LandingAccentText,
                        disabledContainerColor = LandingAccent.copy(alpha = 0.28f),
                        disabledContentColor = LandingAccentText.copy(alpha = 0.45f),
                    ),
                ) {
                    Text("이메일로 로그인")
                }
            }
            HorizontalDivider(color = LandingLine)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 18.dp, end = 18.dp, bottom = 18.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "처음 사용하시나요?",
                    style = MaterialTheme.typography.bodyMedium,
                    color = LandingMuted,
                )
                OutlinedButton(
                    onClick = onGoToRegister,
                    enabled = !busy,
                    shape = WakerButtonShape,
                    border = BorderStroke(1.dp, LandingLine),
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = LandingText,
                        disabledContentColor = LandingMuted.copy(alpha = 0.45f),
                    ),
                ) {
                    Text("계정 만들기")
                }
            }
        }
    }
}
