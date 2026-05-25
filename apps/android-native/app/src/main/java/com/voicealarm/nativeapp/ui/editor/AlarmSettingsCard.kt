package com.voicealarm.nativeapp

import android.content.Context
import android.media.AudioAttributes
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.Manifest
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.MyLocation
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material.icons.outlined.Snooze
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import com.voicealarm.nativeapp.data.SnoozeRepeatLimits
import com.voicealarm.nativeapp.data.VibrationPatternLibrary
import com.voicealarm.nativeapp.data.VibrationPatterns

@Composable
internal fun ChipGrid(
    options: List<Pair<String, String>>,
    selected: String,
    onSelect: (String) -> Unit,
    selectedContainerColor: Color? = null,
    selectedLabelColor: Color? = null,
) {
    val chipColors = FilterChipDefaults.filterChipColors(
        selectedContainerColor = selectedContainerColor ?: MaterialTheme.colorScheme.primaryContainer,
        selectedLabelColor = selectedLabelColor ?: MaterialTheme.colorScheme.onPrimaryContainer,
    )
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.chunked(3).forEach { rowOptions ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                rowOptions.forEach { (value, label) ->
                    FilterChip(
                        selected = selected == value,
                        onClick = { onSelect(value) },
                        colors = chipColors,
                        label = { Text(label) },
                    )
                }
            }
        }
    }
}

private val SnoozeIntervals = listOf(5, 10, 15, 30)

private val VibrationOptions = listOf(
    VibrationPatterns.DEFAULT to "Basic call",
    VibrationPatterns.STRONG to "Strong",
    VibrationPatterns.SHORT to "Short",
    VibrationPatterns.MEDIUM to "Medium",
    VibrationPatterns.HEARTBEAT to "Heartbeat",
    VibrationPatterns.TICKTOCK to "Ticktock",
    VibrationPatterns.WALTZ to "Waltz",
    VibrationPatterns.ZIGZAG to "Zig-zig-zig",
    VibrationPatterns.OFF_BEAT to "Off-beat",
    VibrationPatterns.RIPPLE to "Ripple",
    VibrationPatterns.SIREN to "Siren",
)

@Composable
internal fun AlarmSettingsCard(
    snoozeEnabled: Boolean,
    snoozeMinutes: Int,
    snoozeRepeatLimit: Int,
    vibrationPattern: String,
    alarmVolumePercent: Int,
    alarmSoundLabel: String?,
    showAlarmSound: Boolean,
    onSnoozeEnabledChange: (Boolean) -> Unit,
    onSnoozeMinutesChange: (Int) -> Unit,
    onSnoozeRepeatLimitChange: (Int) -> Unit,
    onVibrationEnabledChange: (Boolean) -> Unit,
    onVibrationSelect: (String) -> Unit,
    onAlarmVolumeChange: (Int) -> Unit,
    onOpenSnoozeSettings: () -> Unit,
    onOpenVibrationSettings: () -> Unit,
    onOpenAlarmSoundSettings: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
            Text(
                text = "세부 설정",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onBackground,
                modifier = Modifier.padding(bottom = 6.dp),
            )
            AlarmSettingRow(
                title = "다시 울림",
                subtitle = if (snoozeEnabled) "${snoozeMinutes}분 · ${snoozeRepeatLabel(snoozeRepeatLimit)}" else "꺼짐",
                icon = Icons.Outlined.Snooze,
                onClick = onOpenSnoozeSettings,
                trailing = {
                    VoiceAlarmSwitch(
                        checked = snoozeEnabled,
                        onCheckedChange = onSnoozeEnabledChange,
                    )
                },
            )
            AlarmSettingDivider()
            AlarmSettingRow(
                title = "진동",
                subtitle = vibrationLabel(vibrationPattern),
                icon = Icons.Outlined.Notifications,
                onClick = onOpenVibrationSettings,
                trailing = {
                    VoiceAlarmSwitch(
                        checked = vibrationPattern != VibrationPatterns.NONE,
                        onCheckedChange = onVibrationEnabledChange,
                    )
                },
            )
            if (showAlarmSound) {
                AlarmSettingDivider()
                AlarmSettingRow(
                    title = "알람음",
                    subtitle = alarmSoundSummary(
                        alarmVolumePercent = alarmVolumePercent,
                        alarmSoundLabel = alarmSoundLabel,
                    ),
                    icon = Icons.Outlined.Alarm,
                    onClick = onOpenAlarmSoundSettings,
                    trailing = {
                        VoiceAlarmSwitch(
                            checked = alarmVolumePercent > 0,
                            onCheckedChange = { enabled ->
                                onAlarmVolumeChange(if (enabled) 100 else 0)
                            },
                        )
                    },
                )
            }
        }
}

