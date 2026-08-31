import SwiftUI

/// AlarmTalk 의 목소리 프로필 관리 화면.
///
/// Android `VoiceProfileManagementPanel.kt` (1158 줄) 의 SwiftUI 포팅. 슬롯 상태,
/// 프로필 행, 편집/공유/삭제 다이얼로그, 슬롯 부족 시 PlanGate 트리거, errorCode
/// 매핑까지 한 화면이 책임진다. 녹음/업로드 워크플로우는 형제 컴포넌트
/// `VoiceCloneUploadFlow` 가 맡고 본 화면은 라우팅만 한다.
struct VoiceProfileManagementPanel: View {
    @Environment(\.voiceAlarmTheme) private var theme
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
    /// 쿠폰 코드 등록. 유료 게이트는 **항상** 이 갈래를 함께 낸다(`PaidGateCopy.redeemCode`).
    /// 코드를 등록하고 **실패 사유**를 돌려준다(성공이면 `nil`) — 시트가 입력창 밑에 그린다.
    var onRedeemCode: ((String) async -> String?)? = nil

    /// 프로필 편집 다이얼로그 입력값.
    @State private var editTarget: VoiceProfile?
    @State private var editName: String = ""
    @State private var editRelationship: String = ""
    @State private var editListenerTitle: String = ""
    @State private var editIsShared: Bool = false

    /// 삭제 확인 다이얼로그 입력값. force 토글 포함.
    @State private var deleteTarget: VoiceProfile?

    /// 슬롯 가득 시 노출하는 플랜 안내 시트.
    @State private var planGateOpen: Bool = false
    @State private var redeemCodeAlertOpen = false
    /// 유료인데 **이번 달 등록 한도**를 다 쓴 경우. 이용권 안내와 **다른 모달**이다 —
    /// 이미 이용권이 있는 사람에게 이용권을 사라고 하면 안 된다.
    @State private var monthlyLimitNoticeOpen: Bool = false

    /// 내 목소리 행의 ⋮ 가 여는 액션 시트 대상.
    @State private var actionSheetTarget: VoiceProfile?

    /// 사전렌더(알람 음성 준비) 상태 — 목소리 id → 상태. 5초 폴링으로 채운다.
    @State private var prerenderStatuses: [String: VoicePrerenderStatus] = [:]
    @State private var retryingPrerenderIDs: Set<String> = []
    @State private var retryingSpeechStyleIDs: Set<String> = []

    /// 공유받은 음성에 viewer 가 자신의 관계/호칭을 등록할 때 사용하는 다이얼로그 타깃.
    /// (⚠ 안드로이드에 `SharedVoiceViewerInfoDialog` 라는 이름은 없다 — 옛 주석이 틀렸다.
    ///  같은 일을 하는 곳은 `ui/voices/VoiceProfileManagementPanel.kt` 의 호칭 등록 흐름이다.)
    @State private var sharedViewerInfoTarget: FamilyVoiceProfile?

    /// 기본 목소리 선택 시트 노출 상태 (Android defaultVoiceSheetOpen 미러).
    @State private var defaultVoiceSheetOpen: Bool = false

    /// 시스템(스톡) 목소리 = 무료에서도 쓰는 기본 목소리. 내 목소리/공유 목소리와 분리해 노출.
    private var systemVoices: [VoiceProfile] {
        voice.profiles.filter { isSystemVoice($0) }
    }
    /// ⚠ **무료면 내 목소리를 목록에서 숨긴다**(2026-08-31, 안드로이드
    /// `VoiceProfileManagementPanel.ownVoices` 미러). 유료여야 쓸 수 있는데 그대로 보여
    /// 주면 미리듣기·이름 수정·공유·**삭제**까지 눌린다 — 보관 유예 안에 다시 시작하면
    /// 돌아올 목소리를 사용자가 모르고 지운다. 대신 그 자리에 안내 한 줄을 둔다
    /// (`freeLockedNotice`) — 아무 말 없이 사라지면 이미 지워진 것으로 읽힌다.
    private var ownVoices: [VoiceProfile] {
        guard paidVoiceEntitledNow else { return [] }
        return voice.profiles.filter { !isSystemVoice($0) }
    }

