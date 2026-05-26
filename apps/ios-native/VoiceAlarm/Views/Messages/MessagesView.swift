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
        .task(id: auth.session?.user.id) {
            guard auth.session != nil else { return }
            await SocialNotificationTracker.requestAuthorizationIfNeeded()
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
        let metadata = archiveMetadata(for: message)
        VStack(alignment: .leading, spacing: 6) {
            Text(message.text)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(VoiceAlarmTheme.text)
                .lineLimit(2)
            if !metadata.isEmpty {
                Text(metadata.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(VoiceAlarmTheme.surfaceVariant)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func archiveMetadata(for message: TtsMessage) -> [String] {
        [
            trimmed(message.voiceName),
            ttsCategoryLabel(message.category),
            formattedArchiveDate(message.createdAt)
        ].compactMap { $0 }
    }

    private func trimmed(_ value: String?) -> String? {
        let text = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return text.isEmpty ? nil : text
    }

    private func ttsCategoryLabel(_ raw: String?) -> String? {
        guard let category = trimmed(raw) else { return nil }
        switch category {
        case "custom":
            return "직접 입력"
        case "morning":
            return "기상"
        case "lunch":
            return "점심 식사"
        case "evening":
            return "퇴근"
        case "night":
            return "밤"
        case "health":
            return "건강"
        case "study":
            return "공부"
        case "cheer":
            return "응원"
        case "love":
            return "사랑"
        default:
            return "랜덤 문구"
        }
    }

    private func formattedArchiveDate(_ raw: String?) -> String? {
        guard let value = trimmed(raw) else { return nil }
        let output = DateFormatter()
        output.dateFormat = "yyyy-MM-dd HH:mm"
        output.locale = Locale(identifier: "ko_KR")
        output.timeZone = .current
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: value) {
            return output.string(from: date)
        }
        iso.formatOptions = [.withInternetDateTime]
        if let date = iso.date(from: value) {
            return output.string(from: date)
        }
        return String(value.prefix(16))
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
