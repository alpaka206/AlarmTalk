import SwiftUI

/// 등록 직후 **'이 목소리로 저장할까요?'** 확인 스텝.
///
/// 안드로이드 `ui/voices/VoiceProfileManagementPanel.kt:1830-1968` 의 Preview 스텝.
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
/// 4. **목소리 높이는 지금 값을 끝까지 들어야 저장이 열린다.** 미리듣기는 이 기기가 메모리에서 굽고, 저장(등록
///    확정)하면 들은 높이가 요청에 한 번 실려 서버가 그 목소리의 알람 소리에 굽는다(스펙 voice-and-message §4-3).
struct VoicePreviewConfirmView: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var voice: VoiceStudioViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @EnvironmentObject private var subscriptions: SubscriptionManager
    /// 교체 확정 직후 **이 기기의** 직접 입력 알람을 곧바로 내리기 위해 든다.
    @EnvironmentObject private var alarmStore: LocalAlarmStore

    let draft: VoiceProfile
    /// 저장(승격) 완료 — 부모가 목록으로 돌린다.
    let onSaved: (String) -> Void
    /// 다시 만들기 — 부모가 등록 폼으로 되돌린다.
    let onDiscarded: () -> Void

    @State private var previewText: String = ""
    @State private var editing = false
    @State private var editDraft = ""
    @State private var saving = false
    @State private var busy = false
    /// 첫 미리듣기 요청이 끝났는지. 빈 문자열을 로딩과 실패로 구분한다.
    @State private var previewAttempted = false
    /// 미리듣기를 끝까지 들었는가. 문구를 고치면 `false` 로 되돌린다.
    @State private var listened = false
    @State private var errorMessage: String?
    /// 등록 확정 화면의 **교체 체크**. 이미 등록된 목소리가 있을 때만 보인다.
    @State private var replaceExisting = false
    /// 공유 여부는 초안 입력 단계가 아니라 실제로 저장하는 이 단계에서 고른다.
    @State private var isShared = false
    /// 뒤로 나가려 할 때 뜨는 경고. 이 화면을 벗어나면 초안이 삭제된다
    /// (안드로이드 `VoiceProfileManagementPanel.kt:2133` `draftExitWarningOpen`).
    @State private var exitWarningOpen = false

    // MARK: 목소리 높이(스펙 voice-and-message §4-3)
    /// 지금 슬라이더 값(목소리 높이) — 손을 떼면 그 높이로 구워 다시 들려주고, 저장하면 등록 확정 요청에
    /// 실린다(서버가 그 목소리로 만드는 모든 알람 소리에 굽는다).
    @State private var tuning: VoiceTuning = .neutral
    /// 자동 추천값. '추천값' 버튼이 이 값으로 되돌린다.
    @State private var suggestedTuning: VoiceTuning = .neutral
    /// 서버 미리듣기 재생에 실은 값 — 그 재생이 끝났을 때 슬라이더 값과 다르면 다시 튼다.
    @State private var servedTuning: VoiceTuning?
    /// **끝까지 들은** 높이 — 저장은 지금 슬라이더 값을 끝까지 들었을 때만 열리고, 이 값이 요청에 실린다(듣지 않은
    /// 값을 등록하지 않게, 첫 미리듣기의 '끝까지 들어야 저장' 과 같은 규칙 — Codex #870). 안드로이드 `heardTuning` 과 같다.
    @State private var heardTuning: VoiceTuning?
    /// 마지막으로 받은 미리듣기 클립(원래 소리) — 슬라이더를 놓으면 **서버 왕복 없이** 이걸 다시 굽고 튼다.
    @State private var previewAudioURL: URL?
    /// 등록 녹음 측정(원래 목소리 높이). 업로드하는 동안 잰 숫자다(`VoiceStudioViewModel.pendingDraftSourceMeasurement`).
    @State private var sourceMeasurement: VoiceTuningAnalyzer.Measurement?
    /// 높이를 바꾼 소리를 굽는 중인가(재생 버튼이 진행 표시로 바뀐다).
    @State private var renderingTuning = false
    /// 굽기 요청 세대 — 늦게 끝난 옛 굽기가 새 값의 재생을 덮지 않게.
    @State private var tuningGeneration = 0
    /// 이 화면이 떠났는가 — 떠난 뒤 끝난 준비(분석·굽기)가 소리를 내지 않게(`prepareTuning`).
    @State private var viewGone = false

    var body: some View {
        VStack(spacing: 0) {
            WakerTopBar(
                title: "목소리 만들기",
                onBack: { exitWarningOpen = true },
                backEnabled: !busy
            )
            .padding(.top, 18)

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(String(localized: "이 목소리로 저장할까요?"))
                        .font(theme.typography.titleMedium)
                        .fontWeight(.semibold)
                        .foregroundStyle(theme.palette.onSurface)

                    // 본문은 **교체일 때만** 한 줄이다(2026-09-29 지시). 이미 등록된 목소리가
                    // 있으면 저장은 교체 체크를 켜야만 열리므로(`actions` 의 `saveDisabled`),
                    // 이 화면에서의 저장은 곧 교체다 — 체크 여부로 가르지 않는다(체크할 때마다
                    // 맨 위 줄이 생겼다 사라지며 화면이 밀린다). 교체가 아니면 본문이 없다.
                    // 월 등록 한도 경고는 사용자 승인으로 뺐다. 안드로이드
                    // `ui/voices/VoiceProfileManagementPanel.kt` 의 `voices_confirm_replace_body` 와 같다.
                    if registeredVoice != nil {
                        Text(String(localized: "저장하면 이전 목소리는 삭제돼요."))
                            .font(theme.typography.bodyMedium)
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                    }

                    previewCard
                    Text(String(localized: "말투를 원하는 대로 바꿔 보세요."))
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)

                    tuningCard

                    if let errorMessage {
                        Text(errorMessage)
                            .font(theme.typography.bodySmall)
                            .foregroundStyle(theme.palette.error)
                    }

                    // ⚠ **공유할 수 없는 등급에는 이 칸을 아예 두지 않는다**(2026-09-17 지시).
                    // 개인 이용권은 혼자 쓰는 등급이라 공유가 성립하지 않는다 — 꺼진 스위치와
                    // "커플/가족에서 쓸 수 있어요" 안내를 등록 화면에 깔아 두면, 만들기 흐름
                    // 한복판에서 못 쓰는 기능부터 읽게 된다(같은 이유로 목소리 탭도 등급이
                    // 되는 사람에게만 공유 행을 보여 준다 — `VoiceProfileManagementPanel`).
                    if canShareVoice {
                        sharingSection
                    }
                    replaceConsent
                    Spacer(minLength: 4)
                }
                .padding(.horizontal, 20)
            }
            actions
        }
        .homeGradientBackground()
        .task {
            isShared = draft.isShared == true && canShareVoice
            startSourceMeasurement()
            // 문구는 합성 응답이 알려 준다(서버가 그때 확정한다) — 여기선 비워 두고
            // 첫 재생이 채운다. 들어보라고 만든 화면이니 들어오자마자 한 번 들려준다.
            await play()
        }
        // 화면을 떠나면 미리듣기를 끈다 — 끝까지 듣지 않은 재생은 청취로 기록되지 않는다.
        .onAppear { viewGone = false }
        .onDisappear {
            viewGone = true
            tuningGeneration += 1
            renderingTuning = false
            voice.tuningPreviewPlayer.stop()
        }
        .alert(String(localized: "나가면 임시 목소리가 삭제돼요"), isPresented: $exitWarningOpen) {
            Button(String(localized: "나가고 삭제"), role: .destructive) {
                Task { await discard() }
            }
            Button(String(localized: "계속 만들기"), role: .cancel) {}
        } message: {
            Text(String(localized: "지금 나가면 만들고 있던 목소리(초안)가 삭제되고, 처음부터 다시 만들어야 해요."))
        }
    }

    private var sharingSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(String(localized: "공유 설정"))
                .font(theme.typography.titleSmall)
                .fontWeight(.semibold)
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(String(localized: "가족·연인에게 공유 허용"))
                        .font(theme.typography.bodyMedium)
                        .fontWeight(.semibold)
                    Text(String(localized: "등록한 목소리를 가족·연인도 함께 사용할 수 있어요."))
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
                Spacer(minLength: 0)
                Toggle("", isOn: $isShared)
                    .labelsHidden()
                    .alarmTalkSwitch()
            }
            .disabled(busy)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(theme.palette.surfaceVariant.opacity(0.42))
            .outlinedButtonShape()
        }
    }

    private var canShareVoice: Bool {
        canShareVoiceWithOthers(
            subscriptionResponse: socialFeatures.subscription,
            familyGroup: socialFeatures.familyGroup,
            authSession: auth.session,
            storeTier: subscriptions.currentTier
        )
    }

    // MARK: - 미리듣기 카드

    private var previewCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            if editing {
                TextEditor(text: $editDraft)
                    .frame(minHeight: 72)
                    .font(theme.typography.bodyMedium)
                    .scrollContentBackground(.hidden)
                    .padding(10)
                    .background(theme.palette.surface.opacity(0.74))
                    .outlinedButtonShape()
                    .onChange(of: editDraft) { _, new in
                        // ⚠ **이 글자는 TTS 가 읽는다** — 제어문자·제로폭이 그대로 들어가면
                        // 낭독이 망가진다. 줄바꿈은 지우지 않고 공백으로 바꾼다(안드로이드
                        // `ui/voices/VoiceProfileManagementPanel.kt` 의 `confirmPreviewEditText`
                        // 와 같은 조합). 길이는 UTF-16 으로 세야 서버와 어긋나지 않는다.
                        let cleaned = InputSanitizer.clamp(
                            InputSanitizer.sanitizeUserText(new, allowNewlines: true),
                            max: 200
                        )
                        if cleaned != new { editDraft = cleaned }
                    }

                HStack(spacing: 8) {
                    Button(String(localized: "취소")) {
                        editing = false
                        editDraft = ""
                    }
                    .buttonStyle(.bordered)
                    .frame(maxWidth: .infinity)
                    .disabled(saving)

                    Button(saving ? String(localized: "재생성 중…") : String(localized: "재생성")) {
                        Task { await savePreviewText() }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(theme.palette.primary)
                    .frame(maxWidth: .infinity)
                    .disabled(saving || editDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            } else {
                HStack(spacing: 8) {
                    Text(previewDisplayText)
                        .font(theme.typography.bodyLarge)
                        .foregroundStyle(
                            previewText.isEmpty ? theme.palette.onSurfaceVariant : theme.palette.onSurface
                        )
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Button {
                        editDraft = previewText
                        editing = true
                    } label: {
                        Image(systemName: "pencil")
                            .frame(width: 36, height: 36)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .disabled(busy || previewText.isEmpty)
                    .accessibilityLabel(String(localized: "문구 수정"))

                    Button {
                        if localReplayPlaying {
                            voice.tuningPreviewPlayer.stop()
                        } else {
                            Task { await play() }
                        }
                    } label: {
                        if busy || renderingTuning {
                            ProgressView().frame(width: 36, height: 36)
                        } else {
                            Image(systemName: localReplayPlaying ? "stop.fill" : "play.fill")
                                .frame(width: 36, height: 36)
                        }
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(theme.palette.primary)
                    .disabled(busy || renderingTuning)
                    .accessibilityLabel(
                        localReplayPlaying ? String(localized: "정지") : String(localized: "다시 듣기")
                    )
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

    // MARK: - 목소리 높이

    /// 받아 둔 클립을 다시 트는 중인가(서버 미리듣기 재생 중은 `busy`).
    private var localReplayPlaying: Bool {
        !busy && voice.tuningPreviewPlayer.isPlaying
    }

    /// 목소리 높이 슬라이더 + '추천값'·'0으로'. 범위·눈금은 서버·안드로이드와 같다
    /// (`VoiceTuning.pitchRange`). 손을 떼면 그 높이로 구워(PSOLA — 몸집은 그대로) 처음부터 한 번 다시 튼다.
    /// 음량·굵기는 2026-10-07 에 뺐다 — 크기는 굽는 쪽이 원래 미리듣기와 같게 되맞춘다.
    private var tuningCard: some View {
        let label = Self.tuningValueText(tuning.pitchSt)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(String(localized: "목소리 높이"))
                    .font(theme.typography.titleSmall)
                    .fontWeight(.semibold)
                    .foregroundStyle(theme.palette.onSurface)
                Spacer(minLength: 8)
                Text(verbatim: label)
                    .font(theme.typography.bodyMedium)
                    .foregroundStyle(theme.palette.primary)
                    .monospacedDigit()
            }
            Text(String(localized: "목소리 몸집은 그대로 두고 높이만 바꿔요. 크기는 미리듣기와 같게 맞춰요. 저장하면 이 목소리로 울리는 모든 알람에 적용돼요."))
                .font(theme.typography.bodySmall)
                .foregroundStyle(theme.palette.onSurfaceVariant)
            Slider(
                value: Binding(
                    get: { tuning.pitchSt },
                    set: { tuning = VoiceTuning(pitchSt: $0, source: .user).normalized() }
                ),
                in: VoiceTuning.pitchRange,
                step: VoiceTuning.step,
                onEditingChanged: { editing in
                    if !editing { replayLocally() }
                }
            )
            .tint(theme.palette.primary)
            .accessibilityLabel(String(localized: "목소리 높이"))
            .accessibilityValue(label)
            HStack(spacing: 20) {
                tuningButton(String(localized: "추천값"), disabled: tuning.soundsSame(as: suggestedTuning)) {
                    applyTuning(suggestedTuning)
                }
                tuningButton(String(localized: "0으로"), disabled: tuning.isNeutral) {
                    applyTuning(VoiceTuning(pitchSt: 0, source: .user))
                }
                Spacer(minLength: 0)
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
        .disabled(saving)
    }

    private func tuningButton(_ title: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .font(theme.typography.labelLarge.weight(.semibold))
            .foregroundStyle(disabled ? theme.palette.onSurfaceVariant : theme.palette.primary)
            .buttonStyle(.plain)
            .disabled(saving || disabled)
    }

    /// "+3.5" / "−1.5" / "0" — 부호를 늘 보인다(안드로이드 `signedTuningValue` 와 같은 글자, 빼기는 U+2212).
    /// 숫자뿐이라 번역 대상이 아니다.
    static func tuningValueLabel(_ value: Double) -> String {
        guard value != 0 else { return "0" }
        return (value > 0 ? "+" : "\u{2212}") + String(format: "%.1f", abs(value))
    }

    /// 단위까지 붙인 값 — "−1.5 반음"(안드로이드 `voices_tuning_pitch_value`, 스펙 §4-3 제목 줄). 숫자만 두면 무슨 눈금인지
    /// 알 수 없다(Codex #870).
    static func tuningValueText(_ value: Double) -> String {
        String(localized: "\(tuningValueLabel(value)) 반음")
    }

    /// 버튼으로 값을 바꾼다 — 바로 그 높이로 다시 들려준다.
    private func applyTuning(_ next: VoiceTuning) {
        tuning = next
        replayLocally()
    }

    /// 받아 둔 미리듣기 클립을 **지금 높이로 메모리에서 구워** 서버 왕복 없이 처음부터 한 번 다시 튼다. 청취 기록(서버)과는
    /// 무관하다 — 끝까지 들으면 그 높이가 '들은 높이' 가 된다. 서버 미리듣기를 트는 중(`busy`)이면 끊지 않는다 — 끝까지
    /// 들어야 저장이 열리는 화면이다. 그때 바꾼 값은 그 재생이 끝난 뒤 다시 들려준다(`play`).
    @discardableResult
    private func replayLocally() -> Bool {
        guard !viewGone, !busy, !saving,
              let source = previewAudioURL,
              FileManager.default.fileExists(atPath: source.path) else { return false }
        voice.tuningPreviewPlayer.stop()
        voice.previewPlayer.stop()
        tuningGeneration += 1
        let generation = tuningGeneration
        let target = tuning
        renderingTuning = true
        Task {
            let tuned = await Self.bake(source, tuning: target)
            guard generation == tuningGeneration else { return }
            renderingTuning = false
            // 실제로 들려준 높이 — 굽지 못했거나 구운 소리를 못 틀어 원본을 틀었으면 0 이다(Codex #870).
            var heard = tuned == nil ? VoiceTuning.neutral : target
            let end = await voice.tuningPreviewPlayer.play(tuned: tuned, original: source) { heard = .neutral }
            switch end {
            case .finished: heardTuning = heard
            case .stopped: break
            // 원본도 못 틀었다 — 조용히 넘기면 버튼만 돌아오고 저장이 잠긴 채 남는다(Codex #870).
            case .failed: errorMessage = String(localized: "미리듣기를 재생하지 못했어요.")
            }
        }
        return true
    }

    /// 클립을 그 높이로 **메모리에서** 구운 소리(메인 밖). 원래 소리(0)거나 굽지 못하면 nil — 그때는 원본을 튼다.
    private static func bake(_ source: URL, tuning: VoiceTuning) async -> Data? {
        guard !tuning.isNeutral else { return nil }
        return await Task.detached(priority: .userInitiated) {
            VoiceTuningRenderer.previewWAV(source: source, tuning: tuning)
        }.value
    }

    /// 업로드하는 동안 잰 등록 녹음 높이(원래 목소리)를 가져온다. 초안과 짝이 맞을 때만.
    private func startSourceMeasurement() {
        guard sourceMeasurement == nil,
              let source = voice.pendingDraftSourceMeasurement,
              source.draftID == draft.id else { return }
        sourceMeasurement = source.measurement
    }

    /// 새 미리듣기 클립이 도착했다 — 재생 **전에** 재서 추천값을 정하고, 그 높이로 메모리에서 구운 소리를
    /// 돌려준다(재생이 처음부터 그 소리로 나간다). 사용자가 이미 슬라이더를 만졌으면 그 값을 덮지 않는다(추천값만 갱신).
    /// 화면을 떠났으면 `.cancelled` — 분석·굽기는 떼어 낸 작업이라 화면을 떠나도 끝까지 돌고, 그 뒤에 틀면 화면 밖에서
    /// 소리가 난다(Codex #870). 판정은 `viewGone`(떠날 때 켜지고 돌아오면 꺼진다).
    private func prepareTuning(for url: URL) async -> VoiceStudioViewModel.DraftPreviewAudio {
        guard !viewGone else { return .cancelled }
        previewAudioURL = url
        let preview = await Task.detached(priority: .userInitiated) {
            VoiceTuningAnalyzer.measure(url: url, maxSeconds: 30)
        }.value
        guard !viewGone else { return .cancelled }
        let suggestion = VoiceTuningAnalyzer.suggest(preview: preview, source: sourceMeasurement)
        suggestedTuning = suggestion
        if tuning.source == .suggested {
            tuning = suggestion
        }
        let target = tuning
        let tuned = await Self.bake(url, tuning: target)
        guard !viewGone else { return .cancelled }
        // 이 재생에 **실제로 실은** 값 — 재생 도중 슬라이더를 바꾸면 끝난 뒤 새 높이로 다시 튼다(`play`).
        servedTuning = tuned == nil ? .neutral : target
        return tuned.map { .tuned($0) } ?? .original
    }

    private var previewDisplayText: String {
        if !previewText.isEmpty { return "“\(previewText)”" }
        if busy || !previewAttempted { return String(localized: "문구를 준비하고 있어요…") }
        return String(localized: "문구를 아직 준비하지 못했어요. 미리듣기를 눌러 다시 시도해 주세요.")
    }

    /// 이미 등록된 **내** 목소리(이 초안 제외). 있으면 저장이 한도에 걸리므로
    /// 교체 체크를 낸다.
    private var registeredVoice: VoiceProfile? {
        voice.profiles.first { profile in
            profile.id != draft.id
                && profile.isDraft != true
                && profile.isSystem != true
                && normalizedStatus(profile.status) != "failed"
        }
    }

    private func normalizedStatus(_ value: String?) -> String {
        (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// 교체 안내 + 체크. **이미 등록된 목소리가 있을 때만** 낸다 — 없으면 그냥 저장되고,
    /// 체크를 보여 줄 이유가 없다.
    ///
    /// ⚠ 문구가 곧 계약이다. 체크하면 실제로 이 두 가지가 일어난다:
    ///   - 이전 목소리는 목록에서 사라진다(서버는 그 행을 지우지 않고 **재사용**한다 —
    ///     지우면 그 목소리를 쓰던 알람이 전부 기본 목소리(미나)로 바뀌기 때문이다).
    ///   - 직접 입력 문구로 만든 알람만 기본 목소리(미나)로 바뀐다(그 음성은 옛 목소리로 만들어
    ///     둔 것이라 자동 재생성이 안 된다). 나머지 알람은 그대로 살아 새 목소리로 운다.
    @ViewBuilder
    private var replaceConsent: some View {
        if let registeredVoice {
            Button {
                replaceExisting.toggle()
            } label: {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: replaceExisting ? "checkmark.square.fill" : "square")
                        .font(.title3)
                        .foregroundStyle(replaceExisting ? theme.palette.primary : theme.palette.onSurfaceVariant)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(String(localized: "‘\(registeredVoice.name)’ 대신 이 목소리를 써요"))
                            .font(theme.typography.bodyMedium)
                            .fontWeight(.semibold)
                            .foregroundStyle(theme.palette.onSurface)
                        Text(String(localized: "이전에 저장한 목소리는 삭제돼요. 직접 입력 문구로 만든 알람도 기본 목소리로 바뀌어요."))
                            .font(theme.typography.bodySmall)
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                    }
                    Spacer(minLength: 0)
                }
                .multilineTextAlignment(.leading)
                .padding(14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .background(
                theme.palette.surface,
                in: RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                    .stroke(
                        replaceExisting ? theme.palette.primary : theme.palette.outlineVariant,
                        lineWidth: 1
                    )
            )
            .disabled(busy)
        }
    }

    /// 하단 액션 — **'다시 만들기'(보조) · '저장하기'(주)** 두 버튼의 크기를 정확히 같게
    /// 그린다(2026-09-19 지시).
    ///
    /// ⚠ **시스템 버튼 스타일을 섞지 말 것.** `.borderedProminent` 는 자기 여백·높이를
    ///   따로 갖고 있어서, 옆의 `.plain` 버튼과 같은 `minHeight` 를 줘도 실제로는 다르게
    ///   그려진다(실기기에서 두 번 어긋났다). 그래서 **둘 다 `.plain`** 으로 두고 배경·
    ///   테두리·높이를 이 파일에서 직접 같은 값으로 그린다 — 다른 것은 **색뿐**이다.
    private var actions: some View {
        // ⚠ **폭을 SwiftUI 분배에 맡기지 않는다**(2026-09-19 실기기: 높이도 폭도 어긋났다).
        //   `maxWidth: .infinity` 는 글자 길이에 따라 두 버튼이 다르게 나뉠 수 있다.
        //   남은 폭에서 간격을 빼고 **반으로 나눈 값**을 두 버튼에 그대로 준다.
        GeometryReader { geo in
            let gap: CGFloat = 10
            let each = max((geo.size.width - gap) / 2, 0)
            HStack(spacing: gap) {
                actionButton(
                title: "다시 만들기",
                foreground: theme.palette.error,
                    background: theme.palette.surface,
                    border: theme.palette.outlineVariant,
                    width: each,
                    disabled: busy
                ) { Task { await discard() } }

            // ⚠ **끝까지 듣기 전에는 저장할 수 없다.** 서버도 재생 토큰 없이는 승격을
            // 거부하므로, 여기서 열어 두면 눌러도 실패하는 버튼이 된다.
            //
            // ⚠ 이미 등록된 목소리가 있으면 **교체에 동의해야** 저장이 열린다. 서버가
            // 어차피 `VOICE_LIMIT_REACHED` 로 막으므로, 열어 두면 눌러도 실패하는
            // 버튼이 된다 — 무엇을 해야 저장되는지도 알 수 없다.
                // ⚠ **지금 높이를 끝까지 들어야** 저장이 열린다 — 바꾼 높이를 굽거나 트는 중에 저장하면 듣지 않은
                // 값이 등록되어 그 목소리의 모든 알람에 구워진다(Codex #870).
                let heardCurrentTuning = heardTuning.map { tuning.soundsSame(as: $0) } ?? false
                let saveDisabled = busy || !listened || renderingTuning || !heardCurrentTuning
                    || (registeredVoice != nil && !replaceExisting)
                actionButton(
                    title: saving ? "저장 중…" : "저장하기",
                    foreground: theme.palette.onPrimary,
                    background: saveDisabled
                        ? theme.palette.primary.opacity(0.4)
                        : theme.palette.primary,
                    border: .clear,
                    width: each,
                    disabled: saveDisabled
                ) { Task { await promote() } }
            }
        }
        // GeometryReader 는 높이를 스스로 정하지 못한다 — 버튼 높이로 고정한다.
        .frame(height: Self.actionButtonHeight)
        .padding(.horizontal, 20)
        .padding(.top, 10)
        .padding(.bottom, 16)
    }

    /// 하단 버튼 높이. 두 버튼이 **같은 값**을 쓰는 유일한 출처다.
    private static let actionButtonHeight: CGFloat = 52

    /// 두 하단 버튼이 **같은 자로** 그려지도록 모양을 한 곳에 둔다(위 주석 참조).
    private func actionButton(
        title: LocalizedStringKey,
        foreground: Color,
        background: Color,
        border: Color,
        width: CGFloat,
        disabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(title)
                .font(theme.typography.bodyMedium.weight(.semibold))
                .foregroundStyle(foreground)
                // 글자가 길어도 상자를 넓히지 않는다 — 두 버튼이 같은 폭이어야 한다.
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(width: width, height: Self.actionButtonHeight)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(
            background,
            in: RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                .stroke(border, lineWidth: 1)
        )
        .disabled(disabled)
    }

    // MARK: - 동작

    private func play() async {
        guard !busy else { return }
        // 이미 끝까지 들은 문구면 **받아 둔 클립을 다시 튼다** — 높이를 바꿔 가며 비교하는 자리라
        // 누를 때마다 합성을 기다리게 하지 않는다. 문구를 고치면 `listened` 가 풀려 아래 서버 경로로
        // 새 클립을 받는다.
        if listened, replayLocally() { return }
        busy = true
        errorMessage = nil
        let outcome = await voice.playDraftPreview(
            draft: draft,
            session: auth.session,
            // 소리가 나기 시작할 때 글자도 같이 보인다(2026-09-19 지시).
            onTextReady: { text in previewText = text },
            prepareAudio: { url in await prepareTuning(for: url) },
            // 구운 소리를 못 틀어 원본을 틀었다 — 들은 것은 0 이다(Codex #870).
            onPlayingOriginalInstead: { servedTuning = .neutral }
        )
        busy = false
        previewAttempted = true
        switch outcome {
        case .played(let text):
            if !text.isEmpty { previewText = text }
            listened = true
            heardTuning = servedTuning
            // 서버 미리듣기 도중(끊지 않는다) 높이를 바꿨으면 이제 새 높이로 들려준다 — 안 그러면 들어 보지
            // 않은 값을 저장하게 된다(Codex #870). 확인을 기다리는 사이 화면을 떠났으면 다시 틀지 않는다.
            if !viewGone, let served = servedTuning, !tuning.soundsSame(as: served) {
                replayLocally()
            }
        case .failed(let message):
            errorMessage = message
        case .interrupted:
            break
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
            heardTuning = nil
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
            let promoted = try await AlarmTalkAPI.shared.promoteVoiceDraft(
                id: draft.id,
                token: token,
                replaceExisting: replaceExisting,
                isShared: isShared && canShareVoice,
                // **끝까지 들은** 높이를 한 번 싣는다(저장은 지금 값을 들었을 때만 열린다). 교체 등록도 같다 — 서버는
                // 옛 목소리의 높이를 물려주지 않고 이 값으로 덮어쓴다(스펙 §4-3). 0 이면 키가 나가지 않는다.
                pitchSemitones: heardTuning?.normalized().pitchSt
            )
            voice.tuningPreviewPlayer.stop()
            // ⚠ **교체한 기기에서 곧바로 내린다.** 교체는 옛 프로필 행을 그대로 재사용하므로
            // (id 가 같다) 어떤 접근권 재확인으로도 이 알람들은 잡히지 않는다 — 놔두면 바로
            // 위에서 "직접 입력으로 해둔 알람들도 기본 알람으로 설정됩니다" 를 읽고 체크한
            // 그 기기에서 **지운 목소리가 계속 울린다**(Codex #703 P1). 다른 기기는 서버의
            // voice_access_revoked(voiceProfileId 동봉)가 깨운다.
            // 프리셋 알람은 건드리지 않는다 — 서버가 같은 message id 로 새 목소리를 다시 만든다.
            if replaceExisting {
                // 이 화면에서 이미 동의를 받았으므로 대기표(모달)는 남기지 않는다.
                // `degrade` 가 세우는 `needsScheduleReconcile` 을 `AlarmTalkApp` 이 받아
                // AlarmKit 예약(구워 둔 .caf)까지 맞춘다.
                // ⚠ **강등과 표식 확정을 함께 한다.** 새로고침이 우연히 해 주기를 기다리지
                // 않는다(안드로이드에는 그 우연이 없다 — 두 앱이 같은 자리에서 같은 일을 한다).
                // 표식이 옛 값이면 곧바로 **새 목소리로** 만든 알람을 뒤늦은 푸시나 다음
                // 새로고침이 '아직 안 내린 교체' 로 보고 되돌릴 수 없이 지운다.
                let pending = VoiceReplacementMarkerStore().applyIfNotApplied(
                    userID: auth.session?.user.id,
                    profileID: promoted.id,
                    invalidatedAt: promoted.customAudioInvalidatedAt
                ) {
                    let ids = voice.degradeCustomMessageAlarms(
                        forProfileID: promoted.id,
                        alarmStore: alarmStore,
                        audioCache: .shared,
                        ownerUserId: auth.session?.user.id
                    )
                    // 디스크에 남은 뒤에만 확정 후보가 된다 — 안 그러면 다음 실행이 옛 알람을
                    // 다시 읽는데 표식만 앞서 나가 영영 다시 내리지 않는다.
                    return alarmStore.saveNow() ? ids : nil
                }
                // ⚠ **예약까지 맞춘 뒤에 확정한다.** `degrade` 는 로컬 행만 고치고, 울리는
                // 것은 이미 구워 둔 예약이다 — 여기서 확정해 버리면 재예약이 실패했을 때
                // 다음 회차가 같은 세대를 건너뛰어 회수된 목소리가 예약된 채 남는다.
                let deps = BackgroundDependencies.shared
                _ = await AlarmScheduleReconciler.reconcile(
                    store: alarmStore,
                    alarmKit: deps.alarmKit,
                    ownerUserId: auth.session?.user.id
                )
                // ⚠ **프리셋 재렌더가 끝나야 이 세대를 확정한다**(Codex #703 P1).
                // 교체 트랜잭션은 세대를 커밋하고 프리셋 재렌더는 **큐에만 넣는다**
                // (`replaceVoiceInPlace`) — 실제 굽기는 cron 이 나중에 한다. 그런데 여기서
                // 확정해 버리면 권위 새로고침의 `guard` 가 '바뀐 것 없음' 으로 접어
                // **프리셋 수리 자체를 건너뛴다**(`onAuthoritativeRefresh`). 완료 푸시를 놓친
                // 기기에서는 기존 프리셋 알람이 회수된 옛 목소리로 계속 운다.
                //
                // 판정은 푸시 경로와 **철자까지 같다** — 한쪽만 고치면 다시 갈라진다.
                let manifestFresh = await voice.loadStockClips(session: auth.session, force: true)
                let presetRefresh = await voice.refreshChangedCachedStockClips(session: auth.session)
                let presetPending = !manifestFresh
                    || !presetRefresh.settled(forProfileID: promoted.id)
                if presetPending {
                    // ⚠ **확정하지 않는다.** 표식이 그대로라 아래 `voice.refresh(force:)` 의
                    // 권위 훅이 같은 세대를 다시 집고, 재렌더가 끝난 회차에 확정·해제한다.
                    //
                    // ⚠ **실패 문구를 쓰지 말 것** — 이건 정상적인 대기다. 사용자는 곧바로
                    // 준비 화면(`ClipPreparationView`)으로 넘어가고 그 화면이 진행률을 말한다.
                    voice.suppressReplacedProfile(promoted.id)
                } else {
                    let cleaned = await deps.confirmIfReservationsSettled(
                        pending,
                        ownerID: auth.session?.user.id
                    )
                    if !cleaned {
                        // ⚠ **정리가 끝나지 않았으면 이 목소리를 아직 고를 수 없게 둔다**
                        // (안드로이드 승격 경로와 같다). 고를 수 있게 두면 그 사이 만든 새
                        // 알람을 다음 회차가 함께 지운다 — 강등 대상은 프로필 id 로만
                        // 고르기 때문이다. 다음 새로고침이 정리를 마치면 곧바로 풀린다.
                        voice.suppressReplacedProfile(promoted.id)
                        voice.statusMessage =
                            String(localized: "목소리는 바뀌었지만 기존 알람 정리를 끝내지 못했어요. 목소리 탭을 새로고침해 주세요.")
                    }
                }
            }
            await voice.refresh(session: auth.session, force: true)
            // 교체 갈래는 draft id 가 아니라 기존 공식 프로필 id 를 반환한다. 준비 페이지가
            // 삭제된 draft 를 기다리지 않도록 서버가 돌려준 실제 id 를 넘긴다.
            onSaved(promoted.id)
        } catch {
            errorMessage = voice.mapVoiceError(error)
        }
    }

    private func discard() async {
        guard let token = auth.session?.token else { return }
        voice.tuningPreviewPlayer.stop()
        busy = true
        defer { busy = false }
        // 실패해도 되돌아간다 — 초안은 서버가 정리하고, 여기 갇히는 게 더 나쁘다.
        try? await AlarmTalkAPI.shared.deleteVoiceDraft(id: draft.id, token: token)
        await voice.refresh(session: auth.session, force: true)
        onDiscarded()
    }
}
