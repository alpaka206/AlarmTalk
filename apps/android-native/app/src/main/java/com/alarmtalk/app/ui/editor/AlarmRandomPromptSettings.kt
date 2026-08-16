package com.alarmtalk.app

import android.Manifest
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.R
import com.alarmtalk.app.WakerChipShape
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.material3.TextButton
import androidx.compose.ui.text.style.TextOverflow

@Composable
internal fun RandomPromptSettingsPane(
    randomContext: String,
    /**
     * 이 알람이 **직접 입력으로 저장돼 있을 때**의 기존 문구. 수정하려고 다시 들어온 사용자가
     * 처음부터 타이핑하지 않도록 입력 다이얼로그를 이 값으로 연다.
     *
     * 새로 만드는 알람이나 버킷/랜덤 알람이면 호출부가 빈 문자열을 넘긴다 — '기본값 없음' 규칙은
     * 그대로 지킨다(내가 쓴 적 없는 문구가 미리 채워져 있으면 안 된다).
     */
    manualText: String = "",
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
    onSaveSettings: (RandomPromptSettingsResult) -> Unit,
) {
    val context = LocalContext.current
    var draftContext by remember(randomContext) {
        mutableStateOf(
            // 지금 값을 그대로 고른 상태로 연다. 예전에는 목록에 없는 값(preset)이면 '약'을
            // 대신 체크했는데, 요약 행은 '기본 인사말'인데 열면 '약'이라 선택이 리셋된 것처럼
            // 보였다. preset 이 목록에 있으니(EditorMessageContexts) 그럴 필요가 없다.
            if (randomContext == ManualMessageContext) {
                ManualMessageContext
            } else {
                normalizedRandomPromptContext(randomContext)
            },
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
    // 직접 입력 문구도 다른 상세값과 같은 층위로 다룬다 — 다이얼로그에서 확인하면 여기에
    // 담기고, 아래 상세 카드에 보이며, 최종 반영은 이 화면의 저장에서 한 번에 한다.
    var draftManualText by remember(manualText) { mutableStateOf(manualText) }
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
                manualText = draftManualText,
            ),
        )
    }

    fun selectContext(context: String) {
        draftContext = context
        // 상세 입력이 필요한 모드는 **아직 값이 없을 때만** 그 자리에서 다이얼로그를 띄운다.
        // 이미 등록한 값이 있으면 고르기만 하고 넘어간다 — 매번 같은 정보를 다시 확인시키면
        // 문구 하나 바꾸는 데 모달을 두 번 지나야 한다. 고치고 싶으면 아래 상세 카드의
        // '변경하기' 로 간다.
        when {
            context == ManualMessageContext && draftManualText.isBlank() -> manualDialogOpen = true
            randomContextUsesWeather(context) && !hasWeatherInfo() -> weatherDialogOpen = true
            context == "wake_fortune" && !hasFortuneInfo() -> fortuneDialogOpen = true
        }
    }

    // ⚠ **뒤로가기가 곧 반영이다**(2026-08-15 지시 "취소·저장 버튼 말고 위 뒤로가기가 자연스럽다").
    // 다른 상세 화면(진동·스누즈·무료 테마)이 전부 그렇다 — 이 화면만 하단 버튼을 갖고 있었다.
    // 필요한 정보(도시·사주)가 비어 있어도 그대로 반영한다: 상세 카드가 '아직 고르지 않았어요'
    // 로 말하고, 알람 저장은 편집기가 막는다(`saveBlockedReason`). 여기서 다이얼로그를 강제로
    // 띄우면 화면을 나가려는 동작이 모달로 붙잡히는 셈이라 더 나쁘다.
    BackHandler(onBack = ::saveResolvedSettings)

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // 상단바는 공용 `WakerTopBar` 하나다 — 화면마다 손으로 그리지 말 것
            // (알람 목록·설정·법무 문서가 모두 이걸 쓴다).
            WakerTopBar(
                title = stringResource(R.string.editorp_random_title),
                onBack = ::saveResolvedSettings,
                modifier = Modifier.padding(top = 24.dp),
            )

            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    // ⚠ **iOS `PaneScaffold` 와 같은 여백이다**(2026-08-16 지시).
                    // 거긴 `padding(.horizontal, 20).padding(.vertical, 16)` 이고, 여기는
                    // 상단바가 자체 아래 여백 4 를 갖고 있어 12 를 더해 16 을 만든다.
                    // 예전에는 위가 4 뿐이라 제목 바로 밑에 카드가 붙어 있었다.
                    .padding(start = 20.dp, end = 20.dp, bottom = 16.dp),
                // 무료 pane·iOS 와 같은 16dp(`MessageSettingsPane` 의 `VStack(spacing: 16)`).
                verticalArrangement = Arrangement.spacedBy(16.dp),
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

                // 직접 입력도 날씨·운세와 같은 자리에서 값을 보여주고 같은 자리에서 고친다.
                // 문구는 전체를 그대로 보여준다(요약 행에서는 말줄임되므로 여기가 전문이다).
                if (isManual && draftManualText.isNotBlank()) {
                    RandomPromptDetailRow(
                        title = stringResource(R.string.editorp_random_manual_title),
                        value = draftManualText,
                        onChange = { manualDialogOpen = true },
                    )
                }

                if (randomContextUsesWeather(normalizedContext)) {
                    RandomPromptDetailRow(
                        title = stringResource(R.string.editorp_random_weather_region_title),
                        onChange = { weatherDialogOpen = true },
                        value = when {
                            // ⚠ **도시 하나로 판정한다**(2026-08-15). 나라는 국내면 비는 값이라
                            // (`WeatherCityPickerSheet` 프리셋은 도시만 준다) 둘 다 요구하면
                            // **저장돼 있는데도 "아직 고르지 않았어요"** 로 보인다 — 실기기에
                            // `weather_city=인천, weather_country=""` 로 들어 있었다.
                            // 모달을 띄울지 보는 `savedWeatherConfigured` 도 도시만 본다.
                            draftWeatherCity.isNotBlank() ->
                                // 값만 보여준다 — "…날씨를 사용해요." 로 감싸면 상세 카드가
                                // 값이 아니라 문장이 된다(iOS 는 "서울" 하나만 보여준다).
                                weatherLocationSummary(context, draftWeatherCountry, draftWeatherCity)
                            usingTargetDynamicPromptSettings && savedWeatherConfigured ->
                                stringResource(R.string.editorp_random_weather_region_saved)
                            else -> stringResource(R.string.editorp_random_weather_region_required)
                        },
                    )
                }

                if (normalizedContext == "wake_fortune") {
                    RandomPromptDetailRow(
                        title = stringResource(R.string.editorp_random_fortune_title),
                        onChange = { fortuneDialogOpen = true },
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

        }
    }

    // 세 다이얼로그 모두 **자기만 닫는다.** 예전에는 확인하면 곧바로 onSaveSettings 로
    // 이어져 문구 목록까지 통째로 닫혔는데, 사용자는 '문구를 고르는 중' 이지 '고르기를
    // 끝낸' 게 아니다 — 도시 하나 바꾸려다 목록 밖으로 튕겨 나가면 다시 들어와야 한다.
    // 취소(닫기)도 마찬가지로 이 화면을 닫지 않는다. 최종 반영은 이 화면을 나갈 때다.
    if (weatherDialogOpen) {
        WeatherLocationDialog(
            country = draftWeatherCountry,
            city = draftWeatherCity,
            onDismissWithoutSave = { weatherDialogOpen = false },
            onConfirm = { country, city ->
                draftWeatherCountry = country
                draftWeatherCity = city
                weatherDialogOpen = false
            },
        )
    }

    if (fortuneDialogOpen) {
        FortuneInfoDialog(
            gender = draftFortuneGender,
            birthDate = draftFortuneBirthDate,
            birthTime = draftFortuneBirthTime,
            onDismissWithoutSave = { fortuneDialogOpen = false },
            onConfirm = { gender, birthDate, birthTime ->
                draftFortuneGender = gender
                draftFortuneBirthDate = birthDate
                draftFortuneBirthTime = birthTime
                fortuneDialogOpen = false
            },
        )
    }

    if (manualDialogOpen) {
        ManualMessageDialog(
            // 지금까지 담긴 문구로 연다(기존 알람의 문구든, 방금 이 화면에서 친 것이든).
            // 확인 없이 닫으면 입력한 내용은 그대로 폐기된다.
            initialText = draftManualText,
            onDismiss = { manualDialogOpen = false },
            onConfirm = { text ->
                draftManualText = text
                manualDialogOpen = false
            },
        )
    }
}

