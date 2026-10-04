package com.alarmtalk.app

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.flow.first
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.material3.TextButton
import androidx.compose.ui.text.style.TextOverflow
import com.alarmtalk.app.data.WeatherCountry
import com.alarmtalk.app.data.WeatherRegion
import com.alarmtalk.app.data.WeatherRegions
import com.alarmtalk.app.data.weatherRegionFor

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
    /**
     * 이 목소리로 **실제로 고를 수 있는** 문구 종류(`EditorMessageContexts` 의 부분집합, 순서 유지).
     *
     * 등록(클론) 목소리는 다섯 종류가 모두 사전렌더되므로 전부 들어온다. 기본(시스템) 목소리는
     * 서버에 구워 둔 스톡 클립이 있는 카테고리만 들어온다 — 새 카테고리를 시딩하는 중이면
     * 그 종류만 잠깐 빠져 보이고, 다 구워지면 앱 수정 없이 나타난다.
     *
     * ⚠ **여기서 '무료라서' 빼지 않는다.** 2026-09-02 전에는 무료·기본 목소리에 아예 다른
     * pane(`FreeBucketSettingsPane`)을 보여 주며 목록을 날씨·약으로 잘랐는데, 그건 등급
     * 정책이 아니라 **클립이 없다**는 사정이었다. 등급으로 갈리는 것은 아래 [manualLocked] 하나다.
     */
    availableContexts: List<String> = EditorMessageContexts.map { it.first },
    /**
     * '직접 입력' 이 잠겨 있는가. **잠그는 기준은 무료 플랜뿐이다.**
     *
     * ⚠ **기본 목소리라고 잠그지 말 것.** 유료 사용자는 기본 목소리로도 직접 입력을 쓸 수
     * 있고, 비용은 직접 입력 월 한도가 센다(서버 `tts.ts` 의 manual-tts-quota).
     */
    manualLocked: Boolean = false,
    /** 잠긴 '직접 입력' 을 눌렀을 때 — 호출부가 이용권 안내를 띄운다. */
    onManualLocked: () -> Unit = {},
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
    // ⚠ **미완성 종류는 선택되지 않는다**(2026-08-18 변경. 그전에는 반대였다).
    // 예전에는 값 없이 고른 뒤 다이얼로그를 취소해도 그 종류가 그대로 선택됐고, 편집기가
    // 하단 바에서 "랜덤 문구 설정에서 날씨 지역·운세 정보를 채워 주세요." 로 막았다 —
    // **고를 수는 있는데 저장은 안 되는 상태**를 만들어 놓고 그 사실을 다른 화면에서
    // 알리는 구조였다. 지금은 취소하면 **직전 선택으로 되돌린다**: 목소리 관문
    // (`VoiceAudioCard` 의 `onNeedsClipPreparation`)과 같은 규칙이다 — 준비 안 된 것은
    // 고를 수 없다. 뒤로가기를 모달로 붙잡는 게 아니라 선택만 되돌리는 것이라,
    // 아래 `BackHandler` 규약(뒤로가기가 곧 반영)과 부딪히지 않는다.
    //
    // null = 되돌릴 것이 없다. 상세 카드 '변경하기' 로 연 경우가 그렇다(선택은 이미
    // 완성돼 있고 값만 고치는 중이므로, 취소해도 종류는 그대로여야 한다).
    var contextBeforeDialog by remember { mutableStateOf<String?>(null) }
    /**
     * 지금 고른 종류를 정규화한다.
     *
     * ⚠ **콜백 안에서는 이 함수를 부르고, 바깥에서 계산해 둔 값을 캡처하지 말 것**
     * (2026-09-06 실기기 재현). 콤포지션 지역 `val` 을 `::saveResolvedSettings` 같은 참조가
     * 캡처하면 **그 콤포지션의 값이 그대로 굳는다** — 함수 참조는 캡처가 달라도 서로
     * `equals` 라, Compose 가 `BackHandler`/`WakerTopBar` 를 "인자가 그대로" 로 보고
     * 건너뛰어 **첫 콤포지션의 람다가 계속 남기** 때문이다. 그래서 '약' 을 골라도 뒤로가기가
     * 옛 종류(날씨)를 돌려주었고, 고른 것이 **조용히 사라졌다**. `draft*` 들은 상태 델리게이트라
     * 늘 최신인데 이 값만 굳어 있었던 것이라 증상이 종류 하나에만 나타났다.
     */
    fun resolvedContext(): String =
        if (draftContext == ManualMessageContext) {
            ManualMessageContext
        } else {
            normalizedRandomPromptContext(draftContext)
        }
    val isManual = draftContext == ManualMessageContext
    val normalizedContext = resolvedContext()
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
                // ⚠ 위 [resolvedContext] 주석 — 여기서 **다시 계산한다.**
                randomContext = resolvedContext(),
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
        val previous = draftContext
        draftContext = context
        // 상세 입력이 필요한 모드는 **아직 값이 없을 때만** 그 자리에서 다이얼로그를 띄운다.
        // 이미 등록한 값이 있으면 고르기만 하고 넘어간다 — 매번 같은 정보를 다시 확인시키면
        // 문구 하나 바꾸는 데 모달을 두 번 지나야 한다. 고치고 싶으면 아래 상세 카드의
        // '변경하기' 로 간다.
        val needsInput = when {
            context == ManualMessageContext -> draftManualText.isBlank()
            randomContextUsesWeather(context) -> !hasWeatherInfo()
            context == "wake_fortune" -> !hasFortuneInfo()
            else -> false
        }
        if (!needsInput) {
            contextBeforeDialog = null
            return
        }
        // 취소하면 되돌아갈 자리. 같은 종류를 다시 누른 것이면 되돌릴 것이 없다.
        contextBeforeDialog = previous.takeIf { it != context }
        when {
            context == ManualMessageContext -> manualDialogOpen = true
            randomContextUsesWeather(context) -> weatherDialogOpen = true
            context == "wake_fortune" -> fortuneDialogOpen = true
        }
    }

    /** 다이얼로그를 확인 없이 닫았을 때 — 그 종류를 고르기 전으로 되돌린다. */
    fun cancelContextSelection() {
        contextBeforeDialog?.let { draftContext = it }
        contextBeforeDialog = null
    }

    // ⚠ **뒤로가기가 곧 반영이다**(2026-08-15 지시 "취소·저장 버튼 말고 위 뒤로가기가 자연스럽다").
    // 다른 상세 화면(진동·스누즈·무료 테마)이 전부 그렇다 — 이 화면만 하단 버튼을 갖고 있었다.
    // 여기서 다이얼로그를 강제로 띄우지는 않는다 — 화면을 나가려는 동작이 모달로 붙잡히는
    // 셈이라 더 나쁘다. 대신 **미완성 종류는 애초에 선택되지 않는다**(위 `selectContext` 의
    // `contextBeforeDialog` 주석). 그래서 이 시점의 값은 언제나 완성돼 있고, 편집기가
    // 하단 바에서 "…채워 주세요" 로 뒤늦게 막을 일도 없다.
    //
    // 예외는 **가족 알람**이다: 수신자가 제 설정을 갖고 있으면 내 칸이 비어 있어도 완성이라
    // (`hasWeatherInfo`/`hasFortuneInfo` 의 `saved*Configured` 갈래) 그대로 반영한다.
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
                    // ⚠ **'직접 입력' 은 목록에서 빼지 않는다.** 무료에게도 이런 기능이
                    // 있다는 걸 보여 준다 — 아예 감추면 있는지조차 모르고, 유료 전환 동기
                    // 중 가장 강한 것을 잃는다. 잠긴 행으로 그린다.
                    val rows = EditorMessageContexts.filter { (context, _) ->
                        context == ManualMessageContext || context in availableContexts
                    }
                    rows.forEachIndexed { index, (context, labelRes) ->
                        val baseLabel = stringResource(labelRes)
                        val locked = context == ManualMessageContext && manualLocked
                        val label = if (
                            context == ManualMessageContext && !locked &&
                            manualLimit != null && manualLimit > 0 && manualRemaining != null
                        ) {
                            // 예: "직접 입력 (29/30)" — 이번 달 남은/총 만들기 횟수.
                            "$baseLabel ($manualRemaining/$manualLimit)"
                        } else {
                            baseLabel
                        }
                        if (locked) {
                            SnoozeLockedRow(label = label, onClick = onManualLocked)
                        } else {
                            SnoozeRadioRow(
                                label = label,
                                selected = normalizedContext == context,
                                onClick = { selectContext(context) },
                            )
                        }
                        if (index != rows.lastIndex) SnoozeOptionDivider()
                    }
                }

                // 직접 입력도 날씨·운세와 같은 자리에서 값을 보여주고 같은 자리에서 고친다.
                // 문구는 전체를 그대로 보여준다(요약 행에서는 말줄임되므로 여기가 전문이다).
                if (isManual && draftManualText.isNotBlank()) {
                    RandomPromptDetailRow(
                        title = stringResource(R.string.editorp_random_manual_title),
                        value = draftManualText,
                        // 값만 고치는 자리다 — 취소해도 종류 선택은 그대로여야 하므로
                        // 되돌릴 자리를 비운다(위 `contextBeforeDialog` 주석).
                        onChange = {
                            contextBeforeDialog = null
                            manualDialogOpen = true
                        },
                    )
                }

                if (randomContextUsesWeather(normalizedContext)) {
                    val weatherDisplay = weatherRegionDisplay(context, draftWeatherCountry, draftWeatherCity)
                    RandomPromptDetailRow(
                        // '날씨 지역' 이 아니라 **'지역'** 이다(2026-09-30) — 공휴일 국가도 이 값의 나라다.
                        title = stringResource(R.string.editorp_random_weather_region_title),
                        onChange = {
                            contextBeforeDialog = null
                            weatherDialogOpen = true
                        },
                        value = when {
                            // ⚠ **도시 하나로 판정한다**(2026-08-15). 옛 값에는 나라가 빈 행이 있다
                            // (실기기에 `weather_city=인천, weather_country=""`). 둘 다 요구하면
                            // **저장돼 있는데도 "아직 고르지 않았어요"** 로 보인다.
                            // 모달을 띄울지 보는 `savedWeatherConfigured` 도 도시만 본다.
                            draftWeatherCity.isNotBlank() ->
                                // 값만 보여준다 — "…날씨를 사용해요." 로 감싸면 상세 카드가
                                // 값이 아니라 문장이 된다(iOS 는 "서울" 하나만 보여준다).
                                weatherDisplay.label
                            usingTargetDynamicPromptSettings && savedWeatherConfigured ->
                                stringResource(R.string.editorp_random_weather_region_saved)
                            else -> stringResource(R.string.editorp_random_weather_region_required)
                        },
                        // 목록에 없는 옛 글자(직접 입력 시절) — 글자는 그대로 두고 다시 고르라고만 한다.
                        hint = if (draftWeatherCity.isNotBlank() && weatherDisplay.needsRepick) {
                            stringResource(R.string.region_picker_legacy_hint)
                        } else {
                            null
                        },
                    )
                }

                if (normalizedContext == "wake_fortune") {
                    RandomPromptDetailRow(
                        title = stringResource(R.string.editorp_random_fortune_title),
                        onChange = {
                            contextBeforeDialog = null
                            fortuneDialogOpen = true
                        },
                        value = when {
                            draftFortuneGender.isNotBlank() &&
                                draftFortuneBirthDate.isNotBlank() &&
                                draftFortuneBirthTime.isNotBlank() ->
                                fortuneInfoSummary(draftFortuneGender, draftFortuneBirthDate, draftFortuneBirthTime)
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
            onDismissWithoutSave = {
                weatherDialogOpen = false
                cancelContextSelection()
            },
            // 행·계정에는 **옛 앱이 읽는 글자**를 적는다 — 키는 그 글자에서 되짚힌다
            // (`weatherRegionFor`, 회귀 `WeatherRegionsAliasTest`).
            onConfirm = { region ->
                draftWeatherCountry = region.legacyCountry
                draftWeatherCity = region.legacyCity
                weatherDialogOpen = false
                contextBeforeDialog = null
            },
        )
    }

    if (fortuneDialogOpen) {
        FortuneInfoDialog(
            gender = draftFortuneGender,
            birthDate = draftFortuneBirthDate,
            birthTime = draftFortuneBirthTime,
            onDismissWithoutSave = {
                fortuneDialogOpen = false
                cancelContextSelection()
            },
            onConfirm = { gender, birthDate, birthTime ->
                draftFortuneGender = gender
                draftFortuneBirthDate = birthDate
                draftFortuneBirthTime = birthTime
                fortuneDialogOpen = false
                contextBeforeDialog = null
            },
        )
    }

    if (manualDialogOpen) {
        ManualMessageDialog(
            // 지금까지 담긴 문구로 연다(기존 알람의 문구든, 방금 이 화면에서 친 것이든).
            // 확인 없이 닫으면 입력한 내용은 그대로 폐기된다.
            initialText = draftManualText,
            onDismiss = {
                manualDialogOpen = false
                cancelContextSelection()
            },
            onConfirm = { text ->
                draftManualText = text
                manualDialogOpen = false
                contextBeforeDialog = null
            },
        )
    }
}

