package com.voicealarm.nativeapp

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
            primary = Color(0xFFF7C45B),
            onPrimary = Color(0xFF211A0B),
            primaryContainer = Color(0xFF3A3528),
            onPrimaryContainer = Color(0xFFF7C45B),
            secondary = Color(0xFF9FC7E8),
            onSecondary = Color(0xFF0E2430),
            secondaryContainer = Color(0xFF243B4D),
            onSecondaryContainer = Color(0xFFD9ECFA),
            tertiary = Color(0xFF86C9A9),
            onTertiary = Color(0xFF0C2A1D),
            tertiaryContainer = Color(0xFF1E4A37),
            onTertiaryContainer = Color(0xFFD8F5E6),
            background = Color(0xFF171A1D),
            onBackground = Color(0xFFF5F1E8),
            surface = Color(0xFF22262A),
            surfaceVariant = Color(0xFF2E3439),
            onSurface = Color(0xFFF5F1E8),
            onSurfaceVariant = Color(0xFFC1C7CF),
            outline = Color(0xFF3D454D),
            outlineVariant = Color(0xFF343B42),
            error = Color(0xFFFF9A8A),
            onError = Color(0xFF3D0703),
            errorContainer = Color(0xFF5B211B),
            onErrorContainer = Color(0xFFFFDAD4),
        )
    } else {
        androidx.compose.material3.lightColorScheme(
            primary = Color(0xFFF2B544),
            onPrimary = Color(0xFF241A08),
            primaryContainer = Color(0xFFFFE7AE),
            onPrimaryContainer = Color(0xFF241A08),
            secondary = Color(0xFF486A8F),
            onSecondary = Color(0xFFFFFFFF),
            secondaryContainer = Color(0xFFDCE9F7),
            onSecondaryContainer = Color(0xFF10283A),
            tertiary = Color(0xFF3F7B60),
            onTertiary = Color(0xFFFFFFFF),
            tertiaryContainer = Color(0xFFDDEFE6),
            onTertiaryContainer = Color(0xFF0F3324),
            background = Color(0xFFF8F6F1),
            onBackground = Color(0xFF242629),
            surface = Color(0xFFFFFFFF),
            surfaceVariant = Color(0xFFEEF1F4),
            onSurface = Color(0xFF242629),
            onSurfaceVariant = Color(0xFF626A73),
            outline = Color(0xFFD8DDE3),
            outlineVariant = Color(0xFFE6E9ED),
            error = Color(0xFFC23E32),
            onError = Color(0xFFFFFFFF),
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
