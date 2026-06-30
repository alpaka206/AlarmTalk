import SwiftUI

/// AlarmTalk 의 목소리 프로필 관리 화면.
///
/// Android `VoiceProfileManagementPanel.kt` (1158 줄) 의 SwiftUI 포팅. 슬롯 상태,
/// 프로필 행, 편집/공유/삭제 다이얼로그, 슬롯 부족 시 PlanGate 트리거, errorCode
/// 매핑까지 한 화면이 책임진다. 녹음/업로드 워크플로우는 형제 컴포넌트
/// `VoiceCloneUploadFlow` / `SpeakerSeparationFlow` 가 맡고 본 화면은 라우팅만 한다.
struct VoiceProfileManagementPanel: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var voice: VoiceStudioViewModel
    @EnvironmentObject private var alarmStore: LocalAlarmStore
    @EnvironmentObject private var socialFeatures: SocialFeatureViewModel
    @EnvironmentObject private var subscriptions: SubscriptionManager

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

    /// 시스템(기본) 목소리 섹션 접이식 상태.
    @State private var systemVoicesExpanded: Bool = false

    /// 시스템(스톡) 목소리 = 무료에서도 쓰는 기본 목소리. 내 목소리/공유 목소리와 분리해 노출.
    private var systemVoices: [VoiceProfile] {
        voice.profiles.filter { isSystemVoice($0) }
    }
    private var ownVoices: [VoiceProfile] {
        voice.profiles.filter { !isSystemVoice($0) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ScreenHeader(title: "목소리", subtitle: nil)
            slotStatusCard
            addActionsRow
            if let message = voice.statusMessage {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
                    .padding(.horizontal, 4)
            }

            if voice.profiles.isEmpty && hasPaidVoiceAccess {
                EmptyStatePlaceholder(
                    title: "아직 사용할 수 있는 목소리가 없어요.",
                    subtitle: "60초 이상 녹음한 뒤 학습을 등록해 주세요.",
                    icon: "mic.slash"
                )
            } else {
                if !ownVoices.isEmpty {
                    ownProfilesSection
                }
                if !systemVoices.isEmpty {
                    systemVoicesSection
                }
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
                canShareVoice: canShareVoice,
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
                        let didDelete = await voice.deleteProfile(
                            target,
                            session: auth.session,
                            force: force,
                            alarmStore: alarmStore,
                            audioCache: AudioCacheStore.shared
                        )
                        if didDelete {
                            await socialFeatures.refreshAll(session: auth.session, force: true)
                        }
                    }
                }
            )
            .presentationDetents([.medium])
        }
        .alert("녹음과 화자 분리로 목소리를 만들려면 유료 플랜이 필요해요.", isPresented: $planGateOpen) {
            Button("닫기", role: .cancel) {}
            Button("플랜 보기") {
                onRequestBilling?()
            }
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

    private var slotStatusCard: some View {
        let used = voice.usedProfileSlots
        let max = VoiceProfileLimits.maxProfiles
        let progress = max == 0 ? 0.0 : Double(used) / Double(max)
        let isFull = voice.isProfileLimitReached
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: isFull ? "exclamationmark.triangle.fill" : "person.crop.circle.badge.checkmark")
                    .foregroundStyle(isFull ? AlarmTalkTheme.error : AlarmTalkTheme.primary)
                Text("목소리 슬롯")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text("\(used) / \(max)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
            }
            ProgressView(value: progress)
                .tint(isFull ? AlarmTalkTheme.error : AlarmTalkTheme.primary)
            if isFull {
                Text("슬롯이 가득 찼어요. 기존 목소리를 삭제하거나 플랜을 업그레이드해 주세요.")
                    .font(.footnote)
                    .foregroundStyle(AlarmTalkTheme.error)
            } else {
                Text("최대 \(max)개까지 등록할 수 있어요. 남은 슬롯 \(voice.remainingProfileSlots)개.")
                    .font(.footnote)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
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
                    if !hasPaidVoiceAccess {
                        planGateOpen = true
                    } else if !voice.isProfileLimitReached {
                        route = .clone
                    }
                } label: {
                    Label("녹음으로 만들기", systemImage: "mic.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(AlarmTalkTheme.primary)
                .disabled(voice.isBusy || (hasPaidVoiceAccess && voice.isProfileLimitReached))

                Button {
                    if !hasPaidVoiceAccess {
                        planGateOpen = true
                    } else if !voice.isProfileLimitReached {
                        route = .separate
                    }
                } label: {
                    Label("화자 분리", systemImage: "person.2.wave.2")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(voice.isBusy || (hasPaidVoiceAccess && voice.isProfileLimitReached))
            }
            if !hasPaidVoiceAccess {
                Text("유료 이용권에서 사용할 수 있어요.")
                    .font(.footnote)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
            }
        }
        .sectionSurface()
    }

    private var hasPaidVoiceAccess: Bool {
        PlanTier.bestKnown(
            serverSubscription: socialFeatures.subscription,
            storeTier: subscriptions.currentTier,
            userPlan: auth.session?.user.plan
        )
        .meetsOrExceeds(.personal)
    }

    // MARK: - Own profiles list

    private var ownProfilesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("내 목소리")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Button("새로고침") {
                    Task { await voice.refresh(session: auth.session) }
                }
                .font(.footnote)
                .disabled(voice.isBusy)
            }
            ForEach(ownVoices) { profile in
                VoiceProfileRow(
                    profile: profile,
                    isSelected: profile.id == voice.selectedProfileID,
                    canShareVoice: canShareVoice,
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
        if canShareVoice && !voice.familyVoices.isEmpty {
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

    // MARK: - 기본(시스템) 목소리 (Android VoiceProfileManagementPanel.kt systemVoicesSection 미러)

    private var defaultVoiceName: String? {
        systemVoices.first { $0.id == voice.defaultVoiceId }?.name
    }

    @ViewBuilder
    private var systemVoicesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                withAnimation(.easeInOut(duration: 0.18)) { systemVoicesExpanded.toggle() }
            } label: {
                HStack {
                    // 기본이 정해졌으면 그 이름을, 아니면 종 수를 보여준다.
                    Text(defaultVoiceName.map { "기본 목소리 · \($0)" } ?? "기본 목소리 \(systemVoices.count)종")
                        .font(.subheadline.weight(.semibold))
                    Spacer()
                    Image(systemName: systemVoicesExpanded ? "chevron.up" : "chevron.down")
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
            }
            .buttonStyle(.plain)

            if systemVoicesExpanded {
                ForEach(systemVoices) { profile in
                    SystemVoiceProfileRow(
                        profile: profile,
                        selected: profile.id == voice.defaultVoiceId,
                        playing: voice.previewingGreetingVoiceId == profile.id,
                        onSelect: { voice.setDefaultVoice(profile.id) },
                        onPlay: { Task { await voice.previewGreeting(voiceId: profile.id, session: auth.session) } }
                    )
                }
            }

            // 기본 목소리가 정해졌으면 호칭을 여기서 수정(펼치지 않아도 보임). 입력 즉시 저장.
            if voice.defaultVoiceId != nil {
                VStack(alignment: .leading, spacing: 6) {
                    Text("호칭")
                        .font(.caption)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                    TextField("예: 지호, 자기, 대표님", text: Binding(
                        get: { voice.defaultListenerTitle ?? "" },
                        set: { voice.setDefaultListenerTitle(String($0.prefix(30))) }
                    ))
                    .textFieldStyle(.roundedBorder)
                }
                .padding(.top, 4)
            }
        }
    }

    private var canShareVoice: Bool {
        canShareVoiceWithOthers(
            subscriptionResponse: socialFeatures.subscription,
            familyGroup: socialFeatures.familyGroup,
            authSession: auth.session,
            storeTier: subscriptions.currentTier,
            userPlan: auth.session?.user.plan
        )
    }
}

