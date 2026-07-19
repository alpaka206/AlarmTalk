package com.alarmtalk.app

import android.Manifest
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.MyLocation
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.R
import com.alarmtalk.app.WakerChipShape
import com.alarmtalk.app.WakerPanelShape
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

@Composable
internal fun RandomPromptSettingsPane(
    randomContext: String,
    manualText: String,
    // 직접 입력 옵션에 '(남은/총)' 을 붙여 이번 달 남은 만들기 횟수를 보여준다(유료·limit>0 일 때).
    manualRemaining: Int? = null,
    manualLimit: Int? = null,
    weatherCountry: String,
    weatherCity: String,
    savedWeatherCountry: String,
    savedWeatherCity: String,
    savedWeatherConfigured: Boolean,
    savedFortuneGender: String,
    savedFortuneBirthDate: String,
    savedFortuneBirthTime: String,
    savedFortuneConfigured: Boolean,
    usingTargetDynamicPromptSettings: Boolean,
    fortuneGender: String,
    fortuneBirthDate: String,
    fortuneBirthTime: String,
    onDismissWithoutSave: () -> Unit,
    onSaveSettings: (RandomPromptSettingsResult) -> Unit,
) {
    val context = LocalContext.current
    var draftContext by remember(randomContext) {
        mutableStateOf(
            if (randomContext == ManualMessageContext) ManualMessageContext
            else normalizedRandomPromptContext(randomContext),
        )
    }
    var draftWeatherCountry by remember(weatherCountry, savedWeatherCountry) {
        mutableStateOf(weatherCountry.ifBlank { savedWeatherCountry })
    }
    var draftWeatherCity by remember(weatherCity, savedWeatherCity) {
        mutableStateOf(weatherCity.ifBlank { savedWeatherCity })
    }
    var draftFortuneGender by remember(fortuneGender, savedFortuneGender) {
        mutableStateOf(fortuneGender.ifBlank { savedFortuneGender })
    }
    var draftFortuneBirthDate by remember(fortuneBirthDate, savedFortuneBirthDate) {
        mutableStateOf(fortuneBirthDate.ifBlank { savedFortuneBirthDate })
    }
    var draftFortuneBirthTime by remember(fortuneBirthTime, savedFortuneBirthTime) {
        mutableStateOf(fortuneBirthTime.ifBlank { savedFortuneBirthTime })
    }
    var weatherDialogOpen by remember { mutableStateOf(false) }
    var fortuneDialogOpen by remember { mutableStateOf(false) }
    var manualDialogOpen by remember { mutableStateOf(false) }
    val isManual = draftContext == ManualMessageContext
    val normalizedContext = if (isManual) ManualMessageContext else normalizedRandomPromptContext(draftContext)
    fun hasWeatherInfo(): Boolean =
        draftWeatherCity.isNotBlank() || savedWeatherConfigured
    fun hasFortuneInfo(): Boolean =
        (
            draftFortuneGender.isNotBlank() &&
                draftFortuneBirthDate.isNotBlank() &&
                draftFortuneBirthTime.isNotBlank()
            ) || savedFortuneConfigured

    fun saveResolvedSettings() {
        onSaveSettings(
            RandomPromptSettingsResult(
                randomContext = normalizedContext,
                weatherCountry = draftWeatherCountry.trim(),
                weatherCity = draftWeatherCity.trim(),
                fortuneGender = draftFortuneGender.trim(),
                fortuneBirthDate = draftFortuneBirthDate.trim(),
                fortuneBirthTime = draftFortuneBirthTime.trim(),
            ),
        )
    }

    fun requestRequiredInfoOrSave() {
        when {
            // 직접 입력은 문구를 다이얼로그로만 받는다(빈 문구로 저장되지 않게).
            isManual -> manualDialogOpen = true
            randomContextUsesWeather(normalizedContext) && !hasWeatherInfo() -> weatherDialogOpen = true
            normalizedContext == "wake_fortune" && !hasFortuneInfo() -> fortuneDialogOpen = true
            else -> saveResolvedSettings()
        }
    }

    fun selectContext(context: String) {
        draftContext = context
        // 상세 입력이 필요한 모드는 고르는 즉시 다이얼로그를 띄운다(날씨·운세·직접 입력).
        when {
            context == ManualMessageContext -> manualDialogOpen = true
            randomContextUsesWeather(context) -> weatherDialogOpen = true
            context == "wake_fortune" -> fortuneDialogOpen = true
        }
    }

    BackHandler(onBack = onDismissWithoutSave)

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 8.dp, top = 4.dp, end = 16.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onDismissWithoutSave) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                        contentDescription = stringResource(R.string.editorp_random_back),
                    )
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    text = stringResource(R.string.editorp_random_title),
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
            }

            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                SnoozeOptionSection {
                    EditorMessageContexts.forEachIndexed { index, (context, labelRes) ->
                        val baseLabel = stringResource(labelRes)
                        val label = if (
                            context == ManualMessageContext &&
                            manualLimit != null && manualLimit > 0 && manualRemaining != null
                        ) {
                            // 예: "직접 입력 (29/30)" — 이번 달 남은/총 만들기 횟수.
                            "$baseLabel ($manualRemaining/$manualLimit)"
                        } else {
                            baseLabel
                        }
                        SnoozeRadioRow(
                            label = label,
                            selected = normalizedContext == context,
                            onClick = { selectContext(context) },
                        )
                        if (index != EditorMessageContexts.lastIndex) SnoozeOptionDivider()
                    }
                }

                if (randomContextUsesWeather(normalizedContext)) {
                    RandomPromptDetailRow(
                        title = stringResource(R.string.editorp_random_weather_region_title),
                        value = when {
                            draftWeatherCountry.isNotBlank() && draftWeatherCity.isNotBlank() ->
                                stringResource(
                                    R.string.editorp_random_weather_region_value,
                                    weatherLocationSummary(context, draftWeatherCountry, draftWeatherCity),
                                )
                            usingTargetDynamicPromptSettings && savedWeatherConfigured ->
                                stringResource(R.string.editorp_random_weather_region_saved)
                            else -> stringResource(R.string.editorp_random_weather_region_required)
                        },
                    )
                }

                if (normalizedContext == "wake_fortune") {
                    RandomPromptDetailRow(
                        title = stringResource(R.string.editorp_random_fortune_title),
                        value = when {
                            draftFortuneGender.isNotBlank() &&
                                draftFortuneBirthDate.isNotBlank() &&
                                draftFortuneBirthTime.isNotBlank() ->
                                fortuneInfoSummary(context, draftFortuneGender, draftFortuneBirthDate, draftFortuneBirthTime)
                            usingTargetDynamicPromptSettings && savedFortuneConfigured ->
                                stringResource(R.string.editorp_random_fortune_saved)
                            else -> stringResource(R.string.editorp_random_fortune_required)
                        },
                    )
                }
            }

            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = MaterialTheme.colorScheme.background,
                tonalElevation = 0.dp,
                shadowElevation = 0.dp,
            ) {
                Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) {
                    Button(
                        onClick = ::requestRequiredInfoOrSave,
                        modifier = Modifier.fillMaxWidth(),
                        shape = WakerButtonShape,
                    ) {
                        Text(stringResource(R.string.editorp_random_save_button))
                    }
                }
            }
        }
    }

    if (weatherDialogOpen) {
        WeatherLocationDialog(
            country = draftWeatherCountry,
            city = draftWeatherCity,
            onDismissWithoutSave = onDismissWithoutSave,
            onConfirm = { country, city ->
                draftWeatherCountry = country
                draftWeatherCity = city
                weatherDialogOpen = false
                saveResolvedSettings()
            },
        )
    }

    if (fortuneDialogOpen) {
        FortuneInfoDialog(
            gender = draftFortuneGender,
            birthDate = draftFortuneBirthDate,
            birthTime = draftFortuneBirthTime,
            onDismissWithoutSave = onDismissWithoutSave,
            onConfirm = { gender, birthDate, birthTime ->
                draftFortuneGender = gender
                draftFortuneBirthDate = birthDate
                draftFortuneBirthTime = birthTime
                fortuneDialogOpen = false
                saveResolvedSettings()
            },
        )
    }

    if (manualDialogOpen) {
        ManualMessageDialog(
            initialText = manualText,
            // 취소는 pane 에 머문다(직접 입력 선택만 남고 저장은 안 됨).
            onDismiss = { manualDialogOpen = false },
            onConfirm = { text ->
                manualDialogOpen = false
                onSaveSettings(
                    RandomPromptSettingsResult(
                        randomContext = ManualMessageContext,
                        weatherCountry = draftWeatherCountry.trim(),
                        weatherCity = draftWeatherCity.trim(),
                        fortuneGender = draftFortuneGender.trim(),
                        fortuneBirthDate = draftFortuneBirthDate.trim(),
                        fortuneBirthTime = draftFortuneBirthTime.trim(),
                        manualText = text,
                    ),
                )
            },
        )
    }
}