private fun alarmVolumeLabel(value: Int): String =
    if (value <= 0) "무음" else "${value.coerceIn(0, 100)}%"

private fun alarmSoundSummary(
    alarmVolumePercent: Int,
    alarmSoundLabel: String?,
): String =
    if (alarmVolumePercent <= 0) {
        "무음"
    } else {
        "${alarmSoundLabel ?: "기본 알람음"} · ${alarmVolumeLabel(alarmVolumePercent)}"
    }

@Composable
private fun AlarmSoundActionRow(
    title: String,
    subtitle: String,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        color = Color.Transparent,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 11.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.width(12.dp))
            Text(
                text = ">",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
internal fun AlarmSoundSettingsPane(
    alarmVolumePercent: Int,
    alarmSoundLabel: String?,
    onDismiss: () -> Unit,
    onAlarmVolumeChange: (Int) -> Unit,
    onPickAlarmSound: () -> Unit,
) {
    val alarmEnabled = alarmVolumePercent > 0
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 8.dp, top = 4.dp, end = 16.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onDismiss) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                        contentDescription = "뒤로",
                    )
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    text = "알람음",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Surface(
                    shape = RoundedCornerShape(18.dp),
                    color = MaterialTheme.colorScheme.surface,
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 9.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = if (alarmEnabled) "사용 중" else "무음",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = if (alarmEnabled) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.onSurface
                            },
                        )
                        VoiceAlarmSwitch(
                            checked = alarmEnabled,
                            onCheckedChange = { enabled ->
                                onAlarmVolumeChange(if (enabled) 100 else 0)
                            },
                        )
                    }
                }

                if (alarmEnabled) {
                    SnoozeOptionSection(title = "알람음") {
                        AlarmSoundActionRow(
                            title = "알람음",
                            subtitle = alarmSoundLabel ?: "기본 알람음",
                            onClick = onPickAlarmSound,
                        )
                    }
                }

                SnoozeOptionSection(title = "볼륨") {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = "볼륨",
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                text = alarmVolumeLabel(alarmVolumePercent),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                        Slider(
                            value = alarmVolumePercent.toFloat(),
                            onValueChange = { onAlarmVolumeChange(it.toInt().coerceIn(0, 100)) },
                            valueRange = 0f..100f,
                            steps = 9,
                            enabled = alarmEnabled,
                        )
                    }
                }
            }
        }
    }
}

@Composable
internal fun VibrationSettingsPane(
    vibrationPattern: String,
    onDismiss: () -> Unit,
    onVibrationEnabledChange: (Boolean) -> Unit,
    onVibrationSelect: (String) -> Unit,
) {
    val context = LocalContext.current
    val vibrationEnabled = vibrationPattern != VibrationPatterns.NONE
    val selectedPattern = if (vibrationEnabled) vibrationPattern else VibrationPatterns.DEFAULT

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 8.dp, top = 4.dp, end = 16.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onDismiss) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                        contentDescription = "뒤로",
                    )
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    text = "진동",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Surface(
                    shape = RoundedCornerShape(18.dp),
                    color = MaterialTheme.colorScheme.surface,
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 9.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = if (vibrationEnabled) "사용 중" else "사용 안 함",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = if (vibrationEnabled) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.onSurface
                            },
                        )
                        VoiceAlarmSwitch(
                            checked = vibrationEnabled,
                            onCheckedChange = onVibrationEnabledChange,
                        )
                    }
                }

                SnoozeOptionSection(title = "패턴") {
                    VibrationOptions.forEachIndexed { index, (pattern, label) ->
                        SnoozeRadioRow(
                            label = label,
                            selected = selectedPattern == pattern,
                            onClick = {
                                onVibrationEnabledChange(true)
                                onVibrationSelect(pattern)
                                previewVibration(context, pattern)
                            },
                        )
                        if (index != VibrationOptions.lastIndex) {
                            SnoozeOptionDivider()
                        }
                    }
                }
            }
        }
    }
}

internal data class RandomPromptSettingsResult(
    val voiceLanguage: String,
    val randomContext: String,
    val weatherCountry: String,
    val weatherCity: String,
    val fortuneGender: String,
    val fortuneBirthDate: String,
    val fortuneBirthTime: String,
)

