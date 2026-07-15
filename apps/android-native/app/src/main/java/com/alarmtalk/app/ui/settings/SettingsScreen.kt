package com.alarmtalk.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
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
    onLogout: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val promptPreferenceStore = remember(context) { DynamicPromptPreferenceStore(context) }
    var promptPreferences by remember(context) { mutableStateOf(promptPreferenceStore.read()) }
    val holidayCountryStore = remember(context) { HolidayCountryPreferenceStore(context) }
    var holidayCountryCode by remember(context) { mutableStateOf(holidayCountryStore.read()) }
    var showWeatherLocationDialog by remember { mutableStateOf(false) }
    var showFortuneInfoDialog by remember { mutableStateOf(false) }
    var showHolidayCountryDialog by remember { mutableStateOf(false) }
    var showLogoutConfirm by remember { mutableStateOf(false) }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack) {
                    Icon(
                        Icons.AutoMirrored.Outlined.ArrowBack,
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

        // 광고성 정보 수신(마케팅) 동의는 전체 탭 → 법적 정보 → '약관 및 개인정보 처리 동의' 화면으로 통합했다.
        // 약관·개인정보 링크와 회원탈퇴도 전체 탭(법적 정보 섹션·탈퇴하기 카드)에 있다.
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
        WeatherLocationPreferenceDialog(
            country = promptPreferences.weatherCountry,
            city = promptPreferences.weatherCity,
            onDismiss = { showWeatherLocationDialog = false },
            onConfirm = { country, city ->
                promptPreferenceStore.saveWeatherLocation(country, city)
                promptPreferences = promptPreferenceStore.read()
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
                promptPreferenceStore.saveFortuneInfo(gender, birthDate, birthTime)
                promptPreferences = promptPreferenceStore.read()
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

