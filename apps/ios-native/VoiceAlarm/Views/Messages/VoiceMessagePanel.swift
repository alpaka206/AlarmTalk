import SwiftUI

/// 가족 음성 메시지 — 받는 사람 선택, 메시지 입력, 받은 메시지 리스트.
///
/// ContentView 의 `voiceMessagePanel` 과 `codeRegisterRow` 를 옮긴 것.
/// 가족 그룹이 없으면 빈 상태 + 초대 코드 입력 폼을 보여준다.
struct VoiceMessagePanel: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("가족 메시지")
                    .font(.headline)
                Spacer()
                Button("새로고침") {
                    Task { await socialFeatures.refreshAll(session: auth.session) }
                }
                .disabled(socialFeatures.isBusy)
            }

            if let message = socialFeatures.statusMessage {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }

            if socialFeatures.selectableMembers.isEmpty {
                EmptyStatePlaceholder(
                    title: "아직 연결된 가족 그룹이 없어요.",
                    subtitle: "초대 코드를 등록하거나 가족 이용권 공유 코드를 만든 뒤 메시지를 보낼 수 있어요.",
                    icon: "person.2"
                )
                CodeRegisterRow()
            } else {
                Picker("받는 사람", selection: $socialFeatures.selectedReceiverID) {
                    Text("선택 안 함").tag(String?.none)
                    ForEach(socialFeatures.selectableMembers) { member in
                        Text(member.name ?? member.email ?? member.userId).tag(Optional(member.userId))
                    }
                }

                TextField("메시지", text: $socialFeatures.noteText, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(2...5)

                Button {
                    Task { await socialFeatures.sendNote(session: auth.session) }
                } label: {
                    Label("메시지 보내기", systemImage: "paperplane")
                }
                .buttonStyle(.borderedProminent)
                .tint(VoiceAlarmTheme.primary)
                .foregroundStyle(VoiceAlarmTheme.text)
                .disabled(socialFeatures.isBusy)
            }

            if socialFeatures.receivedNotes.isEmpty {
                Text("받은 메시지가 없어요.")
                    .font(.footnote)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            } else {
                ForEach(socialFeatures.receivedNotes.prefix(8)) { note in
                    ReceivedNoteRow(note: note)
                }
            }
        }
        .sectionSurface()
    }
}

/// 가족 초대 코드 입력 + 공유 코드 발급 행.
///
/// ContentView 의 `codeRegisterRow` 를 옮긴 것. VoiceMessagePanel 과
/// PeoplePanel 두 곳에서 동일하게 사용한다.
struct CodeRegisterRow: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("초대 코드", text: $socialFeatures.inviteCode)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.characters)
            HStack {
                Button {
                    Task { await socialFeatures.registerCode(session: auth.session) }
                } label: {
                    Label("코드 등록", systemImage: "qrcode")
                }
                .buttonStyle(.borderedProminent)
                .tint(VoiceAlarmTheme.primary)
                .foregroundStyle(VoiceAlarmTheme.text)

                Button {
                    Task { await socialFeatures.ensureFamilyShareCode(session: auth.session) }
                } label: {
                    Label("공유 코드", systemImage: "person.badge.plus")
                }
                .buttonStyle(.bordered)
            }
        }
    }
}

/// 받은 메시지 한 줄.
///
/// ContentView 의 `receivedNoteRow(_:)` 헬퍼를 옮긴 것. 탭하면 읽음 처리.
struct ReceivedNoteRow: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    let note: ReceivedNote

    var body: some View {
        let hasAudio = socialFeatures.hasPlayableAudio(note)
        let revealText = socialFeatures.shouldRevealText(note)
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(note.senderName ?? note.senderEmail ?? "보낸 사람")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(VoiceAlarmTheme.text)
                Spacer()
                if note.readAt == nil {
                    Circle()
                        .fill(VoiceAlarmTheme.secondary)
                        .frame(width: 9, height: 9)
                }
            }

            HStack(alignment: .center, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(revealText ? note.text : "음성을 들으면 메시지가 보여요.")
                        .font(.footnote)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                        .lineLimit(3)
                    if let createdAt = formatNoteCreatedAt(note.createdAt) {
                        Text(createdAt)
                            .font(.caption2)
                            .foregroundStyle(VoiceAlarmTheme.textSecondary)
                    }
                }
                Spacer(minLength: 0)
                if hasAudio {
                    Button {
                        Task { await socialFeatures.playNoteAudio(note, session: auth.session) }
                    } label: {
                        if socialFeatures.loadingNoteID == note.id {
                            ProgressView()
                                .frame(width: 38, height: 38)
                        } else {
                            Image(systemName: socialFeatures.playingNoteID == note.id ? "stop.fill" : "play.fill")
                                .foregroundStyle(.white)
                                .frame(width: 38, height: 38)
                                .background(VoiceAlarmTheme.secondary, in: Circle())
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(socialFeatures.loadingNoteID != nil && socialFeatures.loadingNoteID != note.id)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(note.readAt == nil ? VoiceAlarmTheme.surfaceVariant.opacity(0.82) : VoiceAlarmTheme.surfaceVariant)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .onTapGesture {
            guard !hasAudio else { return }
            Task { await socialFeatures.markRead(note, session: auth.session) }
        }
    }
}

private func formatNoteCreatedAt(_ value: String?) -> String? {
    guard let raw = value?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
        return nil
    }
    let output = DateFormatter()
    output.dateFormat = "yyyy-MM-dd HH:mm"
    output.locale = Locale(identifier: "ko_KR")
    output.timeZone = .current

    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = iso.date(from: raw) {
        return output.string(from: date)
    }
    iso.formatOptions = [.withInternetDateTime]
    if let date = iso.date(from: raw) {
        return output.string(from: date)
    }

    let fallback = raw.replacingOccurrences(of: "T", with: " ")
    return String(fallback.prefix(16))
}

#if DEBUG
#Preview("VoiceMessagePanel (light)") {
    ScrollView {
        VoiceMessagePanel().padding()
    }
    .voiceAlarmPreviewEnvironment()
}

#Preview("VoiceMessagePanel (dark)") {
    ScrollView {
        VoiceMessagePanel().padding()
    }
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}

#Preview("CodeRegisterRow") {
    CodeRegisterRow()
        .padding()
        .voiceAlarmPreviewEnvironment()
}
#endif
