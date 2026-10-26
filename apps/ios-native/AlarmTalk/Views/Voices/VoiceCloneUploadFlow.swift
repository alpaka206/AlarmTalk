import AVFoundation
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// 등록 음원의 갈래 — 녹음 또는 고른 파일. 회귀 테스트가 `VoiceCloneUploadFlow.sentSourceCleanup` 을 부르도록 파일 밖에 연다.
enum VoiceCloneSourceMode: String, CaseIterable, Identifiable {
    case record
    case file

    var id: String { rawValue }

    var label: String {
        switch self {
        case .record: return String(localized: "녹음")
        case .file: return String(localized: "파일")
        }
    }
}

extension VoiceCloneUploadFlow {
    /// 등록 창의 단계 — 흔한 이름이라 모듈 맨 위가 아니라 이 화면 안에 둔다.
    enum RegistrationStep: Sendable {
        case source
        case details
        case creating
    }

    /// 가져온 파일의 사본을 두는 폴더(캐시 아래, `copyImportedAudio`). 등록 음원 정리(`sentSourceCleanup`)가 지우는
    /// 것은 이 폴더와 잘라 낸 사본 폴더(`AudioCropper.outputFolderName`)의 파일뿐이다.
    nonisolated static let importFolderName = "VoiceImports"

    /// 본문 맨 위 — 음원 준비로 돌려보낼 때 여기로 올린다(`rerecordReason`).
    private static let contentTopID = "voice-clone-content-top"
}

/// 녹음/파일 선택 → 세부 정보 → 생성 중 워크플로우.
///
/// Android `VoiceProfileManagementPanel.VoiceRegistrationStep` 의 Source/Details/Creating 을
/// SwiftUI 화면으로 분리한 것. 이후 Preview/Prerendering 은 `VoicesRoute` 가 잇는다.
struct VoiceCloneUploadFlow: View {
    @State private var didBeginCreation = false
    @Environment(\.voiceAlarmTheme) private var theme
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var voice: VoiceStudioViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @EnvironmentObject private var subscriptions: SubscriptionManager

    @Binding var route: VoicesRoute

    @State private var registrationStep: RegistrationStep = .source
    @State private var sourceMode: VoiceCloneSourceMode = .record
    @State private var profileName: String = ""
    @State private var relationshipSelection = VoiceRelationshipSelection()
    /// Android 생성 플로우처럼 이 목소리가 나를 부를 호칭을 함께 저장한다.
    @State private var listenerTitle: String = ""
    @State private var previewLanguage: String = VoiceStudioViewModel.appVoiceLanguage()
    @State private var submitted: Bool = false
    /// 음성 생체정보 동의 인라인 체크. 가입 화면에서 **거절한 사람에게만** 뜬다
    /// (`auth.consentSensitiveMissing`). 한 번 동의하면 서버 기록이 남아 다시 보이지 않는다.
    @State private var voiceBiometricAgreed: Bool = false
    @State private var fileImporterPresented: Bool = false
    @State private var selectedFileURL: URL?
    @State private var selectedFileName: String?
    @State private var selectedFileDurationMs: Int?
    @State private var cropStartMs: Int = 0
    @State private var cropEndMs: Int = VoiceProfileLimits.maxDurationMs
    @State private var localError: String?
    /// 말소리가 없다고 돌려받아 음원 준비로 돌아온 이유(`SubmitOutcome.rerecordForNoSpeech`) — 그 단계의 거절 줄
    /// (`rerecordReasonLine`)이 그린다. 뷰모델의 안내 줄(`statusMessage`)이 아니라 **이 창의 상태**다 — 창과 함께
    /// 사라져 목소리 탭 맨 위나 다음 창의 빈 녹음 카드 아래에 남지 않는다. 새로 녹음하기 시작하거나, 파일을 새로
    /// 고르거나, 방식을 바꾸면 걷힌다 — 그 이유는 앞 소리의 이야기다.
    /// 안드로이드 `VoiceProfileManagementPanel` 의 `rerecordReason` 과 같은 규칙이다.
    @State private var rerecordReason: String?
    /// 방금 멈춘 녹음의 품질 판정이 도는 중인가(디코딩 — 길어도 1초 남짓). 그동안 `다음` 을 잠근다.
    @State private var recordingAnalyzing = false
    /// 권장 안내·끼어듦·복구한 녹음 — '그래도 쓰기' / '다시 녹음' 을 묻는 알럿(스펙 voice-and-message §4-1
    /// 「녹음 품질 판정」). 확정 사유는 묻지 않고 거절 줄(`rerecordReason`)에 쓴다. 안드로이드 `recordingReview` 짝.
    @State private var recordingReview: RecordingReview?
    @State private var scriptExpanded = false
    /// 선제 동의 시트를 띄우느라 멈춘 등록이 있는가 — 동의가 기록되면 **그 자리에서 이어서**
    /// 등록한다. 안드로이드의 `SensitiveConsentRequest.resumeVoiceDrafts` 대응이다.
    @State private var resumeSubmitAfterConsent = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var activeDurationMs: Int {
        switch sourceMode {
        case .record:
            return voice.recorder.latestDurationMs ?? Int(voice.recorder.elapsedSeconds * 1000)
        case .file:
            return cropDurationMs
        }
    }

    private var cropDurationMs: Int {
        max(0, cropEndMs - cropStartMs)
    }

    /// 12~120초 구간 검증. 상단은 Android 처럼 5초 허용 오차를 둬 120.x초 측정값도 받아들인다.
    private var isInValidRange: Bool {
        activeDurationMs >= VoiceProfileLimits.minDurationMs
            && activeDurationMs <= VoiceProfileLimits.maxDurationMs + VoiceProfileLimits.maxDurationToleranceMs
    }

    private var hasPreparedSource: Bool {
        switch sourceMode {
        case .record:
            return voice.recorder.latestRecordingURL != nil
        case .file:
            return selectedFileURL != nil && selectedFileDurationMs != nil
        }
    }

    /// 가입 때 음성 생체정보를 거절해 **여기서 다시 받아야 하는** 상태인가.
    private var needsBiometricConsent: Bool {
        auth.consentSensitiveMissing.contains("voice_biometric")
    }

    /// 이 화면의 **인라인 체크박스가 실제로 묻는** 유형. 여기 없는 유형은 그 체크로 기록하면
    /// 안 되고(본 적 없는 동의가 기록된다), 전용 시트로 따로 물어야 한다.
    /// 안드로이드 짝은 `MainViewModelVoiceActions.INLINE_COVERED_CONSENTS`.
    private static let inlineCoveredConsents: Set<String> = ["voice_biometric"]

    /// 인라인이 덮지 못하는, 아직 없는 민감 동의(보통 국외 이전 — 가입 필수라 대개 비어 있다).
    private var unaskedSensitiveConsents: [String] {
        auth.consentSensitiveMissing.filter { !Self.inlineCoveredConsents.contains($0) }
    }