// '직접 입력' 선택 시 뜨는 문구 입력 다이얼로그(날씨·운세 다이얼로그와 같은 층위).
@Composable
private fun ManualMessageDialog(
    initialText: String,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var draft by remember(initialText) { mutableStateOf(initialText) }
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .widthIn(max = 460.dp),
            shape = WakerDialogShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
            shadowElevation = 18.dp,
            border = wakerCardBorder(),
        ) {
            Column(
                modifier = Modifier.padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                ModalDialogTitle(
                    title = stringResource(R.string.editor_msg_mode_manual),
                    onDismiss = onDismiss,
                )
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it.take(200) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 120.dp),
                    placeholder = { Text(stringResource(R.string.editor_manual_input_placeholder)) },
                    shape = WakerInputShape,
                    colors = wakerOutlinedTextFieldColors(),
                )
                Button(
                    onClick = { onConfirm(draft.trim()) },
                    enabled = draft.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                    shape = WakerButtonShape,
                ) {
                    Text(stringResource(R.string.editorp_random_save_button))
                }
            }
        }
    }
}

@Composable
internal fun RandomPromptDetailRow(
    title: String,
    value: String,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = WakerChipShape,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Text(title, fontWeight = FontWeight.SemiBold)
            Text(
                text = value,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
internal fun WeatherLocationDialog(
    country: String,
    city: String,
    onDismissWithoutSave: () -> Unit,
    onConfirm: (String, String) -> Unit,
) {
    var draftCountry by remember(country) { mutableStateOf(country) }
    var draftCity by remember(city) { mutableStateOf(city) }
    var submitted by remember { mutableStateOf(false) }
    val cityError = submitted && draftCity.isBlank()

    Dialog(
        onDismissRequest = onDismissWithoutSave,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .widthIn(max = 460.dp),
            shape = WakerDialogShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
            shadowElevation = 18.dp,
            border = wakerCardBorder(),
        ) {
            Column(
                modifier = Modifier
                    .padding(20.dp)
                    .heightIn(max = 600.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                ModalDialogTitle(
                    title = stringResource(R.string.editorp_random_weather_region_title),
                    onDismiss = onDismissWithoutSave,
                )
                Surface(
                    shape = WakerPanelShape,
                    color = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.34f),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text(
                            text = stringResource(R.string.editorp_weather_dialog_section_title),
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                        )
                        Text(
                            text = stringResource(R.string.editorp_weather_dialog_section_desc),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                WeatherCityPickerField(
                    city = draftCity,
                    cityError = cityError,
                    onCityChange = { draftCity = it },
                )
                Button(
                    onClick = {
                        submitted = true
                        if (draftCity.isNotBlank()) {
                            onConfirm(draftCountry.trim(), draftCity.trim())
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = WakerButtonShape,
                ) {
                    Text(stringResource(R.string.editorp_weather_save_button))
                }
            }
        }
    }
}
