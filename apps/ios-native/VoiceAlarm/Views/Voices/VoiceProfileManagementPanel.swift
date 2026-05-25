import SwiftUI

/// VoiceAlarm 의 보이스 프로필 관리 화면.
///
/// Android `VoiceProfileManagementPanel.kt` (1158 줄) 의 SwiftUI 포팅. 슬롯 상태,
/// 프로필 행, 편집/공유/삭제 다이얼로그, 슬롯 부족 시 PlanGate 트리거, errorCode
/// 매핑까지 한 화면이 책임진다. 녹음/업로드 워크플로우는 형제 컴포넌트
/// `VoiceCloneUploadFlow` / `SpeakerSeparationFlow` 가 맡고 본 화면은 라우팅만 한다.
struct VoiceProfileManagementPanel: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var voice: VoiceStudioViewModel
    @EnvironmentObject private var alarmStore: LocalAlarmStore

    @Binding var route: VoicesRoute

    /// Phase 4-D1: PlanGate "결제 화면으로" 를 눌렀을 때 호출되는 라우팅 콜백.
    /// 부모가 MainTabsView 의 `auxiliaryScreen = .billing` 으로 chain 한다.
    /// 시트 충돌을 피하기 위해 본 화면의 시트를 먼저 닫고, 다음 runloop 에서
    /// 부모가 BillingPanel 시트를 띄우는 패턴을 사용한다.
    var onRequestBilling: (() -> Void)? = nil

    /// 프로필 편집 다이얼로그 입력값.
    @State private var editTarget: VoiceProfile?
    @State private var editName: String = ""
    @State private var editRelationship: String = ""
    @State private var editListenerTitle: String = ""
    @State private var editIsShared: Bool = false

    /// 삭제 확인 다이얼로그 입력값. force 토글 포함.
    @State private var deleteTarget: VoiceProfile?
    @State private var deleteForce: Bool = true

    /// 슬롯 가득 시 노출하는 플랜 안내 시트.
    @State private var planGateOpen: Bool = false

    /// 공유받은 음성에 viewer 가 자신의 관계/호칭을 등록할 때 사용하는 다이얼로그 타깃.
    /// Android `SharedVoiceViewerInfoDialog` (VoiceProfileManagementPanel.kt:1543) 와 동일한 의도.
    @State private var sharedViewerInfoTarget: FamilyVoiceProfile?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ScreenHeader(title: "음성", subtitle: nil)
            slotStatusCard
            addActionsRow
            if let message = voice.statusMessage {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
                    .padding(.horizontal, 4)
            }

            if voice.profiles.isEmpty {
                EmptyStatePlaceholder(
                    title: "아직 사용할 수 있는 목소리가 없어요.",
                    subtitle: "60초 이상 녹음한 뒤 학습을 등록해 주세요.",
                    icon: "mic.slash"
                )
            } else {
                ownProfilesSection
            }
            familyProfilesSection
        }
        .task { await voice.refresh(session: auth.session) }
        .sheet(item: $editTarget) { profile in
            VoiceProfileEditDialog(
                initialName: editName,
                initialRelationship: editRelationship,
                initialListenerTitle: editListenerTitle,
                initialIsShared: editIsShared,
                onCancel: { editTarget = nil },
                onSave: { newName, newRelationship, newListenerTitle, newShared in
                    Task {
                        if newName != profile.name ||
                            newRelationship != (profile.relationshipLabel ?? "") ||
                            newListenerTitle != (profile.listenerTitle ?? "") {
                            await voice.updateProfileInfo(
                                profile,
                                newName: newName,
                                relationshipLabel: newRelationship,
                                listenerTitle: newListenerTitle,
                                session: auth.session
                            )
                        }
                        if newShared != (profile.isShared ?? false) {
                            await voice.toggleShare(profile, isShared: newShared, session: auth.session)
                        }
                        editTarget = nil
                    }
                }
            )
            .presentationDetents([.medium, .large])
        }
        .sheet(item: $deleteTarget) { profile in
            VoiceProfileDeleteDialog(
                profileName: profile.name,
                force: $deleteForce,
                onCancel: { deleteTarget = nil },
                onConfirm: {
                    let target = profile
                    let force = deleteForce
                    deleteTarget = nil
                    Task {
                        await voice.deleteProfile(
                            target,
                            session: auth.session,
                            force: force,
                            alarmStore: alarmStore,
                            audioCache: AudioCacheStore.shared
                        )
                    }
                }
            )
            .presentationDetents([.medium])
        }
        .sheet(isPresented: $planGateOpen) {
            VoicePlanGateSheet(
                onUpgrade: {
                    planGateOpen = false
                    // Phase 4-D1: 부모(MainTabsView)가 .billing auxiliary 시트를
                    // 띄우도록 콜백 호출. 시트 충돌을 피하려 PlanGate 시트를 먼저
                    // 닫고, 부모가 onDismiss → pendingAuxiliary → auxiliaryScreen
                    // 흐름으로 빌링 시트를 chain.
                    onRequestBilling?()
                },
                onClose: { planGateOpen = false }
            )
            .presentationDetents([.medium])
        }
        .sheet(item: $sharedViewerInfoTarget) { profile in
            SharedVoiceViewerInfoDialog(
                profileName: profile.name,
                sharedFromLabel: profile.sharedFromLabel,
                initialRelationship: profile.relationshipLabel ?? "",
                initialListenerTitle: profile.listenerTitle ?? "",
                isWorking: voice.isBusy,
                onCancel: { sharedViewerInfoTarget = nil },
                onPreview: {
                    Task {
                        await voice.previewSharedVoice(profileId: profile.id, session: auth.session)
                    }
                },
                onConfirm: { relation, listener in
                    let target = profile
                    sharedViewerInfoTarget = nil
                    Task {
                        await voice.updateSharedVoiceViewerInfo(
                            profileId: target.id,
                            relationshipLabel: relation,
                            listenerTitle: listener,
                            session: auth.session
                        )
                    }
                }
            )
            .presentationDetents([.medium, .large])
        }
    }

    // MARK: - Slot status card

    /// 슬롯 카드 — `vm.profiles.count` / `maxProfiles` 진행률 + 가득 시 안내.
    private var slotStatusCard: some View {
        let used = voice.profiles.count
        let max = VoiceProfileLimits.maxProfiles
        let progress = max == 0 ? 0.0 : Double(used) / Double(max)
        let isFull = voice.isProfileLimitReached
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: isFull ? "exclamationmark.triangle.fill" : "person.crop.circle.badge.checkmark")
                    .foregroundStyle(isFull ? VoiceAlarmTheme.error : VoiceAlarmTheme.primary)
                Text("보이스 슬롯")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text("\(used) / \(max)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }
            ProgressView(value: progress)
                .tint(isFull ? VoiceAlarmTheme.error : VoiceAlarmTheme.primary)
            if isFull {
                Text("슬롯이 가득 찼어요. 기존 보이스를 삭제하거나 플랜을 업그레이드해 주세요.")
                    .font(.footnote)
                    .foregroundStyle(VoiceAlarmTheme.error)
            } else {
                Text("최대 \(max)개까지 등록할 수 있어요. 남은 슬롯 \(voice.remainingProfileSlots)개.")
                    .font(.footnote)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }
        }
        .sectionSurface()
    }

    private var addActionsRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("만들기")
                .font(.subheadline.weight(.semibold))
            HStack(spacing: 8) {
                Button {
                    if voice.isProfileLimitReached {
                        planGateOpen = true
                    } else {
                        route = .clone
                    }
                } label: {
                    Label("녹음으로 만들기", systemImage: "mic.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(VoiceAlarmTheme.primary)
                .disabled(voice.isBusy)

                Button {
                    if voice.isProfileLimitReached {
                        planGateOpen = true
                    } else {
                        route = .separate
                    }
                } label: {
                    Label("화자 분리", systemImage: "person.2.wave.2")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(voice.isBusy)
            }
        }
        .sectionSurface()
    }

    // MARK: - Own profiles list

    private var ownProfilesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("내 보이스")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Button("새로고침") {
                    Task { await voice.refresh(session: auth.session) }
                }
                .font(.footnote)
                .disabled(voice.isBusy)
            }
            ForEach(voice.profiles) { profile in
                VoiceProfileRow(
                    profile: profile,
                    isSelected: profile.id == voice.selectedProfileID,
                    onSelect: { voice.selectedProfileID = profile.id },
                    onEdit: {
                        editName = profile.name
                        editRelationship = profile.relationshipLabel ?? ""
                        editListenerTitle = profile.listenerTitle ?? ""
                        editIsShared = profile.isShared ?? false
                        editTarget = profile
                    },
                    onDelete: {
                        deleteForce = true
                        deleteTarget = profile
                    },
                    onToggleShare: { newValue in
                        Task { await voice.toggleShare(profile, isShared: newValue, session: auth.session) }
                    }
                )
            }
        }
    }

    @ViewBuilder
    private var familyProfilesSection: some View {
        if !voice.familyVoices.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text("공유받은 목소리")
                    .font(.subheadline.weight(.semibold))
                ForEach(voice.familyVoices) { family in
                    FamilyVoiceProfileRow(
                        profile: family,
                        onEdit: { sharedViewerInfoTarget = family }
                    )
                }
            }
        }
    }
}

