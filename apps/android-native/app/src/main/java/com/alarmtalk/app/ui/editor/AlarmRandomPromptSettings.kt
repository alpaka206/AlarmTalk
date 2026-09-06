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
                    RandomPromptDetailRow(
                        title = stringResource(R.string.editorp_random_weather_region_title),
                        onChange = {
                            contextBeforeDialog = null
                            weatherDialogOpen = true
                        },
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
                        onChange = {
                            contextBeforeDialog = null
                            fortuneDialogOpen = true
                        },
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
            onDismissWithoutSave = {
                weatherDialogOpen = false
                cancelContextSelection()
            },
            onConfirm = { country, city ->
                draftWeatherCountry = country
                draftWeatherCity = city
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
// ⚠ `internal` 이다 — 무료 버킷 pane(`FreeBucketSettingsPane`)도 같은 다이얼로그를 쓴다.
// 유료 사용자가 **기본 목소리**로도 직접 입력을 할 수 있게 되면서(2026-08-11 서버 개방),
// 그 pane 에서도 이 입력창이 필요해졌다. 두 벌로 만들지 않는다.
@Composable
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

/**
 * 직접 입력한 지역 문자열을 **나라와 도시**로 가른다 — iOS `WeatherCityPickerSheet.parseLocation`
 * 과 같은 규칙이다.
 *
 * ⚠ 나라를 안 가르면 "뉴욕" 이 **대한민국 뉴욕**으로 저장돼 서버가 엉뚱한 좌표를 잡는다.
 */
internal fun parseWeatherLocation(context: android.content.Context, raw: String): Pair<String, String> {
    val trimmed = raw.trim()
    val separator = trimmed.indexOf(' ')
    if (separator < 0) return defaultWeatherCountry(context) to trimmed
    val country = trimmed.substring(0, separator).trim()
    val city = trimmed.substring(separator + 1).trim()
    // 끝에 공백만 있던 경우 — 나라 이름만 남으므로 도시로 되돌린다.
    return if (city.isBlank()) defaultWeatherCountry(context) to country else country to city
}

/** 프리셋·공백 없는 입력에 붙이는 기본 나라. iOS `defaultCountry` 와 같은 값이다. */
internal fun defaultWeatherCountry(context: android.content.Context): String =
    context.getString(R.string.hs_weather_default_country)

@Composable
internal fun WeatherLocationDialog(
    country: String,
    city: String,
    onDismissWithoutSave: () -> Unit,
    onConfirm: (String, String) -> Unit,
) {
    val presetCities = androidx.compose.ui.res.stringArrayResource(R.array.hs_weather_preset_cities).toList()
    val context = androidx.compose.ui.platform.LocalContext.current
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
                    // ⚠ **나라를 빈 채로 저장하지 말 것**(2026-08-17). 예전에는 저장된
                    // `country` 를 그대로 흘려보내서, 한 번도 나라가 채워진 적 없는 계정은
                    // 계속 빈 값이었다. 서버는 도시 이름으로 지오코딩한 뒤 **나라로 후보를
                    // 고르므로**(`routes/tts.ts` 의 `resolveWeatherLocation`), 나라가 없으면
                    // 동명 도시 중 첫 결과를 쓴다 — 표시가 아니라 **날씨가 틀릴 수 있다.**
                    // 프리셋은 전부 국내 도시라 나라는 하나다(iOS `WeatherCityPickerSheet`
                    // 의 `defaultCountry` 와 같은 값).
                    onClick = { onConfirm(defaultWeatherCountry(context), preset) },
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
                    modifier = Modifier.textInputTapTarget().then(Modifier.fillMaxWidth()),
                )
                Button(
                    // 공백이 있으면 **첫 낱말이 나라, 나머지가 도시**다("미국 뉴욕").
                    // 공백이 없으면 국내로 본다 — iOS `parseLocation` 과 같은 규칙이다.
                    onClick = {
                        val (parsedCountry, parsedCity) = parseWeatherLocation(context, draftCity)
                        onConfirm(parsedCountry, parsedCity)
                    },
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