// '직접 입력' 선택 시 뜨는 문구 입력 다이얼로그(날씨·운세 다이얼로그와 같은 층위).
@Composable
// ⚠ `internal` 이다 — 무료 버킷 pane(`FreeBucketSettingsPane`)도 같은 다이얼로그를 쓴다.
// 유료 사용자가 **기본 목소리**로도 직접 입력을 할 수 있게 되면서(2026-08-11 서버 개방),
// 그 pane 에서도 이 입력창이 필요해졌다. 두 벌로 만들지 않는다.
internal fun ManualMessageDialog(
    initialText: String,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var draft by remember(initialText) { mutableStateOf(initialText) }
    // 공용 알럿으로 통일한다. 다만 **이 입력만 여러 줄**이다 — 알람에서 들려줄 문구를 최대
    // 200자까지 받으므로, 한 줄짜리 필드로 두면 쓰면서 앞이 안 보인다. 껍데기는 알럿이되
    // 필드 높이만 남긴다.
    IosAlertDialog(
        title = stringResource(R.string.editor_msg_mode_manual),
        message = null,
        onDismiss = onDismiss,
        actions = listOf(
            IosAlertAction(
                label = stringResource(R.string.r3dlg_modal_dialog_close),
                onClick = onDismiss,
            ),
            IosAlertAction(
                label = stringResource(R.string.editorp_random_save_button),
                emphasized = true,
                // 빈 문구로는 저장할 수 없다 — 눌러도 아무 일 없는 버튼 대신 흐리게 둔다.
                enabled = draft.isNotBlank(),
                onClick = { draft.trim().takeIf { it.isNotBlank() }?.let(onConfirm) },
            ),
        ),
    ) {
        IosAlertField(
            value = draft,
            onValueChange = { draft = sanitizeUserText(it, allowNewlines = true).takeWithoutSplittingPairs(200) },
            placeholder = stringResource(R.string.editor_manual_input_placeholder),
            singleLine = false,
            minHeight = 108.dp,
        )
    }
}