    /// ⚠ **만료까지 보는 판정**(2026-08-31 리뷰, 안드로이드 `isPaidVoiceEntitledNow` 미러).
    /// `PlanTier.bestKnown` 은 구매 직후 깜빡임을 줄이려고 `status == "active"` 만 보는데,
    /// 오프라인이거나 갱신이 느리면 **만료된 스냅샷으로도** 유료로 읽혀 숨겨야 할 목소리가
    /// 미리듣기·이름 수정·공유·삭제까지 가능한 채로 드러난다.
    ///
    /// ⚠ **단 StoreKit 이 살아 있다고 하면 서버 만료로 뒤집지 않는다**(2026-08-31 리뷰 2차).
    /// 「구독 수명주기 — **스토어가 권위다**」(docs/spec/billing-lifecycle.md). 갱신 직후
    /// 백엔드 동기화가 아직 안 왔을 뿐인데 옛 만료시각으로 거부하면, **지금 돈을 내고 있는
    /// 사용자가** 자기 목소리 목록을 통째로 잃는다 — 고치려던 것과 정반대 방향의 사고다.
    /// 서버 만료는 StoreKit 이 확인해 주지 못할 때만 본다.
    ///
    /// 만료 시각을 못 읽으면 **막지 않는다** — 과차단이 더 나쁘다(안드로이드와 같은 규칙).
    private var paidVoiceEntitledNow: Bool {
        // **유일 판정기**를 통과시킨다(`PaidVoiceGate.resolve`) — 안드로이드
        // `resolvePaidVoiceAccess` 와 같은 우선순위: 스토어 → 서버 구독(만료) → 그룹 → 모름.
        // 여기는 표시·생성 게이트라 **모르면 잠그지 않는다.**
        let snapshot = AccessSnapshot(
            subscriptionResponse: socialFeatures.subscription,
            familyGroup: socialFeatures.familyGroup,
            storePlanKey: subscriptions.currentTier.meetsOrExceeds(.personal)
                ? subscriptions.currentTier.rawValue : nil
        )
        return PaidVoiceGate.isEntitled(snapshot: snapshot)
    }

