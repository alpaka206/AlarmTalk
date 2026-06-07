package com.alarmtalk.app

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
import com.alarmtalk.app.data.SnoozeRepeatLimits
import com.alarmtalk.app.data.VibrationPatternLibrary
import com.alarmtalk.app.data.VibrationPatterns

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
internal fun RandomPromptDetailRow(
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
internal fun WeatherLocationDialog(
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
                    com.alarmtalk.app.location.WeatherLocationProvider.resolve(context)
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
                                if (com.alarmtalk.app.location.WeatherLocationProvider.hasPermission(context)) {
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