// MARK: - Row

/// 단일 보이스 프로필 행. Android `VoiceProfileRow` 와 동일한 슬롯.
private struct VoiceProfileRow: View {
    let profile: VoiceProfile
    let isSelected: Bool
    let onSelect: () -> Void
    let onEdit: () -> Void
    let onDelete: () -> Void
    let onToggleShare: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(VoiceAlarmTheme.surfaceVariant)
                    Image(systemName: "mic")
                        .foregroundStyle(VoiceAlarmTheme.primary)
                }
                .frame(width: 40, height: 40)

                VStack(alignment: .leading, spacing: 3) {
                    Text(profile.name)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(VoiceAlarmTheme.text)
                    HStack(spacing: 6) {
                        statusPill
                        if profile.isShared == true {
                            sharedPill
                        }
                        if let createdAt = profile.createdAt, !createdAt.isEmpty {
                            Text(prettyDate(createdAt))
                                .font(.caption)
                                .foregroundStyle(VoiceAlarmTheme.textSecondary)
                        }
                    }
                }
                Spacer()
                Menu {
                    Button("선택", action: onSelect)
                    Button("이름·공유 변경", action: onEdit)
                    Toggle("공유 허용", isOn: Binding(
                        get: { profile.isShared ?? false },
                        set: { onToggleShare($0) }
                    ))
                    Divider()
                    Button("삭제", role: .destructive, action: onDelete)
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.title3)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                        .frame(width: 36, height: 36)
                }
            }

            HStack(spacing: 8) {
                Button(isSelected ? "선택됨" : "이 보이스 사용", action: onSelect)
                    .buttonStyle(.bordered)
                    .tint(isSelected ? VoiceAlarmTheme.primary : VoiceAlarmTheme.textSecondary)
                    .disabled(isSelected)
                Spacer()
                Button {
                    onEdit()
                } label: {
                    Image(systemName: "pencil")
                }
                .buttonStyle(.borderless)
                .foregroundStyle(VoiceAlarmTheme.primary)
                Button(role: .destructive) {
                    onDelete()
                } label: {
                    Image(systemName: "trash")
                }
                .buttonStyle(.borderless)
                .foregroundStyle(VoiceAlarmTheme.error)
            }
        }
        .padding(14)
        .background(VoiceAlarmTheme.surface)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(isSelected ? VoiceAlarmTheme.primary : VoiceAlarmTheme.outline, lineWidth: isSelected ? 1.5 : 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private var statusPill: some View {
        let status = profile.status ?? "unknown"
        let bg: Color
        let fg: Color
        switch status {
        case "ready":
            bg = VoiceAlarmTheme.accent.opacity(0.18); fg = VoiceAlarmTheme.accent
        case "processing":
            bg = VoiceAlarmTheme.secondary.opacity(0.18); fg = VoiceAlarmTheme.secondary
        case "failed":
            bg = VoiceAlarmTheme.error.opacity(0.18); fg = VoiceAlarmTheme.error
        default:
            bg = VoiceAlarmTheme.surfaceVariant; fg = VoiceAlarmTheme.textSecondary
        }
        return Text(statusLabel(status))
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(bg, in: Capsule())
            .foregroundStyle(fg)
    }

    private var sharedPill: some View {
        Text("공유 중")
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(VoiceAlarmTheme.primary.opacity(0.15), in: Capsule())
            .foregroundStyle(VoiceAlarmTheme.primary)
    }

    private func statusLabel(_ raw: String) -> String {
        switch raw {
        case "ready": return "사용 가능"
        case "processing": return "학습 중"
        case "failed": return "실패"
        default: return raw
        }
    }

    private func prettyDate(_ raw: String) -> String {
        guard let isoDate = ISO8601DateFormatter().date(from: raw) ?? ISO8601DateFormatter.compatDate(from: raw) else {
            return raw.prefix(10).description
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.dateFormat = "yyyy.MM.dd"
        return formatter.string(from: isoDate)
    }
}

private extension ISO8601DateFormatter {
    static func compatDate(from string: String) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        for pattern in [
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX",
            "yyyy-MM-dd'T'HH:mm:ssXXXXX",
            "yyyy-MM-dd HH:mm:ss",
            "yyyy-MM-dd",
        ] {
            formatter.dateFormat = pattern
            if let d = formatter.date(from: string) { return d }
        }
        return nil
    }
}