/** 직접 입력 문구 상한. iOS `MessageSettingsPane.manualTextMaxLength` 와 같은 값이어야 한다. */
internal const val ManualMessageMaxLength = 200

// '직접 입력' 선택 시 뜨는 문구 입력 다이얼로그(날씨·운세 다이얼로그와 같은 층위).
@Composable
private fun ManualMessageDialog(
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
            onValueChange = {
                draft = sanitizeUserText(it, allowNewlines = true)
                    .takeWithoutSplittingPairs(ManualMessageMaxLength)
            },
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
    // 값 아래 작은 안내(예: 목록에 없는 옛 지역 — "목록에서 다시 골라 주세요").
    hint: String? = null,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        // ⚠ **위 목록 카드와 같은 껍데기다**(2026-08-20). 예전에는 `surfaceVariant` 를
        // 45% 로 얹었는데, 라이트에서 그 색(#EDEEF3 의 45%)이 배경(#F7F7FA)과 거의 같아
        // **경계가 사라졌다** — 같은 화면 위쪽 카드는 흰 바탕에 실선 테두리라 또렷한데
        // 아래만 배경에 잠겨 보였다(실기기 확인). 다크는 원래도 계산값이 `surface`
        // 근처(#19203A ≈ #1B2542)라 보이는 모양이 그대로다.
        //
        // iOS `PromptDetailCard` 도 처음부터 `EditorCard`(surface + outlineVariant 1px)
        // 였다 — 갈라져 있던 쪽은 안드로이드다. 반경도 형제 카드(`SnoozeOptionSection`)와
        // 같은 18 로 맞춘다(더 큰 블록이 더 작은 14 를 쓰던 역전).
        shape = WakerPanelShape,
        color = MaterialTheme.colorScheme.surface,
        border = wakerCardBorder(),
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
                if (hint != null) {
                    Text(
                        text = hint,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
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

/**
 * 저장된 날씨 지역(옛 앱용 글자 한 벌)을 **화면에 어떻게 보일지**.
 *
 * 설정 '지역' 행·문구 화면 상세 카드·편집기 문구 요약이 **전부 이걸 거친다** — 한 자리만
 * 다른 규칙으로 그리면 같은 값이 두 이름을 갖는다.
 */
internal data class WeatherRegionDisplay(
    /** 보일 글자. 목록의 지역이면 **앱 언어의 이름**, 못 되짚은 옛 값이면 적힌 글자 그대로. 비었으면 "". */
    val label: String,
    /** 되짚힌 지역. 비었거나 못 되짚었으면 null. */
    val region: WeatherRegion?,
) {
    /**
     * 목록에 없는 옛 글자인가 — 이름 곁에 "목록에서 다시 골라 주세요" 를 붙인다.
     * 고르게 **강요하지는 않는다**(모달·차단 없음). 바꾸기 전까지 서버의 엄격한 옛 경로로 돈다.
     */
    val needsRepick: Boolean get() = region == null && label.isNotBlank()
}

/**
 * (나라, 도시) 글자 → 보일 모양. 규칙은 docs/spec/voice-and-message.md 「날씨 지역은 목록에서만
 * 고른다」.
 *
 * 되짚지 못한 옛 값은 **적힌 글자 그대로**다. 나라 칸이 아는 나라(옛 앱이 자동으로 붙인
 * `대한민국` 등)면 도시만, 모르는 글자면 옛 입력칸이 첫 낱말을 나라 칸으로 떼어 간 것이라
 * 둘을 다시 이어 붙인다("Birmingham England" 가 "England" 로 보이면 안 된다).
 */
internal fun weatherRegionDisplay(
    context: android.content.Context,
    country: String,
    city: String,
): WeatherRegionDisplay {
    val region = weatherRegionFor(country, city)
    if (region != null) return WeatherRegionDisplay(context.getString(region.nameRes), region)
    val trimmedCountry = country.trim()
    val trimmedCity = city.trim()
    val raw = if (trimmedCountry.isEmpty() || WeatherRegions.countryForLabel(trimmedCountry) != null) {
        trimmedCity
    } else {
        listOf(trimmedCountry, trimmedCity).filter { it.isNotEmpty() }.joinToString(" ")
    }
    return WeatherRegionDisplay(raw, null)
}

/**
 * 지역 고르기를 **열 때** 보여 줄 나라. 지금 지역이 있으면 그 나라, 없으면 [fallbackCountryCode]
 * (이 기기의 공휴일 국가 — 없으면 기기 로케일 기준 KR·JP·US, 아니면 KR).
 */
internal fun initialWeatherPickerCountry(
    current: WeatherRegion?,
    fallbackCountryCode: String?,
): WeatherCountry =
    current?.country ?: WeatherCountry.fromCode(fallbackCountryCode) ?: WeatherCountry.KR

/**
 * 서버의 날씨가 기상청(KR)·気象庁(JP)·NWS(US)의 예보에서 온다는 토큰 — `GET /api/app/version` 의
 * `weather_attribution`(백엔드 `WEATHER_ATTRIBUTION`, `packages/backend/src/lib/weather-attribution.ts`).
 */
internal const val OFFICIAL_FORECASTS_WEATHER_ATTRIBUTION = "kma_jma_nws"

/**
 * 지역 시트에 날씨 출처 줄을 그릴까 — 서버가 **정확히** [OFFICIAL_FORECASTS_WEATHER_ATTRIBUTION] 을 줄 때만.
 * 그 밖(모르는 값·null·필드가 없는 옛 서버·버전 확인 실패·아직 응답 전)은 숨긴다.
 *
 * 출처 문장은 서버가 **실제로 쓰는 원천**을 따라가야 한다 — 앱이 단정하면 서버의 원천 교체가 늦거나 되돌려진
 * 동안 쓰지 않는 기관을 출처로 적는다(코덱스 #845). 규칙: `docs/spec/voice-and-message.md` 「지역 시트의 날씨
 * 출처 줄 — 서버가 원천을 말할 때만」. iOS 는 `WeatherAttribution.showsLine` 이 같은 판정이다.
 */
internal fun showsWeatherAttribution(token: String?): Boolean =
    token == OFFICIAL_FORECASTS_WEATHER_ATTRIBUTION

/**
 * 서버가 알려 준 날씨 원천 토큰(`MainViewModel.weatherAttribution`) — `MainActivity` 가 앱 전체에 내려 준다.
 * 지역 시트는 설정·편집기 두 곳에서 열리므로 인자로 실어 나르지 않고 여기서 읽는다. 기본값 null = 숨김이라,
 * 내려 주지 않은 곳에서 열려도 출처를 지어내지 않는다.
 */
internal val LocalWeatherAttribution = compositionLocalOf<String?> { null }

/**
 * 지역 고르기 — **나라 → 지역**, 직접 입력은 없다(2026-09-30).
 *
 * 위에 나라 세그먼트(대한민국 · 일본 · 미국), 아래에 그 나라의 지역 목록(목록 순서 — 생성
 * 파일 `WeatherRegions.kt`, 원본 `packages/shared/src/weather-regions.json`). 지역 행을 누르면
 * 그 자리에서 선택+닫힘이다(별도 저장 버튼 없음). 닫힘은 [onConfirm] 쪽 상태가 맡는다 —
 * 시트의 `dismiss()` 는 [onDismissWithoutSave] 를 부르므로 **여기서 쓰지 않는다**(문구 화면은
 * 그걸 '취소' 로 읽어 고르기 전 종류로 되돌린다).
 *
 * 되짚지 못한 옛 값이면 부제에 그 글자와 "다시 골라 주세요" 를 보인다. 목록에 없는 것을
 * 고른 채로 둘 수는 없으므로 체크 표시는 없다.
 *
 * 시트 껍데기는 [WakerSelectionSheet] 이다 — 창을 스스로 등록한다(`TrackOpenModal`).
 */
@Composable
internal fun WeatherLocationDialog(
    country: String,
    city: String,
    onDismissWithoutSave: () -> Unit,
    onConfirm: (WeatherRegion) -> Unit,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val display = remember(country, city) { weatherRegionDisplay(context, country, city) }
    val fallbackCountry = remember(context) {
        com.alarmtalk.app.data.HolidayCountryPreferenceStore(context).read()
    }
    var shownCountry by remember(display.region?.key) {
        mutableStateOf(initialWeatherPickerCountry(display.region, fallbackCountry))
    }
    val showsAttribution = showsWeatherAttribution(LocalWeatherAttribution.current)

    val regions = WeatherRegions.byCountry(shownCountry)
    // 나라마다 목록을 새로 연다 — 새 목록은 맨 위에서 시작한다.
    val listState = remember(shownCountry) { LazyListState() }
    val selectedIndex = regions.indexOfFirst { it.key == display.region?.key }
    // 시트를 연 직후에만 고른 지역을 찾아간다. 사용자가 나라를 바꾸면 그 뒤로는 늘 맨 위다
    // (2026-09-30 사용자 지시 — 바꾸면 곧바로 맨 위로). 고른 지역이 있는 나라로 되돌아와도 같다.
    var followSelection by remember(display.region?.key) { mutableStateOf(true) }
    // ⚠ **열 때 고른 지역으로 스크롤한다**(iOS `WeatherRegionPickerSheet.scrollToCurrent` 와 같다).
    // 미국은 69곳이라 고른 지역이 화면 밖에 있기 쉽다 — 안 옮기면 무엇이 골라져 있는지 안 보인다.
    LaunchedEffect(listState, selectedIndex) {
        if (!followSelection || selectedIndex <= 0) return@LaunchedEffect
        listState.scrollToItem(selectedIndex)
        // 목록이 한 번 그려져야 칸 높이를 안다 — 그다음 가운데로 끌어온다.
        // ⚠ **지금 자리에서 가운데까지의 차이만큼** 옮긴다. 끝 가까운 지역(제주)은 `scrollToItem`
        // 이 끝에서 멈춰 칸이 이미 아래쪽에 있다 — '맨 위에 왔다' 고 보고 반 화면을 되돌리면
        // 목록 맨 위로 돌아가 버린다(2026-09-30 A32 에서 그렇게 됐다).
        val layout = snapshotFlow { listState.layoutInfo }
            .first { info -> info.visibleItemsInfo.any { it.index == selectedIndex } }
        val item = layout.visibleItemsInfo.first { it.index == selectedIndex }
        val viewport = layout.viewportEndOffset - layout.viewportStartOffset
        val centered = layout.viewportStartOffset + (viewport - item.size) / 2
        listState.scrollBy((item.offset - centered).toFloat())
    }

    // ⚠ **나라 세그먼트는 제자리에 둔다**(`scrollsContent = false`). 껍데기가 통째로 스크롤하면
    // 긴 목록(미국 69곳)을 내려간 뒤 나라를 바꾸려면 맨 위까지 되돌아가야 했다(2026-09-30 A32).
    // iOS 도 세그먼트는 고정이고 목록만 스크롤한다.
    WakerSelectionSheet(
        title = stringResource(R.string.editorp_random_weather_region_title),
        subtitle = if (display.needsRepick) {
            stringResource(R.string.region_picker_legacy_value_hint, display.label)
        } else {
            null
        },
        onDismiss = onDismissWithoutSave,
        scrollsContent = false,
    ) { _ ->
        EditorSegmentedSelector(
            options = WeatherCountry.entries.map { it.code to stringResource(it.nameRes) },
            selected = shownCountry.code,
            onSelect = { code ->
                WeatherCountry.fromCode(code)?.let {
                    followSelection = false
                    shownCountry = it
                }
            },
            modifier = Modifier.padding(horizontal = 20.dp),
        )
        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f, fill = false),
        ) {
            itemsIndexed(regions, key = { _, region -> region.key }) { index, region ->
                WakerSheetOptionRow(
                    title = stringResource(region.nameRes),
                    // 날씨를 재는 곳이 이름과 다를 때만(경기 → 수원, 愛知 → 名古屋).
                    description = region.seatNameRes?.let {
                        stringResource(R.string.region_picker_seat_description, stringResource(it))
                    },
                    selected = index == selectedIndex,
                    onClick = { onConfirm(region) },
                    divider = index != regions.lastIndex,
                )
            }
        }
        // 날씨 출처 — 목록 **아래 고정**(목록이 `weight(1f, fill = false)` 라 늘 보인다). 원천과 가공해 쓴다는
        // 사실은 기상법(출처 표시)과 気象庁 약관(공공데이터 이용규약 — 가공 시 그 사실을 적는다)이 요구한다. 지역을
        // 고르는 곳이 이 시트 하나라(설정·편집기 공용) 여기 한 곳에만 둔다. iOS `WeatherRegionPickerSheet` 와 같은
        // 문장이다.
        // ⚠ **서버가 그 원천을 쓴다고 말할 때만 그린다**([showsWeatherAttribution]). 문장을 늘 그리면 서버의 원천
        // 교체가 늦거나 되돌려진 동안 쓰지 않는 기관을 출처로 적는다(코덱스 #845).
        if (showsAttribution) {
            Text(
                text = stringResource(R.string.region_picker_weather_attribution),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp),
            )
        }
    }
}
