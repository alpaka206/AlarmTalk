import SwiftUI

/// 가족 음성 메시지 — 받는 사람 선택, 메시지 입력, 받은 메시지 리스트.
///
/// ContentView 의 `voiceMessagePanel` 과 `codeRegisterRow` 를 옮긴 것.
/// 가족 그룹이 없으면 빈 상태 + 초대 코드 입력 폼을 보여준다.
struct VoiceMessagePanel: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @EnvironmentObject private var voiceStudio: VoiceStudioViewModel

    var onCodeRegistered: (CodeRegistrationDestination) -> Void = { _ in }

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
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
            }

            if messageRecipients.isEmpty {
                EmptyStatePlaceholder(
                    title: "아직 연결된 가족 그룹이 없어요.",
                    subtitle: "초대 코드를 등록하거나 가족 이용권 공유 코드를 만든 뒤 메시지를 보낼 수 있어요.",
                    icon: "person.2"
                )
                CodeRegisterRow(onCodeRegistered: onCodeRegistered)
            } else {
                Button {
                    composerOpen = true
                } label: {
                    Label("작성", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .tint(AlarmTalkTheme.primary)
                .foregroundStyle(AlarmTalkTheme.text)
                .disabled(socialFeatures.isBusy)
            }

            if socialFeatures.receivedNotes.isEmpty {
                Text("받은 메시지가 없어요.")
                    .font(.footnote)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
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
                        .foregroundStyle(AlarmTalkTheme.text)
                    Text("상대에게 텍스트나 음성 메시지를 보낼 수 있어요.")
                        .font(.subheadline)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
                Spacer()
                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.headline)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                        .frame(width: 32, height: 32)
                        .background(AlarmTalkTheme.surfaceVariant, in: Circle())
                }
                .buttonStyle(.plain)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    MessageComposerSection(title: "받는 사람") {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(recipients) { recipient in
                                    MessageChoiceChip(
                                        title: memberLabel(recipient),
                                        selected: recipientID == recipient.userId,
                                        action: { recipientID = recipient.userId }
                                    )
                                }
                            }
                        }
                    }

                    MessageComposerSection(title: "보내기 방식") {
                        HStack(spacing: 8) {
                            ForEach(VoiceMessageSendMode.allCases) { mode in
                                MessageChoiceChip(
                                    title: mode.label,
                                    selected: sendMode == mode,
                                    action: { sendMode = mode }
                                )
                            }
                        }
                    }

                    if sendMode == .voice {
                        MessageComposerSection(title: "보낼 목소리") {
                            if voiceOptions.isEmpty {
                                Text("사용 가능한 목소리가 없어요.")
                                    .font(.caption)
                                    .foregroundStyle(AlarmTalkTheme.textSecondary)
                            } else {
                                ScrollView(.horizontal, showsIndicators: false) {
                                    HStack(spacing: 8) {
                                        ForEach(voiceOptions) { option in
                                            MessageChoiceChip(
                                                title: option.label,
                                                selected: selectedVoiceID == option.id,
                                                action: { selectedVoiceID = option.id }
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }

                    MessageComposerSection(title: "메시지") {
                        TextField("전하고 싶은 말을 입력하세요", text: $text, axis: .vertical)
                            .textFieldStyle(.roundedBorder)
                            .lineLimit(4...6)
                            .onChange(of: text) { _, newValue in
                                if newValue.count > maxLength {
                                    text = String(newValue.prefix(maxLength))
                                }
                            }
                        Text("\(text.count)/\(maxLength)")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(AlarmTalkTheme.textSecondary)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                }
            }
            .frame(maxHeight: 520)

            HStack {
                if submitted && !canSend {
                    Text("받는 사람과 메시지를 확인해 주세요.")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(AlarmTalkTheme.error)
                }
                Spacer()
            }

            Button(isBusy ? "보내는 중" : "보내기") {
                submitted = true
                guard canSend, let recipientID else { return }
                if sendMode == .voice, let selectedVoiceID {
                    onSendVoice(recipientID, trimmedText, selectedVoiceID)
                } else {
                    onSendText(recipientID, trimmedText)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(AlarmTalkTheme.primary)
            .frame(maxWidth: .infinity)
            .disabled(!canSend)

            Spacer(minLength: 0)
        }
        .padding(20)
        .background(AlarmTalkTheme.background)
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
        .onChange(of: voiceOptions) { _, nextOptions in
            let selectionMissing = selectedVoiceID.map { id in
                !nextOptions.contains(where: { $0.id == id })
            } ?? true
            if selectionMissing {
                selectedVoiceID = nextOptions.first?.id
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

private struct MessageComposerSection<Content: View>: View {
    let title: String
    let content: Content

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(AlarmTalkTheme.text)
            content
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AlarmTalkTheme.surfaceVariant.opacity(0.42), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(AlarmTalkTheme.outline, lineWidth: 1)
        )
    }
}

private struct MessageChoiceChip: View {
    let title: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
                .foregroundStyle(selected ? Color.white : AlarmTalkTheme.text)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(
                    selected ? AlarmTalkTheme.secondary : AlarmTalkTheme.surface,
                    in: Capsule()
                )
                .overlay(
                    Capsule()
                        .stroke(selected ? AlarmTalkTheme.secondary : AlarmTalkTheme.outline, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }
}

/// 가족 초대 코드 / 이용권 코드 등록 행.
///
/// ContentView 의 `codeRegisterRow` 를 옮긴 것. VoiceMessagePanel 과
/// PeoplePanel 두 곳에서 동일하게 사용한다.
struct CodeRegisterRow: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel

    var onCodeRegistered: (CodeRegistrationDestination) -> Void = { _ in }

    @State private var inviteCodeDraft = ""
    @State private var voucherCodeDraft = ""
    @State private var showCodeInputs = false
    @State private var pendingDialog: CodeRegisterDialog?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if canManageShareCode {
                Text("공유 이용권을 관리 중이에요.")
                    .font(.footnote)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
            } else if hasActivePlan && !showCodeInputs {
                Text("\(activePlanName ?? "현재") 이용권 사용 중이에요. 등록은 이용권이 종료된 다음 가능해요.")
                    .font(.footnote)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
                Button {
                    if isSharedMember, let groupId = currentGroup?.id {
                        pendingDialog = .leave(groupId)
                    } else {
                        showCodeInputs = true
                    }
                } label: {
                    Text(isSharedMember ? "현재 이용권 나가고 새 코드 등록하기" : "다른 코드 등록하기")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .foregroundStyle(isSharedMember ? AlarmTalkTheme.error : AlarmTalkTheme.text)
                .disabled(socialFeatures.isBusy)
            } else {
                if hasActivePlan {
                    Text("등록하면 현재 \(activePlanName ?? "이용권") 이용권이 변경돼요.")
                        .font(.footnote)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }

                codeInputSection(
                    title: "초대 코드",
                    placeholder: "INV-XXXX-XXXX-XXXX",
                    text: Binding(
                        get: { inviteCodeDraft },
                        set: { inviteCodeDraft = normalizedCode($0, maxLength: 18) }
                    ),
                    submitLabel: "참여"
                )

                codeInputSection(
                    title: "이용권 코드",
                    placeholder: "GIFT-XXXX-XXXX-XXXX",
                    text: Binding(
                        get: { voucherCodeDraft },
                        set: { voucherCodeDraft = normalizedCode($0, maxLength: 19) }
                    ),
                    submitLabel: "등록"
                )
            }
        }
        .sheet(item: $pendingDialog) { dialog in
            switch dialog {
            case .leave(let groupId):
                CodeRegisterConfirmSheet(
                    title: "현재 이용권 나가고 새 코드 등록",
                    description: "현재 이용권에서 나가고 새 코드를 등록할까요?",
                    confirmLabel: "나가고 등록하기",
                    destructive: true,
                    onDismiss: { pendingDialog = nil },
                    onConfirm: {
                        pendingDialog = nil
                        showCodeInputs = true
                        Task {
                            await socialFeatures.leaveFamilyGroup(
                                groupId: groupId,
                                session: auth.session
                            )
                            await auth.refreshUser()
                        }
                    }
                )
                .presentationDetents([.medium])
            case .register(let code):
                CodeRegisterConfirmSheet(
                    title: "코드 등록",
                    description: registerDescription,
                    confirmLabel: "등록",
                    destructive: false,
                    onDismiss: { pendingDialog = nil },
                    onConfirm: {
                        pendingDialog = nil
                        inviteCodeDraft = ""
                        voucherCodeDraft = ""
                        Task {
                            if let destination = await socialFeatures.registerCode(
                                code,
                                session: auth.session
                            ) {
                                await auth.refreshUser()
                                await MainActor.run {
                                    onCodeRegistered(destination)
                                }
                            }
                        }
                    }
                )
                .presentationDetents([.medium])
            }
        }
    }

    private var currentGroup: FamilyGroup? {
        socialFeatures.familyGroup?.group
    }

    private var isSharedMember: Bool {
        currentGroup != nil && socialFeatures.familyGroup?.role == "member"
    }

    private var canManageShareCode: Bool {
        currentGroup != nil &&
            socialFeatures.familyGroup?.role == "owner" &&
            socialFeatures.subscription?.plan?.planType == "family"
    }

    private var activePlanName: String? {
        guard socialFeatures.subscription?.subscription != nil else { return nil }
        return socialFeatures.subscription?.plan?.name
            ?? codeRegisterPlanName(socialFeatures.subscription?.plan?.key)
    }

    private var hasActivePlan: Bool {
        activePlanName != nil
    }

    private var registerDescription: String {
        if hasActivePlan {
            return "등록 가능한 코드라면 현재 \(activePlanName ?? "이용권") 이용권은 종료되고 새 이용권으로 바뀌어요. 등록할까요?"
        }
        return "이 코드를 등록할까요?"
    }

    private func codeInputSection(
        title: String,
        placeholder: String,
        text: Binding<String>,
        submitLabel: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(AlarmTalkTheme.text)
            HStack(spacing: 8) {
                TextField(placeholder, text: text)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                Button {
                    pendingDialog = .register(text.wrappedValue)
                } label: {
                    Text(submitLabel)
                }
                .buttonStyle(.borderedProminent)
                .tint(AlarmTalkTheme.primary)
                .foregroundStyle(AlarmTalkTheme.text)
                .disabled(
                    text.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                        socialFeatures.isBusy
                )
            }
        }
    }
}

private enum CodeRegisterDialog: Identifiable, Equatable {
    case leave(String)
    case register(String)

    var id: String {
        switch self {
        case .leave(let groupId): return "leave-\(groupId)"
        case .register(let code): return "register-\(code)"
        }
    }
}

private struct CodeRegisterConfirmSheet: View {
    let title: String
    let description: String
    let confirmLabel: String
    let destructive: Bool
    let onDismiss: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(title)
                        .font(.headline.weight(.bold))
                        .foregroundStyle(AlarmTalkTheme.text)
                    Text(description)
                        .font(.footnote)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.subheadline.weight(.semibold))
                        .padding(8)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("닫기")
            }

            if destructive {
                Button(role: .destructive, action: onConfirm) {
                    Text(confirmLabel)
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                }
                .buttonStyle(.borderedProminent)
                .tint(AlarmTalkTheme.error)
                .foregroundStyle(.white)
            } else {
                Button(action: onConfirm) {
                    Text(confirmLabel)
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                }
                .buttonStyle(.borderedProminent)
                .tint(AlarmTalkTheme.primary)
                .foregroundStyle(.white)
            }
        }
        .padding(20)
        .background(AlarmTalkTheme.background)
    }
}

