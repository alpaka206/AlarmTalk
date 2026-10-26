import SwiftUI

/// 목소리 탭 **'추가 팩'** 섹션 — 카탈로그·받기 진행·게시 끝 안내, 누르면 팩 상세(`docs/spec/voice-packs.md` §7).
///
/// 안드로이드 짝은 `ui/voices/VoicePackSection.kt`. 기본 목소리 섹션 **아래**에 둔다. 팩이 하나도 없으면 빈 상태 한 줄이다
/// (첫 팩은 외부 권리/음원 대기 — 스펙 §0).
struct VoicePackSection: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var voice: VoiceStudioViewModel
    @EnvironmentObject private var alarmStore: LocalAlarmStore
    @ObservedObject private var packs = VoicePackStore.shared
    @ObservedObject private var previewPlayer = VoicePackStore.shared.previewPlayer

    @State private var detailPackID: String?

    /// 그릴 행 — 카탈로그(지금 받을 수 있는 팩) + 카탈로그에 없지만 받아 둔 팩(게시 끝 · 이 빌드·지역에서 안 보임).
    private var rows: [VoicePackRowModel] {
        var out = packs.catalog.map { VoicePackRowModel(summary: $0, held: packs.heldPack(packID: $0.packId)) }
        for held in packs.held where !packs.catalog.contains(where: { $0.packId == held.packId }) {
            out.append(VoicePackRowModel(summary: nil, held: held))
        }
        return out
    }

    var body: some View {
        VoiceSectionCard(title: String(localized: "추가 팩")) {
            if rows.isEmpty {
                Text(String(localized: "준비 중인 추가 팩이 아직 없어요."))
                    .font(theme.typography.bodyMedium)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
            } else {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    if index > 0 {
                        Divider().overlay(theme.palette.outlineVariant).padding(.leading, 16)
                    }
                    VoiceCatalogRow(
                        name: row.speakerName,
                        subtitle: subtitle(for: row),
                        isPlaying: packs.previewingPackID == row.id && previewPlayer.isPlaying,
                        onOpenActions: { detailPackID = row.id },
                        onPreview: { preview(row) }
                    )
                }
            }
        }
        .task(id: auth.session?.user.id) {
            await packs.refreshCatalog(session: auth.session)
        }
        .sheet(item: Binding(
            get: { detailPackID.map(VoicePackSheetID.init) },
            set: { detailPackID = $0?.id }
        )) { sheet in
            VoicePackDetailSheet(packID: sheet.id)
                .environmentObject(auth)
                .environmentObject(voice)
                .environmentObject(alarmStore)
                .presentationDetents([.medium, .large])
        }
    }

    private func preview(_ row: VoicePackRowModel) {
        guard let summary = row.summary ?? row.held.map(VoicePackRowModel.summary(from:)) else { return }
        Task { await packs.togglePreview(summary, session: auth.session) }
    }

    private func subtitle(for row: VoicePackRowModel) -> String {
        [row.languageName, row.sizeText, VoicePackStatusText.text(for: row, store: packs)]
            .compactMap { $0?.nilIfBlank }
            .joined(separator: " · ")
    }
}

private struct VoicePackSheetID: Identifiable {
    let id: String
}

/// 한 행이 그리는 값. 카탈로그 요약과 받은 팩 중 있는 것으로 채운다.
struct VoicePackRowModel: Identifiable {
    let summary: VoicePackSummary?
    let held: HeldVoicePack?

    var id: String { summary?.packId ?? held?.packId ?? "" }
    var speakerName: String { summary?.speakerName ?? held?.speakerName ?? "" }
    var language: String { summary?.language ?? held?.language ?? "ko" }
    var totalBytes: Int { summary?.totalBytes ?? held?.totalBytes ?? 0 }

    var languageName: String? {
        Locale.current.localizedString(forLanguageCode: language)
    }

    var sizeText: String? {
        totalBytes > 0 ? ByteCountFormatter.string(fromByteCount: Int64(totalBytes), countStyle: .file) : nil
    }

    /// 받은 팩만 있을 때(게시가 끝났다) 미리듣기·상세가 쓰는 모양.
    static func summary(from held: HeldVoicePack) -> VoicePackSummary {
        VoicePackSummary(
            packId: held.packId,
            voiceId: held.voiceId,
            contentRevision: held.contentRevision,
            speakerName: held.speakerName,
            description: held.description,
            usageNote: held.usageNote,
            language: held.language,
            categories: Array(Set(held.clips.map(\.category))).sorted(),
            clipCount: held.clips.count,
            totalBytes: held.totalBytes,
            preview: held.previewClipId.map { VoicePackPreview(clipId: $0, sizeBytes: 0) },
            clips: held.clips
        )
    }
}

