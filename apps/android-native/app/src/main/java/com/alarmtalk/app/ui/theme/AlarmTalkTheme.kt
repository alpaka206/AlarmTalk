package com.alarmtalk.app

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/**
 * 앱 전역 다크 컬러 스킴(브랜드 블루 계열)의 단일 출처.
 * 잠금화면 위에 항상 다크로 떠야 하는 RingingActivity 도 이 스킴을 참조해
 * primary 계열 색을 인라인 리터럴로 중복 정의하지 않는다.
 */
internal val AlarmTalkDarkColorScheme = androidx.compose.material3.darkColorScheme(
    primary = Color(0xFFA6D2FF),
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
    // 배경/표면 계열은 랜딩(일출 씬)의 딥 네이비 축과 같은 색조로 맞춘다 —
    // 무채색 회흑 대신 밤바다 톤이라 랜딩 → 앱 진입 시 톤이 이어진다.
    background = Color(0xFF090D16),
    onBackground = Color(0xFFF7F8FC),
    surface = Color(0xFF131825),
    surfaceVariant = Color(0xFF1D2434),
    onSurface = Color(0xFFF7F8FC),
    onSurfaceVariant = Color(0xFFA7AFC0),
    outline = Color(0xFF3A4257),
    outlineVariant = Color(0xFF272F42),
    error = Color(0xFFFF9A8A),
    onError = Color(0xFF3D0703),
    errorContainer = Color(0xFF5B211B),
    onErrorContainer = Color(0xFFFFDAD4),
)

@Composable
internal fun AlarmTalkTheme(
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
        AlarmTalkDarkColorScheme
    } else {
        androidx.compose.material3.lightColorScheme(
            primary = Color(0xFF175FB0),
            onPrimary = Color(0xFFFFFFFF),
            primaryContainer = Color(0xFFD6E9FF),
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
        typography = AlarmTalkTypography,
        shapes = AlarmTalkShapes,
    ) {
        AppSystemBars(isDark = isDark)
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = MaterialTheme.colorScheme.background,
            content = content,
        )
    }
}

// 모서리 스케일의 단일 출처는 WakerDesign.kt 의 Waker*Shape 토큰이다.
// 여기서는 그 토큰을 M3 Shapes 슬롯에 매핑만 한다(값 중복 정의 금지).
private val AlarmTalkShapes = Shapes(
    extraSmall = WakerTileShape,
    small = WakerChipShape,
    medium = WakerInputShape,
    large = WakerCardShape,
    extraLarge = WakerDialogShape,
)

/** 시스템 바 오버라이드 값 — 고정 다크 씬(랜딩·인증)이 보이는 동안만 non-null. */
private data class SystemBarsSpec(val status: Color, val nav: Color)

private val systemBarsOverride = mutableStateOf<SystemBarsSpec?>(null)

// enableEdgeToEdge 가 API 29 미만에서 내비게이션 바에 까는 기본 스크림과 동일한 값.
// 그 구간(26–28)에서만 앱 테마에 맞춰 내비바 색을 갱신할 때 재사용한다.
private val NavBarScrimLight: Int = 0xE6FFFFFF.toInt()
private val NavBarScrimDark: Int = 0x801B1B1B.toInt()

/**
 * 고정 다크 씬(랜딩·인증 플로우)이 보이는 동안 시스템 바를 씬 색으로 덮어쓴다.
 * 테마는 상태바를 theme background 로 칠하므로 라이트 모드에선 네이비 씬 위에
 * 흰 상태바 띠가 생긴다 — 씬을 벗어나면 테마 기본으로 복원한다.
 * 실제 창 조작은 항상 [AppSystemBars] 한 곳에서만 일어난다(오버라이드 상태를 읽어
 * 재구성되므로, 테마 SideEffect 가 나중에 다시 칠해도 덮어쓰기 경쟁이 없다).
 */
@Composable
internal fun SceneSystemBars(top: Color, bottom: Color) {
    DisposableEffect(top, bottom) {
        val spec = SystemBarsSpec(status = top, nav = bottom)
        systemBarsOverride.value = spec
        onDispose {
            // 다른 씬이 이미 값을 바꿨다면(씬 간 전환) 그쪽 오버라이드를 존중한다.
            if (systemBarsOverride.value == spec) systemBarsOverride.value = null
        }
    }
}

@Composable
@Suppress("DEPRECATION") // navigationBarColor 는 API 26–28 경로에서만 쓰고, 35+ 지원중단은 회피한다.
private fun AppSystemBars(isDark: Boolean) {
    val view = LocalView.current
    val override = systemBarsOverride.value
    // 씬 오버라이드는 항상 어두운 배경(밝은 아이콘·어두운 스크림), 아니면 테마 명암을 따른다.
    val barsDark = override != null || isDark
    SideEffect {
        val window = view.context.findActivity()?.window ?: return@SideEffect
        // 시스템 바 배경색은 더 이상 window.statusBarColor/navigationBarColor 로 칠하지 않는다
        // (Android 15/SDK 35 에서 지원중단·엣지투엣지 강제). MainActivity 의 enableEdgeToEdge()
        // 로 바가 투명해지고, 그 뒤로 콘텐츠가 그려진다 — 일반 화면은 Scaffold 배경(=background)이,
        // 씬 화면(랜딩/울림)은 풀블리드 씬이 바 영역까지 채운다. 여기서는 아이콘 명암을 제어한다.
        WindowCompat.getInsetsController(window, view).apply {
            isAppearanceLightStatusBars = !barsDark
            isAppearanceLightNavigationBars = !barsDark
        }
        // API 26–28 은 enableEdgeToEdge 가 시스템 야간모드 기준 내비바 스크림을 onCreate 때 한 번만
        // 깔아, 앱 테마가 시스템과 다르거나 런타임에 바뀌면 내비바 배경이 어긋난다. 이 구간에서만
        // (29+ 는 바가 투명해 불필요, 35+ 지원중단도 피함) 내비바 색을 앱 테마에 맞춰 갱신한다.
        if (Build.VERSION.SDK_INT in Build.VERSION_CODES.O..Build.VERSION_CODES.P) {
            window.navigationBarColor = if (barsDark) NavBarScrimDark else NavBarScrimLight
        }
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
