package com.alarmtalk.app

import android.icu.text.MeasureFormat
import android.icu.util.Measure
import android.icu.util.MeasureUnit
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import kotlinx.coroutines.delay
import java.util.Locale
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import com.alarmtalk.app.R
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.WakerPanelShape
import com.alarmtalk.app.WakerPillShape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.alarmtalk.app.data.AlarmEntity

// 알람 탭 헤더 — '알람' 제목 대신 상태 한 줄(다음 알람/꺼짐/없음)을 헤드라인으로 승격한다.
@Composable
internal fun HomeHeader(
    nextAlarm: AlarmEntity?,
    hasAnyAlarm: Boolean,
) {
    // 절대 시각은 바로 아래 카드에 이미 있으니 헤더는 '남은 시간'을 말한다.
    // 분이 바뀌는 경계마다 갱신해 화면을 켜둔 채로도 어긋나지 않게 한다.
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(nextAlarm?.fireAtMillis) {
        if (nextAlarm == null) return@LaunchedEffect
        while (true) {
            delay(60_000L - System.currentTimeMillis() % 60_000L)
            now = System.currentTimeMillis()
        }
    }
    val statusText: String? = when {
        nextAlarm != null -> {
            val remainingMillis = nextAlarm.fireAtMillis - now
            if (remainingMillis < 60_000L) {
                stringResource(R.string.hs_status_ring_soon)
            } else {
                stringResource(R.string.hs_status_ring_in, remainingDurationLabel(remainingMillis))
            }
        }
        hasAnyAlarm -> stringResource(R.string.hs_status_inactive)
        else -> stringResource(R.string.hs_status_no_alarm)
    }
    // '알람' 라벨을 따로 두지 않고, 상태 문구(다음 울림/모두 꺼짐/알람 없음)를 그대로 헤드라인으로 승격한다.
    // 디자인 언어(제목=결론)에 맞춰 지금 상태가 곧 화면의 첫 줄이 되게 한다.
    if (!statusText.isNullOrBlank()) {
        Text(
            text = statusText,
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground,
        )
    }
}

/** "13시간 40분"/"2일 5시간" — 다음 울림까지 남은 시간(분 단위 올림, 상위 두 단위만 노출). */
private fun remainingDurationLabel(remainingMillis: Long): String {
    val totalMinutes = ((remainingMillis + 59_999L) / 60_000L).toInt()
    val days = totalMinutes / (24 * 60)
    val hours = totalMinutes % (24 * 60) / 60
    val minutes = totalMinutes % 60
    val measures = when {
        days > 0 -> listOfNotNull(
            Measure(days, MeasureUnit.DAY),
            Measure(hours, MeasureUnit.HOUR).takeIf { hours > 0 },
        )
        hours > 0 -> listOfNotNull(
            Measure(hours, MeasureUnit.HOUR),
            Measure(minutes, MeasureUnit.MINUTE).takeIf { minutes > 0 },
        )
        else -> listOf(Measure(minutes, MeasureUnit.MINUTE))
    }
    return MeasureFormat.getInstance(Locale.getDefault(), MeasureFormat.FormatWidth.SHORT)
        .formatMeasures(*measures.toTypedArray())
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
                // 원형 사람 아이콘 아바타는 제거 — 기본 아이콘 장식 없이 텍스트만 둔다.
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
        // 법적 정보(약관·오픈소스)는 설정 화면 하단으로 이동 — 더보기는 핵심 항목만 남긴다.
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
            val modes = listOf(ThemeMode.System, ThemeMode.Light, ThemeMode.Dark)
            WakerSheetOptionGroup {
                modes.forEachIndexed { index, mode ->
                    WakerSheetOptionRow(
                        title = themeModeLabel(context, mode),
                        selected = themeMode == mode,
                        onClick = {
                            onChangeTheme(mode)
                            dismiss()
                        },
                        divider = index != modes.lastIndex,
                    )
                }
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

// 로그아웃 확인과 같은 iOS 알럿 스타일(IosAlertDialog)로 통일 — 확인형 모달은 전부 이 계열.
@Composable
internal fun DeleteAccountConfirmDialog(
    busy: Boolean,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    // iOS 표준 구성: 질문 한 문장만 제목(17sp), 나머지 안내는 작은 설명(13sp)으로 —
    // 세 문장을 전부 제목 타이포로 키우면 알럿이 과해 보인다(문장별 줄바꿈은 설명에 유지).
    IosAlertDialog(
        title = stringResource(R.string.hs_delete_account_title),
        message = stringResource(R.string.hs_delete_account_body),
        onDismiss = { if (!busy) onDismiss() },
        actions = listOf(
            IosAlertAction(
                label = stringResource(R.string.social_cancel_button),
                onClick = { if (!busy) onDismiss() },
            ),
            IosAlertAction(
                label = stringResource(R.string.hs_delete_account_confirm),
                emphasized = true,
                destructive = true,
                onClick = { if (!busy) onConfirm() },
            ),
        ),
    )
}

@Composable
internal fun ScreenHeader(
    title: String,
    subtitle: String? = null,
    titleStyle: TextStyle = MaterialTheme.typography.headlineLarge,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            text = title,
            style = titleStyle,
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