@Composable
internal fun RandomPromptSettingsPane(
    voiceLanguage: String,
    randomContext: String,
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
    var draftLanguage by remember(voiceLanguage) {
        mutableStateOf(voiceLanguage.takeIf { language -> TtsLanguages.any { it.first == language } } ?: "ko")
    }
    var draftContext by remember(randomContext) {
        mutableStateOf(normalizedRandomPromptContext(randomContext))
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
    val normalizedContext = normalizedRandomPromptContext(draftContext)
    fun hasWeatherInfo(): Boolean =
        (draftWeatherCountry.isNotBlank() && draftWeatherCity.isNotBlank()) || savedWeatherConfigured
    fun hasFortuneInfo(): Boolean =
        (
            draftFortuneGender.isNotBlank() &&
                draftFortuneBirthDate.isNotBlank() &&
                draftFortuneBirthTime.isNotBlank()
            ) || savedFortuneConfigured

    fun saveResolvedSettings() {
        onSaveSettings(
            RandomPromptSettingsResult(
                voiceLanguage = draftLanguage,
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
            randomContextUsesWeather(normalizedContext) && !hasWeatherInfo() -> weatherDialogOpen = true
            normalizedContext == "wake_fortune" && !hasFortuneInfo() -> fortuneDialogOpen = true
            else -> saveResolvedSettings()
        }
    }

    fun selectContext(context: String) {
        draftContext = context
        when {
            randomContextUsesWeather(context) && !hasWeatherInfo() -> weatherDialogOpen = true
            context == "wake_fortune" && !hasFortuneInfo() -> fortuneDialogOpen = true
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
                        contentDescription = "뒤로",
                    )
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    text = "랜덤 문구 설정",
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
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.55f),
                ) {
                    Text(
                        text = "저장하면 선택한 조건으로 알람 문구를 만들어요. 저장하지 않으면 직접 입력으로 돌아가요.",
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                    )
                }

                SnoozeOptionSection(title = "문구 종류") {
                    RandomPromptContexts.forEachIndexed { index, (context, label) ->
                        SnoozeRadioRow(
                            label = label,
                            selected = normalizedContext == context,
                            onClick = { selectContext(context) },
                        )
                        if (index != RandomPromptContexts.lastIndex) SnoozeOptionDivider()
                    }
                }

                if (randomContextUsesWeather(normalizedContext)) {
                    RandomPromptDetailRow(
                        title = "날씨 지역",
                        value = when {
                            draftWeatherCountry.isNotBlank() && draftWeatherCity.isNotBlank() ->
                                "${weatherLocationSummary(draftWeatherCountry, draftWeatherCity)} 날씨를 사용해요."
                            usingTargetDynamicPromptSettings && savedWeatherConfigured ->
                                "상대가 저장한 날씨 지역을 사용해요."
                            else -> "날씨가 들어간 문구를 쓰려면 나라와 도시가 필요해요."
                        },
                    )
                }

                if (normalizedContext == "wake_fortune") {
                    RandomPromptDetailRow(
                        title = "운세 정보",
                        value = when {
                            draftFortuneGender.isNotBlank() &&
                                draftFortuneBirthDate.isNotBlank() &&
                                draftFortuneBirthTime.isNotBlank() ->
                                fortuneInfoSummary(draftFortuneGender, draftFortuneBirthDate, draftFortuneBirthTime)
                            usingTargetDynamicPromptSettings && savedFortuneConfigured ->
                                "상대가 저장한 운세 정보를 사용해요."
                            else -> "운세가 들어간 문구를 쓰려면 성별, 생년월일, 태어난 시간이 필요해요."
                        },
                    )
                }

                SnoozeOptionSection(title = "언어") {
                    TtsLanguages.forEachIndexed { index, (language, label) ->
                        SnoozeRadioRow(
                            label = label,
                            selected = draftLanguage == language,
                            onClick = { draftLanguage = language },
                        )
                        if (index != TtsLanguages.lastIndex) SnoozeOptionDivider()
                    }
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
                        Icon(Icons.Outlined.Save, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("저장")
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
}

@Composable
private fun RandomPromptDetailRow(
    title: String,
    value: String,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
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
private fun WeatherLocationDialog(
    country: String,
    city: String,
    onDismissWithoutSave: () -> Unit,
    onConfirm: (String, String) -> Unit,
) {
    var draftCountry by remember(country) { mutableStateOf(country) }
    var draftCity by remember(city) { mutableStateOf(city) }
    var submitted by remember { mutableStateOf(false) }
    var locationBusy by remember { mutableStateOf(false) }
    var locationStatus by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    fun startLocationLookup() {
        if (locationBusy) return
        scope.launch {
            locationBusy = true
            locationStatus = "현재 위치를 가져오는 중..."
            val fix = withContext(Dispatchers.IO) {
                runCatching {
                    com.voicealarm.nativeapp.location.WeatherLocationProvider.resolve(context)
                }.getOrNull()
            }
            if (fix == null) {
                locationStatus = "위치를 가져오지 못했어요. GPS/위치 서비스가 켜져 있는지 확인하거나 직접 입력해 주세요."
            } else {
                draftCountry = fix.country.ifBlank { draftCountry }
                draftCity = fix.city.ifBlank { draftCity }
                locationStatus = if (fix.country.isBlank() && fix.city.isBlank()) {
                    "위치를 가져왔지만 주소 정보를 못 찾았어요. GPS/위치 서비스가 켜져 있는지 확인하거나 직접 입력해 주세요."
                } else {
                    "현재 위치로 채웠어요"
                }
            }
            locationBusy = false
        }
    }

    val locationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { results ->
        val granted = results.values.any { it }
        if (!granted) {
            locationStatus = "위치 권한이 거부됐어요. 권한과 GPS/위치 서비스를 확인하거나 직접 입력해 주세요."
            return@rememberLauncherForActivityResult
        }
        startLocationLookup()
    }
    val countryError = submitted && draftCountry.isBlank()
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
            shape = WakerCardShape,
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
                    title = "날씨 지역",
                    onDismiss = onDismissWithoutSave,
                )
                Surface(
                    shape = RoundedCornerShape(18.dp),
                    color = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.34f),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text(
                            text = "날씨 문구에 사용할 지역",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                        )
                        Text(
                            text = "직접 입력하거나 현재 위치로 채울 수 있어요. 저장하지 않으면 랜덤 문구가 꺼져요.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        OutlinedButton(
                            onClick = {
                                if (com.voicealarm.nativeapp.location.WeatherLocationProvider.hasPermission(context)) {
                                    startLocationLookup()
                                } else {
                                    locationPermissionLauncher.launch(
                                        arrayOf(
                                            Manifest.permission.ACCESS_COARSE_LOCATION,
                                            Manifest.permission.ACCESS_FINE_LOCATION,
                                        ),
                                    )
                                }
                            },
                            enabled = !locationBusy,
                            modifier = Modifier.fillMaxWidth(),
                            shape = WakerButtonShape,
                            border = wakerCardBorder(),
                            colors = wakerOutlinedButtonColors(),
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.Center,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                if (locationBusy) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(18.dp),
                                        strokeWidth = 2.dp,
                                    )
                                    Spacer(Modifier.width(8.dp))
                                    Text("위치 가져오는 중")
                                } else {
                                    Icon(
                                        imageVector = Icons.Outlined.MyLocation,
                                        contentDescription = null,
                                        modifier = Modifier.size(18.dp),
                                    )
                                    Spacer(Modifier.width(8.dp))
                                    Text("현재 위치 사용")
                                }
                            }
                        }
                    }
                }
                locationStatus?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = draftCountry,
                        onValueChange = { draftCountry = it.take(30) },
                        label = { Text("나라") },
                        placeholder = { Text("예: 대한민국") },
                        singleLine = true,
                        isError = countryError,
                        supportingText = {
                            if (countryError) Text("꼭 입력해 주세요.")
                        },
                        shape = WakerInputShape,
                        colors = wakerOutlinedTextFieldColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = draftCity,
                        onValueChange = { draftCity = it.take(30) },
                        label = { Text("도시") },
                        placeholder = { Text("예: 서울") },
                        singleLine = true,
                        isError = cityError,
                        supportingText = {
                            if (cityError) Text("꼭 입력해 주세요.")
                        },
                        shape = WakerInputShape,
                        colors = wakerOutlinedTextFieldColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Button(
                        onClick = {
                            submitted = true
                            if (draftCountry.isNotBlank() && draftCity.isNotBlank()) {
                                onConfirm(draftCountry.trim(), draftCity.trim())
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        shape = WakerButtonShape,
                    ) {
                        Text("저장")
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FortuneInfoDialog(
    gender: String,
    birthDate: String,
    birthTime: String,
    description: String = "운세가 들어간 문구를 만들 때만 사용해요. 저장하지 않으면 랜덤 문구가 꺼져요.",
    onDismissWithoutSave: () -> Unit,
    onConfirm: (String, String, String) -> Unit,
) {
    var draftGender by remember(gender) { mutableStateOf(normalizeFortuneGender(gender)) }
    var draftBirthDate by remember(birthDate) { mutableStateOf(normalizeFortuneBirthDate(birthDate)) }
    var draftBirthTime by remember(birthTime) { mutableStateOf(normalizeFortuneBirthTime(birthTime)) }
    var submitted by remember { mutableStateOf(false) }
    var datePickerOpen by remember { mutableStateOf(false) }
    var timePickerOpen by remember { mutableStateOf(false) }
    val genderError = submitted && draftGender.isBlank()
    val birthDateError = submitted && draftBirthDate.isBlank()
    val birthTimeError = submitted && draftBirthTime.isBlank()

    Dialog(
        onDismissRequest = onDismissWithoutSave,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            shape = RoundedCornerShape(28.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 6.dp,
            shadowElevation = 18.dp,
        ) {
            Column(
                modifier = Modifier
                    .padding(24.dp)
                    .heightIn(max = 640.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                ModalDialogTitle(
                    title = "운세 정보",
                    onDismiss = onDismissWithoutSave,
                )
                Text(
                    text = description,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                FortuneFieldLabel(text = "성별", error = genderError)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    GenderChoice(
                        label = "남",
                        selected = draftGender == FortuneGenderMale,
                        onClick = { draftGender = FortuneGenderMale },
                        modifier = Modifier.weight(1f),
                    )
                    GenderChoice(
                        label = "여",
                        selected = draftGender == FortuneGenderFemale,
                        onClick = { draftGender = FortuneGenderFemale },
                        modifier = Modifier.weight(1f),
                    )
                }

                FortuneFieldLabel(text = "생년월일", error = birthDateError)
                FortuneSelectorRow(
                    value = if (draftBirthDate.isBlank()) "탭하여 생년월일 선택" else formatBirthDateDisplay(draftBirthDate),
                    placeholderActive = draftBirthDate.isBlank(),
                    error = birthDateError,
                    onClick = { datePickerOpen = true },
                )

                FortuneFieldLabel(text = "태어난 시간", error = birthTimeError)
                FortuneSelectorRow(
                    value = if (draftBirthTime.isBlank()) "탭하여 시간 선택" else formatBirthTimeDisplay(draftBirthTime),
                    placeholderActive = draftBirthTime.isBlank(),
                    error = birthTimeError,
                    onClick = { timePickerOpen = true },
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Button(
                        onClick = {
                            submitted = true
                            if (
                                draftGender.isNotBlank() &&
                                draftBirthDate.isNotBlank() &&
                                draftBirthTime.isNotBlank()
                            ) {
                                onConfirm(
                                    draftGender.trim(),
                                    draftBirthDate.trim(),
                                    draftBirthTime.trim(),
                                )
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        shape = WakerButtonShape,
                    ) {
                        Text("저장")
                    }
                }
            }
        }
    }

    if (datePickerOpen) {
        val initialMillis = parseBirthDateMillis(draftBirthDate)
        val state = rememberDatePickerState(initialSelectedDateMillis = initialMillis)
        DatePickerDialog(
            onDismissRequest = { datePickerOpen = false },
            confirmButton = {
                TextButton(
                    onClick = {
                        state.selectedDateMillis?.let { millis ->
                            draftBirthDate = formatBirthDateIso(millis)
                        }
                        datePickerOpen = false
                    },
                ) { Text("확인") }
            },
            dismissButton = {},
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ModalDialogTitle(
                    title = "생년월일",
                    onDismiss = { datePickerOpen = false },
                    modifier = Modifier.padding(horizontal = 24.dp),
                )
                DatePicker(state = state)
            }
        }
    }

    if (timePickerOpen) {
        val (hourInit, minuteInit) = parseBirthTimeParts(draftBirthTime)
        val state = rememberTimePickerState(
            initialHour = hourInit,
            initialMinute = minuteInit,
            is24Hour = true,
        )
        Dialog(onDismissRequest = { timePickerOpen = false }) {
            Surface(
                shape = RoundedCornerShape(24.dp),
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 6.dp,
                shadowElevation = 18.dp,
            ) {
                Column(
                    modifier = Modifier.padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    ModalDialogTitle(
                        title = "태어난 시간",
                        onDismiss = { timePickerOpen = false },
                    )
                    TimePicker(state = state)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                    ) {
                        TextButton(
                            onClick = {
                                draftBirthTime = String.format(
                                    Locale.US,
                                    "%02d:%02d",
                                    state.hour,
                                    state.minute,
                                )
                                timePickerOpen = false
                            },
                        ) { Text("확인") }
                    }
                }
            }
        }
    }
}

private const val FortuneGenderMale = "남성"
private const val FortuneGenderFemale = "여성"

private fun normalizeFortuneGender(value: String): String =
    when (value.trim()) {
        "남", "남자", "M", "male", "Male", "MALE", FortuneGenderMale -> FortuneGenderMale
        "여", "여자", "F", "female", "Female", "FEMALE", FortuneGenderFemale -> FortuneGenderFemale
        else -> ""
    }

private fun normalizeFortuneBirthDate(value: String): String {
    val trimmed = value.trim()
    if (trimmed.isBlank()) return ""
    val digits = trimmed.filter { it.isDigit() }
    return if (digits.length == 8) {
        "${digits.substring(0, 4)}-${digits.substring(4, 6)}-${digits.substring(6, 8)}"
    } else {
        trimmed
    }
}

private fun normalizeFortuneBirthTime(value: String): String {
    val trimmed = value.trim()
    if (trimmed.isBlank()) return ""
    val digits = trimmed.filter { it.isDigit() }
    return when (digits.length) {
        4 -> "${digits.substring(0, 2)}:${digits.substring(2, 4)}"
        3 -> "0${digits.substring(0, 1)}:${digits.substring(1, 3)}"
        else -> trimmed
    }
}

private fun parseBirthDateMillis(value: String): Long? {
    val digits = value.filter { it.isDigit() }
    if (digits.length != 8) return null
    val year = digits.substring(0, 4).toIntOrNull() ?: return null
    val month = digits.substring(4, 6).toIntOrNull() ?: return null
    val day = digits.substring(6, 8).toIntOrNull() ?: return null
    val calendar = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
        clear()
        set(year, month - 1, day)
    }
    return calendar.timeInMillis
}

private fun parseBirthTimeParts(value: String): Pair<Int, Int> {
    val parts = value.split(":")
    val hour = parts.getOrNull(0)?.toIntOrNull()?.coerceIn(0, 23) ?: 9
    val minute = parts.getOrNull(1)?.toIntOrNull()?.coerceIn(0, 59) ?: 0
    return hour to minute
}

private fun formatBirthDateIso(millis: Long): String {
    val formatter = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    formatter.timeZone = TimeZone.getTimeZone("UTC")
    return formatter.format(java.util.Date(millis))
}

private fun formatBirthDateDisplay(value: String): String {
    val digits = value.filter { it.isDigit() }
    if (digits.length != 8) return value
    return "${digits.substring(0, 4)}년 ${digits.substring(4, 6).trimStart('0')}월 ${digits.substring(6, 8).trimStart('0')}일"
}

private fun formatBirthTimeDisplay(value: String): String {
    val parts = value.split(":")
    val hour = parts.getOrNull(0)?.toIntOrNull() ?: return value
    val minute = parts.getOrNull(1)?.toIntOrNull() ?: return value
    val suffix = if (hour < 12) "오전" else "오후"
    val display = if (hour == 0) 12 else if (hour > 12) hour - 12 else hour
    return "$suffix ${display}시 ${String.format(Locale.US, "%02d", minute)}분"
}

@Composable
private fun FortuneFieldLabel(text: String, error: Boolean) {
    Text(
        text = if (error) "$text · 필수 입력" else text,
        style = MaterialTheme.typography.labelLarge,
        fontWeight = FontWeight.SemiBold,
        color = if (error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
    )
}

@Composable
private fun FortuneSelectorRow(
    value: String,
    placeholderActive: Boolean,
    error: Boolean,
    onClick: () -> Unit,
) {
    val borderColor = when {
        error -> MaterialTheme.colorScheme.error
        else -> MaterialTheme.colorScheme.outline
    }
    Surface(
        onClick = onClick,
        shape = WakerInputShape,
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, borderColor),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = value,
                style = MaterialTheme.typography.bodyLarge,
                color = if (placeholderActive) {
                    MaterialTheme.colorScheme.onSurfaceVariant
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
                modifier = Modifier.weight(1f),
            )
            Icon(
                imageVector = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun GenderChoice(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(14.dp),
        color = if (selected) {
            MaterialTheme.colorScheme.primaryContainer
        } else {
            MaterialTheme.colorScheme.surface
        },
        border = BorderStroke(
            width = if (selected) 1.5.dp else 1.dp,
            color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
        ),
        modifier = modifier,
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 14.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = if (selected) {
                    MaterialTheme.colorScheme.onPrimaryContainer
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
            )
        }
    }
}

private fun weatherLocationSummary(country: String, city: String): String =
    listOf(country, city)
        .map { it.trim() }
        .filter { it.isNotBlank() }
        .joinToString(" ")
        .ifBlank { "나라와 도시를 입력해 주세요." }

private fun fortuneInfoSummary(gender: String, birthDate: String, birthTime: String): String =
    listOf(gender, birthDate, birthTime)
        .map { it.trim() }
        .filter { it.isNotBlank() }
        .joinToString(" · ")
        .ifBlank { "성별, 생년월일, 태어난 시간을 입력해 주세요." }

@Composable
internal fun VoiceTranslationSettingsPane(
    voiceLanguage: String,
    onDismiss: () -> Unit,
    onLanguageChange: (String) -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 8.dp, top = 4.dp, end = 16.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onDismiss) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                        contentDescription = "뒤로",
                    )
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    text = "번역 언어",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                SnoozeOptionSection(title = "언어") {
                    TtsTranslationLanguages.forEachIndexed { index, (language, label) ->
                        SnoozeRadioRow(
                            label = label,
                            selected = voiceLanguage == language,
                            onClick = { onLanguageChange(language) },
                        )
                        if (index != TtsTranslationLanguages.lastIndex) SnoozeOptionDivider()
                    }
                }
            }
        }
    }
}