    var body: some View {
        // ⚠ **페이지 대제목('목소리')을 두지 않는다.** 하단 탭 라벨이 이미 위치를 말해주고,
        // 첫 섹션 제목('내 목소리')이 곧바로 내용을 연다(안드로이드 `AlarmListScreen.kt:212`
        // 주석과 알람 탭의 무제목 규칙에 맞춤).
        //
        // ⚠ **'목소리 슬롯' 진행바 카드도 두지 않는다.** 안드로이드에 없는 컨트롤이다 —
        // 남은 개수는 '내 목소리' 섹션 헤더의 '생성 가능 n/m회'가 말하고, 슬롯이 가득 차면
        // 추가 버튼을 누를 때 안내 모달이 뜬다. 진행바는 상시로 자리만 차지했다.
        VStack(alignment: .leading, spacing: 16) {
            if let message = voice.statusMessage {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
                    .padding(.horizontal, 4)
            }

            // ⚠ **전용 '목소리 없음' 빈 화면을 두지 않는다.** 안드로이드는 기본 목소리
            // 섹션이 **항상** 나오므로 이 화면이 비는 일이 없다 — 빈 화면을 그리면
            // 무료 사용자에게 쓸 수 있는 기본 목소리 4개를 도로 가리게 된다.
            ownProfilesSection
            familyProfilesSection
            if !systemVoices.isEmpty {
                // 기본 제공 목소리는 맨 아래 — 개인화된 목소리(내 것·공유받은 것)가 먼저다.
                systemVoicesSection
            }
        }
        .task { await voice.refresh(session: auth.session) }
        // ⚠ **이용권도 여기서 갱신한다**(안드로이드 `NativeTab.Voices → preloadSocial()` 대응).
        //
        // 예전에는 이 화면이 목소리 목록만 새로 받고 **권한은 앱 시작의 캐시 스냅샷**
        // (`restoreAccessSnapshot`)에 기대고 있었다. 그래서 이 기기 밖에서 플랜이 바뀌면
        // (다른 기기 결제·선물 코드·가족 그룹 합류) 캐시가 옛 '무료' 인 채로 남아,
        // **가족 이용권 사용자가 '추가' 를 눌렀는데 이용권 안내 모달이 떴다**
        // (2026-08-24 실기기). 이용권 화면에 한 번 다녀오면 그제야 풀렸는데, 그건 그 화면만
        // `refreshAll` 을 부르기 때문이었다 — 목소리를 만들려는 사람이 이용권 화면에
        // 들를 이유가 없으니 영영 막힌 것처럼 보인다.
        //
        // `force` 를 주지 않는 이유: 탭을 오갈 때마다 재조회하지 않도록 뷰모델의 스로틀에
        // 맡긴다(안드로이드 `preloadSocial` 과 같은 결).
        .task { await socialFeatures.refreshAll(session: auth.session) }
        // 내 목소리 행의 ⋮ — 안드로이드는 관리 시트(이름 수정·공유·삭제)를 연다.
        .confirmationDialog(
            actionSheetTarget?.name ?? "",
            isPresented: Binding(get: { actionSheetTarget != nil }, set: { if !$0 { actionSheetTarget = nil } }),
            titleVisibility: .visible
        ) {
            Button("이 목소리 사용") {
                if let profile = actionSheetTarget { voice.selectedProfileID = profile.id }
                actionSheetTarget = nil
            }
            Button("이름 수정") {
                if let profile = actionSheetTarget {
                    editName = profile.name
                    actionSheetTarget = nil
                    // 다음 런루프에 알럿을 띄운다 — 액션시트가 닫히는 프레임에 겹치면
                    // 둘 다 안 뜨는 상태로 끝난다.
                    DispatchQueue.main.async { editTarget = profile }
                }
            }
            if canShareVoice, let profile = actionSheetTarget {
                Button(profile.isShared == true ? "공유 끄기" : "공유 허용") {
                    let next = !(profile.isShared ?? false)
                    actionSheetTarget = nil
                    Task { await voice.toggleShare(profile, isShared: next, session: auth.session) }
                }
            }
            Button("삭제", role: .destructive) {
                if let profile = actionSheetTarget {
                    actionSheetTarget = nil
                    DispatchQueue.main.async { deleteTarget = profile }
                }
            }
            Button("취소", role: .cancel) { actionSheetTarget = nil }
        }
        // 사전렌더 진행 폴링 — 준비 중인 목소리가 하나라도 있는 동안만 돈다.
        .task(id: ownVoices.map(\.id).joined(separator: ",")) {
            await pollPrerenderStatuses()
        }
        // ⚠ **이름만 고친다.** 관계·호칭을 함께 보내면 서버가 409
        // `VOICE_PERSONA_LOCKED` 로 거절해(`voice-profile.ts:733-741`) **이름 변경조차
        // 실패했다.** 등록이 끝난 뒤엔 알람 클립이 이미 그 페르소나로 전부 렌더돼 있어
        // 바꿀 수 있는 값이 아니다. 관계·호칭 입력은 등록 플로우에만 둔다.
        .alert("이름 수정", isPresented: renameAlertBinding) {
            TextField("목소리 이름", text: $editName)
                .textInputAutocapitalization(.never)
            Button("닫기", role: .cancel) { editTarget = nil }
            // ⚠ **빈 이름을 조용히 삼키지 말 것.** 예전에는 `editTarget = nil` 로
            // 알럿을 먼저 닫고 그다음 guard 로 return 했다 — 저장을 눌러도 알럿만
            // 닫히고 아무 일도 일어나지 않아, 사용자는 저장된 줄 안다.
            // 이제 빈 값이면 **버튼 자체가 비활성**이라 그 상태가 만들어지지 않는다.
            Button("저장") {
                guard let profile = editTarget else { return }
                let newName = InputSanitizer.clampVoiceName(
                    InputSanitizer.sanitizeDisplayName(editName)
                )
                editTarget = nil
                guard !newName.isEmpty, newName != profile.name else { return }
                Task { await voice.renameProfile(profile, newName: newName, session: auth.session) }
            }
            .disabled(
                InputSanitizer.sanitizeDisplayName(editName)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                    .isEmpty
            )
        } message: {
            Text("알람 목록과 목소리 탭에 보이는 이름이에요. 이름은 비울 수 없어요.")
        }
        // ⚠ **확인형 모달은 시스템 `.alert` 다**(CLAUDE.md 「iOS 는 안드로이드를 원본으로
        // 삼는다」의 플랫폼 표준 갈래). 예전에는 커스텀 시트였고, 거기에 안드로이드에
        // 없는 '사용 중인 알람도 함께 정리' 토글이 붙어 있었다 — 끄면 사용 중인 목소리는
        // 삭제가 조용히 실패한다. 안드로이드는 선택지를 주지 않고 **항상 강등 삭제**다.
        .alert(
            monthlyExhausted ? "정말 삭제할까요?" : "목소리 삭제",
            isPresented: Binding(
                get: { deleteTarget != nil },
                set: { if !$0 { deleteTarget = nil } }
            ),
            presenting: deleteTarget
        ) { profile in
            Button("삭제", role: .destructive) {
                let target = profile
                deleteTarget = nil
                Task {
                    let didDelete = await voice.deleteProfile(
                        target,
                        session: auth.session,
                        // 안드로이드와 같이 **항상 강등 삭제**다. 선택지를 두면 끈 사람은
                        // 사용 중인 목소리를 영영 못 지운다.
                        force: true,
                        alarmStore: alarmStore,
                        audioCache: AudioCacheStore.shared
                    )
                    if didDelete {
                        await socialFeatures.refreshAll(session: auth.session, force: true)
                    }
                }
            }
            Button("취소", role: .cancel) { deleteTarget = nil }
        } message: { profile in
            if monthlyExhausted {
                Text("이 목소리로 만든 알람은 기본 알람음으로 바뀌고, 저장된 음성도 함께 지워져요. 되돌릴 수 없어요. 이번 달에는 새 목소리를 만들 수 없고, 다음 달부터 다시 만들 수 있어요.")
            } else {
                Text("'\(profile.name)' 목소리를 삭제할까요?\n이 목소리를 쓰는 알람은 기본 알람음으로 바뀌어요. 저장된 음원 파일도 함께 삭제돼요.")
            }
        }
        // 화자 분리는 제품에서 사라졌다(VoicesPanelView 주석 참조) — 없는 기능을 근거로
        // 결제를 권하지 않는다.
        .alert("이번 달 목소리는 다 만들었어요", isPresented: $monthlyLimitNoticeOpen) {
            Button("닫기", role: .cancel) {}
        } message: {
            Text("목소리는 한 달에 1개 만들 수 있어요. 다음 달에 새로 만들 수 있고, 지금 목소리를 지워도 이번 달에는 다시 만들 수 없어요.")
        }
        // ⚠ **alert 제목에 마침표를 찍지 말 것**(Apple HIG). 제목은 짧은 구절이고,
        // 문장이 필요하면 `message` 로 내린다 — 다른 alert 들도 전부 그렇게 돼 있다.
        // ⚠ **쿠폰 갈래를 빼지 말 것.** 안드로이드 게이트에는 처음부터 있었는데
        // 여기만 없어서, 같은 상황에서 iOS 사용자는 **코드로 여는 길을 못 봤다**
        // (2026-08-11 전수 조사). 제목도 안드로이드(`voices_create_paid_title`)에 맞춘다.
        .alert("내 목소리 만들기는 유료 기능이에요", isPresented: $planGateOpen) {
            Button("닫기", role: .cancel) {}
            Button(PaidGateCopy.redeemCode) { redeemCodeAlertOpen = true }
            Button(PaidGateCopy.viewPlans) { onRequestBilling?() }
                // ⚠ **이 줄이 강조를 만든다 — 빼지 말 것.** 시스템 알럿은 버튼 색을 직접
                // 주지 못하고, '기본 액션' 으로 지정된 하나만 채운 캡슐로 그린다. 없으면
                // 세 버튼이 **똑같은 회색**이라 주행동이 사라진다(2026-08-18 실기기 확인).
                // 편집기 쪽 짝은 `Views/Editor/VoicePlanGateAlert.swift` — 한쪽만 고치지 말 것.
                .keyboardShortcut(.defaultAction)
        } message: {
            Text(PaidGateCopy.message)
        }
        // ⚠ 껍데기는 `RedeemCodeSheet` 하나다 — 편집기 게이트도 같은 것을 쓴다.
        // 여기에 알럿을 다시 만들면 실패 사유를 그릴 자리가 없어져, 코드를 잘못 친
        // 사용자에게 모달이 그냥 닫힌다(2026-08-18 실기기 확인).
        .redeemCodeSheet(isPresented: $redeemCodeAlertOpen) { code in
            await onRedeemCode?(code)
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

    /// 화면에 숫자를 띄울 쿼터. **유료 사용자에게만** 의미가 있다 —
    /// 무료에게 '생성 가능 0/1회'는 마치 이용권만 있으면 이미 다 쓴 것처럼 읽혀 거짓말이 된다.
    private var monthlyQuota: VoiceDraftQuotaResponse? {
        // 만료까지 보는 판정 — 목록만 숨기고 쿼터를 옛 판정으로 두면 숫자만 남는다.
        guard paidVoiceEntitledNow, let quota = voice.draftQuota, quota.registrationLimit > 0 else { return nil }
        return quota
    }

    /// ⚠ **정식 등록 쿼터로 판정한다.** 초안 쿼터의 `remaining` 은 제한 해제 후 호환용으로
    /// 0 고정이라, 그걸 쓰면 이번 달 등록이 남아 있어도 소진으로 읽힌다.
    private var monthlyExhausted: Bool {
        (monthlyQuota?.registrationRemaining ?? 1) <= 0
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
        // ⚠ **'새로고침' 버튼은 두지 않는다.** 안드로이드에 없는 컨트롤이고, 화면 진입
        // `.task` 와 사전렌더 폴링이 이미 최신값을 가져온다 — 눌러야 최신이 되는 것처럼
        // 보이면 사용자가 그걸 매번 누르게 된다.
        // ⚠ 목소리가 없으면 **빈 카드를 그리지 않는다.** 예전에는 "아직 만든 목소리가
        // 없어요." 한 줄이 든 빈 상자가 항상 자리를 차지했다 — 바로 옆 '추가' 버튼이
        // 이미 무엇을 해야 하는지 말하고 있어서 같은 말을 두 번 하는 셈이었다.
        // (그 문구는 번역 카탈로그에도 없어 en/ja 기기에는 한국어로 떴다.)
        VoiceSectionCard(
            title: "내 목소리",
            trailing: AnyView(addVoiceHeaderTrailing),
            hasContent: !ownVoices.isEmpty
        ) {
            ForEach(Array(ownVoices.enumerated()), id: \.element.id) { index, profile in
                if index > 0 {
                    Divider().overlay(theme.palette.outlineVariant).padding(.leading, 16)
                }
                VoiceCatalogRow(
                    name: profile.name,
                    subtitle: ownSubtitle(profile),
                    isPlaying: voice.previewingGreetingVoiceId == profile.id,
                    onPreview: {
                        Task { await voice.previewGreeting(voiceId: profile.id, session: auth.session) }
                    },
                    // 생성 중인 행은 손대지 못하게 한다 — 그 사이 이름을 바꾸거나 지우면
                    // 서버 상태와 어긋난 요청이 나간다.
                    enabled: normalizedStatus(profile.status) != "processing" && !voice.isBusy,
                    onOpenActions: { actionSheetTarget = profile },
                    below: {
                        if let status = prerenderStatuses[profile.id] {
                            VoicePrerenderStatusRow(
                                status: status,
                                retrying: retryingPrerenderIDs.contains(profile.id),
                                onRetry: { Task { await retryPrerender(profile) } }
                            )
                        }
                        // 말투 분석 실패 — 서버에 재시도 라우트가 있는데 부를 길이 없었다.
                        if profile.speechStyleStatus == "failed" {
                            VoiceSpeechStyleFailedRow(
                                retrying: retryingSpeechStyleIDs.contains(profile.id),
                                onRetry: { Task { await retrySpeechStyle(profile) } }
                            )
                        }
                    }
                )
            }
        }
    }

    /// 섹션 헤더 오른쪽 — 남은 생성 횟수 + '추가'. 안드로이드 `VoiceProfileManagementPanel.kt:1274-1305`.
    private var addVoiceHeaderTrailing: some View {
        HStack(spacing: 10) {
            // ⚠ **유료만 숫자를 본다.** 무료에게 '생성 가능 0/1회'는 마치 이용권만 있으면
            // 이미 다 쓴 것처럼 읽혀 거짓말이 된다 — 무료는 숫자 없이 버튼만 두고,
            // 눌렀을 때 이용권 안내로 보낸다.
            if let quota = monthlyQuota, paidVoiceEntitledNow, quota.registrationLimit > 0 {
                Text("생성 가능 \(max(quota.registrationRemaining, 0))/\(quota.registrationLimit)회")
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
            }
            Button {
                // ⚠ **세 갈래를 구분한다**(안드로이드 `VoiceProfileManagementPanel.kt:1293-1299`).
                // 무료면 이용권 안내, 유료인데 이번 달을 다 썼으면 한도 안내.
                // 예전에는 둘 다 이용권 안내로 보내, 이용권이 있는 사람에게 이용권을
                // 사라고 말하고 있었다.
                // 안드로이드 `ui/voices/VoiceProfileManagementPanel.kt` 의 when 과 **같은 세 갈래**다:
                //   canOpenCreateForm → 폼 / !canCreateVoice → 이용권 안내 / else → 한도 안내
                if !paidVoiceEntitledNow {
                    planGateOpen = true
                } else if monthlyExhausted {
                    // ⚠ **이용권 안내를 띄우지 말 것.** 이미 유료인 사람에게 "이용권을
                    // 사세요" 라고 말하게 된다 — 한도를 다 쓴 것과 이용권이 없는 것은 다르다.
                    monthlyLimitNoticeOpen = true
                } else {
                    // ⚠ **슬롯이 찼다고 막지 않는다**(2026-08-12 확정).
                    // 이미 목소리가 있으면 등록을 끝까지 진행시키고, **마지막 확정 화면**
                    // (`VoicePreviewConfirmView`)에서 "기존 목소리를 교체할까요" 를 묻는다.
                    // 예전에는 여기서 막아 그 화면에 도달할 수 없었고, 승격의
                    // `replace_existing` 갈래가 **죽은 코드**였다.
                    //
                    // 막는 기준은 **월 등록 한도 하나**다 — 그건 교체해도 풀리지 않으므로
                    // 녹음을 다 시킨 뒤 거절하지 않도록 입구에서 알린다.
                    route = .clone
                }
            } label: {
                // ⚠ **여백은 라벨에 준다 — 바깥 `.frame` 은 캡슐을 못 키운다.**
                // `borderedProminent` 는 **라벨 크기**에 맞춰 색칠된 캡슐을 그리고,
                // 버튼 바깥에 건 `.frame(minHeight:)` 은 그 위에 **투명 여백**만 얹는다.
                // 그래서 예전에는 터치 타깃만 44 였고 **보이는 버튼은 31pt** 였다
                // (2026-08-11 스크린샷 픽셀로 실측 — 눈으로 작아 보인 게 맞았다).
                // 안드로이드 M3 `Button` 기본 높이 40dp 에 맞춘다.
                Text("추가")
                    .padding(.vertical, 5)
                    // 좌우도 라벨에 준다 — 세로와 같은 이유다(캡슐은 **라벨 크기**에 맞춰
                    // 그려지므로 버튼 바깥 여백으로는 안 넓어진다). 2026-08-11 지적
                    // "좌우 여백이 너무 없다" — 실측 폭 48pt 였다.
                    .padding(.horizontal, 8)
            }
            .font(theme.typography.bodyMedium.weight(.semibold))
            .buttonStyle(.borderedProminent)
            .tint(theme.palette.primary)
            // ⚠ `.controlSize(.small)` 을 쓰지 말 것 — 높이가 28pt 안팎으로 떨어져
            // **최소 터치 타깃(44pt)을 밑돈다.** 섹션 헤더에 있다고 작게 만들 이유가
            // 없다. 이 버튼이 목소리를 만드는 **유일한 진입점**이다.
            //
            // ⚠⚠ **`.buttonStyle` **뒤에** 걸어야 한다.** 앞에 두면 그 44 는 버튼이 아니라
            // **라벨**에 걸리고, 스타일이 제 높이로 다시 그려서 아무 효과가 없다 —
            // 그렇게 둔 채로 주석만 "44를 지킨다" 고 적혀 있었고 **실측은 31pt** 였다
            // (2026-08-11, XCUITest `VoiceAddButtonUITests`). 지켜 준다고 적힌 보호 장치가
            // 실제로는 아무것도 안 하고 있었다.
            .frame(minHeight: 44)
            // ⚠ **이번 달을 다 썼으면 버튼을 끈다** — 안드로이드
            // (`ui/voices/VoiceProfileManagementPanel.kt` 의 `enabled = !voiceProfileBusy
            // && !monthlyExhausted`)와 같다. 흐려도 '왜' 가 읽히는 건 **바로 옆에
            // '생성 가능 0/1회'가 있기 때문**이고, 그 숫자는 유료일 때만 뜨는데
            // `monthlyExhausted` 도 유료일 때만 참이라 둘은 항상 같이 나타난다.
            //
            // (예전 주석은 "안드로이드는 켜 두고 눌렀을 때 이유를 말한다" 고 적어 두고
            // 켜 둔 채로 안내 모달을 띄웠는데, **안드로이드는 그런 적이 없다.** 없는 근거로
            // 갈라져 있었다 — 한 번 더 눌러야 이유를 듣는 만큼 iOS 쪽이 손해였다.)
            .disabled(voice.isBusy || monthlyExhausted)
        }
    }

    /// 행 둘째 줄 — 관계 라벨이 있으면 그걸, 없으면 상태를 보여준다.
    private func ownSubtitle(_ profile: VoiceProfile) -> String? {
        switch normalizedStatus(profile.status) {
        case "processing": return "만드는 중"
        case "failed": return "만들지 못했어요"
        default: break
        }
        var parts: [String] = []
        if let relationship = profile.relationshipLabel?.nilIfBlank { parts.append(relationship) }
        if profile.isShared == true { parts.append("공유 중") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    @ViewBuilder
    private var familyProfilesSection: some View {
        if canShareVoice && !voice.familyVoices.isEmpty {
            VoiceSectionCard(title: "공유받은 목소리") {
                ForEach(Array(voice.familyVoices.enumerated()), id: \.element.id) { index, family in
                    if index > 0 {
                        Divider().overlay(theme.palette.outlineVariant).padding(.leading, 16)
                    }
                    VoiceCatalogRow(
                        name: family.name,
                        subtitle: family.sharedFromLabel,
                        isPlaying: voice.previewingGreetingVoiceId == family.id,
                        onPreview: {
                            Task { await voice.previewGreeting(voiceId: family.id, session: auth.session) }
                        },
                        // 공유받은 목소리에서 내가 손댈 수 있는 건 '나를 부를 호칭' 뿐이라
                        // ⋮ 대신 아래 CTA 로 낸다(관계·호칭이 비어 있을 때만).
                        below: {
                            if family.requiresViewerInfo {
                                Button {
                                    sharedViewerInfoTarget = family
                                } label: {
                                    Text("이 목소리가 나를 어떻게 부를지 설정")
                                        .font(theme.typography.bodySmall.weight(.semibold))
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 8)
                                }
                                .buttonStyle(.bordered)
                                .tint(theme.palette.primary)
                            }
                        }
                    )
                }
            }
        }
    }

    // MARK: - 기본(시스템) 목소리

    /// ⚠ **시트 뒤에 숨기지 말 것.** 안드로이드는 기본 목소리 4종을 목록에 그대로 펼친다.
    /// 예전 구조(값 + 셰브론 → 시트)에서는 **무료 사용자에게 정작 쓸 수 있는 기본 목소리
    /// 4개가 시트를 열기 전까진 보이지 않았다** — 안드로이드가 이 화면을 고친 이유가 그거다.
    ///
    /// '호칭' TextField 도 여기 두지 않는다(안드로이드에 없다). 호칭은 등록 플로우에서 받는다.
    @ViewBuilder
    private var systemVoicesSection: some View {
        VoiceSectionCard(title: "기본 목소리") {
            ForEach(Array(systemVoices.enumerated()), id: \.element.id) { index, profile in
                if index > 0 {
                    Divider().overlay(theme.palette.outlineVariant).padding(.leading, 16)
                }
                // ⚠ **부가설명도 ⋮ 도 두지 않는다.** 섹션 이름이 이미 '기본 목소리' 라고
                // 말하고, 이 행에는 관리할 게 없다(안드로이드 `VoiceProfileManagementPanel.kt:1411`).
                // 행 전체가 미리듣기다.
                VoiceCatalogRow(
                    name: profile.name,
                    isPlaying: voice.previewingGreetingVoiceId == profile.id,
                    onPreview: {
                        Task { await voice.previewGreeting(voiceId: profile.id, session: auth.session) }
                    }
                )
            }
        }
    }

    /// 사전렌더 상태 폴링. 안드로이드는 5초 간격으로 돈다(`VoiceProfileManagementPanel.kt:979-1036`).
    ///
    /// ⚠ **끝나면 멈춘다.** 준비 중(`pending`)인 목소리가 없으면 루프를 빠져나온다 —
    /// 안 그러면 목소리 탭을 열어 둔 내내 5초마다 네트워크를 친다.
    private func pollPrerenderStatuses() async {
        guard let token = auth.session?.token else { return }
        while !Task.isCancelled {
            var anyPending = false
            for profile in ownVoices where !isSystemVoice(profile) {
                guard let status = try? await AlarmTalkAPI.shared.voicePrerenderStatus(id: profile.id, token: token)
                else { continue }
                prerenderStatuses[profile.id] = status
                if status.status == "pending" {
                    anyPending = true
                    // 앱이 열려 있는 동안은 cron 을 기다리지 않고 우리가 앞당긴다
                    // (호출당 최대 3클립). 실패는 무시 — 다음 회차가 다시 시도한다.
                    _ = try? await AlarmTalkAPI.shared.advanceVoicePrerender(id: profile.id, token: token)
                }
            }
            guard anyPending else { return }
            try? await Task.sleep(nanoseconds: 5_000_000_000)
        }
    }

    private func retryPrerender(_ profile: VoiceProfile) async {
        guard let token = auth.session?.token else { return }
        retryingPrerenderIDs.insert(profile.id)
        defer { retryingPrerenderIDs.remove(profile.id) }
        guard (try? await AlarmTalkAPI.shared.retryVoicePrerender(id: profile.id, token: token)) != nil else {
            voice.statusMessage = "다시 시도하지 못했어요. 잠시 뒤에 눌러 주세요."
            return
        }
        await pollPrerenderStatuses()
    }

    /// 말투 분석 재시도. 서버에 라우트가 있는데 부를 길이 없어 실패가 영구였다.
    private func retrySpeechStyle(_ profile: VoiceProfile) async {
        guard let token = auth.session?.token else { return }
        retryingSpeechStyleIDs.insert(profile.id)
        defer { retryingSpeechStyleIDs.remove(profile.id) }
        do {
            _ = try await AlarmTalkAPI.shared.retryVoiceSpeechStyle(id: profile.id, token: token)
            // 상태는 서버가 다시 계산하므로 목록을 새로 읽어 실패 행이 사라지게 한다.
            await voice.refresh(session: auth.session)
        } catch {
            voice.statusMessage = "말투 분석을 다시 시도하지 못했어요. 잠시 뒤에 눌러 주세요."
        }
    }

    /// `.alert` 는 `item:` 형태가 없어 Bool 바인딩으로 감싼다.
    private var renameAlertBinding: Binding<Bool> {
        Binding(get: { editTarget != nil }, set: { if !$0 { editTarget = nil } })
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