@Composable
internal fun RandomPromptDetailRow(
    title: String,
    value: String,
    // 이 값을 고치는 액션. 넘기면 오른쪽에 '변경하기' 가 붙는다.
    // 한 번 등록한 뒤에는 목록에서 그 항목을 다시 눌러도 입력창이 뜨지 않으므로, 고치는
    // 길은 여기 하나뿐이다 — 없으면 등록한 값을 영영 못 바꾼다.
    onChange: (() -> Unit)? = null,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = WakerChipShape,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
    ) {
        Row(
            modifier = Modifier.padding(start = 14.dp, top = 12.dp, end = 6.dp, bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                // ⚠ **iOS `PromptDetailCard` 와 같은 위계다**(2026-08-16 지시).
                // 거긴 제목이 작은 보조 글씨(bodySmall 12), 값이 본문(bodyLarge 16)이다 —
                // 안드로이드는 정반대(제목 16 SemiBold / 값 12)라 같은 카드가 뒤집혀 보였다.
                Text(
                    text = title,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                // **여기서는 자르지 않는다.** 직접 입력 문구는 길지만, 이 카드가 그 문구를
                // 전부 확인하는 유일한 자리다(요약 행은 좁아서 말줄임한다). 목록이 세로
                // 스크롤이라 길어져도 잘린 채 갇히지 않는다.
                Text(
                    text = value,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
            if (onChange != null) {
                TextButton(onClick = onChange) {
                    Text(
                        text = stringResource(R.string.editorp_random_detail_change),
                        // iOS 는 `bodyMedium.weight(.semibold)` = 14 SemiBold.
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

// 지역 선택 — 기본 목소리/테마와 같은 바텀시트 선택 패턴(WakerSelectionSheet). 도시 행을
// 탭하면 그 자리에서 선택+저장+닫힘(별도 저장 버튼 없음). '직접 입력'을 고르면 시트 안에
// 입력 필드가 열린다. 프리셋이 없는 로케일은 처음부터 입력 필드만 보여준다.
@Composable
internal fun WeatherLocationDialog(
    country: String,
    city: String,
    onDismissWithoutSave: () -> Unit,
    onConfirm: (String, String) -> Unit,
) {
    val presetCities = androidx.compose.ui.res.stringArrayResource(R.array.hs_weather_preset_cities).toList()
    // 직접 입력 필드는 항상 빈칸으로 시작 — 이전 도시명을 프리필하지 않는다(기본값 없음 규칙).
    // 현재 저장된 지역은 뒤 화면의 '원하는 지역' 행에 이미 보인다.
    var draftCity by remember(city) { mutableStateOf("") }
    var customMode by remember(city) {
        mutableStateOf(presetCities.isEmpty() || (city.isNotBlank() && city !in presetCities))
    }

    WakerSelectionSheet(
        title = stringResource(R.string.editorp_random_weather_region_title),
        onDismiss = onDismissWithoutSave,
    ) { _ ->
        WakerSheetOptionGroup {
            presetCities.forEach { preset ->
                WakerSheetOptionRow(
                    title = preset,
                    selected = !customMode && city == preset,
                    // 탭 = 선택+저장+닫힘(닫힘 전이는 onConfirm 쪽 상태가 담당).
                    onClick = { onConfirm(country.trim(), preset) },
                    divider = true,
                )
            }
            if (presetCities.isNotEmpty()) {
                WakerSheetOptionRow(
                    title = stringResource(R.string.hs_weather_city_custom),
                    selected = customMode,
                    onClick = { customMode = !customMode },
                )
            }
        }
        if (customMode) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .imePadding(),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                OutlinedTextField(
                    value = draftCity,
                    // 도시명은 사람 이름이 아니지만 '한 줄·보이지 않는 문자 없음' 규칙은 같다.
                    onValueChange = { draftCity = sanitizeDisplayName(it, maxLength = DisplayNameMaxLength) },
                    label = { Text(stringResource(R.string.hs_weather_city_label)) },
                    placeholder = { Text(stringResource(R.string.hs_weather_city_placeholder)) },
                    singleLine = true,
                    shape = WakerInputShape,
                    colors = wakerOutlinedTextFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = { onConfirm(country.trim(), draftCity.trim()) },
                    enabled = draftCity.isNotBlank(),
                    colors = wakerButtonColors(),
                    modifier = Modifier.fillMaxWidth(),
                    shape = WakerButtonShape,
                ) {
                    Text(stringResource(R.string.editorp_weather_save_button))
                }
            }
        }
    }
}
