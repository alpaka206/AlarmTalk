package com.alarmtalk.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import com.alarmtalk.app.R
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.WakerCardShape
import com.alarmtalk.app.WakerPanelShape
import com.alarmtalk.app.WakerPillShape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

// 알람 홈 좌상단 인사말 — 시간대별 문구. 우측 공간은 비워둔다(추후 알림 등 배치 여지).
@Composable
internal fun HomeHeader() {
    val hour = java.time.LocalTime.now().hour
    val (greetingTop, greetingBottom) = when {
        hour < 6 -> stringResource(R.string.hs_greeting_voice_top) to stringResource(R.string.hs_greeting_voice_bottom)
        hour < 12 -> stringResource(R.string.hs_greeting_morning_top) to stringResource(R.string.hs_greeting_morning_bottom)
        hour < 17 -> stringResource(R.string.hs_greeting_tomorrow_top) to stringResource(R.string.hs_greeting_tomorrow_bottom)
        hour < 21 -> stringResource(R.string.hs_greeting_each_other_top) to stringResource(R.string.hs_greeting_each_other_bottom)
        else -> stringResource(R.string.hs_greeting_voice_top) to stringResource(R.string.hs_greeting_voice_bottom)
    }
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = greetingTop,
            modifier = Modifier.padding(end = 72.dp),
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Text(
            text = greetingBottom,
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            // 랜딩 헤드라인처럼 두 번째 줄에 브랜드 액센트를 준다.
            color = MaterialTheme.colorScheme.primary,
        )
    }
}

