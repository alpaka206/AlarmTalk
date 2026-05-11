package com.voicealarm.nativeapp

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color

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
            primary = Color(0xFFF0B840),
            onPrimary = Color(0xFF221D16),
            primaryContainer = Color(0xFF5A4218),
            onPrimaryContainer = Color(0xFFFFE0A3),
            secondary = Color(0xFF9CB5E0),
            onSecondary = Color(0xFF17243A),
            secondaryContainer = Color(0xFF26364F),
            onSecondaryContainer = Color(0xFFDCE7FA),
            tertiary = Color(0xFF7FC7A8),
            onTertiary = Color(0xFF102A21),
            tertiaryContainer = Color(0xFF1F4639),
            onTertiaryContainer = Color(0xFFD6F5E9),
            background = Color(0xFF171A1D),
            onBackground = Color(0xFFF3F0E9),
            surface = Color(0xFF22262A),
            surfaceVariant = Color(0xFF2E3439),
            onSurface = Color(0xFFF3F0E9),
            onSurfaceVariant = Color(0xFFBAC1C9),
            outline = Color(0xFF444B52),
            outlineVariant = Color(0xFF353B41),
            error = Color(0xFFFF8A7A),
            errorContainer = Color(0xFF5B211B),
            onErrorContainer = Color(0xFFFFDAD4),
        )
    } else {
        androidx.compose.material3.lightColorScheme(
            primary = Color(0xFFE4AD34),
            onPrimary = Color(0xFF282116),
            primaryContainer = Color(0xFFFFE3A3),
            onPrimaryContainer = Color(0xFF282116),
            secondary = Color(0xFF4E6793),
            onSecondary = Color(0xFFFFFFFF),
            secondaryContainer = Color(0xFFDCE7FA),
            onSecondaryContainer = Color(0xFF17243A),
            tertiary = Color(0xFF4F8D72),
            onTertiary = Color(0xFFFFFFFF),
            tertiaryContainer = Color(0xFFDDEFE6),
            onTertiaryContainer = Color(0xFF123326),
            background = Color(0xFFF7F6F1),
            onBackground = Color(0xFF262522),
            surface = Color(0xFFFFFFFF),
            surfaceVariant = Color(0xFFEEF0F2),
            onSurface = Color(0xFF262522),
            onSurfaceVariant = Color(0xFF62686F),
            outline = Color(0xFFD7DADF),
            outlineVariant = Color(0xFFE5E7EB),
            error = Color(0xFFC84D3D),
            errorContainer = Color(0xFFFFDDD6),
            onErrorContainer = Color(0xFF5F160E),
        )
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = VoiceAlarmTypography,
    ) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = MaterialTheme.colorScheme.background,
            content = content,
        )
    }
}
