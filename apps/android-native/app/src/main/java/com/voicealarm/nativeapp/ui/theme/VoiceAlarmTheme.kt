package com.voicealarm.nativeapp

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat

@Composable
internal fun VoiceAlarmTheme(
    themeMode: ThemeMode = ThemeMode.System,
    content: @Composable () -> Unit,
) {
    val systemDark = androidx.compose.foundation.isSystemInDarkTheme()
    val isDark = when (themeMode) {
        ThemeMode.System -> systemDark
        ThemeMode.Dark -> true
        ThemeMode.Light -> false
    }
    val colorScheme = if (isDark) {
        androidx.compose.material3.darkColorScheme(
            primary = Color(0xFFA8D4FF),
            onPrimary = Color(0xFF08243C),
            primaryContainer = Color(0xFF1E4263),
            onPrimaryContainer = Color(0xFFD9ECFF),
            secondary = Color(0xFFB9DDEB),
            onSecondary = Color(0xFF0F2B36),
            secondaryContainer = Color(0xFF243F49),
            onSecondaryContainer = Color(0xFFE2F5FC),
            tertiary = Color(0xFFC7E5D6),
            onTertiary = Color(0xFF123226),
            tertiaryContainer = Color(0xFF28483B),
            onTertiaryContainer = Color(0xFFE3F6EC),
            background = Color(0xFF090A0F),
            onBackground = Color(0xFFF7F7FA),
            surface = Color(0xFF14161E),
            surfaceVariant = Color(0xFF20232D),
            onSurface = Color(0xFFF7F7FA),
            onSurfaceVariant = Color(0xFFA8AEBA),
            outline = Color(0xFF3A3D49),
            outlineVariant = Color(0xFF2D313D),
            error = Color(0xFFFF9A8A),
            onError = Color(0xFF3D0703),
            errorContainer = Color(0xFF5B211B),
            onErrorContainer = Color(0xFFFFDAD4),
        )
    } else {
        androidx.compose.material3.lightColorScheme(
            primary = Color(0xFF3F6F9E),
            onPrimary = Color(0xFFFFFFFF),
            primaryContainer = Color(0xFFDCEEFF),
            onPrimaryContainer = Color(0xFF0A2740),
            secondary = Color(0xFF5F8FAF),
            onSecondary = Color(0xFFFFFFFF),
            secondaryContainer = Color(0xFFE3F4FA),
            onSecondaryContainer = Color(0xFF12303C),
            tertiary = Color(0xFF5E7D70),
            onTertiary = Color(0xFFFFFFFF),
            tertiaryContainer = Color(0xFFE2F2EA),
            onTertiaryContainer = Color(0xFF163226),
            background = Color(0xFFF7F7FA),
            onBackground = Color(0xFF181922),
            surface = Color(0xFFFFFFFF),
            surfaceVariant = Color(0xFFEDEEF3),
            onSurface = Color(0xFF181922),
            onSurfaceVariant = Color(0xFF5F6470),
            outline = Color(0xFFCCCED8),
            outlineVariant = Color(0xFFE0E2EA),
            error = Color(0xFFC23E32),
            onError = Color(0xFFFFFFFF),
            errorContainer = Color(0xFFFFDDD6),
            onErrorContainer = Color(0xFF5F160E),
        )
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = VoiceAlarmTypography,
        shapes = VoiceAlarmShapes,
    ) {
        AppSystemBars(isDark = isDark)
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = MaterialTheme.colorScheme.background,
            content = content,
        )
    }
}

private val VoiceAlarmShapes = Shapes(
    extraSmall = RoundedCornerShape(12.dp),
    small = RoundedCornerShape(14.dp),
    medium = RoundedCornerShape(18.dp),
    large = RoundedCornerShape(24.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

@Composable
private fun AppSystemBars(isDark: Boolean) {
    val view = LocalView.current
    val backgroundColor = MaterialTheme.colorScheme.background.toArgb()
    SideEffect {
        val window = view.context.findActivity()?.window ?: return@SideEffect
        window.statusBarColor = backgroundColor
        window.navigationBarColor = backgroundColor
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.navigationBarDividerColor = backgroundColor
        }
        WindowCompat.getInsetsController(window, view).apply {
            isAppearanceLightStatusBars = !isDark
            isAppearanceLightNavigationBars = !isDark
        }
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
