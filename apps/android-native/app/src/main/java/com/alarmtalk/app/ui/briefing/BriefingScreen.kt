package com.alarmtalk.app

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.util.Base64
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.data.BriefingSignals
import com.alarmtalk.app.data.BriefingSource
import com.alarmtalk.app.network.BriefingCompany
import com.alarmtalk.app.network.BriefingDisclosure
import com.alarmtalk.app.network.BriefingInterest
import com.alarmtalk.app.network.BriefingPolicyNews
import com.alarmtalk.app.network.BriefingTodayResponse
import com.alarmtalk.app.network.ManualQuotaResponse
import com.alarmtalk.app.network.TtsGenerateResponse
import com.alarmtalk.app.network.apiErrorCode
import com.alarmtalk.app.network.apiErrorMessage
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import retrofit2.HttpException

/** 화면이 여는 바깥 주소. */
internal object BriefingLinks {
    /**
     * 정책브리핑 콘텐츠의 이용 조건(공공누리 제1유형 — 출처표시) 안내. 정책브리핑 자체의 저작권정책 주소를 확인하면 이 값을 그
     * 주소로 바꾼다(`docs/spec/morning-briefing.md` §7). iOS 짝은 `BriefingLinks.koglType1`.
     */
    const val KOGL_TYPE1 = "https://www.kogl.or.kr/info/licenseType1.do"
}

/** 소식 음성 미리보기 한 건 — 무엇을 읽을지와 그 문장. */
private data class BriefingSpeechTarget(
    val key: String,
    val text: String,
    /** 사용 기록의 원천 종류(`briefing_audio_requested`) — 문장·제목은 기록에 싣지 않는다. */
    val source: BriefingSource,
)

/**
 * **아침 소식** — 더보기에서 들어가는 하위 화면(`docs/spec/morning-briefing.md` §8). 열 때와 '다시 확인' 을 누를 때만 묻는다.
 * iOS 짝은 `BriefingView.swift`.
 *
 * 상태는 이 화면이 든다(소식은 기기에 저장하지 않는다). 요청은 뷰모델의 suspend 함수(`MainViewModelBriefingActions`)로 간다.
 */