enum VoicePackStatusText {
    /// 행·상세가 함께 쓰는 상태 문구 — 받기 전(빈 값) / 받는 중 N% / 받음 / 실패 / 게시 끝.
    @MainActor
    static func text(for row: VoicePackRowModel, store: VoicePackStore) -> String? {
        guard let held = row.held else {
            return store.failedPackIDs.contains(row.id) ? String(localized: "받지 못했어요. 다시 시도해 주세요.") : nil
        }
        if let until = held.withdrawnPlaybackUntil {
            let date = until.formatted(.dateTime.month().day())
            return String(localized: "게시가 끝났어요. \(String(date))까지 기존 알람에서 울려요.")
        }
        if store.failedPackIDs.contains(held.packId), held.state != .ready {
            return String(localized: "받지 못했어요. 다시 시도해 주세요.")
        }
        switch held.state {
        case .ready:
            return String(localized: "받음")
        case .downloading:
            let percent = store.progress[held.packId]?.percent ?? 0
            return String(localized: "받는 중 \(Int(percent))%")
        }
    }
}

/// **팩 상세**(지시서 7.2) — 준비한 샘플, 사용 범위, 크기·다운로드 상태, 실제 적용 대상 설명, 받기/지우기.
struct VoicePackDetailSheet: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var voice: VoiceStudioViewModel
    @EnvironmentObject private var alarmStore: LocalAlarmStore
    @ObservedObject private var packs = VoicePackStore.shared
    @ObservedObject private var previewPlayer = VoicePackStore.shared.previewPlayer

    let packID: String

    @State private var deleteConfirmCount: Int?
    @State private var requesting = false

    private var row: VoicePackRowModel {
        VoicePackRowModel(
            summary: packs.catalog.first { $0.packId == packID },
            held: packs.heldPack(packID: packID)
        )
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(row.speakerName)
                    .font(theme.typography.titleLarge)
                    .fontWeight(.bold)
                    .foregroundStyle(theme.palette.onSurface)
                if let description = (row.summary?.description ?? row.held?.description)?.nilIfBlank {
                    Text(description)
                        .font(theme.typography.bodyMedium)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
                Button {
                    preview()
                } label: {
                    Label(
                        String(localized: "들어 보기"),
                        systemImage: packs.previewingPackID == packID && previewPlayer.isPlaying ? "stop.fill" : "speaker.wave.2.fill"
                    )
                    .font(theme.typography.labelLarge)
                }
                .buttonStyle(.bordered)
                .tint(theme.palette.primary)
                .disabled(packs.preparingPreviewPackID == packID)

                if let usage = (row.summary?.usageNote ?? row.held?.usageNote)?.nilIfBlank {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(String(localized: "사용 범위"))
                            .font(theme.typography.titleSmall)
                            .foregroundStyle(theme.palette.onSurface)
                        Text(usage)
                            .font(theme.typography.bodyMedium)
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                    }
                }
                Text([row.languageName, row.sizeText, VoicePackStatusText.text(for: row, store: packs)]
                    .compactMap { $0?.nilIfBlank }
                    .joined(separator: " · "))
                    .font(theme.typography.bodyMedium)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                Text(String(localized: "받으면 알람 목소리 목록에 이 목소리가 생겨요. 날씨·운세·응원·약 테마에 쓸 수 있고, 직접 입력에는 쓸 수 없어요. 이미 있는 알람은 바뀌지 않아요."))
                    .font(theme.typography.bodyMedium)
                    .foregroundStyle(theme.palette.onSurfaceVariant)

                actionButton
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(theme.palette.surface)
        .alert(
            String(localized: "이 팩을 지울까요?"),
            isPresented: Binding(get: { deleteConfirmCount != nil }, set: { if !$0 { deleteConfirmCount = nil } })
        ) {
            Button(String(localized: "지우기"), role: .destructive) {
                remove()
                deleteConfirmCount = nil
            }
            Button(String(localized: "닫기"), role: .cancel) { deleteConfirmCount = nil }
        } message: {
            Text(String(localized: "이 목소리를 쓰는 알람 \(Int(deleteConfirmCount ?? 0))개가 미나 목소리로 바뀌어요."))
        }
    }

    @ViewBuilder
    private var actionButton: some View {
        if row.held != nil {
            Button(role: .destructive) {
                let count = packs.alarmCount(usingPackID: packID, alarmStore: alarmStore)
                if count > 0 { deleteConfirmCount = count } else { remove() }
            } label: {
                Text(String(localized: "지우기"))
                    .font(theme.typography.labelLarge)
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.bordered)
        } else if let summary = row.summary {
            Button {
                requesting = true
                Task {
                    await packs.requestDownload(summary, session: auth.session)
                    requesting = false
                }
            } label: {
                Text(String(localized: "받기"))
                    .font(theme.typography.labelLarge)
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(theme.palette.primary)
            .disabled(requesting)
        }
    }

    private func preview() {
        guard let summary = row.summary ?? row.held.map(VoicePackRowModel.summary(from:)) else { return }
        Task { await packs.togglePreview(summary, session: auth.session) }
    }

    private func remove() {
        packs.remove(packID: packID, alarmStore: alarmStore, voiceStudio: voice)
        dismiss()
    }
}
