import SwiftUI

/// 온보딩 직후 "기본 목소리 고르기" 스텝. Android `VoiceOnboardingScreen.kt` 미러.
///
/// 무료 사용자에게 시스템(스톡) 목소리 4개를 한꺼번에 펼치는 대신, 미리듣기하며
/// **1개를 기본 목소리로 선택** + **호칭(선택)** 을 정하게 한다. 강제 1탭(건너뛰기 없음 —
/// 단, 목소리를 못 불러온 예외 상황에서만 갇히지 않게 건너뛰기 노출).
///
/// 선택은 `VoiceStudioViewModel.completeVoiceSetup(voiceId:listenerTitle:)` 로 기기 설정에
/// 유저별 저장되고, `onComplete()` 로 게이트를 닫는다(RootView 가 MainTabs 로 진행).
struct VoiceSetupView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var voiceStudio: VoiceStudioViewModel
    @Environment(\.voiceAlarmTheme) private var theme

    var onComplete: (() -> Void)?

    @State private var selectedVoiceId: String?
    @State private var listenerTitle: String = ""

    private var systemVoices: [VoiceProfile] {
        voiceStudio.profiles.filter { isSystemVoiceId($0.id) }
    }

    private var effectiveSelectedId: String? {
        selectedVoiceId ?? systemVoices.first?.id
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("기본 목소리를 골라보세요")
                        .font(theme.typography.headlineMedium)
                        .foregroundStyle(theme.palette.onBackground)
                    Spacer().frame(height: 8)
                    Text("마음에 드는 하나면 충분해요.\n나중에 언제든 바꿀 수 있어요.")
                        .font(theme.typography.bodyMedium)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                    Spacer().frame(height: 20)

                    if systemVoices.isEmpty {
                        HStack(spacing: 12) {
                            ProgressView()
                            Text("목소리를 불러오는 중이에요…")
                                .font(theme.typography.bodyMedium)
                                .foregroundStyle(theme.palette.onSurfaceVariant)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 40)
                    } else {
                        VStack(spacing: 10) {
                            ForEach(systemVoices) { profile in
                                VoiceChoiceRow(
                                    name: profile.name,
                                    sample: sampleText(for: profile.id),
                                    selected: profile.id == effectiveSelectedId,
                                    previewing: voiceStudio.previewingGreetingVoiceId == profile.id,
                                    onSelect: { selectedVoiceId = profile.id },
                                    onPreview: {
                                        Task { await voiceStudio.previewGreeting(voiceId: profile.id, session: auth.session) }
                                    }
                                )
                            }
                        }

                        Spacer().frame(height: 24)
                        Text("이 목소리가 나를 뭐라고 부를까요?")
                            .font(theme.typography.titleSmall)
                            .foregroundStyle(theme.palette.onSurface)
                        Spacer().frame(height: 8)
                        TextField("예: 지호, 자기, 대표님", text: $listenerTitle)
                            .textFieldStyle(.roundedBorder)
                            .submitLabel(.done)
                            .onChange(of: listenerTitle) { _, newValue in
                                if newValue.count > 30 {
                                    listenerTitle = String(newValue.prefix(30))
                                }
                            }
                        Spacer().frame(height: 6)
                        Text("비워두면 이름 없이 깨워드려요. 나중에 목소리 탭에서 바꿀 수 있어요.")
                            .font(theme.typography.bodySmall)
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 16)
                .padding(.bottom, 16)
            }

            VStack(spacing: 8) {
                Button(action: confirm) {
                    Text("이 목소리로 시작하기")
                        .font(theme.typography.labelLarge)
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.borderedProminent)
                .tint(theme.palette.primary)
                .foregroundStyle(theme.palette.onPrimary)
                .clipShape(RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous))
                .disabled(effectiveSelectedId == nil)

                // 강제 1탭이라 정상 흐름엔 건너뛰기 없음. 목소리를 못 불러온 예외에만 노출.
                if systemVoices.isEmpty && !voiceStudio.isBusy {
                    Button("나중에 고르기") { onComplete?() }
                        .buttonStyle(.plain)
                        .font(theme.typography.labelLarge)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 12)
        }
        .background(theme.palette.background.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .task {
            if voiceStudio.profiles.isEmpty {
                await voiceStudio.refresh(session: auth.session, successMessage: nil)
            }
            await voiceStudio.loadStockClips(session: auth.session)
        }
        .onDisappear { voiceStudio.previewPlayer.stop() }
    }

    private func sampleText(for voiceId: String) -> String? {
        let greeting = voiceStudio.stockClips.first { $0.voiceProfileId == voiceId && $0.category == "greeting" }
        return (greeting ?? voiceStudio.stockClips.first { $0.voiceProfileId == voiceId })?.text
    }

    private func confirm() {
        guard let id = effectiveSelectedId else { return }
        voiceStudio.previewPlayer.stop()
        let trimmed = listenerTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        voiceStudio.completeVoiceSetup(voiceId: id, listenerTitle: trimmed.isEmpty ? nil : trimmed)
        onComplete?()
    }
}

/// 시스템 음성 1개를 고르는 카드 — 이름 + 인사말 샘플 + 들어보기(▶) + 라디오.
private struct VoiceChoiceRow: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let name: String
    let sample: String?
    let selected: Bool
    let previewing: Bool
    let onSelect: () -> Void
    let onPreview: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(name)
                        .font(theme.typography.titleMedium)
                        .foregroundStyle(selected ? theme.palette.onSecondaryContainer : theme.palette.onSurface)
                    if let sample, !sample.isEmpty {
                        Text(sample)
                            .font(theme.typography.bodySmall)
                            .foregroundStyle(selected ? theme.palette.onSecondaryContainer.opacity(0.78) : theme.palette.onSurfaceVariant)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Button(action: onPreview) {
                    ZStack {
                        Circle().fill(theme.palette.primary.opacity(0.12))
                        Image(systemName: previewing ? "stop.fill" : "play.fill")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(theme.palette.primary)
                    }
                    .frame(width: 40, height: 40)
                }
                .buttonStyle(.plain)

                VoiceChoiceDot(selected: selected)
            }
            .padding(EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 8))
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? theme.palette.secondaryContainer : theme.palette.surfaceVariant.opacity(0.45))
            .clipShape(RoundedRectangle(cornerRadius: theme.shapes.vocaCard, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: theme.shapes.vocaCard, style: .continuous)
                    .stroke(selected ? Color.clear : theme.palette.outlineVariant, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}

private struct VoiceChoiceDot: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let selected: Bool

    var body: some View {
        ZStack {
            Circle()
                .strokeBorder(selected ? Color.clear : theme.palette.outline, lineWidth: 2)
                .background(Circle().fill(selected ? theme.palette.primary : Color.clear))
                .frame(width: 18, height: 18)
            if selected {
                Circle().fill(theme.palette.onPrimary).frame(width: 7, height: 7)
            }
        }
        .frame(width: 22, height: 22)
    }
}
