import SwiftUI

/// 등록 직후 **'이 목소리로 저장할까요?'** 확인 스텝.
///
/// 안드로이드 `ui/voices/VoiceProfileManagementPanel.kt:1838-1976` 의 Preview 스텝.
///
/// ⚠ **iOS 에는 이 스텝이 통째로 없었다.** 등록이 성공하면 곧바로 목록으로 돌아가,
/// 사용자는 자기 목소리가 어떻게 들리는지 **한 번도 못 들어보고** 이번 달 등록 횟수를
/// 써 버렸다. 서버도 이 흐름을 전제한다 — 클론은 `is_draft=true` 로 만들어지고,
/// 여기서 승격(`PATCH is_draft=false`)해야 정식 프로필이 된다.
///
/// 규칙 셋:
/// 1. **끝까지 들어야 저장이 열린다.** 서버가 준 재생 토큰을 `preview-played` 로
///    돌려줘야 승격이 허용된다 — 안 듣고 저장하는 걸 막는 장치다.
/// 2. **문구를 고치면 다시 잠긴다.** 서버가 `previewed_at` 을 리셋하므로 새 문구로
///    다시 들어야 한다(고친 문구는 안 들어본 문구다).
/// 3. **'다시 만들기' 는 초안을 지운다.** 정식 프로필이 아니라 draft 라 지워도 이번 달
///    등록 횟수가 차감되지 않는다 — 그래서 마음에 들 때까지 다시 만들 수 있다.
struct VoicePreviewConfirmView: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var voice: VoiceStudioViewModel

    let draft: VoiceProfile
    /// 저장(승격) 완료 — 부모가 목록으로 돌린다.
    let onSaved: () -> Void
    /// 다시 만들기 — 부모가 등록 폼으로 되돌린다.
    let onDiscarded: () -> Void

    @State private var previewText: String = ""
    @State private var editing = false
    @State private var editDraft = ""
    @State private var saving = false
    @State private var busy = false
    /// 미리듣기를 끝까지 들었는가. 문구를 고치면 `false` 로 되돌린다.
    @State private var listened = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("이 목소리로 저장할까요?")
                .font(theme.typography.titleMedium)
                .fontWeight(.semibold)
                .foregroundStyle(theme.palette.onSurface)

            Text("저장하면 이번 달에 만들 수 있는 목소리를 다 쓰게 돼요. 지워도 다음 달까지는 새로 만들 수 없으니, 마음에 들지 않으면 저장하기 전에 다시 만들어 보세요.")
                .font(theme.typography.bodyMedium)
                .foregroundStyle(theme.palette.onSurfaceVariant)

            previewCard

            if let errorMessage {
                Text(errorMessage)
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.error)
            }

            actions
        }
        .padding(.vertical, 4)
        .task {
            // 문구는 합성 응답이 알려 준다(서버가 그때 확정한다) — 여기선 비워 두고
            // 첫 재생이 채운다. 들어보라고 만든 화면이니 들어오자마자 한 번 들려준다.
            await play()
        }
    }

    // MARK: - 미리듣기 카드

    private var previewCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            if editing {
                TextEditor(text: $editDraft)
                    .frame(minHeight: 72)
                    .font(theme.typography.bodyMedium)
                    .scrollContentBackground(.hidden)
                    .background(theme.palette.surfaceVariant.opacity(0.4))
                    .clipShape(RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous))
                    .onChange(of: editDraft) { _, new in
                        if new.count > 200 { editDraft = String(new.prefix(200)) }
                    }

                HStack(spacing: 8) {
                    Button("취소") {
                        editing = false
                        editDraft = ""
                    }
                    .buttonStyle(.bordered)
                    .frame(maxWidth: .infinity)
                    .disabled(saving)

                    Button(saving ? "저장 중…" : "이 문구로 다시 듣기") {
                        Task { await savePreviewText() }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(theme.palette.primary)
                    .frame(maxWidth: .infinity)
                    .disabled(saving || editDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            } else {
                Text(previewText.isEmpty ? "미리듣기 문구를 불러오는 중이에요." : previewText)
                    .font(theme.typography.bodyMedium)
                    .foregroundStyle(theme.palette.onSurface)
                    .frame(maxWidth: .infinity, alignment: .leading)

                HStack(spacing: 12) {
                    Button {
                        Task { await play() }
                    } label: {
                        Label("다시 듣기", systemImage: "play.fill")
                    }
                    .buttonStyle(.bordered)
                    .disabled(busy)

                    Button {
                        editDraft = previewText
                        editing = true
                    } label: {
                        Label("문구 수정", systemImage: "pencil")
                    }
                    .buttonStyle(.bordered)
                    .disabled(busy || previewText.isEmpty)

                    Spacer(minLength: 0)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            theme.palette.surface,
            in: RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                .stroke(theme.palette.outlineVariant, lineWidth: 1)
        )
    }

    private var actions: some View {
        HStack(spacing: 8) {
            Button("다시 만들기") {
                Task { await discard() }
            }
            .buttonStyle(.bordered)
            .frame(maxWidth: .infinity)
            .disabled(busy)

            Button(saving ? "저장 중…" : "저장하기") {
                Task { await promote() }
            }
            .buttonStyle(.borderedProminent)
            .tint(theme.palette.primary)
            .frame(maxWidth: .infinity)
            // ⚠ **끝까지 듣기 전에는 저장할 수 없다.** 서버도 재생 토큰 없이는 승격을
            // 거부하므로, 여기서 열어 두면 눌러도 실패하는 버튼이 된다.
            .disabled(busy || !listened)
        }
    }

    // MARK: - 동작

    private func play() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        errorMessage = nil
        let outcome = await voice.playDraftPreview(draft: draft, session: auth.session)
        switch outcome {
        case .played(let text):
            if !text.isEmpty { previewText = text }
            listened = true
        case .failed(let message):
            errorMessage = message
        }
    }

    private func savePreviewText() async {
        guard let token = auth.session?.token else { return }
        let text = editDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        saving = true
        defer { saving = false }
        do {
            previewText = try await AlarmTalkAPI.shared.updateVoicePreviewText(
                id: draft.id,
                previewText: text,
                token: token
            )
            editing = false
            editDraft = ""
            // 서버가 previewed_at 을 지웠다 — 새 문구는 안 들어본 문구다.
            listened = false
            await play()
        } catch {
            errorMessage = voice.mapVoiceError(error)
        }
    }

    private func promote() async {
        guard let token = auth.session?.token else { return }
        saving = true
        busy = true
        defer { saving = false; busy = false }
        do {
            _ = try await AlarmTalkAPI.shared.promoteVoiceDraft(id: draft.id, token: token)
            await voice.refresh(session: auth.session, force: true, successMessage: nil)
            voice.statusMessage = "목소리를 저장했어요."
            onSaved()
        } catch {
            errorMessage = voice.mapVoiceError(error)
        }
    }

    private func discard() async {
        guard let token = auth.session?.token else { return }
        busy = true
        defer { busy = false }
        // 실패해도 되돌아간다 — 초안은 서버가 정리하고, 여기 갇히는 게 더 나쁘다.
        try? await AlarmTalkAPI.shared.deleteVoiceDraft(id: draft.id, token: token)
        await voice.refresh(session: auth.session, force: true, successMessage: nil)
        onDiscarded()
    }
}