private fun previewVibration(context: Context, patternName: String) {
    if (patternName == VibrationPatterns.NONE) return
    val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        context.getSystemService(VibratorManager::class.java)?.defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    } ?: return
    val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
    vibrator.cancel()
    @Suppress("DEPRECATION")
    vibrator.vibrate(VibrationEffect.createWaveform(VibrationPatternLibrary.waveform(patternName), -1), attributes)
}

@Composable
private fun AlarmSettingRow(
    title: String,
    subtitle: String,
    icon: ImageVector,
    onClick: () -> Unit,
    trailing: @Composable () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 14.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Surface(
            modifier = Modifier.size(38.dp),
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.72f),
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(end = 12.dp),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            MutedText(subtitle)
        }
        trailing()
        Spacer(Modifier.width(6.dp))
        Icon(
            imageVector = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp),
        )
    }
}

@Composable
private fun AlarmSettingDivider() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(MaterialTheme.colorScheme.outlineVariant),
    )
}

@Composable
internal fun SnoozeSettingsPane(
    snoozeEnabled: Boolean,
    snoozeMinutes: Int,
    snoozeRepeatLimit: Int,
    onDismiss: () -> Unit,
    onSnoozeEnabledChange: (Boolean) -> Unit,
    onSnoozeMinutesChange: (Int) -> Unit,
    onSnoozeRepeatLimitChange: (Int) -> Unit,
) {
    var customIntervalDialogOpen by remember { mutableStateOf(false) }
    var customMinutesText by remember(snoozeMinutes) { mutableStateOf(snoozeMinutes.toString()) }
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 8.dp, top = 4.dp, end = 16.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onDismiss) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                        contentDescription = "뒤로",
                    )
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    text = "다시 울림",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Surface(
                    shape = RoundedCornerShape(18.dp),
                    color = MaterialTheme.colorScheme.surface,
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 9.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = if (snoozeEnabled) "사용 중" else "사용 안 함",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = if (snoozeEnabled) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.onSurface
                            },
                        )
                        VoiceAlarmSwitch(
                            checked = snoozeEnabled,
                            onCheckedChange = onSnoozeEnabledChange,
                        )
                    }
                }

                SnoozeOptionSection(title = "간격") {
                    SnoozeIntervals.forEachIndexed { index, minutes ->
                        SnoozeRadioRow(
                            label = "${minutes}분",
                            selected = snoozeMinutes == minutes,
                            onClick = { onSnoozeMinutesChange(minutes) },
                        )
                        if (index != SnoozeIntervals.lastIndex) SnoozeOptionDivider()
                    }
                    SnoozeOptionDivider()
                    SnoozeRadioRow(
                        label = if (snoozeMinutes in SnoozeIntervals) {
                            "직접 설정"
                        } else {
                            "직접 설정 · ${snoozeMinutes}분"
                        },
                        selected = snoozeMinutes !in SnoozeIntervals,
                        onClick = {
                            customMinutesText = snoozeMinutes.toString()
                            customIntervalDialogOpen = true
                        },
                    )
                }

                SnoozeOptionSection(title = "반복") {
                    val repeatOptions = listOf(
                        SnoozeRepeatLimits.THREE to "3회",
                        SnoozeRepeatLimits.FIVE to "5회",
                        SnoozeRepeatLimits.FOREVER to "계속 반복",
                    )
                    repeatOptions.forEachIndexed { index, (limit, label) ->
                        SnoozeRadioRow(
                            label = label,
                            selected = snoozeRepeatLimit == limit,
                            onClick = { onSnoozeRepeatLimitChange(limit) },
                        )
                        if (index != repeatOptions.lastIndex) SnoozeOptionDivider()
                    }
                }
            }
        }
    }

    if (customIntervalDialogOpen) {
        val customMinutes = customMinutesText.toIntOrNull()
        AlertDialog(
            onDismissRequest = { customIntervalDialogOpen = false },
            title = {
                ModalDialogTitle(
                    title = "간격 직접 설정",
                    onDismiss = { customIntervalDialogOpen = false },
                )
            },
            text = {
                OutlinedTextField(
                    value = customMinutesText,
                    onValueChange = { value ->
                        customMinutesText = value.filter { it.isDigit() }.take(2)
                    },
                    label = { Text("분") },
                    singleLine = true,
                    isError = customMinutesText.isNotBlank() && customMinutes !in 1..60,
                    shape = WakerInputShape,
                    colors = wakerOutlinedTextFieldColors(),
                )
            },
            confirmButton = {
                TextButton(
                    enabled = customMinutes in 1..60,
                    onClick = {
                        onSnoozeMinutesChange(requireNotNull(customMinutes))
                        customIntervalDialogOpen = false
                    },
                ) {
                    Text("적용")
                }
            },
        )
    }
}

