import AVFoundation
import SwiftUI
import UIKit
import UniformTypeIdentifiers

private enum VoiceCloneSourceMode: String, CaseIterable, Identifiable {
    case record
    case file

    var id: String { rawValue }

    var label: String {
        switch self {
        case .record: return "녹음"
        case .file: return "파일"
        }
    }
}

private enum RegistrationStep {
    case source
    case details
    case creating
}

/// 녹음/파일 선택 → 세부 정보 → 생성 중 워크플로우.
///
/// Android `VoiceProfileManagementPanel.VoiceRegistrationStep` 의 Source/Details/Creating 을
/// SwiftUI 화면으로 분리한 것. 이후 Preview/Prerendering 은 `VoicesRoute` 가 잇는다.
struct VoiceCloneUploadFlow: View {
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
    /// Android 생성 플로우처럼 랜덤 문구와 공유 음성에서 쓸 호칭을 함께 저장한다.
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
    @State private var scriptExpanded = false

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
            }

            bottomActions
        }
        .homeGradientBackground()
        .onAppear {
            profileName = voice.cloneName
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
                localError = AudioUserFacingError.message(for: error, fallback: "파일을 선택하지 못했어요.")
            }
        }
        .onChange(of: sourceMode) { _, newValue in
            if newValue == .file, voice.recorder.isRecording {
                voice.stopRecording()
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
            Text("목소리 이름")
                .font(.caption.weight(.semibold))
                .foregroundStyle(theme.palette.onSurfaceVariant)
            TextField("예: 엄마 목소리", text: $profileName)
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
                Text("목소리 이름을 입력해 주세요.")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(AlarmTalkTheme.error)
            }

            VoiceRelationshipInputField(
                selection: $relationshipSelection,
                title: "나와의 관계 (선택)",
                submitted: submitted,
                required: false
            )
            .padding(.top, 4)

            Text("이 목소리가 나를 부를 이름 (선택)")
                .font(.caption.weight(.semibold))
                .foregroundStyle(theme.palette.onSurfaceVariant)
                .padding(.top, 4)
            TextField("예: 엄마, 자기, 김팀장", text: $listenerTitle)
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
        RecordingCard(
            isRecording: voice.recorder.isRecording,
            elapsedMs: activeDurationMs,
            maxDurationMs: VoiceProfileLimits.maxDurationMs,
            hasRecording: voice.recorder.latestRecordingURL != nil,
            isPreviewing: false,
            note: nil,
            onRecord: {
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                if voice.recorder.isRecording {
                    voice.stopRecording()
                } else {
                    Task { await voice.startRecording() }
                }
            },
            onPreview: { voice.playRecording() },
            onRedo: { voice.recorder.clearLatest() }
        )
    }

    @ViewBuilder
    private var sourceSection: some View {
        sourceModeSection
        if sourceMode == .record {
            recordingSection
            VStack(alignment: .leading, spacing: 4) {
                Text("너무 짧으면 목소리가 다르게 나올 수 있어요.")
                Text("원하는 목소리 파일이 없다면 영상을 틀고 녹음해도 돼요.")
            }
            .font(theme.typography.bodySmall)
            .foregroundStyle(theme.palette.onSurfaceVariant)
            scriptSection
        } else {
            fileSection
        }
    }

    private var scriptSection: some View {
        DisclosureGroup(isExpanded: $scriptExpanded) {
            Text(recordingScript)
                .font(theme.typography.bodyMedium)
                .foregroundStyle(theme.palette.onSurface)
                .padding(.top, 8)
        } label: {
            Text("예시 대본")
                .font(theme.typography.titleSmall)
                .fontWeight(.semibold)
        }
        .tint(theme.palette.onSurfaceVariant)
        .padding(16)
        .background(theme.palette.surfaceVariant.opacity(0.38))
        .clipShape(RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                .stroke(theme.palette.outlineVariant, lineWidth: 1)
        )
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
        languageSection
        consentSection
    }

    private var languageSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("알람을 읽어줄 언어")
                .font(.subheadline.weight(.semibold))
            Picker("알람을 읽어줄 언어", selection: $previewLanguage) {
                Text("한국어").tag("ko")
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
            Text("목소리를 만드는 중이에요")
                .font(theme.typography.titleMedium)
                .fontWeight(.semibold)
            Text("잠시만 기다려 주세요.\n완성되면 바로 들려드릴게요.")
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
                if sourceMode == mode {
                    Button(mode.label) { sourceMode = mode }
                        .buttonStyle(.borderedProminent)
                        .buttonBorderShape(.capsule)
                        .tint(theme.palette.secondary)
                        .frame(maxWidth: .infinity)
                } else {
                    Button(mode.label) { sourceMode = mode }
                        .buttonStyle(.bordered)
                        .buttonBorderShape(.capsule)
                        .tint(theme.palette.primary)
                        .frame(maxWidth: .infinity)
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
                    Text(selectedFileURL == nil ? "파일 또는 영상 업로드" : "재업로드")
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
            .clipShape(RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                    .stroke(theme.palette.outlineVariant, lineWidth: 1)
            )

            if let url = selectedFileURL, let durationMs = selectedFileDurationMs {
                Text("12초 이상 2분 이하 구간을 선택해 주세요.")
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                fileCropCard(url: url, durationMs: durationMs)
                Text("한 사람 목소리만 들어간 오디오를 넣어주세요.\n여러 명의 음성이 들어가 있으면 목소리가 달라질 수 있어요.")
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
                        Text("구간 자르기")
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
                    // Android `AudioCropRangeSelector` 처럼 양쪽 핸들로 60~120초 구간을 직접 고른다
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
                title: "선택 구간 미리듣기",
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
        .clipShape(RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                .stroke(theme.palette.outlineVariant, lineWidth: 1)
        )
    }

    /// 등록 직전 고지·동의. 생체정보 동의는 **전용 모달이 아니라 폼 안의 체크박스**로 받는다
    /// — 등록하려는 흐름을 끊지 않고, 무엇에 동의하는지가 화면에 그대로 보인다.
    /// (`VoiceConsentSheet` 는 폼 밖에서 호출된 경로를 위한 폴백이다.)
    private var consentSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            // 권리 보증은 **약관 제7조**가 담당한다(가입 시 필수 동의). 여기서는 업로드
            // 시점 고지만 남긴다 — 체크박스로 다시 받지 않는다.
            Text("본인 또는 적법한 권한과 동의를 받은 사람의 목소리만 등록할 수 있어요. 권한 없는 등록으로 생기는 책임은 등록한 사람에게 있어요(이용약관 제7조).")
            .font(theme.typography.bodySmall)
            .foregroundStyle(theme.palette.onSurfaceVariant)
            .fixedSize(horizontal: false, vertical: true)
            if needsBiometricConsent {
                consentCheck(
                    isOn: $voiceBiometricAgreed,
                    label: "음성 생체정보 처리에 동의해요",
                    description: "목소리는 음성 프로필 생성·클론·읽어주기에 쓰이고, 개인을 식별·재현할 수 있는 생체정보로 처리돼요. 목소리를 지우면 함께 삭제되고, 더보기에서 언제든 동의를 철회할 수 있어요."
                )
            }
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
                Text("등록").frame(maxWidth: .infinity)
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
        guard hasPreparedSource, !isInValidRange else { return "다음" }
        return sourceMode == .record
            ? "12초 이상 녹음해 주세요"
            : "12초 이상인 파일을 선택해 주세요"
    }

    // MARK: - Actions

    private func submit() async {
        submitted = true
        guard hasPaidVoiceAccess else {
            voice.statusMessage = "유료 이용권에서 사용할 수 있어요."
            return
        }
        let trimmedName = profileName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            voice.statusMessage = "목소리 이름을 입력해 주세요."
            return
        }
        // 인라인으로 받은 생체정보 동의를 **업로드 전에** 기록한다. 순서를 뒤집으면
        // 서버가 그 동의를 요구하는 라우트에서 403 이 나 등록이 통째로 실패한다.
        if needsBiometricConsent, voiceBiometricAgreed {
            let recorded = await auth.submitSensitiveConsents(types: ["voice_biometric"])
            guard recorded else {
                voice.statusMessage = "동의를 기록하지 못했어요. 다시 시도해 주세요."
                return
            }
        }
        let trimmedRelationship = relationshipSelection.resolved.nilIfBlank
        let trimmedListener = listenerTitle.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank

        registrationStep = .creating
        let created: VoiceProfile?
        switch sourceMode {
        case .record:
            guard voice.recorder.latestRecordingURL != nil,
                  voice.recorder.latestDurationMs != nil else {
                voice.statusMessage = "먼저 목소리를 녹음해 주세요."
                registrationStep = .source
                return
            }
            voice.cloneName = trimmedName
            created = await voice.uploadRecordingForClone(
                session: auth.session,
                isShared: false,
                relationshipLabel: trimmedRelationship,
                listenerTitle: trimmedListener,
                language: previewLanguage
            )
        case .file:
            do {
                let prepared = try await preparedFileAudio()
                created = await voice.cloneAudioForProfile(
                    audioFileURL: prepared.url,
                    name: trimmedName,
                    durationMs: prepared.durationMs,
                    isShared: false,
                    session: auth.session,
                    uploadFileName: prepared.uploadFileName,
                    relationshipLabel: trimmedRelationship,
                    listenerTitle: trimmedListener,
                    language: previewLanguage
                )
            } catch {
                let message = AudioUserFacingError.message(for: error, fallback: "선택한 음성을 준비하지 못했어요.")
                localError = message
                voice.statusMessage = message
                registrationStep = .details
                return
            }
        }
        // 성공 판정은 **반환된 프로필로만** 한다.
        // ⚠ `statusMessage.contains("등록")` 으로 판정하지 말 것 — 실패 문구
        // "2분 이하 음성으로 등록할 수 있어요." 에도 '등록' 이 들어 있어, 2분을 넘긴 녹음이
        // 실패 안내를 띄운 채 목록으로 넘어가 방금 녹음한 음성이 사라졌다.
        // 또 `guard !isBusy` 로 빠져나간 회차는 statusMessage 를 건드리지 않아
        // 직전 성공 문구가 그대로 남는다 — 문자열로는 이번 시도의 결과를 알 수 없다.
        if let created {
            // ⚠ **목록으로 곧바로 돌아가지 말 것.** 서버는 클론을 초안(`is_draft=true`)으로
            // 만들고 승격을 기다린다 — 여기서 목록으로 보내면 사용자는 자기 목소리를
            // 한 번도 못 들어본 채 이번 달 등록 횟수를 쓰고, 초안은 승격되지 않아
            // 알람에 쓸 수도 없다.
            voice.pendingDraft = created
            route = .preview(created.id)
        } else {
            registrationStep = .details
        }
    }

    private var hasPaidVoiceAccess: Bool {
        PlanTier.bestKnown(
            serverSubscription: socialFeatures.subscription,
            storeTier: subscriptions.currentTier,
            userPlan: auth.session?.user.plan
        )
        .meetsOrExceeds(.personal)
    }

    /// ⚠ **슬롯 한도를 여기서 보지 말 것**(2026-08-12 확정). 이미 목소리가 있어도 등록을
    /// 끝까지 진행시키고, 교체 여부는 마지막 확정 화면(`VoicePreviewConfirmView`)이 묻는다.
    /// 여기서 막으면 그 화면에 도달할 수 없어 교체 기능이 죽는다.
    /// 월 등록 한도는 입구(`VoiceProfileManagementPanel`)가 이미 걸렀다.
    private var canCreateVoice: Bool { hasPaidVoiceAccess }


    private func importAudioFile(_ source: URL) async {
        do {
            let importedURL = try copyImportedAudio(source)
            let durationMs = try await readAudioDurationMs(importedURL)
            await MainActor.run {
                selectedFileURL = importedURL
                selectedFileName = source.lastPathComponent
                selectedFileDurationMs = durationMs
                applyCropDefaults(durationMs: durationMs)
                localError = durationMs < VoiceProfileLimits.minDurationMs
                    ? "12초 이상 파일을 선택해 주세요."
                    : nil
            }
        } catch {
            await MainActor.run {
                localError = AudioUserFacingError.message(for: error, fallback: "선택한 파일을 준비하지 못했어요.")
            }
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
        guard durationMs >= VoiceProfileLimits.minDurationMs else {
            throw AudioCropper.CropperError.invalidRange
        }
        guard durationMs <= VoiceProfileLimits.maxDurationMs else {
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
            .appendingPathComponent("VoiceImports", isDirectory: true)
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
