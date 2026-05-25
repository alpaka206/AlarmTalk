import AVFoundation
import SwiftUI

/// 녹음 -> 60~120초 검증 -> 노이즈 제거 옵션 -> upload -> status 표시 워크플로우.
///
/// Android `VoiceProfileManagementPanel.kt:577~764` 의 생성 다이얼로그를 SwiftUI 자체
/// 화면으로 분리한 것. `VoiceStudioViewModel.recorder` 를 그대로 활용하고, 업로드는
/// `cloneWithNoiseRemoval` / `uploadRecordingForClone` 둘 중 noiseRemovalEnabled 에 따라
/// 분기한다.
struct VoiceCloneUploadFlow: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var voice: VoiceStudioViewModel

    @Binding var route: VoicesRoute

    @State private var profileName: String = ""
    @State private var relationshipSelection = VoiceRelationshipSelection()
    @State private var noiseRemovalEnabled: Bool = false
    @State private var isShared: Bool = false
    /// Android 생성 플로우처럼 랜덤 문구와 공유 음성에서 쓸 호칭을 함께 저장한다.
    @State private var listenerTitle: String = ""
    @State private var submitted: Bool = false
    @State private var animatedLevel: CGFloat = 0.0
    @State private var levelTimer: Timer?

    /// 60~120초 구간 검증.
    private var elapsedMs: Int {
        voice.recorder.latestDurationMs ?? Int(voice.recorder.elapsedSeconds * 1000)
    }
    private var isInValidRange: Bool {
        elapsedMs >= VoiceProfileLimits.minDurationMs && elapsedMs <= VoiceProfileLimits.maxDurationMs
    }
    private var canSubmit: Bool {
        !voice.isBusy
            && voice.recorder.latestRecordingURL != nil
            && !voice.recorder.isRecording
            && isInValidRange
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            header
            nameSection
            recordingSection
            durationSection
            optionsSection
            guidanceSection
            actionsSection
            statusSection
        }
        .onAppear { profileName = voice.cloneName }
        .onDisappear { levelTimer?.invalidate() }
    }

    private var header: some View {
        HStack(alignment: .center) {
            Button(action: { route = .management }) {
                Label("뒤로", systemImage: "chevron.left")
            }
            .buttonStyle(.borderless)
            .tint(VoiceAlarmTheme.primary)
            Spacer()
            Text("녹음으로 보이스 만들기")
                .font(.headline)
            Spacer()
            Color.clear.frame(width: 40, height: 1)
        }
    }

    private var nameSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("이름")
                .font(.caption.weight(.semibold))
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
            TextField("보이스 이름", text: $profileName)
                .textFieldStyle(.roundedBorder)
                .onChange(of: profileName) { _, newValue in
                    voice.cloneName = newValue
                    if newValue.count > 50 {
                        profileName = String(newValue.prefix(50))
                        voice.cloneName = profileName
                    }
                }
            if submitted && profileName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text("목소리 이름을 입력해 주세요.")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(VoiceAlarmTheme.error)
            }

            VoiceRelationshipInputField(
                selection: $relationshipSelection,
                submitted: submitted
            )
            .padding(.top, 4)

            Text("이 목소리가 부를 호칭")
                .font(.caption.weight(.semibold))
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
                .padding(.top, 4)
            TextField("예: 지호야, 우리 강아지", text: $listenerTitle)
                .textFieldStyle(.roundedBorder)
                .onChange(of: listenerTitle) { _, newValue in
                    if newValue.count > 30 {
                        listenerTitle = String(newValue.prefix(30))
                    }
                }
            if submitted && listenerTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text("이 목소리가 나를 부를 이름을 입력해 주세요.")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(VoiceAlarmTheme.error)
            } else {
                Text("랜덤 문구에서 이 이름으로 나를 불러요.")
                    .font(.caption2)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }
            VoiceListenerPreviewCard(
                listenerTitle: listenerTitle,
                relationshipLabel: relationshipSelection.resolved
            )
            HStack(spacing: 10) {
                Toggle(isOn: $isShared) {
                    Text("목소리 공유")
                        .font(.footnote)
                }
                .toggleStyle(.switch)
            }
        }
        .sectionSurface()
    }

    private var recordingSection: some View {
        VStack(alignment: .center, spacing: 14) {
            // 큰 원형 녹음 버튼.
            Button {
                if voice.recorder.isRecording {
                    voice.stopRecording()
                    stopLevelAnimation()
                } else {
                    Task {
                        await voice.startRecording()
                        startLevelAnimation()
                    }
                }
            } label: {
                ZStack {
                    Circle()
                        .fill(voice.recorder.isRecording ? VoiceAlarmTheme.error : VoiceAlarmTheme.primary)
                        .frame(width: 100, height: 100)
                        .overlay(
                            Circle()
                                .stroke(Color.white.opacity(0.5), lineWidth: 4)
                                .scaleEffect(1.0 + animatedLevel * 0.2)
                                .opacity(voice.recorder.isRecording ? 1 : 0)
                        )
                    Image(systemName: voice.recorder.isRecording ? "stop.fill" : "mic.fill")
                        .font(.system(size: 36, weight: .bold))
                        .foregroundStyle(.white)
                }
            }
            .buttonStyle(.plain)

            Text(voice.recorder.isRecording ? "녹음 중…" : (voice.recorder.latestRecordingURL == nil ? "녹음을 시작해 주세요" : "녹음을 저장했어요"))
                .font(.subheadline.weight(.semibold))

            // 단순 파형 시각화 — 18개 막대를 임의 높이로.
            RecordingWaveform(active: voice.recorder.isRecording, level: animatedLevel)
        }
        .frame(maxWidth: .infinity)
        .sectionSurface()
    }

    private var durationSection: some View {
        let elapsedSec = elapsedMs / 1000
        let total = VoiceProfileLimits.maxDurationMs / 1000
        let progress = min(1.0, Double(elapsedMs) / Double(VoiceProfileLimits.maxDurationMs))
        let validZoneStart = Double(VoiceProfileLimits.minDurationMs) / Double(VoiceProfileLimits.maxDurationMs)
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("길이")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text(String(format: "%d:%02d / %d:%02d",
                            elapsedSec / 60, elapsedSec % 60,
                            total / 60, total % 60))
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(isInValidRange ? VoiceAlarmTheme.accent : VoiceAlarmTheme.textSecondary)
            }
            ZStack(alignment: .leading) {
                GeometryReader { geo in
                    // valid zone (60s ~ 120s) 강조.
                    Rectangle()
                        .fill(VoiceAlarmTheme.accent.opacity(0.15))
                        .frame(width: geo.size.width * (1 - validZoneStart), height: 8)
                        .offset(x: geo.size.width * validZoneStart)
                    // progress.
                    Rectangle()
                        .fill(isInValidRange ? VoiceAlarmTheme.accent : VoiceAlarmTheme.primary)
                        .frame(width: geo.size.width * progress, height: 8)
                    // 60s 마커.
                    Rectangle()
                        .fill(VoiceAlarmTheme.accent)
                        .frame(width: 2, height: 16)
                        .offset(x: geo.size.width * validZoneStart - 1, y: -4)
                }
                .frame(height: 8)
                .clipShape(RoundedRectangle(cornerRadius: 4))
                .background(VoiceAlarmTheme.surfaceVariant, in: RoundedRectangle(cornerRadius: 4))
            }
            .frame(height: 8)

            Text("1분 이상 2분 이내로 녹음해 주세요. 1분 30초를 권장해요.")
                .font(.footnote)
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
            if !isInValidRange && elapsedMs > 0 {
                Text(elapsedMs < VoiceProfileLimits.minDurationMs
                     ? "60초 이상 녹음해야 등록할 수 있어요."
                     : "120초 이내로 녹음해 주세요.")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(VoiceAlarmTheme.error)
            }
        }
        .sectionSurface()
    }

    private var optionsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle(isOn: $noiseRemovalEnabled) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("배경음 자동 제거")
                        .font(.subheadline.weight(.semibold))
                    Text("기차·카페 같은 환경음을 줄여 학습 품질을 높여요.")
                        .font(.caption)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
            }
        }
        .sectionSurface()
    }

    private var guidanceSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("녹음 예시")
                .font(.subheadline.weight(.semibold))
            Text("아래 문장을 자연스럽게 읽고, 중간중간 쉬면서 평소 목소리를 유지해 주세요.")
                .font(.caption)
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
            VStack(alignment: .leading, spacing: 4) {
                bulletLine("좋은 아침이야. 이제 천천히 일어날 시간이야.")
                bulletLine("오늘 하루도 정말 고생했어. 잠깐 숨을 고르고 쉬어도 돼.")
                bulletLine("내 목소리가 알람으로 들린다면 어떤 말이 가장 힘이 될지 생각하며 편하게 말해볼게.")
            }
        }
        .sectionSurface()
    }

    private func bulletLine(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Text("•").foregroundStyle(VoiceAlarmTheme.primary)
            Text(text).font(.footnote).foregroundStyle(VoiceAlarmTheme.textSecondary)
        }
    }

    private var actionsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Button {
                    voice.playRecording()
                } label: {
                    Label("들어보기", systemImage: "play.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(voice.recorder.latestRecordingURL == nil)

                Button {
                    Task { await submit() }
                } label: {
                    Label(noiseRemovalEnabled ? "노이즈 제거 학습" : "학습 시작",
                          systemImage: "icloud.and.arrow.up")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(VoiceAlarmTheme.primary)
                .disabled(!canSubmit)
            }
            if voice.isBusy {
                ProgressView("처리 중…")
                    .frame(maxWidth: .infinity)
            }
        }
    }

    @ViewBuilder
    private var statusSection: some View {
        if let message = voice.statusMessage, !message.isEmpty {
            Text(message)
                .font(.footnote)
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
                .padding(.horizontal, 4)
        }
    }

    // MARK: - Actions

    private func submit() async {
        submitted = true
        guard let url = voice.recorder.latestRecordingURL,
              let durationMs = voice.recorder.latestDurationMs else {
            voice.statusMessage = "먼저 목소리를 녹음해 주세요."
            return
        }
        let trimmedName = profileName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            voice.statusMessage = "목소리 이름을 입력해 주세요."
            return
        }
        let trimmedRelationship = relationshipSelection.resolved
        guard !trimmedRelationship.isEmpty else {
            voice.statusMessage = "나와의 관계를 입력해 주세요."
            return
        }
        let trimmedListener = listenerTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedListener.isEmpty else {
            voice.statusMessage = "이 목소리가 나를 부를 이름을 입력해 주세요."
            return
        }
        if noiseRemovalEnabled {
            let _ = await voice.cloneWithNoiseRemoval(
                audioFileURL: url,
                name: trimmedName,
                durationMs: durationMs,
                isShared: isShared,
                session: auth.session,
                relationshipLabel: trimmedRelationship,
                listenerTitle: trimmedListener
            )
        } else {
            voice.cloneName = trimmedName
            await voice.uploadRecordingForClone(
                session: auth.session,
                isShared: isShared,
                relationshipLabel: trimmedRelationship,
                listenerTitle: trimmedListener
            )
        }
        // 성공 시 management 로 복귀.
        if voice.statusMessage?.contains("등록") == true || voice.statusMessage?.contains("완료") == true {
            route = .management
        }
    }

    private func startLevelAnimation() {
        levelTimer?.invalidate()
        levelTimer = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: true) { _ in
            Task { @MainActor in
                // 가벼운 랜덤 워크. 실제 amplitude 는 VoiceRecorder 가 노출하지 않으므로
                // 시각적 신호만 제공.
                animatedLevel = CGFloat.random(in: 0.2...1.0)
            }
        }
    }

    private func stopLevelAnimation() {
        levelTimer?.invalidate()
        levelTimer = nil
        animatedLevel = 0
    }
}

// MARK: - Waveform

/// 녹음 중 보여줄 단순 막대 파형. 실제 마이크 amplitude 미사용 시 fallback.
private struct RecordingWaveform: View {
    let active: Bool
    let level: CGFloat

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<18) { idx in
                Capsule()
                    .fill(active ? VoiceAlarmTheme.error : VoiceAlarmTheme.outline)
                    .frame(width: 4, height: barHeight(for: idx))
            }
        }
        .frame(height: 44)
    }

    private func barHeight(for idx: Int) -> CGFloat {
        if !active {
            return 8 + CGFloat((idx % 4)) * 2.5
        }
        let phaseOffset = sin(Double(idx) * 0.6 + Double(level) * 4.0)
        let amplitude = 12 + CGFloat(abs(phaseOffset)) * 28 * level
        return max(8, amplitude)
    }
}

#if DEBUG
#Preview("VoiceCloneUploadFlow (light)") {
    VoiceCloneUploadFlow(route: .constant(.clone))
        .voiceAlarmPreviewEnvironment()
}

#Preview("VoiceCloneUploadFlow (dark)") {
    VoiceCloneUploadFlow(route: .constant(.clone))
        .preferredColorScheme(.dark)
        .voiceAlarmPreviewEnvironment()
}
#endif