private func normalizedCode(_ value: String, maxLength: Int) -> String {
    String(
        value
            .uppercased()
            .filter { $0.isLetter || $0.isNumber || $0 == "-" }
            .prefix(maxLength)
    )
}

private func codeRegisterPlanName(_ planKey: String?) -> String {
    switch planKey {
    case "free":
        return "무료"
    case "personal", "individual", "plus":
        return "개인"
    case "couple":
        return "커플"
    case "family":
        return "가족"
    default:
        return "이용권"
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
                    .foregroundStyle(AlarmTalkTheme.text)
                Spacer()
                if note.readAt == nil {
                    Circle()
                        .fill(AlarmTalkTheme.secondary)
                        .frame(width: 9, height: 9)
                }
            }

            HStack(alignment: .center, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(revealText ? note.text : "음성을 들으면 메시지가 보여요.")
                        .font(.footnote)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                        .lineLimit(3)
                    if let createdAt = formatNoteCreatedAt(note.createdAt) {
                        Text(createdAt)
                            .font(.caption2)
                            .foregroundStyle(AlarmTalkTheme.textSecondary)
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
                                .background(AlarmTalkTheme.secondary, in: Circle())
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(socialFeatures.loadingNoteID != nil && socialFeatures.loadingNoteID != note.id)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(note.readAt == nil ? AlarmTalkTheme.surfaceVariant.opacity(0.82) : AlarmTalkTheme.surfaceVariant)
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