// 전체 탭 — 우측 상단 프로필 드롭다운 메뉴를 페이지로 승격한 것(토스 설정 패턴).
// 프로필 행(→설정)과 드릴인 항목 리스트(이용권 · 공유 이용권/초대 코드)로 구성한다.
@Composable
internal fun MenuTabPanel(
    authSession: AuthSession?,
    hasSharedPass: Boolean,
    themeMode: ThemeMode,
    onChangeTheme: (ThemeMode) -> Unit,
    onOpenPeople: () -> Unit,
    onOpenBilling: () -> Unit,
    onOpenMemberManagement: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenConsentHistory: () -> Unit,
    onOpenOssLicenses: () -> Unit,
    onDeleteAccount: () -> Unit,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var themeSheetVisible by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        // 프로필 행: 계정·앱 설정 전체가 이 안(설정 화면)에 있다.
        Surface(
            onClick = onOpenSettings,
            shape = WakerPanelShape,
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Surface(
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.secondaryContainer,
                    contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                ) {
                    Box(
                        modifier = Modifier.size(48.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Person,
                            contentDescription = stringResource(R.string.hs_profile_content_desc),
                            modifier = Modifier.size(24.dp),
                        )
                    }
                }
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Text(
                        text = authSession?.user?.name?.takeIf { it.isNotBlank() }
                            ?: stringResource(R.string.hs_profile_content_desc),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = stringResource(R.string.menu_profile_subtitle),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Icon(
                    imageVector = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                    contentDescription = null,
                    modifier = Modifier.size(22.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        // 화면·언어 — 토스의 '언어/화면 테마' 행처럼 전체 탭에서 바로 관리한다.
        Surface(
            shape = WakerPanelShape,
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        ) {
            Column(modifier = Modifier.padding(8.dp)) {
                MenuTabRow(
                    label = stringResource(R.string.hs_settings_theme),
                    value = themeModeLabel(context, themeMode),
                    onClick = { themeSheetVisible = true },
                )
                // 앱별 언어는 시스템 설정(Android 13+)에 위임한다 — locales_config 기준으로 목록이 뜬다.
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                    val appLocales = context.getSystemService(android.app.LocaleManager::class.java)
                        ?.applicationLocales
                    val languageValue = if (appLocales == null || appLocales.isEmpty) {
                        stringResource(R.string.menu_language_system)
                    } else {
                        val locale = appLocales.get(0)
                        locale.getDisplayLanguage(locale).replaceFirstChar { it.uppercase(locale) }
                    }
                    HorizontalDivider(
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        color = MaterialTheme.colorScheme.outlineVariant,
                    )
                    MenuTabRow(
                        label = stringResource(R.string.menu_language_label),
                        value = languageValue,
                        onClick = {
                            runCatching {
                                context.startActivity(
                                    android.content.Intent(
                                        android.provider.Settings.ACTION_APP_LOCALE_SETTINGS,
                                        android.net.Uri.fromParts("package", context.packageName, null),
                                    ),
                                )
                            }
                        },
                    )
                }
            }
        }
        Surface(
            shape = WakerPanelShape,
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        ) {
            Column(modifier = Modifier.padding(8.dp)) {
                MenuTabRow(
                    label = stringResource(R.string.hs_profile_menu_pass),
                    onClick = onOpenBilling,
                )
                HorizontalDivider(
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                    color = MaterialTheme.colorScheme.outlineVariant,
                )
                if (hasSharedPass) {
                    MenuTabRow(
                        label = stringResource(R.string.hs_profile_menu_shared_pass),
                        onClick = onOpenMemberManagement,
                    )
                } else {
                    MenuTabRow(
                        label = stringResource(R.string.hs_profile_menu_invite_code),
                        onClick = onOpenPeople,
                    )
                }
            }
        }
        // 법적 정보 — 문서·동의 이력은 '약관 및 개인정보 처리 동의' 화면 한 곳에서만 연다(중복 진입점 금지).
        Surface(
            shape = WakerPanelShape,
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        ) {
            Column(modifier = Modifier.padding(8.dp)) {
                Text(
                    text = stringResource(R.string.menu_section_legal),
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                MenuTabRow(
                    label = stringResource(R.string.consent_screen_title),
                    onClick = onOpenConsentHistory,
                )
                HorizontalDivider(
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                    color = MaterialTheme.colorScheme.outlineVariant,
                )
                // 오픈소스 라이선스 — 인앱 Compose 화면(OssLicensesScreen)으로 이동.
                MenuTabRow(
                    label = stringResource(R.string.menu_open_source_licenses),
                    onClick = onOpenOssLicenses,
                )
            }
        }
        // 탈퇴하기 — 토스처럼 독립 카드 행. 확인 다이얼로그는 앱 레벨에서 뜬다.
        if (authSession != null) {
            Surface(
                shape = WakerPanelShape,
                color = MaterialTheme.colorScheme.surface,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            ) {
                Column(modifier = Modifier.padding(8.dp)) {
                    MenuTabRow(
                        label = stringResource(R.string.hs_settings_delete_account),
                        onClick = onDeleteAccount,
                    )
                }
            }
        }
        Text(
            text = stringResource(R.string.menu_app_version, BuildConfig.VERSION_NAME),
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 4.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
    }

    if (themeSheetVisible) {
        WakerSelectionSheet(
            title = stringResource(R.string.hs_settings_theme),
            onDismiss = { themeSheetVisible = false },
        ) { dismiss ->
            listOf(ThemeMode.System, ThemeMode.Light, ThemeMode.Dark).forEach { mode ->
                WakerSheetOptionRow(
                    title = themeModeLabel(context, mode),
                    selected = themeMode == mode,
                    onClick = {
                        onChangeTheme(mode)
                        dismiss()
                    },
                )
            }
        }
    }
}

@Composable
private fun MenuTabRow(
    label: String,
    onClick: () -> Unit,
    value: String? = null,
) {
    // 토스처럼 텍스트+값+셰브론만 — 행마다 아이콘을 붙이지 않는다.
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(52.dp)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = label,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
        )
        if (value != null) {
            Text(
                text = value,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.primary,
            )
        }
        Icon(
            imageVector = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}


enum class ThemeMode { System, Light, Dark }

internal fun themeModeLabel(context: android.content.Context, mode: ThemeMode): String = when (mode) {
    ThemeMode.System -> context.getString(R.string.misc2_theme_mode_system)
    ThemeMode.Light -> context.getString(R.string.misc2_theme_mode_light)
    ThemeMode.Dark -> context.getString(R.string.misc2_theme_mode_dark)
}

@Composable
internal fun NicknameEditDialog(
    initial: String,
    busy: Boolean,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var value by remember { mutableStateOf(initial) }
    val trimmedValue = value.trim()
    val canSave = !busy && trimmedValue.isNotEmpty() && trimmedValue != initial

    Dialog(
        onDismissRequest = { if (!busy) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .widthIn(max = 430.dp),
            shape = WakerDialogShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
            shadowElevation = 18.dp,
            border = wakerCardBorder(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                ModalDialogTitle(
                    title = stringResource(R.string.hs_nickname_dialog_title),
                    onDismiss = onDismiss,
                    dismissEnabled = !busy,
                )
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    OutlinedTextField(
                        value = value,
                        onValueChange = { value = it.take(30) },
                        label = { Text(stringResource(R.string.hs_nickname_field_label)) },
                        placeholder = { Text(stringResource(R.string.hs_nickname_field_placeholder)) },
                        singleLine = true,
                        enabled = !busy,
                        shape = WakerInputShape,
                        colors = wakerOutlinedTextFieldColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text(
                        text = stringResource(R.string.hs_nickname_char_counter, value.length),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.align(Alignment.End),
                    )
                }
                Button(
                    onClick = { onConfirm(value) },
                    enabled = canSave,
                    modifier = Modifier.fillMaxWidth(),
                    shape = WakerButtonShape,
                ) {
                    Text(if (busy) stringResource(R.string.hs_nickname_saving) else stringResource(R.string.hs_nickname_save))
                }
            }
        }
    }
}

@Composable
internal fun DeleteAccountConfirmDialog(
    busy: Boolean,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = {
            ModalDialogTitle(
                title = stringResource(R.string.hs_delete_account_title),
                onDismiss = onDismiss,
                dismissEnabled = !busy,
            )
        },
        text = {
            Text(
                stringResource(R.string.hs_delete_account_body),
            )
        },
        confirmButton = {
            TextButton(onClick = onConfirm, enabled = !busy) {
                Text(
                    text = stringResource(R.string.hs_delete_account_confirm),
                    color = MaterialTheme.colorScheme.error,
                )
            }
        },
    )
}

@Composable
internal fun ScreenHeader(
    title: String,
    subtitle: String? = null,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            text = title,
            style = MaterialTheme.typography.headlineLarge,
            fontWeight = FontWeight.Bold,
        )
        if (!subtitle.isNullOrBlank()) {
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
