package com.alarmtalk.app

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.R
import com.alarmtalk.app.data.DynamicPromptPreferenceStore
import com.alarmtalk.app.data.toDynamicPromptSettings
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.DynamicPromptSettings

@Composable
internal fun SettingsScreen(
    contentPadding: PaddingValues,
    authSession: AuthSession?,
    themeMode: ThemeMode,
    onBack: () -> Unit,
    onChangeTheme: (ThemeMode) -> Unit,
    onEditNickname: () -> Unit,
    onUpdateDynamicPromptSettings: (DynamicPromptSettings) -> Unit,
    onLogout: () -> Unit,
    onDeleteAccount: () -> Unit,
) {
    val context = LocalContext.current
    val promptPreferenceStore = remember(context) { DynamicPromptPreferenceStore(context) }
    var promptPreferences by remember(context) { mutableStateOf(promptPreferenceStore.read()) }
    var showThemeDialog by remember { mutableStateOf(false) }
    var showWeatherLocationDialog by remember { mutableStateOf(false) }
    var showFortuneInfoDialog by remember { mutableStateOf(false) }

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
            SettingsCard(title = stringResource(R.string.hs_settings_section_display)) {
                SettingsRow(
                    label = stringResource(R.string.hs_settings_theme),
                    value = themeModeLabel(context, themeMode),
                    onClick = { showThemeDialog = true },
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

        item {
            SettingsCard(title = stringResource(R.string.hs_settings_section_terms)) {
                SettingsRow(
                    label = stringResource(R.string.hs_settings_terms_of_service),
                    value = null,
                    onClick = { context.openExternalUrl("https://alarm-talk.com/ko/terms") },
                )
                HorizontalDivider()
                SettingsRow(
                    label = stringResource(R.string.hs_settings_privacy_policy),
                    value = null,
                    onClick = { context.openExternalUrl("https://alarm-talk.com/ko/privacy") },
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
                        onClick = onLogout,
                    )
                }
            }

            item {
                SettingsCard(title = null) {
                    SettingsRow(
                        label = stringResource(R.string.hs_settings_delete_account),
                        value = null,
                        labelColor = MaterialTheme.colorScheme.error,
                        onClick = onDeleteAccount,
                    )
                }
            }
        }
    }

    if (showThemeDialog) {
        ThemeModePickerDialog(
            current = themeMode,
            onDismiss = { showThemeDialog = false },
            onSelect = { mode ->
                showThemeDialog = false
                onChangeTheme(mode)
            },
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
            description = stringResource(R.string.hs_fortune_info_description),
            onDismissWithoutSave = { showFortuneInfoDialog = false },
            onConfirm = { gender, birthDate, birthTime ->
                promptPreferenceStore.saveFortuneInfo(gender, birthDate, birthTime)
                promptPreferences = promptPreferenceStore.read()
                onUpdateDynamicPromptSettings(promptPreferences.toDynamicPromptSettings())
                showFortuneInfoDialog = false
            },
        )
    }

}