private struct FamilyVoiceProfileRow: View {
    let profile: FamilyVoiceProfile
    let onEdit: () -> Void

    /// Android `SharedVoiceProfileRow.needsViewerInfo` (VoiceProfileManagementPanel.kt:1477) 와 동일.
    /// 관계/호칭 중 하나라도 비어 있으면 "설정하기" CTA 버튼을 노출.
    private var needsViewerInfo: Bool {
        profile.requiresViewerInfo
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(VoiceAlarmTheme.secondary.opacity(0.18))
                    Image(systemName: "person.wave.2")
                        .foregroundStyle(VoiceAlarmTheme.secondary)
                }
                .frame(width: 40, height: 40)
                VStack(alignment: .leading, spacing: 3) {
                    Text(profile.name).font(.subheadline.weight(.semibold))
                    Text(profile.sharedFromLabel)
                        .font(.caption)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
                Spacer()
                Button(action: onEdit) {
                    Image(systemName: "pencil")
                        .font(.callout)
                        .foregroundStyle(VoiceAlarmTheme.primary)
                        .frame(width: 36, height: 36)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("내 정보 수정")
            }
            if needsViewerInfo {
                Button(action: onEdit) {
                    Text("이 목소리가 나를 어떻게 부를지 설정")
                        .font(.footnote.weight(.semibold))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(VoiceAlarmTheme.primary)
            }
        }
        .padding(12)
        .background(VoiceAlarmTheme.surface)
        .overlay(
            RoundedRectangle(cornerRadius: 12).stroke(VoiceAlarmTheme.outline, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    /// 소유자명 + (관계, 호칭) 정보를 한 줄로 조립.
    private var detailLine: String {
        var parts: [String] = []
        if let owner = profile.ownerName, !owner.isEmpty {
            parts.append("\(owner) 님의 보이스")
        } else {
            parts.append("공유받은 보이스")
        }
        if let relation = profile.relationshipLabel?.trimmingCharacters(in: .whitespacesAndNewlines), !relation.isEmpty {
            parts.append("관계 \(relation)")
        }
        if let listener = profile.listenerTitle?.trimmingCharacters(in: .whitespacesAndNewlines), !listener.isEmpty {
            parts.append("호칭 \(listener)")
        }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Edit dialog

/// 프로필 이름 + 공유 토글 동시 편집 다이얼로그.
private struct VoiceProfileEditDialog: View {
    let initialName: String
    let initialRelationship: String
    let initialListenerTitle: String
    let initialIsShared: Bool
    let onCancel: () -> Void
    let onSave: (String, String, String, Bool) -> Void

    @State private var name: String = ""
    @State private var relationshipSelection = VoiceRelationshipSelection()
    @State private var listenerTitle: String = ""
    @State private var isShared: Bool = false
    @State private var submitted = false

    private var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var trimmedRelationship: String {
        relationshipSelection.resolved
    }

    private var trimmedListenerTitle: String {
        listenerTitle.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                Text("정보 수정")
                    .font(.title3.weight(.bold))
                Spacer()
                Button(action: onCancel) {
                    Image(systemName: "xmark")
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("닫기"))
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("이름")
                    .font(.caption)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
                TextField("보이스 이름", text: $name)
                    .textFieldStyle(.roundedBorder)
                    .onChange(of: name) { _, newValue in
                        if newValue.count > 50 {
                            name = String(newValue.prefix(50))
                        }
                    }
                if submitted && trimmedName.isEmpty {
                    Text("목소리 이름을 입력해 주세요.")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(VoiceAlarmTheme.error)
                }
            }

            VoiceRelationshipInputField(
                selection: $relationshipSelection,
                submitted: submitted
            )

            VStack(alignment: .leading, spacing: 6) {
                Text("이 목소리가 나를 부를 호칭")
                    .font(.caption)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
                TextField("예: 지호야, 여보", text: $listenerTitle)
                    .textFieldStyle(.roundedBorder)
                    .onChange(of: listenerTitle) { _, newValue in
                        if newValue.count > 30 {
                            listenerTitle = String(newValue.prefix(30))
                        }
                    }
                if submitted && trimmedListenerTitle.isEmpty {
                    Text("이 목소리가 나를 부를 이름을 입력해 주세요.")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(VoiceAlarmTheme.error)
                }
            }

            VoiceListenerPreviewCard(
                listenerTitle: listenerTitle,
                relationshipLabel: trimmedRelationship
            )

            Toggle(isOn: $isShared) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("목소리 공유").font(.subheadline.weight(.semibold))
                    Text(isShared ? "이용권을 같이 사용하는 사람들에게 목소리를 공유해요." : "내 계정에서만 사용해요.")
                        .font(.caption)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
            }

            Button("저장") {
                submitted = true
                guard !trimmedName.isEmpty,
                      !trimmedRelationship.isEmpty,
                      !trimmedListenerTitle.isEmpty else {
                    return
                }
                onSave(trimmedName, trimmedRelationship, trimmedListenerTitle, isShared)
            }
            .buttonStyle(.borderedProminent)
            .tint(VoiceAlarmTheme.primary)
            .frame(maxWidth: .infinity)
            Spacer(minLength: 0)
        }
        .padding(20)
        .onAppear {
            name = initialName
            relationshipSelection = parseVoiceRelationshipLabel(initialRelationship)
            listenerTitle = initialListenerTitle
            isShared = initialIsShared
        }
    }
}

// MARK: - Delete dialog

/// 삭제 확인 다이얼로그. force 토글 + 영향받는 알람 수 안내.
private struct VoiceProfileDeleteDialog: View {
    let profileName: String
    @Binding var force: Bool
    let onCancel: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                Text("보이스 삭제")
                    .font(.title3.weight(.bold))
                Spacer()
                Button(action: onCancel) {
                    Image(systemName: "xmark")
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
            }

            Text("'\(profileName)' 보이스를 삭제할까요?")
                .font(.subheadline)
            Text("이 보이스를 쓰는 알람은 자동으로 기본 알람음으로 바뀌고, 서버 음원은 함께 정리됩니다.")
                .font(.footnote)
                .foregroundStyle(VoiceAlarmTheme.textSecondary)

            Toggle(isOn: $force) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("사용 중인 알람도 함께 정리").font(.subheadline.weight(.semibold))
                    Text(force ? "기본 알람음으로 강등돼요" : "사용 중이면 삭제하지 않아요")
                        .font(.caption)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
            }

            HStack {
                Button("취소", action: onCancel)
                    .buttonStyle(.bordered)
                    .frame(maxWidth: .infinity)
                Button(role: .destructive, action: onConfirm) {
                    Text("삭제")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(VoiceAlarmTheme.error)
            }
            Spacer(minLength: 0)
        }
        .padding(20)
    }
}