@Composable
internal fun BriefingScreen(
    contentPadding: PaddingValues,
    onBack: () -> Unit,
    /** 고를 수 있는 목소리(`BriefingVoiceRules.allowedVoices` 를 지난 것) — id 와 표시 이름. */
    voiceChoices: List<Pair<String, String>>,
    initialVoiceId: String?,
    onLoadInterests: suspend () -> List<BriefingInterest>,
    onSaveInterests: suspend (List<String>) -> List<BriefingInterest>,
    onSearch: suspend (String) -> List<BriefingCompany>,
    onLoadToday: suspend () -> BriefingTodayResponse,
    onLoadManualQuota: suspend () -> ManualQuotaResponse?,
    onGenerateSpeech: suspend (voiceId: String, text: String, requestId: String) -> TtsGenerateResponse,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var interests by remember { mutableStateOf<List<BriefingInterest>>(emptyList()) }
    var interestsBusy by remember { mutableStateOf(false) }
    // 서버의 관심 기업 목록을 한 번이라도 받았는가. 못 받았으면 고치지 않는다 — 빈 목록 위에 더하고 통째로 바꾸면 서버의 기존
    // 목록이 지워진다(코덱스 #957). 다시 받을 때까지 추가·빼기를 막는다.
    var interestsLoaded by remember { mutableStateOf(false) }
    var interestsMessage by remember { mutableStateOf<String?>(null) }

    var view by remember { mutableStateOf<BriefingView?>(null) }
    var loading by remember { mutableStateOf(false) }
    var loadMessage by remember { mutableStateOf<String?>(null) }
    var notConfigured by remember { mutableStateOf(false) }
    var retryAtMillis by remember { mutableLongStateOf(0L) }
    var retryNoteVisible by remember { mutableStateOf(false) }

    var searchOpen by remember { mutableStateOf(false) }
    var limitAlertOpen by remember { mutableStateOf(false) }
    var speechTarget by remember { mutableStateOf<BriefingSpeechTarget?>(null) }

    // 도는 조회가 있는 동안 관심 기업이 바뀌었다 — 그 조회는 옛 목록으로 답하므로 끝나면 한 번 더 묻는다(코덱스 #957).
    var reloadQueued by remember { mutableStateOf(false) }

    fun loadToday(afterInterestsChange: Boolean = false) {
        if (loading) {
            if (afterInterestsChange) reloadQueued = true
            return
        }
        if (System.currentTimeMillis() < retryAtMillis) {
            // `Retry-After` 를 지킨다 — 보내지 않고 이유를 말한다(버튼은 죽이지 않는다).
            retryNoteVisible = true
            return
        }
        retryNoteVisible = false
        loading = true
        scope.launch {
            try {
                val response = onLoadToday()
                val next = BriefingPresentation.view(response)
                view = next
                loadMessage = null
                notConfigured = false
                retryAtMillis = next.retryAfterSeconds?.let { System.currentTimeMillis() + it * 1000L } ?: 0L
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                val code = apiErrorCode(error)
                if (code == "BRIEFING_NOT_CONFIGURED") {
                    notConfigured = true
                } else {
                    AlarmTalkLog.reportError("Failed to load morning briefing", error)
                    loadMessage = apiErrorMessage(context, code)
                        ?: userFacingError(error, context.getString(R.string.briefing_load_failed))
                }
            } finally {
                loading = false
                if (reloadQueued) {
                    reloadQueued = false
                    loadToday()
                }
            }
        }
    }

    suspend fun loadInterests() {
        try {
            interests = onLoadInterests()
            interestsLoaded = true
            interestsMessage = null
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            AlarmTalkLog.reportError("Failed to load briefing interests", error)
            interestsMessage = apiErrorMessage(context, apiErrorCode(error))
                ?: userFacingError(error, context.getString(R.string.briefing_load_failed))
        }
    }

    fun saveInterests(codes: List<String>) {
        if (interestsBusy) return
        if (!interestsLoaded) {
            scope.launch { loadInterests() }
            return
        }
        interestsBusy = true
        scope.launch {
            try {
                interests = onSaveInterests(codes)
                interestsMessage = null
                // 관심 기업이 바뀌면 소식도 다시 묻는다(새 기업은 서버가 그때 처음 확인한다).
                retryAtMillis = 0L
                loadToday(afterInterestsChange = true)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                AlarmTalkLog.reportError("Failed to save briefing interests", error)
                interestsMessage = apiErrorMessage(context, apiErrorCode(error))
                    ?: userFacingError(error, context.getString(R.string.briefing_load_failed))
            } finally {
                interestsBusy = false
            }
        }
    }

    // 화면이 열렸다(`briefing_opened`) — 한 번 들어온 것을 회전·재생성마다 다시 세지 않는다.
    var openRecorded by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        if (!openRecorded) {
            openRecorded = true
            BriefingSignals.opened(context)
        }
        loadInterests()
        loadToday()
    }

    val interestCodes = interests.map { it.corpCode }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(homeGradientBrush())
            .padding(contentPadding),
    ) {
        WakerTopBar(
            title = stringResource(R.string.briefing_menu_label),
            onBack = onBack,
            modifier = Modifier.padding(top = 12.dp),
        )
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item {
                Text(
                    text = stringResource(R.string.briefing_intro),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
            }
            if (notConfigured) {
                item { BriefingNoteCard(text = stringResource(R.string.briefing_not_configured)) }
            } else {
                item {
                    BriefingStatusCard(
                        view = view,
                        loading = loading,
                        loadMessage = loadMessage,
                        retryNoteVisible = retryNoteVisible,
                        onRefresh = {
                            if (!interestsLoaded) scope.launch { loadInterests() }
                            loadToday()
                        },
                    )
                }
                item {
                    BriefingInterestsCard(
                        interests = interests,
                        busy = interestsBusy || !interestsLoaded,
                        message = interestsMessage,
                        onAdd = {
                            when {
                                // 목록을 못 받은 채로는 더하지 않는다 — 먼저 다시 받는다.
                                !interestsLoaded -> scope.launch { loadInterests() }
                                BriefingInterestRules.canAdd(interestCodes) -> searchOpen = true
                                else -> limitAlertOpen = true
                            }
                        },
                        onRemove = { code -> saveInterests(BriefingInterestRules.removing(interestCodes, code)) },
                    )
                }
                view?.let { current ->
                    current.companies.forEach { section ->
                        item(key = "company-${section.corpCode}") {
                            BriefingCompanyCard(
                                section = section,
                                onOpen = { url ->
                                    BriefingSignals.sourceOpened(
                                        context,
                                        BriefingSource.DISCLOSURE,
                                    )
                                    context.openWebUrl(url)
                                },
                                onSpeech = { item ->
                                    speechTarget = BriefingSpeechTarget(
                                        "d:${item.id}",
                                        BriefingSpeech.disclosure(item),
                                        BriefingSource.DISCLOSURE,
                                    )
                                },
                            )
                        }
                    }
                    item(key = "news") {
                        BriefingNewsCard(
                            section = current.news,
                            onOpen = { url ->
                                BriefingSignals.sourceOpened(
                                    context,
                                    BriefingSource.POLICY_NEWS,
                                )
                                context.openWebUrl(url)
                            },
                            onSpeech = { item ->
                                speechTarget = BriefingSpeechTarget(
                                    "n:${item.id}",
                                    BriefingSpeech.policyNews(item),
                                    BriefingSource.POLICY_NEWS,
                                )
                            },
                        )
                    }
                }
            }
            item { BriefingSourceFooter(onOpenLicense = { context.openWebUrl(BriefingLinks.KOGL_TYPE1) }) }
        }
    }

    if (searchOpen) {
        BriefingSearchDialog(
            selectedCodes = interestCodes,
            onSearch = onSearch,
            onPick = { company ->
                val next = BriefingInterestRules.adding(interestCodes, company.corpCode)
                searchOpen = false
                when {
                    next == null -> limitAlertOpen = true
                    next != interestCodes -> saveInterests(next)
                }
            },
            onDismiss = { searchOpen = false },
        )
    }

    if (limitAlertOpen) {
        IosAlertDialog(
            title = stringResource(R.string.briefing_interest_limit_title, BriefingInterestRules.MAX_INTERESTS),
            message = stringResource(R.string.briefing_interest_limit_message),
            onDismiss = { limitAlertOpen = false },
            actions = listOf(
                IosAlertAction(
                    label = stringResource(R.string.briefing_close),
                    emphasized = true,
                    onClick = { limitAlertOpen = false },
                ),
            ),
        )
    }

    speechTarget?.let { target ->
        BriefingSpeechDialog(
            target = target,
            voiceChoices = voiceChoices,
            initialVoiceId = initialVoiceId,
            onLoadManualQuota = onLoadManualQuota,
            onGenerateSpeech = onGenerateSpeech,
            onDismiss = { speechTarget = null },
        )
    }
}