    /// 등록을 눌러도 되는지 — **법정 동의만** 본다.
    private var registrationConsentSatisfied: Bool {
        Self.registrationConsentSatisfied(
            statusChecked: auth.consentStatusChecked,
            needsBiometric: needsBiometricConsent,
            biometricAgreed: voiceBiometricAgreed
        )
    }

    /// 위 판정의 순수 함수 형태 — 회귀 테스트가 이걸 고정한다.
    ///
    /// ⚠ **권리 보증 확인(attestation)은 여기 없다.** 그 내용은 약관 제7조가 이미 담고
    /// 있고(「본인의 목소리 또는 적법한 권한과 명시적 동의를 받은 사람의 목소리만 등록할 수
    /// 있습니다」·「권한 없는 음성 등록으로 발생하는 책임은 해당 이용자가 부담합니다」),
    /// 약관은 가입 필수 동의라 이미 받았다. 등록마다 체크박스로 다시 받는 것은 계약상
    /// 중복이었다. 화면에는 **비차단 안내**로 남겨 업로드 시점 고지만 유지한다.
    ///
    /// ⚠ **`statusChecked` 를 빼지 말 것.** 동의 상태 응답 전에는 `needsBiometric` 이
    /// 항상 false 라, 거절한 사람에게 체크박스가 안 그려진 채 제출이 열려 403 을 맞는다.
    static func registrationConsentSatisfied(
        statusChecked: Bool,
        needsBiometric: Bool,
        biometricAgreed: Bool
    ) -> Bool {
        statusChecked && (!needsBiometric || biometricAgreed)
    }

    private var canSubmit: Bool {
        !voice.isBusy
            && !voice.recorder.isRecording
            && canCreateVoice
            && hasPreparedSource
            && isInValidRange
            && registrationConsentSatisfied
    }

    private var canAdvanceFromSource: Bool {
        !voice.isBusy && !voice.recorder.isRecording && hasPreparedSource && isInValidRange
            && !(sourceMode == .record && recordingAnalyzing)
    }

    private var topBarBackAction: (() -> Void)? {
        guard registrationStep != .creating else { return nil }
        return { goBack() }
    }

    var body: some View {
        VStack(spacing: 0) {
            WakerTopBar(
                title: "목소리 만들기",
                onBack: topBarBackAction,
                backEnabled: !voice.isBusy
            )
            .padding(.top, 18)

            ScrollViewReader { scroll in
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        switch registrationStep {
                        case .source:
                            sourceSection
                        case .details:
                            detailsSection
                        case .creating:
                            creatingSection
                        }
                        statusSection
                        Spacer(minLength: 4)
                    }
                    .padding(.horizontal, 20)
                    .id(Self.contentTopID)
                }
                // 음원 준비로 돌려보낸 이유(`rerecordReason`)는 녹음 카드·파일 고르기 바로 아래 — 본문 **위쪽**이다. 본문을
                // 맨 위로 올려 그 줄과 녹음 버튼이 함께 보이게 한다. 단계들이 스크롤 하나를 같이 써서 세부 정보 단계에서 내려
                // 둔 위치가 남을 수 있다(글자를 키운 기기에서는 그 위치가 이 줄을 화면 밖에 둔다). 안드로이드
                // `VoiceProfileManagementPanel` 의 `LaunchedEffect(rerecordReason)` 과 같다. 걷힐 때(nil)는 움직이지 않는다.
                .onChange(of: rerecordReason) { _, reason in
                    guard reason != nil else { return }
                    withAnimation(reduceMotion ? nil : .snappy(duration: 0.25)) {
                        scroll.scrollTo(Self.contentTopID, anchor: .top)
                    }
                }
            }

