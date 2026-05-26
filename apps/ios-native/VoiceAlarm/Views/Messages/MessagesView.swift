import SwiftUI

/// 메시지 탭 본화면. 가족 메시지 패널 + 음성 메시지 보관함.
///
/// ContentView 의 `messagesScreen` + `ttsMessageArchivePanel` 합본.
/// 음성 보관함의 "음성 만들기" 액션은 부모(MainTabsView)가 넘긴 콜백을 호출한다.
struct MessagesView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var voiceStudio: VoiceStudioViewModel

    let selectTab: (NativeTab) -> Void
    var onCodeRegistered: (CodeRegistrationDestination) -> Void = { _ in }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ScreenHeader(title: "메시지")
            VoiceMessagePanel(onCodeRegistered: onCodeRegistered)
            ttsMessageArchivePanel
        }
    }

    private var ttsMessageArchivePanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("음성 메시지 보관함")
                    .font(.headline)
                Spacer()
                Button("새로고침") {
                    Task { await voiceStudio.refresh(session: auth.session) }
                }
                .disabled(voiceStudio.isBusy)
            }

            if voiceStudio.messages.isEmpty {
                EmptyStatePlaceholder(
                    title: "아직 생성한 음성 메시지가 없어요.",
                    subtitle: "음성 탭에서 깨워줄 말을 생성하면 여기에서 다시 확인할 수 있어요.",
                    icon: "message"
                )
            } else {
                ForEach(voiceStudio.messages.prefix(8)) { message in
                    messageRow(message)
                }
            }

            Button {
                selectTab(.voices)
            } label: {
                Label("음성 만들기", systemImage: "waveform")
            }
            .buttonStyle(.bordered)
        }
        .sectionSurface()
    }

    private func messageRow(_ message: TtsMessage) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(message.text)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(VoiceAlarmTheme.text)
                .lineLimit(2)
            Text([message.voiceName, message.category, message.createdAt].compactMap { $0 }.joined(separator: " · "))
                .font(.caption)
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(VoiceAlarmTheme.surfaceVariant)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

#if DEBUG
#Preview("MessagesView (light)") {
    ScrollView {
        MessagesView(selectTab: { _ in })
            .padding()
    }
    .voiceAlarmPreviewEnvironment()
}

#Preview("MessagesView (dark)") {
    ScrollView {
        MessagesView(selectTab: { _ in })
            .padding()
    }
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}
#endif
