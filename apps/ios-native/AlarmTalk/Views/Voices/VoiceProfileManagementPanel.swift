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
            } else if !voice.profiles.isEmpty {
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
        .sheet(isPresented: $planGateOpen) {
            VoicePlanGateSheet(
                onUpgrade: {
                    planGateOpen = false
                    // Phase 4-D1: 부모(MainTabsView)가 .billing auxiliary 시트를
                    // 띄우도록 콜백 호출. 시트 충돌을 피하려 PlanGate 시트를 먼저
                    // 닫고, 부모가 짧은 지연 뒤 빌링 시트를 연다.
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
                    if !hasPaidVoiceAccess || voice.isProfileLimitReached {
                        planGateOpen = true
                    } else {
                        route = .clone
                    }
                } label: {
                    Label("녹음으로 만들기", systemImage: "mic.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(AlarmTalkTheme.primary)
                .disabled(voice.isBusy)

                Button {
                    if !hasPaidVoiceAccess || voice.isProfileLimitReached {
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
            ForEach(voice.profiles) { profile in
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
