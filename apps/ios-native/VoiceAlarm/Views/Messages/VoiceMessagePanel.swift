import SwiftUI

/// 가족 음성 메시지 — 받는 사람 선택, 메시지 입력, 받은 메시지 리스트.
///
/// ContentView 의 `voiceMessagePanel` 과 `codeRegisterRow` 를 옮긴 것.
/// 가족 그룹이 없으면 빈 상태 + 초대 코드 입력 폼을 보여준다.
struct VoiceMessagePanel: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @EnvironmentObject private var voiceStudio: VoiceStudioViewModel

    @State private var composerOpen = false

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

            if messageRecipients.isEmpty {
                EmptyStatePlaceholder(
                    title: "아직 연결된 가족 그룹이 없어요.",
                    subtitle: "초대 코드를 등록하거나 가족 이용권 공유 코드를 만든 뒤 메시지를 보낼 수 있어요.",
                    icon: "person.2"
                )
                CodeRegisterRow()
            } else {
                Button {
                    composerOpen = true
                } label: {
                    Label("새 메시지", systemImage: "plus")
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
        .sheet(isPresented: $composerOpen) {
            VoiceMessageComposerSheet(
                recipients: messageRecipients,
                voiceOptions: voiceOptions,
                initialRecipientID: socialFeatures.selectedReceiverID,
                isBusy: socialFeatures.isBusy,
                onDismiss: { composerOpen = false },
                onSendText: { recipientID, text in
                    socialFeatures.selectedReceiverID = recipientID
                    socialFeatures.noteText = text
                    composerOpen = false
                    Task { await socialFeatures.sendNote(session: auth.session) }
                },
                onSendVoice: { recipientID, text, voiceProfileID in
                    socialFeatures.selectedReceiverID = recipientID
                    composerOpen = false
                    Task {
                        await socialFeatures.sendTtsNote(
                            recipientId: recipientID,
                            voiceProfileId: voiceProfileID,
                            text: text,
                            session: auth.session
                        )
                    }
                }
            )
            .presentationDetents([.medium, .large])
        }
    }

    private var messageRecipients: [FamilyGroupMember] {
        let currentUserID = auth.session?.user.id
        let currentEmail = auth.session?.user.email
        return (socialFeatures.familyGroup?.members ?? []).filter { member in
            member.userId != currentUserID && member.email != currentEmail
        }
    }

    private var voiceOptions: [VoiceMessageVoiceOption] {
        let own = voiceStudio.profiles
            .filter { $0.status == nil || $0.status == "ready" }
            .map { VoiceMessageVoiceOption(id: $0.id, label: $0.name) }
        let shared = voiceStudio.familyVoices
            .filter { ($0.status == nil || $0.status == "ready") && $0.isShared != false }
            .map { profile in
                let owner = profile.ownerName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                return VoiceMessageVoiceOption(
                    id: profile.id,
                    label: owner.isEmpty ? profile.name : "\(owner)님의 목소리"
                )
            }
        return own + shared
    }
}

private enum VoiceMessageSendMode: String, CaseIterable, Identifiable {
    case text
    case voice

    var id: String { rawValue }

    var label: String {
        switch self {
        case .text: return "텍스트"
        case .voice: return "음성 메시지"
        }
    }
}

private struct VoiceMessageVoiceOption: Identifiable, Equatable {
    let id: String
    let label: String
}

private struct VoiceMessageComposerSheet: View {
    let recipients: [FamilyGroupMember]
    let voiceOptions: [VoiceMessageVoiceOption]
    let initialRecipientID: String?
    let isBusy: Bool
    let onDismiss: () -> Void
    let onSendText: (String, String) -> Void
    let onSendVoice: (String, String, String) -> Void

    @State private var recipientID: String?
    @State private var sendMode: VoiceMessageSendMode = .text
    @State private var text = ""
    @State private var selectedVoiceID: String?
    @State private var submitted = false

    private var maxLength: Int {
        sendMode == .voice ? 200 : 500
    }

    private var trimmedText: String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSend: Bool {
        recipientID != nil &&
            !trimmedText.isEmpty &&
            !isBusy &&
            (sendMode == .text || selectedVoiceID != nil)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("새 메시지")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(VoiceAlarmTheme.text)
                    Text("상대에게 텍스트나 음성 메시지를 보낼 수 있어요.")
                        .font(.subheadline)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
                Spacer()
                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.headline)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                        .frame(width: 32, height: 32)
                        .background(VoiceAlarmTheme.surfaceVariant, in: Circle())
                }
                .buttonStyle(.plain)
            }

            Picker("보낼 방식", selection: $sendMode) {
                ForEach(VoiceMessageSendMode.allCases) { mode in
                    Text(mode.label).tag(mode)
                }
            }
            .pickerStyle(.segmented)

            Picker("받는 사람", selection: $recipientID) {
                Text("선택").tag(String?.none)
                ForEach(recipients) { recipient in
                    Text(memberLabel(recipient)).tag(Optional(recipient.userId))
                }
            }

            if sendMode == .voice {
                Picker("목소리", selection: $selectedVoiceID) {
                    Text("선택").tag(String?.none)
                    ForEach(voiceOptions) { option in
                        Text(option.label).tag(Optional(option.id))
                    }
                }
                if voiceOptions.isEmpty {
                    Text("사용할 수 있는 목소리가 없어요. 먼저 목소리를 만들어 주세요.")
                        .font(.caption)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
            }

            TextField("메시지", text: $text, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(3...6)
                .onChange(of: text) { _, newValue in
                    if newValue.count > maxLength {
                        text = String(newValue.prefix(maxLength))
                    }
                }
            HStack {
                if submitted && !canSend {
                    Text("받는 사람과 메시지를 확인해 주세요.")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(VoiceAlarmTheme.error)
                }
                Spacer()
                Text("\(text.count)/\(maxLength)")
                    .font(.caption2)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }

            Button(sendMode == .voice ? "음성 메시지 보내기" : "메시지 보내기") {
                submitted = true
                guard canSend, let recipientID else { return }
                if sendMode == .voice, let selectedVoiceID {
                    onSendVoice(recipientID, trimmedText, selectedVoiceID)
                } else {
                    onSendText(recipientID, trimmedText)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(VoiceAlarmTheme.primary)
            .frame(maxWidth: .infinity)
            .disabled(isBusy)

            Spacer(minLength: 0)
        }
        .padding(20)
        .background(VoiceAlarmTheme.background)
        .onAppear {
            recipientID = initialRecipientID.flatMap { id in recipients.contains(where: { $0.userId == id }) ? id : nil }
                ?? recipients.first?.userId
            selectedVoiceID = voiceOptions.first?.id
        }
        .onChange(of: sendMode) { _, newMode in
            if newMode == .voice && selectedVoiceID == nil {
                selectedVoiceID = voiceOptions.first?.id
            }
            if text.count > maxLength {
                text = String(text.prefix(maxLength))
            }
        }
    }

    private func memberLabel(_ member: FamilyGroupMember) -> String {
        if let name = member.name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            return name
        }
        if let email = member.email?.trimmingCharacters(in: .whitespacesAndNewlines), !email.isEmpty {
            return email
        }
        return member.userId
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
