package com.alarmtalk.app

import android.media.MediaPlayer
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

private data class LandingPalette(
    val background: Color,
    val surface: Color,
    val surfaceRaised: Color,
    val line: Color,
    val text: Color,
    val muted: Color,
    val accent: Color,
    val accentText: Color,
)

@Composable
private fun landingPalette(): LandingPalette {
    val scheme = MaterialTheme.colorScheme
    val isDark = scheme.background.luminance() < 0.5f
    return if (isDark) {
        LandingPalette(
            background = Color(0xFF090A0F),
            surface = Color(0xFF14161E),
            surfaceRaised = Color(0xFF191C25),
            line = Color(0xFF2D313D),
            text = Color(0xFFF7F4EE),
            muted = Color(0xFFB0A89C),
            // 브랜드 블루(테마 단일 출처) 사용 — 랜딩만 코랄로 어긋나지 않도록 light 분기와 동일하게 scheme 참조.
            accent = scheme.primary,
            accentText = scheme.onPrimary,
        )
    } else {
        LandingPalette(
            background = scheme.background,
            surface = scheme.surface,
            surfaceRaised = Color(0xFFFFFFFF),
            line = scheme.outlineVariant,
            text = scheme.onBackground,
            muted = scheme.onSurfaceVariant,
            accent = scheme.primary,
            accentText = scheme.onPrimary,
        )
    }
}

/**
 * 첫 진입 랜딩 — 가치 제안(히어로 + 목소리 미리듣기)만 보여주고, 단일 "시작하기" 로
 * 인증 진입(AuthEntryScreen)으로 넘긴다. 로그인/가입 선택지는 이 화면에 두지 않는다.
 */
@Composable
internal fun LandingScreen(
    contentPadding: PaddingValues,
    onGetStarted: () -> Unit,
) {
    val colors = landingPalette()
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .padding(contentPadding)
            .padding(horizontal = 22.dp, vertical = 22.dp),
    ) {
        WakerBrandHeader(colors = colors)
        Spacer(Modifier.weight(0.85f))
        Text(
            text = stringResource(R.string.auth_landing_headline),
            style = MaterialTheme.typography.displaySmall,
            color = colors.text,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(28.dp))
        AlarmIdentityPreview(colors = colors)
        Spacer(Modifier.weight(1f))
        Button(
            onClick = onGetStarted,
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
            shape = WakerButtonShape,
            colors = ButtonDefaults.buttonColors(
                containerColor = colors.accent,
                contentColor = colors.accentText,
            ),
        ) {
            Text(
                text = stringResource(R.string.auth_landing_get_started),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

/**
 * 인증 진입 화면 — "시작하기" 다음 단계. Google(주) + 이메일로 계속하기(보조) 만 두고,
 * 소셜/이메일 선택을 한 곳에서 받는다. 이메일 폼(로그인/가입)에는 더 이상 Google 을
 * 중복 노출하지 않는다.
 */
@Composable
internal fun AuthEntryScreen(
    contentPadding: PaddingValues,
    busy: Boolean,
    onBack: () -> Unit,
    onGoToLogin: () -> Unit,
    onGoToRegister: () -> Unit,
    onGoogleSignIn: () -> Unit,
) {
    val colors = landingPalette()
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .padding(contentPadding)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 22.dp, vertical = 14.dp),
    ) {
        IconButton(onClick = onBack) {
            Icon(
                imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                contentDescription = stringResource(R.string.auth_back),
                tint = colors.text,
            )
        }
        Spacer(Modifier.height(8.dp))
        WakerBrandHeader(colors = colors)
        Spacer(Modifier.height(24.dp))
        Text(
            text = stringResource(R.string.auth_landing_get_started),
            style = MaterialTheme.typography.headlineSmall,
            color = colors.text,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = stringResource(R.string.auth_landing_get_started_desc),
            style = MaterialTheme.typography.bodyMedium,
            color = colors.muted,
        )
        Spacer(Modifier.height(28.dp))
        GoogleSignInButton(
            enabled = !busy,
            onClick = onGoogleSignIn,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(10.dp))
        OutlinedButton(
            onClick = onGoToLogin,
            enabled = !busy,
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
            shape = WakerButtonShape,
            border = BorderStroke(1.dp, colors.line),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.text),
        ) {
            Text(stringResource(R.string.auth_continue_with_email))
        }
        Spacer(Modifier.height(20.dp))
        HorizontalDivider(color = colors.line)
        Spacer(Modifier.height(16.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stringResource(R.string.auth_landing_first_time),
                style = MaterialTheme.typography.bodyMedium,
                color = colors.muted,
            )
            OutlinedButton(
                onClick = onGoToRegister,
                enabled = !busy,
                shape = WakerButtonShape,
                border = BorderStroke(1.dp, colors.line),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.text),
            ) {
                Text(stringResource(R.string.auth_create_account))
            }
        }
    }
}

@Composable
private fun WakerBrandHeader(colors: LandingPalette) {
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
                .clip(WakerTileShape),
        )
        Spacer(Modifier.width(10.dp))
        Text(
            text = "AlarmTalk",
            style = MaterialTheme.typography.titleLarge,
            color = colors.text,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun AlarmIdentityPreview(colors: LandingPalette) {
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
        shape = WakerHeroShape,
        color = colors.surface,
        border = BorderStroke(1.dp, colors.line),
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
                        text = stringResource(R.string.auth_landing_tomorrow_morning),
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.muted,
                    )
                    Text(
                        text = "07:30",
                        style = MaterialTheme.typography.displaySmall,
                        color = colors.text,
                        fontWeight = FontWeight.Bold,
                    )
                }
                Surface(
                    onClick = ::togglePreview,
                    modifier = Modifier.size(54.dp),
                    shape = WakerPillShape,
                    color = colors.accent.copy(alpha = 0.14f),
                    contentColor = colors.accent,
                    border = BorderStroke(1.dp, colors.accent.copy(alpha = 0.28f)),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = if (isPlaying) Icons.Outlined.Pause else Icons.Outlined.PlayArrow,
                            contentDescription = if (isPlaying) stringResource(R.string.auth_landing_preview_pause) else stringResource(R.string.auth_landing_preview_play),
                            modifier = Modifier.size(29.dp),
                        )
                    }
                }
            }
            LandingPreviewWaveform(
                colors = colors,
                progress = playbackProgress,
                isPlaying = isPlaying,
            )
        }
    }
}

@Composable
private fun LandingPreviewWaveform(
    colors: LandingPalette,
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
            val color = if (played) colors.accent else colors.line
            Box(
                modifier = Modifier
                    .width(2.dp)
                    .height((9 + level * 34).dp)
                    .background(
                        color = color.copy(alpha = if (played) 1f else 0.78f),
                        shape = WakerPillShape,
                    ),
            )
        }
    }
}
