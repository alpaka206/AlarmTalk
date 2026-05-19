package com.voicealarm.nativeapp

import android.content.Context
import android.media.AudioAttributes
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material.icons.outlined.Snooze
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
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
    var draftFortuneGender by remember(fortuneGender) { mutableStateOf(fortuneGender) }
    var draftFortuneBirthDate by remember(fortuneBirthDate) { mutableStateOf(fortuneBirthDate) }
    var draftFortuneBirthTime by remember(fortuneBirthTime) { mutableStateOf(fortuneBirthTime) }
    var weatherDialogOpen by remember { mutableStateOf(false) }
    var fortuneDialogOpen by remember { mutableStateOf(false) }
    val normalizedContext = normalizedRandomPromptContext(draftContext)

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
            randomContextUsesWeather(normalizedContext) &&
                (draftWeatherCountry.isBlank() || draftWeatherCity.isBlank()) -> weatherDialogOpen = true
            normalizedContext == "wake_fortune" &&
                (
                    draftFortuneGender.isBlank() ||
                        draftFortuneBirthDate.isBlank() ||
                        draftFortuneBirthTime.isBlank()
                    ) -> fortuneDialogOpen = true
            else -> saveResolvedSettings()
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
                    text = "랜덤 문구",
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
                        text = "옵션을 고른 뒤 아래 저장을 눌러야 랜덤 생성이 적용돼요. 저장하지 않고 나가면 직접 문구 입력으로 돌아가요.",
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
                            onClick = { draftContext = context },
                        )
                        if (index != RandomPromptContexts.lastIndex) SnoozeOptionDivider()
                    }
                }

                if (randomContextUsesWeather(normalizedContext)) {
                    RandomPromptDetailRow(
                        title = "날씨 위치",
                        value = if (draftWeatherCountry.isBlank() || draftWeatherCity.isBlank()) {
                            "저장할 때 나라와 도시를 입력해요."
                        } else {
                            "${weatherLocationSummary(draftWeatherCountry, draftWeatherCity)} 날씨를 사용해요."
                        },
                    )
                }

                if (normalizedContext == "wake_fortune") {
                    RandomPromptDetailRow(
                        title = "운세 정보",
                        value = if (
                            draftFortuneGender.isBlank() ||
                            draftFortuneBirthDate.isBlank() ||
                            draftFortuneBirthTime.isBlank()
                        ) {
                            "저장할 때 성별, 생년월일, 태어난 시간을 입력해요."
                        } else {
                            fortuneInfoSummary(draftFortuneGender, draftFortuneBirthDate, draftFortuneBirthTime)
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
                        shape = VocaWakeButtonShape,
                    ) {
                        Icon(Icons.Outlined.Save, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("랜덤 설정 저장")
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
    val countryError = submitted && draftCountry.isBlank()
    val cityError = submitted && draftCity.isBlank()

    Dialog(onDismissRequest = onDismissWithoutSave) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(24.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 6.dp,
            shadowElevation = 16.dp,
        ) {
            Column(
                modifier = Modifier
                    .padding(20.dp)
                    .heightIn(max = 560.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("날씨 위치 저장", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text(
                        text = "이 위치는 저장해두고 날씨가 필요한 랜덤 문구에서 다시 사용해요. 이 창에서 저장하지 않으면 랜덤 생성이 적용되지 않아요.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                OutlinedTextField(
                    value = draftCountry,
                    onValueChange = { draftCountry = it.take(30) },
                    label = { Text("나라") },
                    placeholder = { Text("예: 대한민국") },
                    singleLine = true,
                    isError = countryError,
                    supportingText = {
                        if (countryError) Text("필수 입력 값입니다.")
                    },
                    shape = VocaWakeInputShape,
                    colors = vocaWakeOutlinedTextFieldColors(),
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
                        if (cityError) Text("필수 입력 값입니다.")
                    },
                    shape = VocaWakeInputShape,
                    colors = vocaWakeOutlinedTextFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                ) {
                    OutlinedButton(
                        onClick = onDismissWithoutSave,
                        shape = VocaWakeButtonShape,
                    ) {
                        Text("닫기")
                    }
                    Button(
                        onClick = {
                            submitted = true
                            if (draftCountry.isNotBlank() && draftCity.isNotBlank()) {
                                onConfirm(draftCountry.trim(), draftCity.trim())
                            }
                        },
                        shape = VocaWakeButtonShape,
                    ) {
                        Text("저장")
                    }
                }
            }
        }
    }
}

@Composable
private fun FortuneInfoDialog(
    gender: String,
    birthDate: String,
    birthTime: String,
    onDismissWithoutSave: () -> Unit,
    onConfirm: (String, String, String) -> Unit,
) {
    var draftGender by remember(gender) { mutableStateOf(gender) }
    var draftBirthDate by remember(birthDate) { mutableStateOf(birthDate) }
    var draftBirthTime by remember(birthTime) { mutableStateOf(birthTime) }
    var submitted by remember { mutableStateOf(false) }
    val genderError = submitted && draftGender.isBlank()
    val birthDateError = submitted && draftBirthDate.isBlank()
    val birthTimeError = submitted && draftBirthTime.isBlank()

    Dialog(onDismissRequest = onDismissWithoutSave) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(24.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 6.dp,
            shadowElevation = 16.dp,
        ) {
            Column(
                modifier = Modifier
                    .padding(20.dp)
                    .heightIn(max = 620.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("운세 정보", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text(
                        text = "입력한 정보는 운세형 문구를 만들 때만 사용돼요. 이 창에서 저장하지 않으면 랜덤 생성이 적용되지 않아요.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                OutlinedTextField(
                    value = draftGender,
                    onValueChange = { draftGender = it.take(12) },
                    label = { Text("성별") },
                    placeholder = { Text("예: 남성, 여성") },
                    singleLine = true,
                    isError = genderError,
                    supportingText = {
                        if (genderError) Text("필수 입력 값입니다.")
                    },
                    shape = VocaWakeInputShape,
                    colors = vocaWakeOutlinedTextFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = draftBirthDate,
                    onValueChange = { draftBirthDate = it.take(10) },
                    label = { Text("생년월일") },
                    placeholder = { Text("예: 1950-05-19") },
                    singleLine = true,
                    isError = birthDateError,
                    supportingText = {
                        if (birthDateError) Text("필수 입력 값입니다.")
                    },
                    shape = VocaWakeInputShape,
                    colors = vocaWakeOutlinedTextFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = draftBirthTime,
                    onValueChange = { draftBirthTime = it.take(5) },
                    label = { Text("태어난 시간") },
                    placeholder = { Text("예: 07:30") },
                    singleLine = true,
                    isError = birthTimeError,
                    supportingText = {
                        if (birthTimeError) Text("필수 입력 값입니다.")
                    },
                    shape = VocaWakeInputShape,
                    colors = vocaWakeOutlinedTextFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                ) {
                    OutlinedButton(
                        onClick = onDismissWithoutSave,
                        shape = VocaWakeButtonShape,
                    ) {
                        Text("닫기")
                    }
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
                        shape = VocaWakeButtonShape,
                    ) {
                        Text("저장")
                    }
                }
            }
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
            title = { Text("간격 직접 설정") },
            text = {
                OutlinedTextField(
                    value = customMinutesText,
                    onValueChange = { value ->
                        customMinutesText = value.filter { it.isDigit() }.take(2)
                    },
                    label = { Text("분") },
                    singleLine = true,
                    isError = customMinutesText.isNotBlank() && customMinutes !in 1..60,
                    shape = VocaWakeInputShape,
                    colors = vocaWakeOutlinedTextFieldColors(),
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
            dismissButton = {
                TextButton(onClick = { customIntervalDialogOpen = false }) {
                    Text("취소")
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
        shape = VocaWakeButtonShape,
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
