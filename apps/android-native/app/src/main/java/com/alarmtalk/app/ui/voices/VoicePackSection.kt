package com.alarmtalk.app

import android.text.format.Formatter
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.data.HeldVoicePack
import com.alarmtalk.app.network.VoicePackPreview
import com.alarmtalk.app.network.VoicePackSummary
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date
import java.util.Locale

/*
 * 목소리 탭 '추가 팩' 섹션과 팩 상세(`docs/spec/voice-packs.md` §7, 지시서 7.2 의 '팩 상세').
 * 기본 목소리 섹션 아래에 놓인다(`VoiceProfileManagementPanel`). 받는 일은 선다운로드 워커의 팩 칸이 하고, 여기는
 * 목록·상세·받기 시작·지우기 확인을 그린다. iOS 짝은 `VoicePackSection.swift`.
 */

/**
 * 목소리 탭이 '추가 팩' 섹션에 넘기는 값·동작 한 묶음 — `AlarmTalkApp` → `AlarmListScreen` → `VoiceProfileManagementPanel` 로
 * 그대로 내려간다(인자를 하나씩 늘리지 않으려고 묶었다).
 */
internal data class VoicePackPanelState(
    val catalog: List<VoicePackSummary> = emptyList(),
    val held: List<HeldVoicePack> = emptyList(),
    val progress: Map<String, Int> = emptyMap(),
    val catalogLoaded: Boolean = false,
    val catalogFailed: Boolean = false,
    val onDownload: (String) -> Unit = {},
    val onDelete: (String) -> Unit = {},
    val countAlarmsUsing: suspend (String) -> Int = { 0 },
    val ensureSample: suspend (VoicePackSummary) -> com.alarmtalk.app.data.CachedAlarmAudio = {
        error("Voice pack samples are unavailable.")
    },
)

/** 섹션 한 줄 — 카탈로그 요약과(있으면) 이 계정이 받은 팩. 받은 팩만 있고 카탈로그에 없으면 게시가 끝났거나 안 보이는 팩이다. */
internal data class VoicePackRowModel(
    val summary: VoicePackSummary,
    val held: HeldVoicePack?,
)

/** 카탈로그와 받은 팩을 한 목록으로 — 카탈로그 순서 먼저, 그 뒤에 카탈로그에 없는 받은 팩. */
internal fun voicePackRows(catalog: List<VoicePackSummary>, held: List<HeldVoicePack>): List<VoicePackRowModel> {
    val heldById = held.associateBy { it.packId }
    val listed = catalog.map { VoicePackRowModel(it, heldById[it.packId]) }
    val listedIds = catalog.map { it.packId }.toSet()
    val unlisted = held.filter { it.packId !in listedIds }.map { pack ->
        VoicePackRowModel(
            summary = VoicePackSummary(
                packId = pack.packId,
                voiceId = pack.voiceId,
                contentRevision = pack.contentRevision,
                speakerName = pack.speakerName,
                description = pack.description,
                usageNote = pack.usageNote,
                language = pack.language,
                clipCount = pack.clipList.size,
                totalBytes = pack.totalBytes,
                preview = pack.previewClipId?.let { id ->
                    VoicePackPreview(id, pack.clipList.firstOrNull { it.clipId == id }?.sizeBytes ?: 0)
                },
            ),
            held = pack,
        )
    }
    return listed + unlisted
}

@Composable
internal fun VoicePackSection(
    catalog: List<VoicePackSummary>,
    held: List<HeldVoicePack>,
    progress: Map<String, Int>,
    catalogLoaded: Boolean,
    catalogFailed: Boolean,
    playingVoiceId: String?,
    onPlaySample: (VoicePackSummary) -> Unit,
    onDownload: (String) -> Unit,
    onDelete: (String) -> Unit,
    countAlarmsUsing: suspend (String) -> Int,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var expanded by rememberSaveable { mutableStateOf(true) }
    var detailPackId by rememberSaveable { mutableStateOf<String?>(null) }
    var deleteConfirm by remember { mutableStateOf<Pair<HeldVoicePack, Int>?>(null) }
    val rows = voicePackRows(catalog, held)

    VoiceCatalogSectionHeader(
        title = stringResource(R.string.voice_pack_section_title),
        expanded = expanded,
        onToggle = { expanded = !expanded },
    )
    if (!expanded) return
    if (rows.isEmpty()) {
        // 조회 전에는 아무것도 말하지 않는다 — '없어요' 와 '아직 모른다' 는 다르다.
        if (catalogLoaded) {
            Text(
                text = stringResource(if (catalogFailed) R.string.voice_pack_load_failed else R.string.voice_pack_empty),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(vertical = 4.dp),
            )
        }
    } else {
        VoiceCatalogGroup(
            rows.map { row ->
                {
                    VoiceCatalogRow(
                        name = row.summary.speakerName,
                        isPlaying = playingVoiceId == row.summary.voiceId,
                        onPreview = { onPlaySample(row.summary) },
                        onOpenActions = { detailPackId = row.summary.packId },
                        belowContent = {
                            Text(
                                text = voicePackStatusLine(context, row, progress[row.summary.packId]),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
                            )
                        },
                    )
                }
            },
        )
    }

    val detail = rows.firstOrNull { it.summary.packId == detailPackId }
    if (detail != null) {
        VoicePackDetailSheet(
            row = detail,
            percent = progress[detail.summary.packId],
            playing = playingVoiceId == detail.summary.voiceId,
            onDismiss = { detailPackId = null },
            onPlaySample = { onPlaySample(detail.summary) },
            onDownload = { onDownload(detail.summary.packId) },
            onDelete = {
                val pack = detail.held ?: return@VoicePackDetailSheet
                scope.launch { deleteConfirm = pack to countAlarmsUsing(pack.voiceId) }
            },
        )
    }

    deleteConfirm?.let { (pack, count) ->
        IosAlertDialog(
            title = stringResource(R.string.voice_pack_delete_title),
            message = if (count > 0) {
                stringResource(R.string.voice_pack_delete_message, count)
            } else {
                stringResource(R.string.voice_pack_delete_message_none)
            },
            onDismiss = { deleteConfirm = null },
            actions = listOf(
                IosAlertAction(label = stringResource(R.string.voice_pack_cancel), onClick = { deleteConfirm = null }),
                IosAlertAction(
                    label = stringResource(R.string.voice_pack_delete),
                    destructive = true,
                    onClick = {
                        deleteConfirm = null
                        detailPackId = null
                        onDelete(pack.packId)
                    },
                ),
            ),
        )
    }
}