            bottomActions
        }
        .homeGradientBackground()
        .onAppear {
            guard !didBeginCreation else { return }
            didBeginCreation = true
            voice.beginVoiceCreation()
            profileName = ""
        }
        .fileImporter(
            isPresented: $fileImporterPresented,
            allowedContentTypes: VoiceImportContentTypes.profileTraining,
            allowsMultipleSelection: false
        ) { result in
            switch result {
            case .success(let urls):
                guard let source = urls.first else { return }
                Task { await importAudioFile(source) }
            case .failure(let error):
                localError = AudioUserFacingError.message(for: error, fallback: String(localized: "파일을 선택하지 못했어요."))
            }
        }
        // ⚠ **동의를 받았으면 등록을 이어서 한다**(Codex #703 P2). 시트의 CTA 는
        // '동의하고 목소리 만들기' 인데, 동의만 기록하고 끝나면 아무 일도 일어나지 않은
        // 것처럼 보여 사용자가 등록을 다시 눌러야 한다는 걸 스스로 알아내야 한다.
        .onChange(of: auth.consentSensitiveMissing) { _, _ in
            guard resumeSubmitAfterConsent, unaskedSensitiveConsents.isEmpty else { return }
            resumeSubmitAfterConsent = false
            Task { await submit() }
        }
        // 시트를 그냥 닫았으면(동의 없이) 이어받기를 취소한다 — 안 그러면 한참 뒤 다른
        // 이유로 목록이 바뀔 때 사용자가 누르지도 않은 등록이 시작된다.
        .onChange(of: auth.pendingSensitiveConsent) { _, request in
            if request == nil, !unaskedSensitiveConsents.isEmpty {
                resumeSubmitAfterConsent = false
            }
        }
        // 녹음이 끝났다(사용자가 멈췄든, 전화·블루투스·백그라운드로 끝났든) — 기기에서 판정한다.
        .onChange(of: voice.recorder.isRecording) { _, recording in
            guard !recording, voice.recorder.latestRecordingURL != nil else { return }
            Task { await reviewFinishedRecording() }
        }
        .alert(
            String(localized: "녹음을 확인해 주세요"),
            isPresented: Binding(
                get: { recordingReview != nil },
                set: { if !$0 { recordingReview = nil } }
            ),
            presenting: recordingReview
        ) { _ in
            Button(String(localized: "다시 녹음")) {
                discardRecording()
            }
            // 취소 자리 — 바깥 탭과 같다. 녹음을 지우는 쪽은 버튼으로만(실수로 잃지 않게).
            Button(String(localized: "그래도 쓰기"), role: .cancel) {
                recordingReview = nil
            }
        } message: { review in
            Text(review.alertMessage ?? "")
        }
        .onChange(of: sourceMode) { _, newValue in
            // 거절당한 것은 앞 방식의 소리다 — 다른 방식으로 옮기면 그 이유(`rerecordReason`)는 맞지 않는다.
            rerecordReason = nil
            voice.previewPlayer.stop()
            if newValue == .file, voice.recorder.isRecording {
                voice.stopRecording()
            }
            if newValue == .file,
               voice.recorder.latestRecordingURL != nil,
               (voice.recorder.latestDurationMs ?? Int(voice.recorder.elapsedSeconds * 1000))
                    < VoiceProfileLimits.minDurationMs {
                voice.recorder.clearLatest()
            }
        }
    }

    private func goBack() {
        if registrationStep == .details {
            submitted = false
            registrationStep = .source
        } else {
            route = .management
        }
    }

    private var nameSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(String(localized: "목소리 이름"))
                .font(.caption.weight(.semibold))
                .foregroundStyle(theme.palette.onSurfaceVariant)
            TextField(String(localized: "예: 엄마 목소리"), text: $profileName)
                .onChange(of: profileName) { _, newValue in
                    voice.cloneName = newValue
                    let cleaned = InputSanitizer.clampVoiceName(newValue)
                    if cleaned != newValue {
                        profileName = cleaned
                        voice.cloneName = profileName
                    }
                }
                .alarmTalkFieldStyle()
            if submitted && profileName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text(String(localized: "목소리 이름을 입력해 주세요."))
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(AlarmTalkTheme.error)
            }

            VoiceRelationshipInputField(
                selection: $relationshipSelection,
                title: String(localized: "나와의 관계 (선택)"),
                submitted: submitted,
                required: false
            )
            .padding(.top, 4)

            Text(String(localized: "이 목소리가 나를 부를 이름 (선택)"))
                .font(.caption.weight(.semibold))
                .foregroundStyle(theme.palette.onSurfaceVariant)
                .padding(.top, 4)
            TextField(String(localized: "예: 엄마, 자기, 김팀장"), text: $listenerTitle)
                .onChange(of: listenerTitle) { _, newValue in
                    if newValue.count > 30 {
                        listenerTitle = InputSanitizer.clampDisplayName(newValue)
                    }
                }
                .alarmTalkFieldStyle()
        }
    }

    /// ⚠ **녹음 UI 를 여기서 새로 그리지 말 것**(2026-08-16 정리).
    /// 예전에는 지름 100pt 원형 버튼 + 18칸 파형이었고, 알람 편집기는 전혀 다른 카드였다 —
    /// 같은 일(녹음)을 하는 화면이 앱마다·화면마다 다른 모양이었다. 이제 `RecordingCard`
    /// 하나를 두 화면이 함께 쓴다(안드로이드도 `VoiceRecordControls` 하나로 합쳤다).
    private var recordingSection: some View {
        let hasRecording = voice.recorder.latestRecordingURL != nil
        let recordingIsLongEnough = hasRecording
            && activeDurationMs >= VoiceProfileLimits.minDurationMs
        return RecordingCard(
            isRecording: voice.recorder.isRecording,
            elapsedMs: activeDurationMs,
            maxDurationMs: VoiceProfileLimits.maxDurationMs,
            hasRecording: recordingIsLongEnough,
            isPreviewing: voice.previewPlayer.isPlaying,
            statusText: hasRecording && !recordingIsLongEnough
                ? String(localized: "12초 이상 녹음해 주세요")
                : nil,
            note: nil,
            onRecord: {
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                if voice.recorder.isRecording {
                    voice.stopRecording()
                } else {
                    // 짧은 녹음은 완료본이 아니다. 마이크를 누르면 그 파일을 지우고
                    // 같은 자리에서 곧바로 다시 시작한다.
                    if hasRecording && !recordingIsLongEnough {
                        voice.recorder.clearLatest()
                    }
                    Task {
                        await voice.startRecording()
                        // 새로 녹음하기 시작했다 — 앞 녹음이 거절당한 이유(`rerecordReason`)를 걷는다. 남겨 두면 새 녹음도
                        // 거절당한 것처럼 읽힌다. 마이크를 열지 못했으면 그 이유는 아직 맞다(시작했을 때만 걷는다).
                        if voice.recorder.isRecording { rerecordReason = nil }
                    }
                }
            },
            onPreview: { voice.playRecording() },
            onRedo: { discardRecording() }
        )
    }

    /// 녹음한 클립을 버린다 — '다시 녹음'(카드·품질 알럿)과 확정 거절이 같은 길을 쓴다.
    private func discardRecording() {
        voice.previewPlayer.stop()
        voice.recorder.clearLatest()
        recordingReview = nil
    }

    /// 멈춘 녹음을 기기에서 판정한다 — 디코딩 → 정규화(16 kHz 모노) → 기본 신호 검사. 진단에는 수치만 남긴다.
    /// ⚠ VAD 는 꽂혀 있지 않다(기본 신호 검사) — 화면 어디에서도 'VAD 통과' 라고 말하지 않는다.
    /// 안드로이드 `VoiceProfileManagementPanel` 의 `reviewRecordedAudio` 와 같은 규칙이다.
    private func reviewFinishedRecording() async {
        guard let url = voice.recorder.latestRecordingURL else { return }
        let stopReason = voice.recorder.lastStopReason ?? .finished
        let durationMs = voice.recorder.latestDurationMs ?? 0
        guard durationMs >= VoiceProfileLimits.minDurationMs else {
            // 짧은 녹음은 카드가 '12초 이상' 을 말한다. 끼어들어 멈춘 것이면 왜 멈췄는지 말한다 — 사용자가 멈춘 것이 아니다.
            if stopReason != .finished {
                rerecordReason = String(localized: "전화나 다른 앱 때문에 녹음이 멈췄어요. 12초 이상 다시 녹음해 주세요.")
            }
            return
        }
        recordingAnalyzing = true
        let minDurationMs = VoiceProfileLimits.minDurationMs
        let maxSeconds = Double(VoiceProfileLimits.maxDurationMs + VoiceProfileLimits.maxDurationToleranceMs) / 1000 + 5
        let verdict = await Task.detached(priority: .userInitiated) {
            RecordingQualityAnalyzer.verdict(forRecordingAt: url, minDurationMillis: minDurationMs, maxSeconds: maxSeconds)
        }.value
        recordingAnalyzing = false
        // 그사이 버렸거나 다시 녹음했다 — 지난 녹음의 판정을 새 상태에 덮지 않는다.
        guard voice.recorder.latestRecordingURL == url, !voice.recorder.isRecording else { return }
        var diagnostics = verdict.diagnostics
        diagnostics["stop_reason"] = stopReason.rawValue
        AlarmTalkLog.breadcrumb(
            category: "recording_quality",
            event: "Voice registration recording reviewed",
            data: diagnostics
        )
        let review = RecordingReview.decide(verdict: verdict, stopReason: stopReason)
        switch review {
        case .accept:
            break
        case .reject(let reason):
            discardRecording()
            rerecordReason = reason.message
        case .ask:
            recordingReview = review
        }
    }

    /// ⚠ **거절 이유 줄(`rerecordReasonLine`)은 녹음 카드·파일 고르기 바로 아래다 — 단계 맨 아래로 내리지 말 것.**
    /// 말소리가 없다고 돌려받은 녹음은 버려지고 이 단계로 돌아와 그 이유를 여기서 말한다(`SubmitOutcome.rerecordForNoSpeech`).
    /// 다음에 누를 것이 녹음 버튼(파일 고르기)이라 그 곁이 사용자가 보는 자리다 — 예시 대본을 펼쳐 둔 채면 맨 아래 줄은
    /// 화면 밖이라, 녹음이 왜 사라졌는지 모른 채 다시 녹음하게 된다.
    @ViewBuilder
    private var sourceSection: some View {
        sourceModeSection
        if sourceMode == .record {
            recordingSection
            rerecordReasonLine
            VStack(alignment: .leading, spacing: 4) {
                Text(String(localized: "너무 짧으면 목소리가 다르게 나올 수 있어요."))
                Text(String(localized: "원하는 목소리 파일이 없다면 영상을 틀고 녹음해도 돼요."))
            }
            .font(theme.typography.bodySmall)
            .foregroundStyle(theme.palette.onSurfaceVariant)
            scriptSection
        } else {
            fileSection
            rerecordReasonLine
        }
    }

    private var scriptSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(reduceMotion
                    ? .easeOut(duration: 0.15)
                    : .spring(response: 0.35, dampingFraction: 1)) {
                    scriptExpanded.toggle()
                }
            } label: {
                HStack {
                    Text(String(localized: "예시 대본"))
                        .font(theme.typography.titleSmall)
                        .fontWeight(.semibold)
                    Spacer()
                    Image(systemName: "chevron.down")
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                        .rotationEffect(.degrees(scriptExpanded ? 180 : 0))
                }
                .contentShape(Rectangle())
                .padding(16)
            }
            .buttonStyle(.plain)

            if scriptExpanded {
                Text(recordingScript)
                    .font(theme.typography.bodyMedium)
                    .foregroundStyle(theme.palette.onSurface)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 16)
                    .transition(reduceMotion
                        ? .opacity
                        : .opacity.combined(with: .move(edge: .top)))
            }
        }
        .background(theme.palette.surfaceVariant.opacity(0.38))
        .outlinedButtonShape()
    }

    private var recordingScript: String {
        switch VoiceStudioViewModel.appVoiceLanguage() {
        case "en":
            return """
            Hello! Let's create your voice for AlarmTalk together.
            Every morning, this voice will wake someone you love — doesn't that sound exciting?

            The sky is clear and the breeze is soft today. A perfect day for a walk, isn't it?
            On days like this, don't you feel like wandering around with a warm cup of coffee?

            Now, shall we read some numbers together?
            One, two, three, four, five, six, seven, eight, nine, ten.

            On happy days, laugh as much as you want. On tiring days, tell yourself, "You did well today."
            And in the morning, open the window and take a deep breath — the day feels so much lighter.

            This is the last part already. Thank you for reading clearly all the way.
            Tomorrow morning, this voice will be the warmest alarm of all.
            """
        case "ja":
            return """
            こんにちは。これからAlarmTalkで使う声を、いっしょに作っていきましょう。
            毎朝この声が大切な人を起こしてくれるなんて、わくわくしませんか？

            今日は空も晴れて、風もやわらかい、散歩にぴったりの日です。
            こんな日は温かいコーヒーを片手に、近所をひと回りしたくなりますよね。

            つぎは、数字も読んでみましょうか？
            いち、に、さん、し、ご、ろく、なな、はち、きゅう、じゅう。

            うれしい日は思いきり笑って、疲れた日は「今日もお疲れさま」と声をかけてあげてください。
            朝、窓を大きく開けて深呼吸すると、一日がぐっと軽やかに始まりますよ。

            もう最後の文章です。ここまではっきり読んでくださって、ありがとうございます。
            明日の朝は、この声がいちばんやさしいアラームになってくれるはずです。
            """
        default:
            return """
            안녕하세요, 지금부터 알람톡에서 쓸 목소리를 함께 만들어 볼게요.
            매일 아침 이 목소리가 좋아하는 사람을 깨워 준다니, 설레지 않나요?

            오늘은 하늘도 맑고 바람도 부드러운, 걷기 좋은 날이에요.
            이런 날엔 따뜻한 커피 한 잔을 들고 동네를 한 바퀴 돌고 싶어지는 것 같아요.

            이번에는 숫자도 읽어 볼까요?
            하나, 둘, 셋, 넷, 다섯, 여섯, 일곱, 여덟, 아홉, 열.

            기쁜 날에는 마음껏 웃고, 지친 날에는 "오늘도 수고했어" 하고 말해 주세요.
            아침에 창문을 활짝 열고 시원한 공기를 들이마시면, 하루가 한결 가볍게 시작되거든요.

            벌써 마지막 문장이에요. 여기까지 또렷하게 읽어 주셔서 고마워요.
            내일 아침에는 이 목소리가 가장 다정한 알람이 되어 줄 거예요.
            """
        }
    }

    @ViewBuilder
    private var detailsSection: some View {
        nameSection
        // ⚠ '목소리 느낌'(자동·경쾌·차분) 선택을 되살리지 말 것(2026-09-29 사용자 결정으로 뺐다).
        //   클론 문구의 결은 서버가 등록 녹음 전사로 추정한 말투를 따른다
        //   (`docs/spec/voice-and-message.md` §4-2). 안드로이드 `VoiceRegistrationStep.Details` 와 같다.
        languageSection
        // ⚠ **물을 것이 없으면 상자째 그리지 않는다**(2026-09-19 실기기: 언어 선택 아래에
        //   빈 상자가 남았다). 권리 고지 문구를 동의 화면으로 옮긴 뒤로는, 이미 동의한
        //   사람에게 **내용 없는 배경만** 그려졌다. 판정은 `needsBiometricConsent` 하나다.
        if needsBiometricConsent {
            consentSection
        }
    }

    private var languageSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(String(localized: "알람을 읽어줄 언어"))
                .font(.subheadline.weight(.semibold))
            Picker(String(localized: "알람을 읽어줄 언어"), selection: $previewLanguage) {
                Text(verbatim: "한국어").tag("ko")
                Text("English").tag("en")
                Text("日本語").tag("ja")
            }
            .pickerStyle(.segmented)
        }
    }

    private var creatingSection: some View {
        VStack(spacing: 18) {
            ProgressView()
                .controlSize(.large)
            Text(String(localized: "목소리를 만드는 중이에요"))
                .font(theme.typography.titleMedium)
                .fontWeight(.semibold)
            Text(String(localized: "잠시만 기다려 주세요.\n완성되면 바로 들려드릴게요."))
                .font(theme.typography.bodyMedium)
                .foregroundStyle(theme.palette.onSurfaceVariant)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 72)
    }

    private var sourceModeSection: some View {
        HStack(spacing: 8) {
            ForEach(VoiceCloneSourceMode.allCases) { mode in
                // 두 갈래는 버튼 스타일·색만 다르다.
                let label = Text(mode.label)
                    .font(theme.typography.bodyMedium.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 5)
                if sourceMode == mode {
                    Button { sourceMode = mode } label: { label }
                        .buttonStyle(.borderedProminent)
                        .buttonBorderShape(.capsule)
                        .tint(theme.palette.secondary)
                        .frame(maxWidth: .infinity, minHeight: 44)
                } else {
                    Button { sourceMode = mode } label: { label }
                        .buttonStyle(.bordered)
                        .buttonBorderShape(.capsule)
                        .tint(theme.palette.primary)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
            }
        }
    }

    private var fileSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button { fileImporterPresented = true } label: {
                VStack(spacing: 10) {
                    Image(systemName: "arrow.up.doc")
                        .font(.system(size: selectedFileURL == nil ? 28 : 18))
                    Text(selectedFileURL == nil ? String(localized: "파일 또는 영상 업로드") : String(localized: "재업로드"))
                        .font(theme.typography.bodyMedium)
                        .fontWeight(.semibold)
                }
                .foregroundStyle(theme.palette.onSurface)
                .frame(maxWidth: .infinity)
                .padding(.vertical, selectedFileURL == nil ? 22 : 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .background(theme.palette.surface)
            .outlinedButtonShape()

            if let url = selectedFileURL, let durationMs = selectedFileDurationMs {
                Text(String(localized: "12초 이상 2분 이하 구간을 선택해 주세요."))
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                fileCropCard(url: url, durationMs: durationMs)
                Text(String(localized: "한 사람 목소리만 들어간 오디오를 넣어주세요.\n여러 명의 음성이 들어가 있으면 목소리가 달라질 수 있어요."))
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
            }

            if let localError {
                Text(localError)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(theme.palette.error)
            }
        }
    }

    private func fileCropCard(url: URL, durationMs: Int) -> some View {
        let effectiveEndMs = min(cropEndMs, durationMs)
        let effectiveDurationMs = max(0, effectiveEndMs - cropStartMs)
        return VStack(alignment: .leading, spacing: 10) {
            if durationMs >= VoiceProfileLimits.minDurationMs {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(String(localized: "구간 자르기"))
                            .font(theme.typography.labelLarge)
                            .fontWeight(.semibold)
                        Spacer()
                        Text(HelperFormatters.audioTimeLabel(effectiveDurationMs))
                            .font(theme.typography.labelMedium)
                            .fontWeight(.semibold)
                            .foregroundStyle(theme.palette.onSecondaryContainer)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(theme.palette.secondaryContainer, in: Capsule())
                    }
                    // Android `AudioCropRangeSelector` 처럼 양쪽 핸들로 12~120초 구간을 직접 고른다.
                    // (이전엔 시작점만 움직이고 길이는 항상 120초로 고정됐음).
                    AudioCropRangeSlider(
                        durationMs: durationMs,
                        minDurationMs: VoiceProfileLimits.minDurationMs,
                        maxDurationMs: VoiceProfileLimits.maxDurationMs,
                        cropStartMs: $cropStartMs,
                        cropEndMs: $cropEndMs
                    )
                }
            }

            VoiceSegmentPreviewPlayer(
                title: String(localized: "선택 구간 미리듣기"),
                subtitle: "\(HelperFormatters.audioTimeLabel(cropStartMs)) - \(HelperFormatters.audioTimeLabel(effectiveEndMs))",
                audioURL: url,
                startMs: cropStartMs,
                endMs: effectiveEndMs,
                onError: { localError = $0 }
            )

        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(theme.palette.surfaceVariant.opacity(0.38))
        .outlinedButtonShape()
    }

    /// 등록 직전 고지·동의. 생체정보 동의는 **전용 모달이 아니라 폼 안의 체크박스**로 받는다
    /// — 등록하려는 흐름을 끊지 않고, 무엇에 동의하는지가 화면에 그대로 보인다.
    /// (`VoiceConsentSheet` 는 폼 밖에서 호출된 경로를 위한 폴백이다.)
    private var consentSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            // ⚠ **권리 고지 문구를 여기 두지 않는다**(2026-09-19 지시). 권리 보증은 가입 때
            // 필수로 받는 약관 제7조가 이미 담당한다 — 등록할 때마다 같은 말을 다시 읽히면
            // 만들기 흐름만 길어진다. 아직 동의하지 않은 사람에게 묻는 **생체정보 체크는
            // 남긴다**(그건 고지가 아니라 실제로 받아야 하는 동의다).
            // (상자를 그릴지는 `detailsSection` 이 `needsBiometricConsent` 로 정한다 —
            //  여기 오면 늘 물을 것이 있다.)
            consentCheck(
                isOn: $voiceBiometricAgreed,
                label: String(localized: "음성 생체정보 처리에 동의해요"),
                description: String(localized: "목소리는 음성 프로필 생성·클론·읽어주기에 쓰이고, 개인을 식별·재현할 수 있는 생체정보로 처리돼요.\n본인 또는 적법한 권한과 동의를 받은 사람의 목소리만 등록할 수 있어요(이용약관 제7조).\n목소리를 지우면 함께 삭제되고, 더보기에서 언제든 동의를 철회할 수 있어요.")
            )
        }
        .sectionSurface()
    }

    private func consentCheck(isOn: Binding<Bool>, label: String, description: String) -> some View {
        Button {
            isOn.wrappedValue.toggle()
        } label: {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: isOn.wrappedValue ? "checkmark.square.fill" : "square")
                    .font(.title3)
                    .foregroundStyle(isOn.wrappedValue ? AlarmTalkTheme.primary : AlarmTalkTheme.textSecondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(label)
                        .font(theme.typography.bodyMedium)
                        .foregroundStyle(theme.palette.onSurface)
                    Text(description)
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var statusSection: some View {
        if let message = voice.statusMessage, !message.isEmpty {
            Text(message)
                .font(.footnote)
                .foregroundStyle(AlarmTalkTheme.textSecondary)
                .padding(.horizontal, 4)
        }
    }

    /// 음원 준비로 돌려보낸 이유(`rerecordReason` — 말소리 없음). 글자·색은 오류 줄의 것이다(`bodySmall`·오류 색).
    /// ⚠ 위의 안내 줄(`statusSection`)로 그리지 말 것 — 녹음 카드 아래 힌트 두 줄과 같은 흐린 글자라, 거절이 힌트 한
    /// 줄로 읽혀 녹음이 왜 사라졌는지 모른다. 안드로이드 `RerecordReasonLine` 과 같은 글자·색이다.
    @ViewBuilder
    private var rerecordReasonLine: some View {
        if let rerecordReason {
            Text(rerecordReason)
                .font(theme.typography.bodySmall)
                .foregroundStyle(theme.palette.error)
        }
    }

    @ViewBuilder
    private var bottomActions: some View {
        switch registrationStep {
        case .source:
            Button {
                voice.statusMessage = nil
                registrationStep = .details
            } label: {
                Text(sourceActionTitle).frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(theme.palette.primary)
            .disabled(!canAdvanceFromSource)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        case .details:
            Button {
                Task { await submit() }
            } label: {
                Text(String(localized: "voice.register.submit")).frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(theme.palette.primary)
            .disabled(!canSubmit)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        case .creating:
            EmptyView()
        }
    }

    private var sourceActionTitle: String {
        guard hasPreparedSource, !isInValidRange else { return String(localized: "다음") }
        return sourceMode == .record
            ? String(localized: "12초 이상 녹음해 주세요")
            : String(localized: "12초 이상인 파일을 선택해 주세요")
    }

    // MARK: - Actions

    private func submit() async {
        submitted = true
        guard hasPaidVoiceAccess else {
            voice.statusMessage = String(localized: "유료 이용권에서 사용할 수 있어요.")
            return
        }
        let trimmedName = profileName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            voice.statusMessage = String(localized: "목소리 이름을 입력해 주세요.")
            return
        }
        // ⚠ **인라인이 묻지 못한 민감 동의는 업로드 전에 시트로 받는다.** 그냥 올리면
        // 녹음이 나간 **뒤에** 403 이 오고, 그 시트는 등록 문맥을 모른 채 TTS 카피를 띄운다.
        if !unaskedSensitiveConsents.isEmpty {
            auth.requestSensitiveConsent(
                // 시트에는 **아직 없는 민감 동의 전체**를 담는다 — 인라인 체크는 아직 서버에
                // 기록되지 않았으므로 여기서 함께 받아야 한 번에 끝난다.
                types: auth.consentSensitiveMissing,
                registeringVoice: true
            )
            // **시트가 떴을 때만** 이어받는다. 모르는 유형이라 업데이트 게이트로 갔으면
            // 이어받을 것이 없다 — 플래그를 켜 두면 한참 뒤 목록이 바뀔 때 사용자가 누르지도
            // 않은 등록이 시작된다.
            resumeSubmitAfterConsent = auth.pendingSensitiveConsent != nil
            return
        }
        // 인라인으로 받은 생체정보 동의를 **업로드 전에** 기록한다. 순서를 뒤집으면
        // 서버가 그 동의를 요구하는 라우트에서 403 이 나 등록이 통째로 실패한다.
        if needsBiometricConsent, voiceBiometricAgreed {
            let recorded = await auth.submitSensitiveConsents(types: ["voice_biometric"])
            guard recorded else {
                voice.statusMessage = String(localized: "동의를 기록하지 못했어요. 다시 시도해 주세요.")
                return
            }
        }
        let trimmedRelationship = relationshipSelection.resolved.nilIfBlank
        let trimmedListener = listenerTitle.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank

        // 보낸 음원의 갈래와, 고른 파일이면 실제로 올린 파일(구간을 잘랐으면 잘라 낸 사본) — 갈 곳이 정해지면 이것으로
        // 보낸 음원을 정리한다(`sentSourceCleanup`).
        let sentMode = sourceMode
        var uploadedFileURL: URL?
        registrationStep = .creating
        let created: VoiceProfile?
        switch sentMode {
        case .record:
            guard voice.recorder.latestRecordingURL != nil,
                  voice.recorder.latestDurationMs != nil else {
                voice.statusMessage = String(localized: "먼저 목소리를 녹음해 주세요.")
                registrationStep = .source
                return
            }
            voice.cloneName = trimmedName
            created = await voice.uploadRecordingForClone(
                session: auth.session,
                relationshipLabel: trimmedRelationship,
                listenerTitle: trimmedListener,
                language: previewLanguage
            )
        case .file:
            do {
                let prepared = try await preparedFileAudio()
                uploadedFileURL = prepared.url
                created = await voice.cloneAudioForProfile(
                    audioFileURL: prepared.url,
                    name: trimmedName,
                    durationMs: prepared.durationMs,
                    session: auth.session,
                    uploadFileName: prepared.uploadFileName,
                    relationshipLabel: trimmedRelationship,
                    listenerTitle: trimmedListener,
                    language: previewLanguage
                )
            } catch {
                let message = AudioUserFacingError.message(for: error, fallback: String(localized: "선택한 음성을 준비하지 못했어요."))
                localError = message
                voice.statusMessage = message
                registrationStep = .details
                return
            }
        }
        // 갈 곳은 순수 셈이 정한다(`submitOutcome` — 가르는 규칙과 그 이유는 거기 있다).
        let outcome = Self.submitOutcome(
            created: created,
            monthlyLimitRejected: voice.monthlyLimitRejected,
            noSpeechRejected: voice.noSpeechRejected
        )
        // 보낸 음원은 갈 곳이 정해진 뒤 **이 한 자리에서** 정리한다 — 무엇을 지울지는 순수 셈(`sentSourceCleanup`)이
        // 정하고 여기서는 그대로 따른다. 다 쓴 음원(초안이 만들어졌다·월 한도·말소리 없음)은 평문 생체정보라 곧바로
        // 지우고, 다시 시도할 수 있는 실패는 `등록` 이 다시 보낼 것을 남긴다(스펙 voice-and-message §4-1).
        discardSentSource(Self.sentSourceCleanup(
            after: outcome,
            sentMode: sentMode,
            selectedFileURL: selectedFileURL,
            uploadedURL: uploadedFileURL
        ))
        switch outcome {
        case .preview(let draftID):
            // 확인 스텝이 목록 새로고침을 기다리지 않고 그리게 초안을 넘겨 둔다.
            voice.pendingDraft = created
            route = .preview(draftID)
        case .closeForMonthlyLimit:
            // 창을 닫는다 — 창이 다 내려간 뒤 목소리 탭이 알럿 하나로 이유를 말한다(`VoicesPanelView`).
            route = .management
        case .rerecordForNoSpeech:
            // 음원 준비로 돌아간다 — 보낸 녹음(고른 파일)은 위에서 버렸다. 남겨 두면 `등록` 이 같은 소리를 다시 보내 같은
            // 답을 받는다. 세부 정보로 돌리지 않는다 — 고칠 것은 이름이 아니라 소리다(같은 400 을 받으러 갈 때마다 공용·
            // 한도 있는 키로 전사 한 번을 치른다). 이름·관계·호칭·언어는 그대로 둔다.
            registrationStep = .source
            submitted = false
            // 이유(뷰모델이 안내 줄에 세운 문장)는 이 창의 거절 줄로 옮긴다 — 녹음 카드·파일 고르기 바로 아래, 오류 색
            // (`rerecordReasonLine`). 안내 줄에 남기면 맨 아래 흐린 힌트처럼 읽히고, 창을 닫은 뒤에도 목소리 탭 맨 위에
            // 남는다. 이 갈래에 닿을 때 창은 늘 떠 있다 — 만드는 중에는 닫을 수 없다(`topBarBackAction` 이 nil, 창은
            // `interactiveDismissDisabled`).
            rerecordReason = voice.statusMessage
            voice.statusMessage = nil
        case .details:
            // 이유는 `statusSection` 이 이 창 안에서 말하고, 녹음(가져온 사본)은 그대로라 `등록` 을 그대로
            // 다시 누를 수 있다(잘라 낸 사본은 다음 `등록` 이 다시 자른다).
            registrationStep = .details
        }
    }

    /// 보낸 음원을 정리 계획(`sentSourceCleanup`)대로 지운다. 계획을 **그대로** 따른다 — 무엇을 지울지는 여기서 다시
    /// 셈하지 않는다.
    private func discardSentSource(_ cleanup: SentSourceCleanup) {
        if cleanup.clearsRecorder {
            voice.previewPlayer.stop()
            voice.recorder.clearLatest()
        }
        for url in cleanup.filesToDelete {
            try? FileManager.default.removeItem(at: url)
        }
        if cleanup.clearsFileSelection {
            selectedFileURL = nil
            selectedFileName = nil
            selectedFileDurationMs = nil
            localError = nil
        }
    }

    /// 제출이 끝난 뒤(`SubmitOutcome`) 보낸 음원을 무엇까지 지우는가 — 화면 상태와 떼어 낸 순수 셈의 답이다(회귀
    /// `VoiceStudioViewModelTests`). `submit` 이 갈 곳을 정한 뒤 한 번 이것을 그대로 따른다(`discardSentSource`).
    struct SentSourceCleanup: Equatable, Sendable {
        /// 녹음기를 비운다 — 녹음 파일(`VoiceRecordings`)도 녹음기가 함께 지운다(`VoiceRecorder.clearLatest`).
        let clearsRecorder: Bool
        /// 지울 파일 — 앱이 뜬 사본(가져온 사본·잘라 낸 사본)뿐이다(`isAppMadeSourceCopy`). 사용자가 고른 원본은 가져올
        /// 때 사본을 떴으므로(`copyImportedAudio`) 건드리지 않는다.
        let filesToDelete: [URL]
        /// 고른 파일을 놓는다 — 고르기 전으로 돌린다.
        let clearsFileSelection: Bool
    }

    /// 위 계획을 셈한다(스펙 voice-and-message §4-1 「보낸 음원은 다 쓰면 곧바로 지운다」). **보낸 갈래의 소리만**
    /// 다룬다 — 다른 갈래에 준비해 둔 소리는 보내지 않았으니 그대로 둔다.
    ///
    /// | 갈 곳 | 녹음을 보냈다 | 고른 파일을 보냈다 |
    /// | --- | --- | --- |
    /// | 초안이 만들어졌다 · 월 한도 · 말소리 없음 | 녹음기를 비운다 | 가져온 사본 + 잘라 낸 사본을 지우고 선택을 놓는다 |
    /// | 다시 시도할 수 있는 실패(`.details`) | 그대로 | 잘라 낸 사본만 지운다 — 가져온 사본과 선택은 남긴다 |
    ///
    /// - ⚠ **다 쓴 음원은 지운다.** 서버가 받아들였으면 다시 보낼 일이 없고(확인 스텝의 `다시 만들기` 는 새로 녹음한다),
    ///   월 한도·말소리 없음은 같은 음원을 다시 보내도 같은 답이다. 등록 녹음은 음성 생체정보 평문이다. 안드로이드도
    ///   업로드가 성공하면(`purgeVoiceCloneSourceRecordings`), 거절로 다 쓰면(`cloneRejectionSpendsRecording`) 지운다.
    /// - ⚠ **다시 시도할 수 있는 실패는 `등록` 이 다시 보낼 것을 남긴다** — 녹음과 가져온 사본. 잘라 낸 사본은 남기지
    ///   않는다: 구간은 보낼 때마다 새로 자르므로(`preparedFileAudio`) 남겨 둔 사본은 다시 쓰이지 않고 쌓이기만 한다.
    /// - ⚠ **알람이 쓰는 파일은 지우지 않는다** — 지울 목록은 앱이 뜬 사본 폴더의 파일로만 셈한다(`isAppMadeSourceCopy`).
    ///   알람 음원은 다른 폴더(`AudioCacheStore`)에 있어 여기 섞일 일이 없지만, 다른 곳을 가리키는 주소가 들어와도
    ///   지우지 않는다.
    /// - 녹음은 녹음기가 자기 파일을 지운다 — 지울 파일 목록에 다시 올리지 않는다.
    nonisolated static func sentSourceCleanup(
        after outcome: SubmitOutcome,
        sentMode: VoiceCloneSourceMode,
        selectedFileURL: URL?,
        uploadedURL: URL?
    ) -> SentSourceCleanup {
        let spent: Bool
        switch outcome {
        case .preview, .closeForMonthlyLimit, .rerecordForNoSpeech: spent = true
        case .details: spent = false
        }
        switch sentMode {
        case .record:
            return SentSourceCleanup(clearsRecorder: spent, filesToDelete: [], clearsFileSelection: false)
        case .file:
            // 고른 파일과 다른 파일을 올렸으면 그것이 이번 제출이 잘라 낸 사본이다.
            let cropped = uploadedURL == selectedFileURL ? nil : uploadedURL
            let candidates = spent ? [selectedFileURL, cropped] : [cropped]
            return SentSourceCleanup(
                clearsRecorder: false,
                filesToDelete: candidates.compactMap { $0 }.filter(isAppMadeSourceCopy),
                clearsFileSelection: spent
            )
        }
    }

    /// 앱이 뜬 등록 음원 사본인가 — 가져온 사본 폴더(`importFolderName`)·잘라 낸 사본 폴더(`AudioCropper.outputFolderName`)
    /// **바로 안의** 파일만 그렇다. 정리(`sentSourceCleanup`)는 이것만 지운다.
    nonisolated static func isAppMadeSourceCopy(_ url: URL) -> Bool {
        url.isFileURL && [importFolderName, AudioCropper.outputFolderName]
            .contains(url.deletingLastPathComponent().lastPathComponent)
    }

    /// 제출(`submit`) 뒤 등록 창이 갈 곳 — 화면 상태와 떼어 낸 순수 셈이다(회귀 `VoiceStudioViewModelTests`).
    enum SubmitOutcome: Equatable, Sendable {
        /// 서버가 초안을 만들었다 — 그 초안의 확인 스텝(`VoicesRoute.preview`)으로 간다.
        case preview(String)
        /// 이번 달 등록을 다 썼다 — 창을 닫는다.
        case closeForMonthlyLimit
        /// 녹음에 말소리가 거의 없다 — 그 녹음(고른 파일)을 버리고 음원 준비로 돌아간다.
        case rerecordForNoSpeech
        /// 다시 시도할 수 있는 실패 — 세부 정보로 돌아간다.
        case details
    }

    /// 위 넷을 가른다. 순서가 곧 규칙이다.
    ///
    /// 1. **성공은 반환된 프로필로만 가른다.** ⚠ `statusMessage.contains("등록")` 으로 가르지 말 것 — 실패
    ///    문구 "2분 이하 음성으로 등록할 수 있어요." 에도 '등록' 이 들어 있어, 2분을 넘긴 녹음이 실패 안내를
    ///    띄운 채 목록으로 넘어가 방금 녹음한 음성이 사라졌다. 또 `guard !isBusy` 로 빠져나간 회차는
    ///    `statusMessage` 를 건드리지 않아 직전 성공 문구가 그대로 남는다 — 문자열로는 이번 시도의 결과를
    ///    알 수 없다. 프로필이 있으면 한도 표시가 무엇이든 그것이 이긴다(서버가 이번 등록을 받아들였다).
    ///    - ⚠ **만든 초안은 목록이 아니라 확인 스텝으로 간다.** 서버는 클론을 초안(`is_draft=true`)으로 만들고
    ///      승격을 기다린다 — 목록으로 보내면 사용자는 자기 목소리를 한 번도 못 들어본 채 이번 달 등록 횟수를
    ///      쓰고, 초안은 승격되지 않아 알람에 쓸 수도 없다.
    /// 2. ⚠ **월 등록 한도 거절은 세부 정보로 되돌리지 않는다**(스펙 voice-and-message §4-1 「월 등록 한도」 ③).
    ///    이번 달에는 몇 번을 눌러도 같은 답이고, 거절을 받은 쪽(`VoiceStudioViewModel.cloneAudioForProfile`)은
    ///    창이 닫힐 줄 알고 안내 줄을 비운다 — 되돌리면 아무 말 없는 세부 정보에서 살아 있는 `등록` 을 눌러
    ///    같은 429 를 계속 받는다(2026-10-10 prod 의 안드로이드 사용자는 같은 거절을 일곱 번 받았다). 서버가
    ///    초안을 만들지 않았으니 지울 것도 없다.
    /// 3. ⚠ **말소리가 거의 없다는 거절(`VOICE_CLONE_NO_SPEECH`)도 세부 정보로 되돌리지 않는다** — 녹음을 버리고 음원
    ///    준비로 돌아간다(스펙 voice-and-message §4-1). 녹음은 그대로인데 `등록` 만 살아 있으면 같은 소리를 다시 보내 같은
    ///    답을 받는다. 흐름은 끝내지 않는다 — 서버는 아무것도 쓰지 않았고 이번 달 등록도 그대로라 다시 녹음하는 데
    ///    제한이 없다. 월 한도가 앞선다: 이번 달을 다 썼으면 다시 녹음해도 소용이 없다(서버도 한도를 먼저 본다).
    /// 4. 그 밖의 실패는 다시 시도할 수 있다 — 세부 정보로 돌아간다.
    nonisolated static func submitOutcome(
        created: VoiceProfile?,
        monthlyLimitRejected: Bool,
        noSpeechRejected: Bool
    ) -> SubmitOutcome {
        if let created { return .preview(created.id) }
        if monthlyLimitRejected { return .closeForMonthlyLimit }
        return noSpeechRejected ? .rerecordForNoSpeech : .details
    }

    /// ⚠ **입구(`VoiceProfileManagementPanel.paidVoiceEntitledNow`)와 같은 판정기다 — 갈라 두지
    /// 말 것**(2026-09-27). 예전에는 입구가 `PaidVoiceGate`, 여기가 `PlanTier.bestKnown` 이었다.
    /// 둘의 답이 다르면 사용자는 입구를 통과해 **녹음을 다 마친 뒤 제출에서** "유료 이용권에서
    /// 사용할 수 있어요" 를 받는다 — 구독 행 없이 `users.plan` 으로 유료인 계정(기간 한정 개인
    /// 플랜 등)이 정확히 그랬다. 여기도 등록을 여는 게이트라 **모르면 잠그지 않는다**
    /// (서버가 제출을 다시 판정한다).
    private var hasPaidVoiceAccess: Bool {
        PaidVoiceGate.isEntitled(snapshot: PaidVoiceGate.liveSnapshot(
            subscriptionResponse: socialFeatures.subscription,
            storeTier: subscriptions.currentTier,
            user: auth.session?.user
        ))
    }

    /// ⚠ **슬롯 한도를 여기서 보지 말 것**(2026-08-12 확정). 이미 목소리가 있어도 등록을
    /// 끝까지 진행시키고, 교체는 마지막 확정 화면(`VoicePreviewConfirmView`)이 알린다(그 화면의 저장이 곧 교체다).
    /// 여기서 막으면 그 화면에 도달할 수 없어 교체 기능이 죽는다.
    /// 월 등록 한도는 입구(`VoiceProfileManagementPanel`)가 이미 걸렀다.
    private var canCreateVoice: Bool { hasPaidVoiceAccess }


    private func importAudioFile(_ source: URL) async {
        do {
            let importedURL = try copyImportedAudio(source)
            let durationMs = try await readAudioDurationMs(importedURL)
            // 뷰는 메인 액터라 await 뒤에도 여기서 곧바로 상태를 고친다.
            selectedFileURL = importedURL
            selectedFileName = source.lastPathComponent
            selectedFileDurationMs = durationMs
            applyCropDefaults(durationMs: durationMs)
            localError = durationMs < VoiceProfileLimits.minDurationMs
                ? String(localized: "12초 이상 파일을 선택해 주세요.")
                : nil
            // 새 파일이다 — 앞 파일(녹음)이 거절당한 이유(`rerecordReason`)는 이 파일의 이야기가 아니다. 남겨 두면 새
            // 파일의 구간 카드 아래에 그 거절이 붙어, 새 파일이 거절당한 것처럼 읽힌다.
            rerecordReason = nil
        } catch {
            localError = AudioUserFacingError.message(for: error, fallback: String(localized: "선택한 파일을 준비하지 못했어요."))
        }
    }

    private func preparedFileAudio() async throws -> (url: URL, durationMs: Int, uploadFileName: String?) {
        guard let source = selectedFileURL,
              let sourceDuration = selectedFileDurationMs else {
            throw AudioCropper.CropperError.invalidRange
        }
        let uploadFileName = selectedFileName ?? source.lastPathComponent
        let endMs = min(cropEndMs, sourceDuration)
        let durationMs = max(0, endMs - cropStartMs)
        guard (VoiceProfileLimits.minDurationMs...VoiceProfileLimits.maxDurationMs).contains(durationMs) else {
            throw AudioCropper.CropperError.invalidRange
        }
        guard AudioCropper.shouldExportAudioOnly(
            source: source,
            startMs: cropStartMs,
            endMs: endMs,
            sourceDurationMs: sourceDuration
        ) else {
            return (source, durationMs, uploadFileName)
        }
        let audioOnly = try await AudioCropper.crop(source: source, startMs: cropStartMs, endMs: endMs)
        return (audioOnly, durationMs, uploadFileName)
    }

    private func copyImportedAudio(_ source: URL) throws -> URL {
        let scoped = source.startAccessingSecurityScopedResource()
        defer {
            if scoped {
                source.stopAccessingSecurityScopedResource()
            }
        }
        let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(Self.importFolderName, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let ext = source.pathExtension.isEmpty ? "m4a" : source.pathExtension
        let destination = directory.appendingPathComponent("clone-import-\(UUID().uuidString).\(ext)")
        try FileManager.default.copyItem(at: source, to: destination)
        return destination
    }

    private func readAudioDurationMs(_ url: URL) async throws -> Int {
        let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
        let audioTracks = try await asset.loadTracks(withMediaType: .audio)
        guard !audioTracks.isEmpty else {
            throw AudioCropper.CropperError.noAudioTrack
        }
        let duration = try await asset.load(.duration)
        let seconds = CMTimeGetSeconds(duration)
        guard seconds.isFinite, seconds > 0 else {
            throw AudioCropper.CropperError.invalidRange
        }
        return Int((seconds * 1000).rounded())
    }

    private func applyCropDefaults(durationMs: Int) {
        cropStartMs = 0
        cropEndMs = min(durationMs, VoiceProfileLimits.maxDurationMs)
    }

}