@Composable
private fun BriefingNoteCard(text: String) {
    SettingsCard(title = null) {
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
        )
    }
}

@Composable
private fun BriefingStatusCard(
    view: BriefingView?,
    loading: Boolean,
    loadMessage: String?,
    retryNoteVisible: Boolean,
    onRefresh: () -> Unit,
) {
    SettingsCard(title = null) {
        Column(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            val headline = when {
                view == null && loading -> stringResource(R.string.briefing_loading)
                view?.fetchedAt == null -> stringResource(R.string.briefing_not_checked_yet)
                else -> stringResource(R.string.briefing_checked_at, formatBriefingCheckedAt(view.fetchedAt))
            }
            Text(
                text = headline,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (view != null) {
                Text(
                    text = stringResource(
                        if (view.complete) R.string.briefing_status_complete else R.string.briefing_status_partial,
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (view.complete) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error,
                )
                view.window?.let { (from, to) ->
                    Text(
                        text = stringResource(R.string.briefing_window, formatBriefingDate(from), formatBriefingDate(to)),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            loadMessage?.let { Text(text = it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
            if (retryNoteVisible) {
                Text(
                    text = stringResource(R.string.briefing_retry_wait),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onRefresh, enabled = !loading) {
                    Text(stringResource(R.string.briefing_refresh))
                }
                if (loading) CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
            }
        }
    }
}

@Composable
private fun BriefingInterestsCard(
    interests: List<BriefingInterest>,
    busy: Boolean,
    message: String?,
    onAdd: () -> Unit,
    onRemove: (String) -> Unit,
) {
    SettingsCard(
        title = "${stringResource(R.string.briefing_interests_title)} " +
            stringResource(R.string.briefing_interests_count, interests.size, BriefingInterestRules.MAX_INTERESTS),
    ) {
        if (interests.isEmpty()) {
            Text(
                text = stringResource(R.string.briefing_interests_empty),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            )
        }
        interests.forEach { interest ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 52.dp)
                    .padding(start = 12.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = interest.corpName ?: stringResource(R.string.briefing_company_unknown_name),
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    interest.stockCode?.takeIf { it.isNotBlank() }?.let {
                        Text(text = it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                TextButton(onClick = { onRemove(interest.corpCode) }, enabled = !busy) {
                    Text(stringResource(R.string.briefing_remove_company))
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
        SettingsRow(label = stringResource(R.string.briefing_add_company), value = null, onClick = onAdd)
        message?.let {
            Text(
                text = it,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
            )
        }
    }
}

@Composable
private fun BriefingCompanyCard(
    section: BriefingCompanySection,
    onOpen: (String) -> Unit,
    onSpeech: (BriefingDisclosure) -> Unit,
) {
    SettingsCard(title = section.corpName ?: stringResource(R.string.briefing_company_unknown_name)) {
        val note = when (section.note) {
            BriefingCompanyNote.NONE -> null
            BriefingCompanyNote.NO_DISCLOSURES -> stringResource(R.string.briefing_company_no_disclosures)
            BriefingCompanyNote.NOT_CONCLUSIVE -> stringResource(R.string.briefing_company_not_conclusive)
            BriefingCompanyNote.STALE -> section.fetchedAt
                ?.let { stringResource(R.string.briefing_company_stale, formatBriefingCheckedAt(it)) }
                ?: stringResource(R.string.briefing_stale_unknown)
            BriefingCompanyNote.UNAVAILABLE -> stringResource(R.string.briefing_company_unavailable)
        }
        note?.let { BriefingInlineNote(text = it, warning = section.note != BriefingCompanyNote.NO_DISCLOSURES) }
        if (section.state != BriefingCompanyState.OK && section.errorCode != null) {
            BriefingInlineNote(text = stringResource(BriefingPresentation.sourceErrorMessageRes(section.errorCode)), warning = false)
        }
        section.disclosures.forEachIndexed { index, item ->
            if (index > 0 || note != null) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            BriefingDisclosureRow(item = item, onOpen = { onOpen(item.url) }, onSpeech = { onSpeech(item) })
        }
    }
}

@Composable
private fun BriefingInlineNote(text: String, warning: Boolean) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodyMedium,
        color = if (warning) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
    )
}

@Composable
private fun BriefingDisclosureRow(item: BriefingDisclosure, onOpen: () -> Unit, onSpeech: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 12.dp, end = 4.dp, top = 8.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            text = item.reportName,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
        )
        val flags = buildList {
            if (item.flags?.amendedReport == true) add(stringResource(R.string.briefing_flag_amended))
            if (item.flags?.correctedLater == true) add(stringResource(R.string.briefing_flag_corrected_later))
            if (item.flags?.withdrawn == true) add(stringResource(R.string.briefing_flag_withdrawn))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            if (item.receiptDate.isNotBlank()) {
                Text(
                    text = stringResource(R.string.briefing_receipt_date, formatBriefingDate(item.receiptDate)),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            flags.forEach { BriefingFlagBadge(it) }
        }
        BriefingItemActions(onOpen = onOpen, onSpeech = onSpeech)
    }
}

@Composable
private fun BriefingFlagBadge(text: String) {
    Surface(shape = WakerPillShape, color = MaterialTheme.colorScheme.secondaryContainer) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSecondaryContainer,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
        )
    }
}

@Composable
private fun BriefingItemActions(onOpen: () -> Unit, onSpeech: () -> Unit) {
    Row {
        TextButton(onClick = onOpen) { Text(stringResource(R.string.briefing_open_original)) }
        TextButton(onClick = onSpeech) { Text(stringResource(R.string.briefing_speech_button)) }
    }
}

@Composable
private fun BriefingNewsCard(
    section: BriefingNewsSection,
    onOpen: (String) -> Unit,
    onSpeech: (BriefingPolicyNews) -> Unit,
) {
    SettingsCard(title = stringResource(R.string.briefing_news_title)) {
        when (section.note) {
            BriefingNewsNote.NONE -> Unit
            BriefingNewsNote.NO_NEWS -> BriefingInlineNote(stringResource(R.string.briefing_news_empty), warning = false)
            BriefingNewsNote.STALE -> BriefingInlineNote(stringResource(R.string.briefing_stale_unknown), warning = true)
            BriefingNewsNote.UNAVAILABLE ->
                BriefingInlineNote(stringResource(BriefingPresentation.sourceErrorMessageRes(section.errorCode)), warning = true)
        }
        section.items.forEachIndexed { index, item ->
            if (index > 0 || section.note != BriefingNewsNote.NONE) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 12.dp, end = 4.dp, top = 8.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    text = item.title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                val day = formatBriefingDate(item.publishedDate)
                Text(
                    text = item.organization?.takeIf { it.isNotBlank() }
                        ?.let { stringResource(R.string.briefing_news_meta, it, day) }
                        ?: stringResource(R.string.briefing_news_meta_no_org, day),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (item.summary.isNotBlank()) {
                    // 원천의 HTML 은 서버가 글자로 바꿔 보냈다 — 여기서도 **글자로만** 그린다.
                    Text(
                        text = item.summary,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                BriefingItemActions(onOpen = { onOpen(item.url) }, onSpeech = { onSpeech(item) })
            }
        }
    }
}

/** 출처 줄 — 이용 조건이라 빼지 않는다(`docs/spec/morning-briefing.md` §3). */
@Composable
private fun BriefingSourceFooter(onOpenLicense: () -> Unit) {
    Column(
        modifier = Modifier.padding(horizontal = 4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        listOf(
            R.string.briefing_source_dart,
            R.string.briefing_source_policy,
            R.string.briefing_source_disclaimer,
        ).forEach { res ->
            Text(
                text = stringResource(res),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            text = stringResource(R.string.briefing_source_license_link),
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier
                .clickable(onClick = onOpenLicense)
                .padding(vertical = 4.dp),
        )
    }
}

/** 기업 찾기 알럿 — 입력칸 + 결과 목록. 결과 행을 누르면 그 기업을 고른다. */
@Composable
private fun BriefingSearchDialog(
    selectedCodes: List<String>,
    onSearch: suspend (String) -> List<BriefingCompany>,
    onPick: (BriefingCompany) -> Unit,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<BriefingCompany>?>(null) }
    var searching by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var retryAtMillis by remember { mutableLongStateOf(0L) }

    fun search() {
        val text = sanitizeUserText(query).trim()
        if (text.isEmpty() || searching) return
        if (System.currentTimeMillis() < retryAtMillis) {
            message = context.getString(R.string.api_error_briefing_corp_codes_not_ready)
            return
        }
        searching = true
        scope.launch {
            try {
                results = onSearch(text)
                message = null
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                val code = apiErrorCode(error)
                if (code == "BRIEFING_CORP_CODES_NOT_READY") {
                    retryAtMillis = System.currentTimeMillis() + briefingRetryAfterSeconds(error) * 1000L
                } else if (code != "BRIEFING_INVALID_QUERY") {
                    // (검색어 형식 거절은 친 값의 문제라 문구로 끝내고 보고하지 않는다.)
                    AlarmTalkLog.reportError("Failed to search briefing companies", error)
                }
                message = apiErrorMessage(context, code)
                    ?: userFacingError(error, context.getString(R.string.briefing_load_failed))
            } finally {
                searching = false
            }
        }
    }

    IosAlertDialog(
        title = stringResource(R.string.briefing_search_title),
        message = stringResource(R.string.briefing_search_hint),
        onDismiss = onDismiss,
        actions = listOf(
            IosAlertAction(label = stringResource(R.string.briefing_close), onClick = onDismiss),
            IosAlertAction(
                label = stringResource(R.string.briefing_search_action),
                emphasized = true,
                enabled = !searching,
                onClick = ::search,
            ),
        ),
    ) {
        IosAlertField(
            value = query,
            onValueChange = { value -> query = sanitizeUserText(value).takeWithoutSplittingPairs(BRIEFING_QUERY_MAX) },
            placeholder = stringResource(R.string.briefing_search_placeholder),
        )
        if (searching) {
            CircularProgressIndicator(modifier = Modifier.padding(top = 12.dp).size(20.dp), strokeWidth = 2.dp)
        }
        message?.let {
            Text(
                text = it,
                style = IosAlertType.Message,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            )
        }
        results?.let { list ->
            if (list.isEmpty()) {
                Text(
                    text = stringResource(R.string.briefing_search_no_result),
                    style = IosAlertType.Message,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                )
            } else {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp)
                        .heightIn(max = 240.dp)
                        .verticalScroll(rememberScrollState()),
                ) {
                    list.forEach { company ->
                        val added = company.corpCode in selectedCodes
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = 44.dp)
                                .clickable(enabled = !added) { onPick(company) }
                                .padding(vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(text = company.corpName, style = IosAlertType.Field, color = MaterialTheme.colorScheme.onSurface)
                                company.stockCode?.takeIf { it.isNotBlank() }?.let {
                                    Text(text = it, style = IosAlertType.Message, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                            if (added) {
                                Text(
                                    text = stringResource(R.string.briefing_search_added),
                                    style = IosAlertType.Message,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/** 검색어 상한(정리한 뒤) — shared `BRIEFING_SEARCH_QUERY_MAX`. 서버가 같은 상한으로 다시 막는다. */
private const val BRIEFING_QUERY_MAX = 30

/** 503 의 `Retry-After`(초). 없거나 못 읽으면 계약값 60초(`routes/briefing.ts`). */
private fun briefingRetryAfterSeconds(error: Throwable): Int =
    (error as? HttpException)?.response()?.headers()?.get("Retry-After")?.trim()?.toIntOrNull()?.takeIf { it > 0 } ?: 60

/**
 * 음성 문장 미리보기 — 최종 문장·글자 수·목소리·차감 안내를 함께 보여 주고, 확인해야 만든다(`docs/spec/morning-briefing.md` §8
 * 「요청형 음성」). 만들기는 직접 입력과 같은 요청이다.
 */
@Composable
private fun BriefingSpeechDialog(
    target: BriefingSpeechTarget,
    voiceChoices: List<Pair<String, String>>,
    initialVoiceId: String?,
    onLoadManualQuota: suspend () -> ManualQuotaResponse?,
    onGenerateSpeech: suspend (voiceId: String, text: String, requestId: String) -> TtsGenerateResponse,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val requestIds = remember { ManualRequestIds() }
    var voiceId by remember { mutableStateOf(initialVoiceId ?: voiceChoices.firstOrNull()?.first) }
    var quota by remember { mutableStateOf<ManualQuotaResponse?>(null) }
    var generating by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var audioFile by remember { mutableStateOf<File?>(null) }
    val player = remember { BriefingSpeechPlayer() }
    DisposableEffect(Unit) { onDispose { player.release() } }

    LaunchedEffect(Unit) {
        quota = runCatching { onLoadManualQuota() }.getOrNull()
    }

    fun generate() {
        val chosen = voiceId ?: return
        if (generating) return
        generating = true
        message = null
        BriefingSignals.audioRequested(context, target.source, chosen)
        scope.launch {
            try {
                val response = onGenerateSpeech(chosen, target.text, requestIds.idFor(chosen, "ko", target.text))
                requestIds.completed()
                val file = withContext(Dispatchers.IO) { writeBriefingSpeechFile(context, response) }
                audioFile = file
                message = context.getString(R.string.briefing_speech_ready)
                player.play(file)
                quota = runCatching { onLoadManualQuota() }.getOrNull() ?: quota
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                AlarmTalkLog.reportError("Failed to generate briefing speech", error)
                message = apiErrorMessage(context, apiErrorCode(error))
                    ?: userFacingError(error, context.getString(R.string.api_error_tts_generation_failed))
            } finally {
                generating = false
            }
        }
    }

    val ready = audioFile
    // 본문은 높이를 묶고 스크롤한다 — 긴 문장 + 목소리 넷 + 안내가 작은 화면·큰 글씨에서 창보다 길어져 아래 버튼이 잘렸다
    // (코덱스 #957). 버튼 줄은 스크롤 밖에 남는다. 문장도 스크롤 안에 넣는다(제목 아래 고정 글자로 두면 같은 높이를 다툰다).
    val maxBodyHeight = (androidx.compose.ui.platform.LocalConfiguration.current.screenHeightDp * 0.55f).dp
    IosAlertDialog(
        title = stringResource(R.string.briefing_speech_title),
        message = null,
        onDismiss = { if (!generating) onDismiss() },
        actions = listOf(
            IosAlertAction(label = stringResource(R.string.briefing_close), enabled = !generating, onClick = onDismiss),
            if (ready != null) {
                IosAlertAction(
                    label = stringResource(R.string.briefing_speech_play),
                    emphasized = true,
                    onClick = { player.play(ready) },
                )
            } else {
                IosAlertAction(
                    label = stringResource(R.string.briefing_speech_make),
                    emphasized = true,
                    enabled = !generating && voiceId != null,
                    onClick = ::generate,
                )
            },
        ),
    ) {
      Column(
          modifier = Modifier
              .fillMaxWidth()
              .heightIn(max = maxBodyHeight)
              .verticalScroll(androidx.compose.foundation.rememberScrollState()),
      ) {
        Text(
            text = target.text,
            style = IosAlertType.Message,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp),
        )
        Text(
            text = stringResource(R.string.briefing_speech_length, target.text.length, BriefingSpeech.MAX_LENGTH),
            style = IosAlertType.Message,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.fillMaxWidth(),
        )
        Text(
            text = stringResource(R.string.briefing_speech_voice_label),
            style = IosAlertType.Message,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
        )
        voiceChoices.forEach { (id, name) ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 40.dp)
                    .clickable(enabled = !generating) {
                        if (voiceId != id) {
                            voiceId = id
                            // 목소리가 바뀌면 다른 결과다 — 들려줄 것을 비운다.
                            audioFile = null
                            message = null
                        }
                    },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(text = name, style = IosAlertType.Field, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.weight(1f))
                if (voiceId == id) {
                    Icon(
                        imageVector = Icons.Outlined.Check,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }
        Text(
            text = stringResource(R.string.briefing_speech_charge_notice),
            style = IosAlertType.Message,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
        )
        quota?.takeIf { it.limit > 0 }?.let {
            Text(
                text = stringResource(R.string.briefing_speech_remaining, it.remaining.coerceAtLeast(0)),
                style = IosAlertType.Message,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (generating) {
            CircularProgressIndicator(modifier = Modifier.padding(top = 10.dp).size(20.dp), strokeWidth = 2.dp)
        }
        message?.let {
            Text(
                text = it,
                style = IosAlertType.Message,
                color = if (ready != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            )
        }
      }
    }
}

/** 받은 음성을 캐시 폴더의 한 파일에 쓴다(한 번 듣고 버리는 파일 — 알람에 붙이지 않는다). */
private fun writeBriefingSpeechFile(context: Context, response: TtsGenerateResponse): File {
    val bytes = Base64.decode(response.audioBase64, Base64.DEFAULT)
    val extension = response.audioFormat.lowercase(Locale.ROOT).filter { it.isLetterOrDigit() }.ifBlank { "mp3" }
    val dir = File(context.cacheDir, "briefing-speech").apply { mkdirs() }
    dir.listFiles()?.forEach { it.delete() }
    return File(dir, "speech.$extension").apply { writeBytes(bytes) }
}

/**
 * 만든 음성을 한 번 들려준다 — 알람과 같은 스트림(`USAGE_ALARM`)이다. 기본(미디어) 스트림으로 틀면 알람으로 울릴 때와 크기가
 * 달라진다(CLAUDE.md 「재생 방식」 — 미리듣기는 울림과 같은 스트림).
 */
private class BriefingSpeechPlayer {
    private var player: MediaPlayer? = null

    fun play(file: File) {
        release()
        player = runCatching {
            MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build(),
                )
                setDataSource(file.absolutePath)
                setOnCompletionListener { it.release(); if (player === it) player = null }
                prepare()
                start()
            }
        }.onFailure { AlarmTalkLog.reportError("Failed to play briefing speech", it) }.getOrNull()
    }

    fun release() {
        player?.release()
        player = null
    }
}

/** `YYYY-MM-DD` → 기기 언어의 "10월 26일". 못 읽으면 그대로. */
internal fun formatBriefingDate(ymd: String): String = runCatching {
    val pattern = android.text.format.DateFormat.getBestDateTimePattern(Locale.getDefault(), "MMMd")
    LocalDate.parse(ymd).format(DateTimeFormatter.ofPattern(pattern, Locale.getDefault()))
}.getOrDefault(ymd)

/** ISO 시각 → 기기 시간대·언어의 "10월 26일 오전 7:05". 못 읽으면 그대로. */
internal fun formatBriefingCheckedAt(iso: String): String = runCatching {
    val instant = runCatching { Instant.parse(iso) }.getOrElse { OffsetDateTime.parse(iso).toInstant() }
    val pattern = android.text.format.DateFormat.getBestDateTimePattern(Locale.getDefault(), "MMMdjmm")
    instant.atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern(pattern, Locale.getDefault()))
}.getOrDefault(iso)