/** 행 아래 한 줄 — 언어 · 크기 · 상태(받기 전 / 받는 중 N% / 받음 / 게시 끝남). */
private fun voicePackStatusLine(context: android.content.Context, row: VoicePackRowModel, percent: Int?): String {
    val language = row.summary.language?.let { Locale(it).getDisplayLanguage(Locale(it)) }.orEmpty()
    val size = Formatter.formatShortFileSize(context, row.summary.totalBytes)
    val state = voicePackStateText(context, row, percent)
    return listOf(language, size, state).filter { it.isNotBlank() }.joinToString(" · ")
}

/** 받은 팩을 이어 받을 수 있는가 — 다 받지 못했고, 지금 받는 회차가 없고(진행률 없음), 게시 중이다. iOS `VoicePackStore.canRetryDownload` 짝. */
internal fun canRetryVoicePackDownload(held: HeldVoicePack?, percent: Int?): Boolean =
    held != null && !held.ready && !held.withdrawn && percent == null

private fun voicePackStateText(context: android.content.Context, row: VoicePackRowModel, percent: Int?): String {
    val held = row.held
    return when {
        held?.withdrawn == true -> context.getString(
            R.string.voice_pack_withdrawn,
            DateFormat.getDateInstance(DateFormat.LONG).format(Date(held.withdrawnPlaybackUntilMillis ?: 0L)),
        )
        held?.ready == true -> context.getString(R.string.voice_pack_ready)
        // 다 받지 못했는데 받는 회차가 없으면(실패·앱을 다시 켬) '받는 중' 이 아니다 — 상세의 '다시 받기' 를 가리킨다.
        held != null && percent == null -> context.getString(R.string.voice_pack_download_failed)
        held != null -> context.getString(R.string.voice_pack_downloading, percent)
        else -> context.getString(R.string.voice_pack_not_downloaded)
    }
}

@Composable
private fun VoicePackDetailSheet(
    row: VoicePackRowModel,
    percent: Int?,
    playing: Boolean,
    onDismiss: () -> Unit,
    onPlaySample: () -> Unit,
    onDownload: () -> Unit,
    onDelete: () -> Unit,
) {
    val context = LocalContext.current
    val held = row.held
    WakerSelectionSheet(title = row.summary.speakerName, onDismiss = onDismiss) { _ ->
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            row.summary.description?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium)
            }
            row.summary.usageNote?.takeIf { it.isNotBlank() }?.let { note ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        stringResource(R.string.voice_pack_usage_title),
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(note, style = MaterialTheme.typography.bodyMedium)
                }
            }
            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                if (held != null && !held.ready && !held.withdrawn && percent != null) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(14.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(Modifier.width(6.dp))
                }
                Text(
                    text = stringResource(R.string.voice_pack_size, Formatter.formatShortFileSize(context, row.summary.totalBytes)) +
                        " · " + voicePackStateText(context, row, percent),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (held?.withdrawn == true) {
                Text(
                    stringResource(R.string.voice_pack_withdrawn_after),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                // 지시서 7.2 '실제 적용 대상 설명' — 어디에 쓰이고 무엇에는 안 쓰이는가.
                Text(
                    stringResource(R.string.voice_pack_apply_note),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = onPlaySample,
                    enabled = row.summary.preview != null,
                    modifier = Modifier.weight(1f),
                    shape = WakerButtonShape,
                    border = wakerCardBorder(),
                    colors = wakerOutlinedButtonColors(),
                ) {
                    Text(stringResource(if (playing) R.string.voicesr_preview_stop else R.string.voice_pack_preview))
                }
                when {
                    held != null -> OutlinedButton(
                        onClick = onDelete,
                        modifier = Modifier.weight(1f),
                        shape = WakerButtonShape,
                        border = wakerCardBorder(),
                        colors = wakerOutlinedButtonColors(),
                    ) { Text(stringResource(R.string.voice_pack_delete)) }
                    else -> Button(
                        onClick = onDownload,
                        modifier = Modifier.weight(1f),
                        shape = WakerButtonShape,
                        colors = wakerButtonColors(),
                    ) { Text(stringResource(R.string.voice_pack_download)) }
                }
            }
            // 받다 멈췄거나 못 받은 팩은 지우지 않고 '다시 받기' 로 이어 받는다(빠진 클립만 받는다). 지우고 다시 받으면 그 팩 알람이
            // 미나로 바뀐다(코덱스 #960). 판정은 [canRetryVoicePackDownload].
            if (canRetryVoicePackDownload(held, percent)) {
                Button(
                    onClick = onDownload,
                    modifier = Modifier.fillMaxWidth(),
                    shape = WakerButtonShape,
                    colors = wakerButtonColors(),
                ) { Text(stringResource(R.string.voice_pack_retry_download)) }
            }
        }
    }
}