// MARK: - Shared voice viewer info dialog

/// 공유받은 음성에 대해 viewer 가 자신과의 관계와 호칭을 설정하는 다이얼로그.
///
/// Android `SharedVoiceViewerInfoDialog`
/// (`VoiceProfileManagementPanel.kt:1543`) 와 1:1 대응. 둘 다 필수이며, 비어 있으면
/// 인라인 오류 메시지를 띄우고 저장을 막는다.
private struct SharedVoiceViewerInfoDialog: View {
    let profileName: String
    let sharedFromLabel: String
    let initialRelationship: String
    let initialListenerTitle: String
    let isWorking: Bool
    let onCancel: () -> Void
    let onPreview: () -> Void
    let onConfirm: (String, String) -> Void

    @State private var relationshipSelection = VoiceRelationshipSelection()
    @State private var listenerTitle: String = ""
    @State private var submitted: Bool = false

    private var trimmedRelationship: String {
        relationshipSelection.resolved
    }
    private var trimmedListener: String {
        listenerTitle.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    private var listenerError: Bool { submitted && trimmedListener.isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                Text("공유받은 목소리 설정")
                    .font(.title3.weight(.bold))
                Spacer()
                Button(action: onCancel) {
                    Image(systemName: "xmark")
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
                .buttonStyle(.plain)
            }
            Text("'\(profileName)' 가 내게 어떻게 말할지 알려주세요.")
                .font(.subheadline)
                .foregroundStyle(VoiceAlarmTheme.textSecondary)

            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(VoiceAlarmTheme.secondary.opacity(0.18))
                    Image(systemName: "mic")
                        .foregroundStyle(VoiceAlarmTheme.secondary)
                }
                .frame(width: 44, height: 44)
                VStack(alignment: .leading, spacing: 3) {
                    Text(profileName)
                        .font(.headline)
                    Text(sharedFromLabel)
                        .font(.caption)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .background(VoiceAlarmTheme.surfaceVariant.opacity(0.55))
            .overlay(
                RoundedRectangle(cornerRadius: 16).stroke(VoiceAlarmTheme.outline, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 16))

            VoiceRelationshipInputField(
                selection: $relationshipSelection,
                submitted: submitted
            )

            VStack(alignment: .leading, spacing: 6) {
                Text("이 목소리가 나를 부를 호칭")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
                TextField("예: 지호야, 우리 강아지", text: $listenerTitle)
                    .textFieldStyle(.roundedBorder)
                    .onChange(of: listenerTitle) { _, newValue in
                        if newValue.count > 30 {
                            listenerTitle = String(newValue.prefix(30))
                        }
                    }
                if listenerError {
                    Text("필수 입력 값입니다.")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(VoiceAlarmTheme.error)
                }
            }

            VoiceListenerPreviewCard(
                listenerTitle: listenerTitle,
                relationshipLabel: trimmedRelationship
            )

            VStack(spacing: 8) {
                Button(action: onPreview) {
                    Label("미리듣기", systemImage: "play.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(isWorking)

                Button("저장") {
                    submitted = true
                    if !trimmedRelationship.isEmpty && !trimmedListener.isEmpty {
                        onConfirm(trimmedRelationship, trimmedListener)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(VoiceAlarmTheme.primary)
                .frame(maxWidth: .infinity)
                .disabled(isWorking)
            }
            Spacer(minLength: 0)
        }
        .padding(20)
        .onAppear {
            relationshipSelection = parseVoiceRelationshipLabel(initialRelationship)
            listenerTitle = initialListenerTitle
        }
    }
}

// MARK: - Plan gate

/// 슬롯 부족 / 유료 플랜 필요 시 노출하는 안내 시트.
struct VoicePlanGateSheet: View {
    let onUpgrade: () -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("플랜 업그레이드가 필요해요")
                    .font(.title3.weight(.bold))
                Spacer()
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
                .accessibilityLabel(Text("닫기"))
            }
            Text("보이스 슬롯이 가득 찼거나, 본 기능은 유료 플랜에서 사용할 수 있어요.")
                .font(.subheadline)
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
            VStack(alignment: .leading, spacing: 8) {
                bullet("기존 보이스를 삭제해 자리를 만들어요")
                bullet("Family · Couple 플랜으로 업그레이드해 슬롯을 확장해요")
            }
            Button("플랜 보기", action: onUpgrade)
                .buttonStyle(.borderedProminent)
                .tint(VoiceAlarmTheme.primary)
                .frame(maxWidth: .infinity)
            Spacer(minLength: 0)
        }
        .padding(20)
    }

    private func bullet(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(VoiceAlarmTheme.primary)
            Text(text).font(.footnote)
        }
    }
}

#if DEBUG
#Preview("VoiceProfileManagementPanel (light)") {
    VoiceProfileManagementPanel(route: .constant(.management))
        .voiceAlarmPreviewEnvironment()
}

#Preview("VoiceProfileManagementPanel (dark)") {
    VoiceProfileManagementPanel(route: .constant(.management))
        .preferredColorScheme(.dark)
        .voiceAlarmPreviewEnvironment()
}

#Preview("Delete dialog") {
    VoiceProfileDeleteDialog(
        profileName: "아침 보이스",
        force: .constant(true),
        onCancel: {},
        onConfirm: {}
    )
    .padding()
}
#endif