/// 시스템(스톡) 목소리 행 — 카드 탭 = 기본 목소리로 선택, ▶ = 인사말 미리듣기, 라디오 = 선택 표시.
/// Android `SystemVoiceProfileRow` 미러.
private struct SystemVoiceProfileRow: View {
    let profile: VoiceProfile
    let selected: Bool
    let playing: Bool
    let onSelect: () -> Void
    let onPlay: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 8) {
                ZStack {
                    Circle().fill(AlarmTalkTheme.primary.opacity(0.14))
                    Image(systemName: "mic")
                        .foregroundStyle(AlarmTalkTheme.primary)
                }
                .frame(width: 42, height: 42)

                Text(profile.name)
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity, alignment: .leading)

                Button(action: onPlay) {
                    Image(systemName: playing ? "stop.fill" : "play.fill")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(AlarmTalkTheme.primary)
                        .frame(width: 40, height: 40)
                }
                .buttonStyle(.plain)

                ZStack {
                    Circle()
                        .strokeBorder(selected ? Color.clear : AlarmTalkTheme.outline, lineWidth: 2)
                        .background(Circle().fill(selected ? AlarmTalkTheme.primary : Color.clear))
                        .frame(width: 18, height: 18)
                    if selected {
                        Circle().fill(Color.white).frame(width: 7, height: 7)
                    }
                }
                .frame(width: 22, height: 22)
            }
            .padding(EdgeInsets(top: 8, leading: 14, bottom: 8, trailing: 6))
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? AlarmTalkTheme.primary.opacity(0.10) : AlarmTalkTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(AlarmTalkTheme.outline.opacity(0.4), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}
