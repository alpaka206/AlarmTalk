package com.alarmtalk.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.rememberCoroutineScope
import com.alarmtalk.app.R
import com.alarmtalk.app.data.DynamicPromptPreferenceStore
import com.alarmtalk.app.data.HolidayCountryPreferenceStore
import com.alarmtalk.app.data.holidayCountryDisplayName
import com.alarmtalk.app.data.holidayCountryFlagEmoji
import com.alarmtalk.app.data.toDynamicPromptSettings
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.DynamicPromptSettings
import kotlinx.coroutines.launch

@Composable
internal fun SettingsScreen(
    contentPadding: PaddingValues,
    authSession: AuthSession?,
    onBack: () -> Unit,
    onEditNickname: () -> Unit,
    onUpdateDynamicPromptSettings: (DynamicPromptSettings) -> Unit,
    onOpenConsentHistory: () -> Unit,
    onOpenOssLicenses: () -> Unit,
    onLogout: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val promptPreferenceStore = remember(context) { DynamicPromptPreferenceStore(context) }
    // 계정별 값이다 — 계정이 바뀌면 다시 읽는다(앞 사람의 사주를 물려받지 않게).
    val promptOwnerUserId = authSession?.user?.id
    var promptPreferences by remember(context, promptOwnerUserId) {
        mutableStateOf(promptPreferenceStore.read(promptOwnerUserId))
    }
    val holidayCountryStore = remember(context) { HolidayCountryPreferenceStore(context) }
    var holidayCountryCode by remember(context) { mutableStateOf(holidayCountryStore.read()) }
    var showWeatherLocationDialog by remember { mutableStateOf(false) }
    var showFortuneInfoDialog by remember { mutableStateOf(false) }
    var showHolidayCountryDialog by remember { mutableStateOf(false) }
    var showLogoutConfirm by remember { mutableStateOf(false) }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            // 탭과 같은 그라데이션 배경 — 더보기 → 설정 진입 시 배경 톤이 튀지 않게.
            .background(homeGradientBrush())
            .padding(contentPadding),
        // 좌우 20dp·카드 간 16dp — 전 화면 공통 규격.
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack) {
                    Icon(
                        painterResource(R.drawable.ic_chevron_back),
                        contentDescription = stringResource(R.string.hs_settings_back),
                    )
                }
                Text(
                    text = stringResource(R.string.hs_settings_title),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                )
            }
        }

        item {
            // 테마·앱 언어는 전체 탭에서 관리한다(토스 패턴). 여기엔 알람 동작에 걸리는 설정만 남긴다.
            SettingsCard(title = stringResource(R.string.hs_settings_section_display)) {
                SettingsRow(
                    label = stringResource(R.string.settings_holiday_country_title),
                    value = holidayCountryDisplayLabel(holidayCountryCode),
                    onClick = { showHolidayCountryDialog = true },
                )
            }
        }

        item {
            SettingsCard(title = stringResource(R.string.hs_settings_section_random_phrase)) {
                SettingsRow(
                    label = stringResource(R.string.hs_settings_weather_region),
                    value = weatherLocationSettingsLabel(
                        context,
                        promptPreferences.weatherCountry,
                        promptPreferences.weatherCity,
                    ),
                    onClick = { showWeatherLocationDialog = true },
                )
                HorizontalDivider()
                SettingsRow(
                    label = stringResource(R.string.hs_settings_fortune_info),
                    value = fortuneInfoSettingsLabel(
                        context,
                        promptPreferences.fortuneGender,
                        promptPreferences.fortuneBirthDate,
                        promptPreferences.fortuneBirthTime,
                    ),
                    onClick = { showFortuneInfoDialog = true },
                )
            }
        }

        if (authSession != null) {
            item {
                SettingsCard(title = stringResource(R.string.hs_settings_section_account)) {
                    SettingsRow(
                        label = stringResource(R.string.hs_settings_nickname),
                        value = authSession.user.name.ifBlank { stringResource(R.string.hs_settings_no_name) },
                        onClick = onEditNickname,
                    )
                    HorizontalDivider()
                    SettingsRow(
                        label = stringResource(R.string.hs_settings_logout),
                        value = null,
                        onClick = { showLogoutConfirm = true },
                    )
                }
            }
        }

        // 법적 정보 — 더보기 탭에서 이곳(설정 하단)으로 이동. 처리방침/약관 접근과 오픈소스
        // 고지는 스토어·법적 요구라 앱 안에 유지해야 한다(완전 삭제 불가).
        item {
            SettingsCard(title = stringResource(R.string.menu_section_legal)) {
                SettingsRow(
                    label = stringResource(R.string.consent_screen_title),
                    value = null,
                    onClick = onOpenConsentHistory,
                )
                HorizontalDivider(
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                    color = MaterialTheme.colorScheme.outlineVariant,
                )
                SettingsRow(
                    label = stringResource(R.string.menu_open_source_licenses),
                    value = null,
                    onClick = onOpenOssLicenses,
                )
            }
        }
    }

    if (showLogoutConfirm) {
        IosAlertDialog(
            title = stringResource(R.string.settings_logout_confirm_title),
            message = null,
            onDismiss = { showLogoutConfirm = false },
            actions = listOf(
                IosAlertAction(
                    label = stringResource(R.string.social_cancel_button),
                    onClick = { showLogoutConfirm = false },
                ),
                IosAlertAction(
                    label = stringResource(R.string.hs_settings_logout),
                    emphasized = true,
                    onClick = {
                        showLogoutConfirm = false
                        onLogout()
                    },
                ),
            ),
        )
    }

    if (showWeatherLocationDialog) {
        // 편집기 문구 pane 과 같은 다이얼로그를 공유한다(제목·필드·저장 버튼 동일).
        WeatherLocationDialog(
            country = promptPreferences.weatherCountry,
            city = promptPreferences.weatherCity,
            onDismissWithoutSave = { showWeatherLocationDialog = false },
            onConfirm = { country, city ->
                promptPreferenceStore.saveWeatherLocation(promptOwnerUserId, country, city)
                promptPreferences = promptPreferenceStore.read(promptOwnerUserId)
                onUpdateDynamicPromptSettings(promptPreferences.toDynamicPromptSettings())
                showWeatherLocationDialog = false
            },
        )
    }

    if (showFortuneInfoDialog) {
        FortuneInfoDialog(
            gender = promptPreferences.fortuneGender,
            birthDate = promptPreferences.fortuneBirthDate,
            birthTime = promptPreferences.fortuneBirthTime,
            onDismissWithoutSave = { showFortuneInfoDialog = false },
            onConfirm = { gender, birthDate, birthTime ->
                promptPreferenceStore.saveFortuneInfo(promptOwnerUserId, gender, birthDate, birthTime)
                promptPreferences = promptPreferenceStore.read(promptOwnerUserId)
                onUpdateDynamicPromptSettings(promptPreferences.toDynamicPromptSettings())
                showFortuneInfoDialog = false
            },
        )
    }

    if (showHolidayCountryDialog) {
        HolidayCountryPickerDialog(
            current = holidayCountryCode,
            onDismiss = { showHolidayCountryDialog = false },
            onSelect = { code ->
                scope.launch {
                    holidayCountryStore.setCountry(code)
                    holidayCountryCode = holidayCountryStore.read()
                }
            },
        )
    }
}

private fun holidayCountryDisplayLabel(countryCode: String): String {
    val flag = holidayCountryFlagEmoji(countryCode)
    val name = holidayCountryDisplayName(countryCode)
    return listOf(flag, name).filter { it.isNotBlank() }.joinToString(" ")
}

@Composable
private fun HolidayCountryPickerDialog(
    current: String,
    onDismiss: () -> Unit,
    onSelect: (String) -> Unit,
) {
    WakerSelectionSheet(
        title = stringResource(R.string.settings_holiday_country_title),
        onDismiss = onDismiss,
    ) { dismiss ->
        WakerSheetOptionGroup {
            HolidayCountryPreferenceStore.SUPPORTED.forEachIndexed { index, code ->
                WakerSheetOptionRow(
                    title = holidayCountryDisplayLabel(code),
                    selected = code == current,
                    onClick = {
                        onSelect(code)
                        dismiss()
                    },
                    divider = index != HolidayCountryPreferenceStore.SUPPORTED.lastIndex,
                )
            }
        }
    }
}