@Composable
private fun SnoozeOptionSection(
    title: String,
    content: @Composable () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(
            text = title,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(start = 4.dp),
        )
        Surface(
            shape = RoundedCornerShape(14.dp),
            color = MaterialTheme.colorScheme.surface,
        ) {
            Column(modifier = Modifier.fillMaxWidth()) {
                content()
            }
        }
    }
}

@Composable
private fun SnoozeRadioRow(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        color = Color.Transparent,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CompactSelectionDot(
                selected = selected,
            )
            Spacer(Modifier.width(9.dp))
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun CompactSelectionDot(selected: Boolean) {
    Box(
        modifier = Modifier
            .size(18.dp)
            .border(
                width = 1.5.dp,
                color = if (selected) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.outline
                },
                shape = CircleShape,
            )
            .background(
                color = if (selected) MaterialTheme.colorScheme.primary else Color.Transparent,
                shape = CircleShape,
            ),
        contentAlignment = Alignment.Center,
    ) {
        if (selected) {
            Box(
                modifier = Modifier
                    .size(6.dp)
                    .background(MaterialTheme.colorScheme.onPrimary, CircleShape),
            )
        }
    }
}

@Composable
private fun SnoozeOptionDivider() {
    Box(
        modifier = Modifier
            .padding(start = 39.dp)
            .fillMaxWidth()
            .height(1.dp)
            .background(MaterialTheme.colorScheme.outlineVariant),
    )
}

@Composable
internal fun EditorActionButtons(
    isEditing: Boolean,
    isSaving: Boolean,
    canSave: Boolean,
    onSave: () -> Unit,
) {
    Button(
        onClick = onSave,
        enabled = canSave && !isSaving,
        modifier = Modifier.fillMaxWidth(),
        shape = WakerButtonShape,
    ) {
        Icon(Icons.Outlined.Save, contentDescription = null)
        Spacer(Modifier.width(8.dp))
        Text(
            when {
                isSaving -> "저장 중"
                isEditing -> "변경사항 저장"
                else -> "알람 설정하기"
            },
        )
    }
}
