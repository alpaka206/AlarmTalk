import SwiftUI
import UIKit

/// 알람 만들기/수정 시트 (Phase 3-C2).
///
/// Phase 3-C1 가 분리해 둔 264 줄 sheet 를, Android `AlarmEditorScreen.kt` +
/// `AlarmSettingsCard.kt` 수준으로 끌어올린 풀-폼. 본 파일은 *시트 UI* 만
/// 담당하고, 실제 시간 휠/요일 칩/진동 picker 등 컴포넌트는 별도 파일에서
/// 가져온다 (`TimeWheelPicker`, `RepeatWeekdayChips`, …).
///
/// 비즈니스 로직 (검증 → upsert → AlarmKit schedule) 은 본 파일이 그대로
/// 보유한다. 시트 외부에서 변하는 필드 (audio cache, sync state, alarmKitID
/// 등) 는 `AlarmEditDraft.toRecord(...)` 가 기존 record 의 값을 보존하며 다시
/// 합쳐 돌려준다.
struct AlarmEditorSheet: View {
    @EnvironmentObject var auth: AuthViewModel
    @EnvironmentObject var store: LocalAlarmStore
    @EnvironmentObject var alarmKit: AlarmKitViewModel
    @EnvironmentObject var remoteSync: RemoteAlarmSyncViewModel
    @EnvironmentObject var voiceStudio: VoiceStudioViewModel
    @EnvironmentObject var prefetcher: StockClipPrefetcher
    @EnvironmentObject var socialFeatures: SocialFeatureViewModel
    @EnvironmentObject var subscriptions: SubscriptionManager

    @StateObject var holidayStore = HolidayStore()
    @StateObject var localRecorder = VoiceRecorder()
    /// 에디터의 단일 미리듣기 플레이어(change 4). 기존의 두 플레이어
    /// (voiceStudio.previewPlayer 사용분 + localPreviewPlayer)와 previewingStockMessageID
    /// 를 이 하나 + previewTarget 으로 통합한다. voiceStudio.previewPlayer 는 에디터
    /// 밖(VoiceProfileManagementPanel 등) VM 소유 미리듣기 전용으로 그대로 남는다.
    @StateObject var editorPreviewPlayer = AudioPreviewPlayer()
    /// 지금 미리듣는 알람음 파일 경로.
    @State var previewingAlarmSoundPath: String?

    @Environment(\.voiceAlarmTheme) var theme

    /// 부모(MainTabsView)가 넘기는 target — 새 알람 vs 기존 알람 수정 구분.
    let target: AlarmEditorTarget
    /// 시트 닫기.
    let onClose: () -> Void
    /// 사용자가 "음성 탭에서 만들기" 버튼을 누른 경우 부모가 탭 전환을 처리.
    let onJumpToVoices: () -> Void
    /// 이용권 화면으로 보낸다. 게이트의 '이용권 보기' 가 쓴다.
    var onRequestBilling: (() -> Void)?
    /// 저장 완료 후 알람 탭으로 전환.
    let onSchedulingDidFinish: () -> Void

    // MARK: - Form state

    /// 세부 설정 카드가 여는 상세 화면.
    @State var settingsPane: AlarmSettingsPane?

    /// '문구' 요약 행이 여는 화면.
    @State var messagePaneOpen = false

    /// 무료 테마(버킷) 선택 화면.
    /// 직전에 고른 무료 테마를 이어받으려는 의도. 스톡 매니페스트가 도착하면 집는다.
    /// ⚠ 새 알람에서만 세운다 — 기존 알람은 자기 값을 써야 한다.
    @State var pendingFreeBucket: FreeBucket?

    /// 목소리 고르기 시트.
    @State var voiceSheetOpen = false

    @State var draft: AlarmEditDraft = .newDefault()
    @State var didLoadInitial = false
    @State var validationAlert: ValidationAlertContent?
    @State var duplicateAlarmConfirm: DuplicateAlarmConfirmContent?
    @State var isWorking = false
    /// 이번 달 직접 입력 여유. **유료일 때만** 조회한다(무료에게 숫자를 보이면
    /// 이용권만 있으면 이미 다 쓴 것처럼 읽혀 거짓말이 된다).
    @State var manualQuota: ManualQuotaResponse?
    @State var voiceGateAlert: VoiceGateAlertContent?
    @State var redeemCodeAlertOpen = false
    @State var sharedVoiceSetupTarget: FamilyVoiceProfile?
    /// 기본(시스템) 목소리로 바꾸면 직접 입력 문구를 쓸 수 없어 편집기가 문구를 비운다.
    /// 조용히 지우면 '문구가 사라졌다' 가 되므로 한 번 확인받는다
    /// (안드로이드 `VoiceAudioCard.kt:194-201` 의 `pendingVoiceSwitch`).
    @State var pendingVoiceSwitch: VoiceSelectionSheet.Option?
    @State var selectedFamilyRecipientID: String?
    @State var voiceSourceMode: VoiceSource = .ttsProfile
    @State var localAudioMode: AlarmLocalAudioInputMode = .record
    @State var localAudioMessage: String?
    @State var selectedLocalAudioURL: URL?
    @State var selectedLocalAudioName: String?
    @State var selectedLocalAudioDurationMs: Int?
    @State var localAudioCropStartMs = 0
    @State var localAudioCropEndMs = Int(AlarmAudioLimits.maxDurationMillis)
    @State var clearExistingLocalAudio = false
    /// 선택/미리듣기 중인 스톡 클립의 messageId. StockClipPicker 의 선택 표시에 사용.
    @State var stockSelectedMessageID: String?

    /// 준비 페이지를 띄울 목소리. 아직 클립을 다 못 받은 목소리를 고르면 여기 담긴다.
    @State var preparationVoiceID: String?

    /// 타입 체커가 body 안에서 인라인 바인딩을 만나면 시간 초과가 나서 밖으로 뺐다.
    private var preparationSheetPresented: Binding<Bool> {
        Binding(
            get: { preparationVoiceID != nil },
            set: { if !$0 { preparationVoiceID = nil } }
        )
    }

    @ViewBuilder
    private var preparationSheet: some View {
        // ⚠ `targetVoiceID` 를 반드시 넘긴다 — 안 넘기면 공유받은 목소리가 준비 대상에서
        // 빠져 "준비됐어요 100%" 만 보이고, 돌아가면 관문이 또 막는다(2026-08-18).
        ClipPreparationView(onDismiss: { preparationVoiceID = nil }, targetVoiceID: preparationVoiceID)
            .environmentObject(auth)
            .environmentObject(voiceStudio)
            // 시트는 환경을 그대로 물려받지 못하는 자리라 여기서도 다시 꽂는다
            // (위 둘과 같은 이유). 준비 화면이 프리페처를 깨울 수 있어야 한다.
            .environmentObject(prefetcher)
    }
    /// 현재 활성 미리듣기 대상(단일 진실 공급원, change 4). 스톡 클립 미리듣기 id 는
    /// `.stockClip(id)` 의 연관 값이 들고 있어 previewingStockMessageID 를 대체한다.
    @State var previewTarget: AudioPreviewTarget?

    @State var suppressProfileChangeInvalidation = false
    @State var ttsProfileChangedDuringEdit = false
    /// 지금 편집 중인 것이 **스톡 클립 알람**인가.
    ///
    /// 안드로이드 `AlarmEditorState.isActiveBucketAlarm()` 대응. 스톡 클립도 저장 시
    /// `voiceRandomPrompt = false` 가 되므로, `!randomPrompt` 만으로 '직접 입력' 을
    /// 판별하면 안 된다.
    ///
    /// ⚠ **저장된 `bucketId` 를 직접 보지 말 것.** 그건 편집 중에 사용자가 바꿔도 안 변하는
    /// 값이라, 유료 사용자가 테마 알람을 열어 '직접 입력' 을 골라도 계속 참이 되어
    /// **직접 입력창이 영영 안 뜬다.** 대신 `selectedBucketDraft` 를 열 때 한 번 심고
    /// (`loadVoicePromptState`), 그 뒤로는 편집기가 소유한다 — 안드로이드
    /// `AlarmEditorState.selectedBucket` 과 같은 수명이다.
    var isActiveStockClipAlarm: Bool { selectedFreeBucket != nil }

    /// 사용자가 고른 테마. **여기가 단일 출처다.**
    ///
    /// ⚠ **음원 준비 상태에서 파생시키지 말 것.** 2026-08-12 전에는 이 값이 없어서
    /// `preparedAlarm`(미리듣기용 준비 음원)에서 거꾸로 읽었다. 그래서 편집기 안에서
    /// `preparedAlarm = nil` 을 하는 **열다섯 자리** 중 하나만 밟아도(재생 방식 왕복,
    /// 같은 목소리 재선택, 가족 상대 선택 …) 고른 테마가 통째로 사라졌고, 요약 행이
    /// **"불러오는 중이에요"** 로 되돌아갔다. 되돌릴 트리거도 없었다.
    ///
    /// 안드로이드 `AlarmEditorState.selectedBucket` 과 같은 위상이다 — 그쪽은 처음부터
    /// 오디오와 무관한 평범한 상태라 같은 증상이 없다.
    ///
    /// 기존 알람을 열면 `loadVoicePromptState` 가 저장된 `bucketId` 로 심는다. 그 뒤로는
    /// **편집기가 소유한다** — 사용자가 다른 문구 갈래를 고르면 비워진다.
    @State var selectedBucketDraft: FreeBucket?
    /// 무료·기본목소리 문구 화면에서 여는 지역 시트·직접 입력 알럿.

    /// 상대 알람의 **최소 예약 여유**. 안드로이드 `FAMILY_ALARM_MIN_LEAD_MILLIS` 와 같은 값이다.
    ///
    /// ⚠ 예전 값 30분은 **푸시가 없고 15분 주기 폴링으로만** 받은 알람을 가져오던 시절의
    /// 것이다. 지금은 `family_alarm` 푸시가 즉시 pull 을 돌리므로(`push.onFamilyAlarm`
    /// → `remoteSync.runFullSync()`) 그 근거가 사라졌다.
    ///
    /// ⚠ **0 으로 두지는 않는다.** 푸시는 즉시지만 보장은 아니다 — 수신 기기가 오프라인이면
    /// pull 이 늦고, 그 사이 알람 시각이 지나면 **울리지 않은 채 지나간다**(보낸 사람은
    /// 보냈다고 믿는다).
    static let familyAlarmMinLeadMillis: Int64 = 5 * 60 * 1000
    private static let familyAlarmRequestMarginMillis: Int64 = 60 * 1000

    /// 분 단위 선택기로 고를 수 있고 서버 왕복 중에도 하한을 지키는 첫 시각.
    static func earliestSelectableFamilyAlarmMillis(nowMillis: Int64) -> Int64 {
        let minute: Int64 = 60 * 1000
        let threshold = nowMillis + familyAlarmMinLeadMillis
        let roundedUp = ((threshold + minute - 1) / minute) * minute
        return roundedUp + familyAlarmRequestMarginMillis
    }

    /// 리드타임 안내에 쓰는 시각 포맷터 — 기기 12/24시간 설정을 따른다.
    private static let leadTimeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.timeStyle = .short
        f.dateStyle = .none
        return f
    }()

    struct ValidationAlertContent: Identifiable {
        let id = UUID()
        let title: String
        let message: String
    }

    /// 준비된 음원이 스톡(테마) 클립이면 그 카테고리 = `bucket_id`.
    ///
    /// 자기 알람이 `saveFlow` 에서 `merged.bucketId` 를 정하는 식과 **같은 계산**이다.
    /// 가족 알람은 로컬 행이 없어 그 경로를 타지 않으므로 여기서 한 번 더 구한다 —
    /// ⚠ 식을 바꾸면 **양쪽을 같이** 바꿀 것(안드로이드는 `AlarmEntity.bucketId` 하나를
    /// 두 빌더가 나눠 쓴다).
    func bucketIdForSave(prepared: PreparedAlarmTalk?) -> String? {
        guard let prepared else { return nil }
        return voiceStudio.stockClips
            .first { $0.messageId == prepared.messageID }?.category?.nilIfBlank
    }

    /// 저장 중 음원 준비·생성이 실패했을 때. **조용히 `return` 하지 말 것** —
    /// 저장 버튼을 눌렀는데 아무 일도 안 일어난 것처럼 보인다.
    ///
    /// ⚠ 사유는 `voiceStudio.statusMessage` 에만 남는다(`mapVoiceError` 가 채운다).
    /// 예전에는 그걸 편집기 하단 `saveBlockedNotice` 가 주워 보여 줬는데, 그 자리는
    /// **저장이 막힌 이유**를 말하는 곳이라 성격이 다른 두 문장이 같은 한 줄을 번갈아
    /// 차지했다. 실패는 일어난 시점에 알럿으로 말하는 게 맞다 — 놓칠 수 없고,
    /// 확인을 누르면 사라지므로 화면에 눌어붙지도 않는다.
    @MainActor
    func showSaveFailureAlert() {
        validationAlert = ValidationAlertContent(
            title: "저장할 수 없어요",
            message: (voiceStudio.statusMessage).nilIfBlank
                ?? "목소리를 준비하지 못했어요. 잠시 뒤에 다시 시도해 주세요."
        )
    }

    /// 목소리 게이트 전용 내용. **액션이 상태마다 다르므로** 일반 검증 알럿과 분리한다
    /// (`docs/spec/plan-gates.md` 「상태는 셋이다」).
    struct VoiceGateAlertContent: Identifiable {
        let id = UUID()
        let title: String
        let message: String
        /// 이용권이 없어서 막힌 경우에만 true — 그때만 쿠폰·결제 액션이 뜻을 갖는다.
        let offersPlanActions: Bool
    }

    /// 같은 시각 알람 교체 확인 모달의 내용. merged/existing 은 동의 시 저장을 마무리하는 데 쓴다.
    struct DuplicateAlarmConfirmContent: Identifiable {
        let id = UUID()
        let timeLabel: String
        let existingLabel: String?
        let merged: LocalAlarmRecord
        let existing: LocalAlarmRecord?
        let conflicts: [LocalAlarmRecord]
    }

    var body: some View {
        // ⚠ **`Form` 으로 되돌리지 말 것.** `Form` 은 iOS 표준 그룹 목록 모양을 강제해
        // (회색 배경 위 흰 그룹, 자체 여백·구분선) 안드로이드의 Waker 카드와 나란히
        // 놓으면 다른 앱이 된다. 편집기는 카드 목록이지 설정 폼이 아니다.
        // ⚠ **키패드의 '완료' 를 꼭 눌러야 하지 않게 한다**(2026-08-11 요청).
        // 숫자 키패드에는 리턴 키가 없어 툴바 '완료' 가 유일한 종료였다 — 다른 곳을 눌러도
        // 끝나야 한다. 값은 포커스를 잃는 순간 반영되므로(`TimeWheelPicker.commitTypeIn`)
        // first responder 만 내려놓으면 된다.
        //
        // ⚠ **`content` 가 아니라 루트에 건다.** 스크롤 본문에만 걸면 그 **밖**(헤더·타임휠
        // 주변·하단 바)을 눌렀을 때 안 잡힌다 — 실제로 그렇게 뒀다가 시뮬레이터에서
        // 키패드가 그대로 남는 걸 확인했다.
        // ⚠ **`simultaneousGesture` 여야 한다** — `onTapGesture` 로 두면 이 탭이
        // 자식(카드·행·버튼)의 탭을 **삼켜** 아무 것도 안 눌린다.
        chrome(content)
            .simultaneousGesture(
                TapGesture().onEnded {
                    UIApplication.shared.sendAction(
                        #selector(UIResponder.resignFirstResponder),
                        to: nil, from: nil, for: nil
                    )
                }
            )
    }

    private var content: some View {
        VStack(spacing: 0) {
            ScrollView {
                // ⚠ **여기에 뷰를 직접 늘어놓지 말 것 — 하위 뷰로 빼서 붙인다.**
                // SwiftUI 의 `ViewBuilder` 는 형제 뷰를 **중첩 튜플 타입**으로 쌓는다.
                // 이 스크롤 본문이 한때 조건 분기까지 포함해 십수 겹으로 자랐고, 그러자
                // 타입 메타데이터를 복사하는 런타임 루틴(`initializeWithCopy`)이 스택을
                // 다 써서 편집기를 여는 순간 **세그폴트로 죽었다**(2026-08-07).
                // 한 계층에 조각 6개까지만 두고, 새 섹션은 새 `@ViewBuilder` 프로퍼티로.
                VStack(alignment: .leading, spacing: 16) {
                    timeWheelSection
                    repeatCard
                    alarmModeSection
                    detailSettingsSection
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 20)
            }
            .scrollDismissesKeyboard(.interactively)


            // 키보드가 올라와도 이 바는 제자리다(2026-08-11 요청) — 아래 `VStack` 의
            // `.ignoresSafeArea(.keyboard)` 가 그 일을 한다. 숫자를 고쳐 쓰는 동안
            // [취소][저장]이 화면 중간까지 따라 올라오면 **누르려던 자리가 사라진다.**
            EditorActionBar(
                saveTitle: saveButtonTitle,
                saving: isWorking || voiceStudio.isBusy,
                savingLabel: voiceStudio.isBusy ? "음성 만드는 중…" : "저장 중…",
                saveEnabled: !editorSaveBlocked,
                onCancel: onClose,
                onSave: { Task { await saveFlow() } }
            )
        }
        // ⚠ **바가 아니라 이 `VStack` 에 건다**(2026-08-15 재수정).
        // 바에만 걸었더니 그대로 따라 올라왔다 — 키보드 안전영역은 **바깥에서** 화면을
        // 줄이므로, 이미 줄어든 높이 안에 놓인 자식이 스스로 "난 무시한다" 고 해 봐야
        // 올라갈 자리가 바뀌지 않는다. 줄어드는 그 컨테이너가 무시해야 한다.
        // 스크롤 본문도 함께 안 밀리는데, 이 화면의 유일한 입력칸은 **맨 위 타임휠**이라
        // 가릴 게 없다.
        .ignoresSafeArea(.keyboard, edges: .bottom)
    }

    // MARK: - Body sections

    /// 타임휠은 **카드에 담지 않는다** — 안드로이드도 배경 없이 화면 위에 그대로 얹는다.
    /// 파란 박스 안에 넣으면 시각이 한 덩어리 위젯처럼 보여 화면의 주인공에서 밀려난다.
    @ViewBuilder
    private var timeWheelSection: some View {
        TimeWheelPicker(hour: $draft.hour, minute: $draft.minute)
            .frame(maxWidth: .infinity)
            .padding(.top, 4)
    }

    /// ⚠ **'반복' 섹션 제목을 다시 넣지 말 것.** 안드로이드에는 편집기 섹션 제목이
    /// 둘뿐이다 — '재생 방식'(`editor_play_mode_title`)과 '세부 설정'
    /// (`editor_detail_settings`). 반복 카드는 첫 줄이 이미 '내일 - 8월 8일 (토)' 로
    /// 자기가 무엇인지 말하고, 요일 칩이 바로 아래 붙는다.
    @ViewBuilder
    private var repeatCard: some View {
            EditorCard {
                Text(repeatSummary)
                    // ⚠ **`bodySmall` 로 되돌리지 말 것**(2026-08-11 지적 "너무 작아 보인다").
                    // 이 줄은 카드의 **제목 역할**이다 — '매주 : 수' / '내일 - 8월 12일 (수)' 는
                    // 이 카드가 무엇인지 말하는 첫 줄이라, 보조 설명 크기로 두면 읽히지 않는다.
                    .font(theme.typography.bodyLarge)
                    .fontWeight(.semibold)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 10)
                    .accessibilityLabel(Text("반복 \(repeatSummary)"))
                RepeatWeekdayChips(mask: $draft.repeatDaysMask)
                    .padding(.vertical, 10)
                // Android `ScheduleDetailsCard` 와 동일: 반복 요일이 하나라도 선택됐을 때만
                // 공휴일off 토글을 노출한다(미선택 시 dimmed 가 아니라 통째로 숨김).
                if draft.repeatDaysMask != 0 {
                    HolidayOffToggle(
                        isOn: $draft.holidayOff,
                        enabled: true
                    )
                    // ⚠ **아래 여백을 빼지 말 것**(2026-08-15 지적 "여백이 너무 작아 어렵다").
                    // `EditorCard` 의 세로 패딩은 4 뿐이라, 이 행이 카드 바닥에 4pt 로 붙어
                    // 스위치를 누르기가 불편했다. 위쪽(4 + 요약줄 10 = 14)과 맞추고, 요일을
                    // 안 골라 이 행이 없을 때(4 + 칩 10 = 14)와도 같아진다.
                    .padding(.bottom, 10)

                    // ⚠ **공휴일 달력 국가·다가오는 공휴일 목록을 되살리지 말 것**(2026-08-11 요청).
                    // 토글이 하는 말("공휴일에는 끄기")로 충분하다 — 어느 나라 달력인지는 설정에서
                    // 이미 정했고, 다가오는 공휴일 목록은 이 자리에서 결정에 쓰이지 않는다.
                    // 카드만 길어져 아래 여백이 사라진다.
                }

                // ⚠ **알람 이름(라벨) 입력창을 되살리지 말 것.** 안드로이드
                // `ScheduleDetailsCard`(`AlarmEditorControls.kt:47-77`)에는 라벨 입력이
                // 없다 — 있다고 적혀 있던 옛 주석은 사실이 아니었다(`editor_label_alarm_name`
                // 문자열 자체가 존재하지 않는다). 알람 행 둘째 줄은 라벨이 아니라
                // '다음 울릴 날짜 · 목소리' 라, 라벨을 채워도 어디에도 보이지 않는다.
            }
    }

    // ⚠ **편집기 안에서 받는 사람을 바꾸는 카드를 되살리지 말 것**(2026-08-07 제거).
    //
    // 안드로이드에는 그런 컨트롤이 아예 없다 — 받는 사람은 「누구를 깨울까요?」 시트에서
    // 정해져 편집기로 넘어오고, 그 뒤로는 바뀌지 않는다(`initialFamilyRecipientId`).
    // iOS 에만 있던 카드였다.
    //
    // 왜 없는 게 맞나: 가족 알람은 **한 번 보내면 끝**이다. 보낸 사람은 그 뒤로 고칠 수
    // 없고, 받은 사람이 자기 기기에서 알아서 관리한다. 그래서 '누구에게' 는 만들기 시작할
    // 때 한 번 정하는 값이지, 편집 중에 오가는 값이 아니다.
    //
    // 지금 누구에게 저장되는지는 **하단 저장 버튼**이 말한다("저장 · 이름").

    /// ⚠ **'세부 설정' 카드 하나다.** 예전에는 '스누즈' 와 '사운드 & 진동' 두
    /// 섹션으로 쪼개져 스누즈 간격·반복 횟수·진동 패턴이 전부 본문에 펼쳐져
    /// 있었다 — 한 번 정하고 다시 안 볼 값들이 시각·목소리와 같은 무게로 화면을
    /// 차지했다. 안드로이드는 요약 행 넷을 한 카드에 모으고 상세는 pane 으로 뺀다.
    @ViewBuilder
    private var detailSettingsSection: some View {
            EditorSectionTitle(text: "세부 설정")
            EditorCard(verticalPadding: 0) {
                // ⚠ **이 기능의 이름은 앱 전체에서 '다시 울림' 하나다**(2026-08-16 통일).
                // 예전에는 여기만 '다시 울림' 이고 상세 화면·토글·오류 문구는 '다시 알림'
                // 이었다. 이 앱에서 **알림은 notification** 이 굳은 뜻이라(알림 권한,
                // "알람 알림이 뜨지 않아요") 스누즈에 쓰면 충돌한다 — 스누즈는 알림이 다시
                // 뜨는 게 아니라 **알람이 다시 울린다.**
                AlarmSettingRow(
                    title: "다시 울림",
                    subtitle: snoozeSummary,
                    onTap: { settingsPane = .snooze },
                    trailing: {
                        Toggle("", isOn: $draft.snoozeEnabled)
                            .labelsHidden()
                            .alarmTalkSwitch()
                    }
                )

                // ⚠ **'진동' 행을 되살리지 말 것**(2026-08-17). AlarmKit 이 알람 진동을
                // 소유해서 우리가 고른 패턴이 실제 알람에 닿지 않는다 — 근거와 판단은
                // `AlarmEnums.swift` 의 `VibrationPattern` 주석에 적어 뒀다.
                // (안드로이드는 자체 울림을 소유하므로 그쪽에는 그대로 있다.)

                if draft.showsAlarmSoundControls {
                    AlarmSettingDivider()
                    AlarmSettingRow(
                        title: "알람음",
                        subtitle: alarmSoundDisplayLabel,
                        onTap: { settingsPane = .alarmSound }
                    )
                }

                // ⚠ **'음성 출력' 행을 여기에 되살리지 말 것.** 음량·반복은 목소리 카드
                // 안의 '목소리 크기' 행이 여는 상세가 소유한다. 안드로이드도 이 행을
                // `showVoiceOutput = false` 로 꺼 두었다 — 같은 값을 바꾸는 자리가 둘이면
                // 어느 쪽이 진짜인지 매번 확인해야 한다.
            }
    }

    // ⚠ **여기에 상태 문구를 다시 넣지 말 것**(위 `editorSaveBlocked` 주석).
    // 이 슬롯(`saveBlockedNotice`)은 사유 한 줄이 계속 갈아치워지는 자리였고, 그 사유들은
    // 전부 값이 사는 자리(목소리 배너·문구 행·녹음 카드)가 더 정확히 말한다.
    // 생성 실패는 `showSaveFailureAlert` 로 간다.

    // MARK: - Chrome (sheets · panes · alerts)

    /// 본문에 붙는 시트·pane·알럿. `body` 에서 `.modifier(...)` 대신 여기에 모아 두면
    /// `@State` 를 뷰 바깥으로 넘기지 않고도 `body` 자체는 짧게 유지된다.
    @ViewBuilder
    private func chrome<V: View>(_ content: V) -> some View {
        content
            // ⚠ **`.sheet` 로 되돌리지 말 것.** 다른 선택 시트와 같은 바텀시트다
            // (`BottomSheetHost` — 좌우 여백 0, 위 모서리만 둥글다).
            .bottomSheet(isPresented: $voiceSheetOpen, onDismiss: { voiceSheetOpen = false }) {
            VoiceSelectionSheet(
                options: voiceOptions,
                // 녹음 갈래일 때는 체크가 '직접 녹음' 행에 있어야 한다 — 프로필 id 를 그대로
                // 넘기면 목록에서 지금 고른 것이 무엇인지 보이지 않는다.
                selectedID: voiceSourceMode == .localAudio ? Self.recordingOptionID : voiceStudio.selectedProfileID,
                playingID: editorPreviewPlayer.isPlaying ? voiceStudio.previewingGreetingVoiceId : nil,
                preparingID: editorPreviewPlayer.isPreparing ? voiceStudio.previewingGreetingVoiceId : nil,
                onSelect: selectVoiceOption,
                onPreview: { option in
                    Task { await voiceStudio.previewGreeting(voiceId: option.id, session: auth.session) }
                },
                onClose: { voiceSheetOpen = false }
            )
        }
        .navigationDestination(isPresented: $messagePaneOpen) {
            MessageSettingsPane(
                initialContext: currentMessageContext,
                // ⚠ **직접 입력일 때만 문구를 넘긴다.** `voiceStudio.ttsText` 는 기존 알람을
                // 열면 저장된 **서버 생성 문장**으로 채워진다(`merged.voiceText = prepared.text`).
                // 조건 없이 넘기던 시절에는 생성형 알람(날씨·운세 등)을 열어 '직접 입력' 을
                // 고르면 입력창이 빈 채로 뜨는 대신 **어제 서버가 만든 문장이 '내가 쓴 문구'
                // 로 채워져** 있었고, 그대로 저장하면 매일 같은 문장이 반복됐다.
                // 판정은 `currentMessageContext` 단일 출처를 재사용한다 — 리터럴 비교를
                // 새로 박으면 CLAUDE.md 가 경고한 '세 자리 중 한 곳만 고치는' 사고가 난다.
                initialManualText: currentMessageContext == MessageSettingsResult.manualContext
                    ? voiceStudio.ttsText
                    : "",
                // ⚠ nil 로 하드코딩하지 말 것 — 그러면 '이번 달 남은 횟수' 가 영영 안 뜬다.
                manualRemaining: manualQuota?.remaining,
                manualLimit: manualQuota?.limit,
                savedWeatherCountry: voiceStudio.weatherCountry,
                savedWeatherCity: voiceStudio.weatherCity,
                savedFortuneGender: voiceStudio.fortuneGender,
                savedFortuneBirthDate: voiceStudio.fortuneBirthDate,
                savedFortuneBirthTime: voiceStudio.fortuneBirthTime,
                // ⚠ **목록을 자르는 것은 '클립이 있는가' 하나다** — 등급이 아니다.
                //   등록(클론) 목소리는 다섯 종류가 모두 사전렌더되므로 전부 나오고,
                //   기본 목소리는 서버에 구워 둔 카테고리만 나온다. 시딩이 끝나면 앱을
                //   고치지 않아도 나타난다(`availableFreeBuckets` 가 매니페스트와 교차한다).
                availableContexts: usesStockClips
                    ? availableFreeBuckets.compactMap { RandomPromptContext.forBucket($0.rawValue)?.rawValue }
                    : MessageSettingsPane.allContextIDs,
                // ⚠ 잠금은 **무료 플랜 단독**이다. 기본 목소리를 골랐다는 것은 이유가
                // 되지 않는다 — 유료면 기본 목소리로도 직접 입력을 쓸 수 있다.
                manualLocked: freeVoiceTier,
                // ⚠ **문구 화면을 닫지 말 것**(2026-08-15 지시). 잠긴 행을 눌렀을 뿐인데
                // 고르던 화면 밖으로 튕기면 안 된다 — 알럿은 편집기(스택 루트)에 붙어
                // 있어 밀어 올린 이 화면 위에 그대로 뜬다.
                onManualLocked: { showVoicePlanLockedAlert() },
                onSave: applyMessageSettings
            )
            // ⚠ **밀어 올린 화면에도 게이트를 붙인다**(2026-08-17 실측). SwiftUI 의
            // `.alert` 는 **지금 보이는 뷰**에 붙어 있어야 뜬다 — 편집기(스택 루트)에만
            // 달아 두면, 문구 화면을 push 한 상태에서 잠긴 '직접 입력' 을 눌러도 **아무 일도
            // 일어나지 않는다.** UI 테스트(`FreeManualGateUITests`)가 이걸 잡는다.
            // 상태(`voiceGateAlert`)는 하나라 두 번 뜨지 않는다.
            .voicePlanGateAlert(
                content: $voiceGateAlert,
                onRedeemCode: { redeemCodeAlertOpen = true },
                onOpenBilling: { onRequestBilling?() }
            )
        }
        .navigationDestination(item: $settingsPane) { pane in
            switch pane {
            case .snooze:
                SnoozeSettingsPane(
                    enabled: $draft.snoozeEnabled,
                    minutes: $draft.snoozeMinutes,
                    repeatLimit: Binding(
                        get: { draft.snoozeRepeatLimit.rawValue },
                        set: { draft.snoozeRepeatLimit = SnoozeRepeatLimit(rawValue: $0) ?? .three }
                    )
                )
            case .alarmSound:
                AlarmSoundSettingsPane(
                    soundUri: $draft.alarmSoundUri,
                    soundLabel: $draft.alarmSoundLabel,
                    onPreview: { url, restart in previewAlarmSound(url, restart: restart) },
                    previewingPath: previewingAlarmSoundPath
                )
            case .voiceOutput:
                voiceOutputPane
            }
        }
        .homeGradientBackground()
        .navigationTitle(navigationTitle)
        .navigationBarTitleDisplayMode(.inline)
        // ⚠ **편집기에는 상단바를 두지 않는다 — 취소가 두 개가 된다.**
        // 안드로이드 편집기에는 TopAppBar 가 아예 없고 취소·저장을 하단에 모았다
        // (`ui/editor/AlarmEditorScreen.kt`). iOS 도 시트일 때는 상단 X 를 일부러 안 뒀다.
        // 그런데 push 로 바꾸면 네비게이션 바가 **뒤로가기를 자동으로** 그리고, 그건 하단
        // [취소]와 완전히 같은 일을 한다 — CLAUDE.md 「취소와 같은 일을 하는 버튼을 두 개
        // 두지 않는다」에 정면으로 걸린다. 그래서 바를 숨기고 탈출구는 [취소] 하나로 둔다.
        // (제목은 `.navigationTitle` 로 남겨 둔다 — 바가 보이는 순간이 있으면 그때 쓰이고,
        //  VoiceOver 가 화면 이름으로 읽는다.)
        .toolbar(.hidden, for: .navigationBar)
        // ⚠ **저장 중에는 나갈 길을 잠근다 — push 는 잠그는 API 가 다르다.**
        // 시트였을 때는 `.interactiveDismissDisabled(isWorking)` 가 아래로 쓸어 닫기를
        // 막았다. push 에서는 그 API 가 아무 일도 하지 않고, 대신 **가장자리 스와이프**가
        // 새 탈출구다. 그대로 두면 저장이 도는 중에 화면을 뜰 수 있어, 하단 [취소]·[저장]을
        // 잠가 둔 의미가 사라진다.
        .navigationBarBackButtonHidden(isWorking)
        .alert(item: $validationAlert) { content in
            Alert(
                title: Text(content.title),
                message: Text(content.message),
                dismissButton: .default(Text("확인"))
            )
        }
        .voicePlanGateAlert(
            content: $voiceGateAlert,
            onRedeemCode: { redeemCodeAlertOpen = true },
            onOpenBilling: { onRequestBilling?() }
        )
        // ⚠ 여기에 입력 알럿을 다시 만들지 말 것 — 껍데기는 `RedeemCodeSheet` 하나다
        // (실패 사유를 그릴 자리가 있는 쪽). 목소리 탭 게이트도 같은 것을 쓴다.
        .redeemCodeSheet(isPresented: $redeemCodeAlertOpen) { code in
            await socialFeatures.registerCodeReportingFailure(code, session: auth.session)
        }
        // 검증/실패 알림이 뜰 때 한 번 error 햅틱을 울려 저장 실패를 촉각으로 알린다.
        .onChange(of: validationAlert?.id) { _, newID in
            if newID != nil {
                UINotificationFeedbackGenerator().notificationOccurred(.error)
            }
        }
        .alert(item: $duplicateAlarmConfirm) { content in
            Alert(
                title: Text("같은 시각 알람이 있어요"),
                message: Text(duplicateAlarmMessage(content)),
                primaryButton: .destructive(Text("교체하기")) {
                    Task { await confirmReplaceDuplicate(content) }
                },
                secondaryButton: .cancel(Text("취소"))
            )
        }
        .onAppear {
            guard !didLoadInitial else { return }
            didLoadInitial = true
            loadInitialState()
            // 기본 목소리 카탈로그는 번들돼 있으므로 서버 왕복 전에 선택까지 끝낼 수 있다.
            // 단 유료 사용자의 마지막 선택이 클론이면 그 목소리가 서버에서 올 때까지 기다린다 —
            // 여기서 시스템 목소리를 먼저 넣으면 성공 응답 뒤에도 마지막 선택이 밀려난다.
            let lastUsedVoiceID = voiceStudio.lastUsedVoiceId
            if freeVoiceTier || lastUsedVoiceID == nil || isSystemVoiceId(lastUsedVoiceID) {
                selectDefaultVoiceProfileIfNeeded()
            }
            Task {
                await voiceStudio.refresh(session: auth.session)
                selectDefaultVoiceProfileIfNeeded()
                if target.familyAlarmMode {
                    await socialFeatures.refreshAll(session: auth.session)
                    selectDefaultFamilyRecipientIfNeeded()
                }
            }
            // 스톡 클립 카탈로그는 refresh 와 독립적으로 1회 로드한다(무료 등급 +
            // 시스템 보이스 선택 시 StockClipPicker 가 사용). 실패는 비차단.
            Task { await voiceStudio.loadStockClips(session: auth.session) }
        }
        .alert(
            "기본 목소리로 바꿀까요?",
            isPresented: Binding(
                get: { pendingVoiceSwitch != nil },
                set: { if !$0 { pendingVoiceSwitch = nil } }
            )
        ) {
            Button("바꾸기") {
                if let pending = pendingVoiceSwitch { applyVoiceSelection(pending) }
                pendingVoiceSwitch = nil
            }
            Button("닫기", role: .cancel) { pendingVoiceSwitch = nil }
        } message: {
            Text("기본 목소리는 준비된 문구로만 말할 수 있어서, 직접 입력한 문구는 사라져요.")
        }
        .sheet(item: $sharedVoiceSetupTarget) { profile in
            SharedVoiceSelectionSetupSheet(
                profile: profile,
                isWorking: voiceStudio.isBusy,
                onCancel: {
                    // 공유 음성 미리듣기는 voiceStudio.previewPlayer 로 재생되므로
                    // 시트가 닫힐 때 직접 정지해 잔여 오디오가 이어지지 않게 한다.
                    voiceStudio.previewPlayer.stop()
                    sharedVoiceSetupTarget = nil
                },
                onPreview: {
                    Task {
                        await voiceStudio.previewSharedVoice(profileId: profile.id, session: auth.session)
                    }
                },
                onConfirm: { relationship, listener in
                    let target = profile
                    Task {
                        await voiceStudio.updateSharedVoiceViewerInfo(
                            profileId: target.id,
                            relationshipLabel: relationship,
                            listenerTitle: listener,
                            session: auth.session
                        )
                        voiceStudio.selectedProfileID = target.id
                        voiceStudio.preparedAlarm = nil
                        // 미리듣기가 재생 중일 수 있으므로 확정 시에도 정지한다.
                        voiceStudio.previewPlayer.stop()
                        sharedVoiceSetupTarget = nil
                    }
                }
            )
            .presentationDetents([.medium, .large])
        }
        // 플랜이 시트 오픈 후 비동기로 free 로 확정되는 경우(socialFeatures.subscription
        // 가 늦게 채워질 때) freeVoiceTier 가 뒤늦게 flip 된다. Android 가
        // `LaunchedEffect(freeVoiceTier, playMode)` 로 재확정하듯, freeVoiceTier
        // (및 currentPlan) 변화에도 4-값 잠금을 다시 강제해 유료 컨트롤이 잠깐
        // 노출되는 일을 막는다. coerceFreeVoiceTierConstraints 는 값이 실제로
        // 달라질 때만 재할당하므로 무한 루프가 생기지 않는다.
        .onChange(of: usesStockClips) { _, _ in coerceFreeVoiceTierConstraints() }
        .onChange(of: currentPlan) { _, _ in coerceFreeVoiceTierConstraints() }
        // 직전에 고른 무료 테마 이어받기. 목소리·스톡 매니페스트가 준비되는 시점이
        // 제각각이라 **둘을 한 키로 묶어** 건다 — 나눠 걸면 SwiftUI 타입체크가 터진다.
        //
        // ⚠ **`.onChange` 로 두지 말 것.** `onChange` 는 값이 **바뀔 때만** 돈다. 앱을 켠 뒤
        // 두 번째로 편집기를 열면 매니페스트도 목소리도 이미 준비돼 있어 이 키가 처음부터
        // 안정적이고, 그러면 **한 번도 실행되지 않는다** — 테마가 영영 안 붙어 문구 행이
        // "불러오는 중이에요" 에 머문다(2026-08-12 실기기 재현).
        // `.task(id:)` 는 나타날 때 한 번 + 키가 바뀔 때마다 돈다. 안드로이드의
        // `LaunchedEffect` 와 같은 동작이다.
        .task(id: freeBucketReadinessKey) {
            applyPendingFreeBucketIfNeeded()
        }
        .task(id: planAccess) {
            guard planAccess == .paid, let token = auth.session?.token else {
                manualQuota = nil
                return
            }
            manualQuota = try? await AlarmTalkAPI.shared.manualQuota(token: token)
        }
        // 선택 목소리가 바뀌면 직전 생성/스톡 선택을 비워, 다른 프로필의 오디오를
        // 저장하지 않게 한다. 미리듣기 중이면 함께 정지한다.
        .sheet(isPresented: preparationSheetPresented) { preparationSheet }
        .onChange(of: voiceStudio.selectedProfileID) { oldProfileID, newProfileID in
            guard !suppressProfileChangeInvalidation else { return }
            // ⚠ **아직 못 받은 목소리는 고를 수 없다.** 공유받은 목소리는 선다운로드 대상이
            // 아니라 고르는 순간 없을 수 있고, 그대로 저장하면 라이브 생성으로 흘러가
            // 오프라인에서 안 울린다. **그 목소리만** 막고 준비 페이지로 보낸다 —
            // 알람 만들기 자체는 막지 않는다(다른 목소리로는 지금 만들 수 있어야 한다).
            // 관문 **1/3**. 판정은 `needsClipPreparation` 한 곳에만 있다(거기 주석 참조).
            //
            // ⚠ **이 핸들러가 끝난 뒤의 `randomPrompt` 로 판정해야 한다.** 아래 751 근처에서
            // 테마 알람은 `randomPrompt` 를 **되켠다**(`wasThemeAlarm` 분기). 지금 값(false)으로
            // 물어보면 관문은 "랜덤 문구가 아니니 클립이 필요 없다" 며 통과시키는데, 곧바로
            // 랜덤이 켜져 **클립이 필요한 상태로 바뀐다** — 테마 알람의 목소리를 아직 못 받은
            // 클론으로 바꾸는 흐름이 통째로 관문을 빠져나갔다. 그래서 `wasThemeAlarm` 을 먼저
            // 구해 두고 **바뀔 값**을 넘긴다.
            let wasThemeAlarm = isActiveStockClipAlarm || (editingAlarm?.bucketId).nilIfBlank != nil
            if let newProfileID = (newProfileID).nilIfBlank,
               needsClipPreparation(
                   profileID: newProfileID,
                   randomPrompt: voiceStudio.randomPrompt || wasThemeAlarm,
                   randomContext: voiceStudio.randomContext
               ) {
                // ⚠ **되돌리는 동안 이 핸들러를 재진입시키지 않는다.** 그냥 되돌리면
                // (거절한 목소리 → 원래 목소리)로 한 번 더 돌아서, 바꾼 적도 없는데
                // `ttsProfileChangedDuringEdit` 이 켜지고 준비해 둔 음성·미리듣기가 지워진다.
                suppressProfileChangeInvalidation = true
                voiceStudio.selectedProfileID = (oldProfileID).nilIfBlank
                suppressProfileChangeInvalidation = false
                preparationVoiceID = newProfileID
                return
            }
            if (oldProfileID).nilIfBlank != (newProfileID).nilIfBlank {
                ttsProfileChangedDuringEdit = true
            }
            stopAllEditorPreviews()
            // `wasThemeAlarm` 은 관문보다 위에서 구했다 — 이 두 줄이 스톡 선택을 지우기
            // **전**의 값이어야 하고, 관문도 그 값으로 판정해야 하기 때문이다(위 주석).
            stockSelectedMessageID = nil
            voiceStudio.preparedAlarm = nil
            // ⚠ **테마 알람이 목소리 변경으로 '직접 입력' 으로 뒤집히지 않게 한다.**
            // 위 두 줄로 스톡 선택을 잃으면 `isActiveStockClipAlarm` 이 false 가 되는데,
            // 테마 알람은 `randomPrompt` 도 false 로 저장돼 있어 판정식
            // (`!randomPrompt && !isActiveStockClipAlarm`)이 **직접 입력**으로 읽는다.
            // 그러면 서버가 준 스톡 문장이 사용자가 친 문구인 양 남고, 저장 시
            // `last_manual_text` 로 기억돼 **다음 새 알람까지 오염**된다.
            // 사용자는 문구를 바꾼 적이 없으니 종류를 그대로 두고 랜덤만 되켠다.
            // (안드로이드는 `selectVoiceProfile` 이 **시스템 목소리로 바꿀 때만** 버킷을
            // 비워서 같은 일이 안 난다. iOS 는 클론에 버킷 경로가 없어 여기서 막는다.)
            if wasThemeAlarm, !voiceStudio.randomPrompt {
                voiceStudio.randomPrompt = true
            }
            // 스톡 선택을 잃는 순간 무료 등급은 곧바로 랜덤/preset 로 되돌린다.
            // 안 그러면 randomPrompt=false 인 채로 남는데, 무료에는 직접 입력 pane 이
            // 안 뜨므로 아무 문구 UI 도 없는 상태가 된다.
            coerceFreeVoiceTierConstraints()
        }
        .onChange(of: voiceStudio.weatherCountry) { _, _ in voiceStudio.preparedAlarm = nil }
        .onChange(of: voiceStudio.weatherCity) { _, _ in voiceStudio.preparedAlarm = nil }
        .onChange(of: voiceStudio.fortuneGender) { _, _ in voiceStudio.preparedAlarm = nil }
        .onChange(of: voiceStudio.fortuneBirthDate) { _, _ in voiceStudio.preparedAlarm = nil }
        .onChange(of: voiceStudio.fortuneBirthTime) { _, _ in voiceStudio.preparedAlarm = nil }
        // 시각이 바뀌면 랜덤 문구용으로 준비한 음원은 발화 시각이 어긋나 stale 이 되므로 무효화한다
        // (canReuseExistingTtsAudio 의 fireAt 검사와 짝). 단 고정 문구/스톡 클립은 시각과
        // 무관하므로 건드리지 않는다 — TimeWheelPicker 스크롤 중간값이 스톡 선택을 지우지
        // 않도록 randomPrompt && 스톡 미스테이징 일 때만 비운다(RISK C).
        .onChange(of: draft.hour) { _, _ in invalidatePreparedRandomClipOnTimeChange() }
        .onChange(of: draft.minute) { _, _ in invalidatePreparedRandomClipOnTimeChange() }
        // 반복 요일이 모두 꺼지면 공휴일 OFF 는 무의미해진다. 토글은 disable 만 되어
        // (HolidayOffToggle.enabled=false) 켜진 값이 그대로 레코드에 남을 수 있으므로,
        // mask 가 0 이 되는 순간 holidayOff 를 false 로 되돌려 stale true 를 막는다(PR6).
        .onChange(of: draft.repeatDaysMask) { _, newMask in
            if newMask == 0, draft.holidayOff {
                draft.holidayOff = false
            }
        }
        .onChange(of: localRecorder.elapsedSeconds) { _, seconds in
            if seconds >= TimeInterval(AlarmAudioLimits.maxDurationMillis / 1000),
               localRecorder.isRecording {
                localRecorder.stop()
                localAudioMessage = "최대 \(AlarmAudioLimits.maxDurationMillis / 1000)초까지 녹음했어요."
            }
        }
        .onDisappear {
            localRecorder.stop()
            stopAllEditorPreviews()
        }
    }

    /// 에디터의 모든 미리듣기를 끄는 단일 진입점(change 4). 흩어져 있던
    /// previewPlayer.stop()/localPreviewPlayer.stop()/previewingStockMessageID=nil 을 대체한다.
    /// Android `stopPreview` (AlarmEditorScreen.kt:280-288) 미러.
    func stopAllEditorPreviews() {
        editorPreviewPlayer.stop()
        // 공유 음성 미리듣기는 voiceStudio.previewPlayer 경로를 쓰므로 함께 정지해
        // 이중 재생/잔여 오디오를 막는다.
        voiceStudio.previewPlayer.stop()
        previewTarget = nil
    }

    // ⚠ **사용 가이드 시트를 되살리지 말 것.** 안드로이드 편집기에는 없다
    // (`AlarmEditorScreen.kt:1269` 주석: "상단바(제목·뒤로가기·가이드)는 제거하고,
    // 취소·저장을 하단에 모았다"). 게다가 그 가이드의 2번 카드는 지금은 없는
    // '알람 + 음성' 모드를 설명하고 있었다 — 안내가 제품보다 오래 남으면 거짓말이 된다.


    /// 저장 버튼 라벨.
    ///
    /// 가족 알람이면 **받는 사람 이름을 함께** 보여준다(안드로이드 `editor_save_for`).
    /// 남의 기기에서 울릴 알람을 만드는 것이라, 누르기 직전에 누구인지 한 번 더 확인시킨다.
    ///
    /// ⚠ **동사를 앞에 둔다.** 큰 글꼴에서 라벨이 한 줄로 잘리는데, 한국어 어순대로
    /// "…에게 저장" 이면 잘려 나가는 게 하필 동사라 "rel dev에…" 가 되어 무슨 버튼인지
    /// 알 수 없다(안드로이드 fontScale 1.8 실기기 확인).
    var saveButtonTitle: String {
        if target.familyAlarmMode, let name = (selectedFamilyRecipient?.name).nilIfBlank {
            // 받는 사람 이름은 사용자 데이터다 — 동사만 번역해서 붙인다.
            return "\(String(localized: "저장")) · \(name)"
        }
        // ⚠ **'수정 저장' 으로 되돌리지 말 것**(2026-08-18 지시). 새 알람이든 편집이든
        // 버튼이 하는 일은 같다 — 지금 화면의 값을 저장한다. 편집일 때만 말이 길어지면
        // 같은 버튼이 두 이름을 갖는다(안드로이드는 처음부터 '저장' 하나다).
        return String(localized: "저장")
    }

    /// 알람음 종류 라벨. 고른 것이 있으면 그 이름, 없으면 '기본 알람음'.
    /// (Android `editor2_default_alarm_sound` 미러.)
    var alarmSoundDisplayLabel: String {
        draft.alarmSoundLabel.nilIfBlank ?? "기본 알람음"
    }

    /// 알람음 미리듣기 — 편집기의 단일 플레이어로 튼다(목소리 미리듣기와 같은 자리).
    /// 같은 것을 다시 누르면 멈춘다.
    /// 목소리 크기 화면. 스위치 본문에서 바로 조립하면 타입 검사기가 그 표현식을 시간 안에
    /// 못 풀어 빌드가 죽는다("unable to type-check this expression") — 프로퍼티로 뺀다.
    @ViewBuilder
    private var voiceOutputPane: some View {
        // 목소리를 아직 안 골랐으면 들려줄 것이 없어 행을 그리지 않는다.
        if let voiceId = voiceStudio.selectedProfileID?.nilIfBlank {
            VoiceOutputSettingsPane(
                volumePercent: $draft.voiceVolumePercent,
                onVolumeSettled: { ensureVoicePreviewAtVolume(voiceId: voiceId, volumePercent: draft.voiceVolumePercent) },
                onVolumeLive: { voiceStudio.previewPlayer.setVolume(percent: $0) }
            )
        } else {
            VoiceOutputSettingsPane(volumePercent: $draft.voiceVolumePercent)
        }
    }

    /// 슬라이더에서 손을 뗐을 때 — 듣고 있으면 크기만 맞추고, 아니면 튼다.
    func ensureVoicePreviewAtVolume(voiceId: String, volumePercent: Int) {
        Task {
            await voiceStudio.ensureGreetingPreview(
                voiceId: voiceId,
                session: auth.session,
                volumePercent: volumePercent
            )
        }
    }

    func previewAlarmSound(_ url: URL?, restart: Bool = false) {
        guard let url else {
            editorPreviewPlayer.stop()
            previewingAlarmSoundPath = nil
            return
        }
        // 스피커 버튼은 토글(같은 것을 누르면 멈춤), 행을 골라서 오면 항상 다시 튼다.
        if !restart, previewingAlarmSoundPath == url.path {
            editorPreviewPlayer.stop()
            previewingAlarmSoundPath = nil
            return
        }
        stopAllEditorPreviews()
        do {
            try editorPreviewPlayer.play(url: url)
            previewingAlarmSoundPath = url.path
        } catch {
            // 못 트는 형식이면 조용히 넘어간다 — 고르는 것 자체는 막지 않는다.
            // (실제 울림은 `AlarmSoundStaging` 이 CAF 로 변환해 AlarmKit 에 넘긴다.)
            previewingAlarmSoundPath = nil
        }
    }

    /// 요일 칩 위에 보여줄 반복 요약(PR6). 0x7f=매일, 일부 요일=매주 목록, 0=다음 울릴 날짜.
    /// Android `AlarmEditorControls.kt` RepeatSelector 상단 요약과 같은 의도.
    var repeatSummary: String {
        let mask = draft.repeatDaysMask
        if mask == 0x7f { return "매일" }
        if mask != 0 {
            let days = RepeatDay.displayOrder
                .filter { mask.hasRepeatDay($0) }
                .map { $0.shortLabel }
                .joined(separator: " ")
            return "매주: \(days)"
        }
        // mask == 0 : 한 번만 — 다음 발화 날짜를 보여준다(공휴일 OFF 는 의미 없지만 계산은 동일).
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let fireAt = (try? AlarmTimeCalculator.nextFireAtMillis(
            hour: draft.hour,
            minute: draft.minute,
            repeatDaysMask: 0,
            holidayOff: draft.holidayOff,
            nowMillis: now,
            isHoliday: holidayStore.holidayPredicate()
        )) ?? LocalAlarmRecord.fallbackFireAtMillis(
            hour: draft.hour,
            minute: draft.minute,
            referenceMillis: now
        )
        // ⚠ **'오늘'/'내일' 을 앞에 붙인다**(안드로이드 `editor2_repeat_today/tomorrow`).
        // 날짜만 있으면 "8월 7일" 이 오늘인지 내일인지 머릿속으로 계산해야 한다 —
        // 알람은 '언제 울리나' 가 전부라 그 한 단어가 실제로 정보를 준다.
        let fireDate = Date(timeIntervalSince1970: TimeInterval(fireAt) / 1000.0)
        let label = Self.repeatSummaryDateFormatter.string(from: fireDate)
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = .autoupdatingCurrent
        if calendar.isDateInToday(fireDate) { return String(localized: "오늘 · \(label)") }
        if calendar.isDateInTomorrow(fireDate) { return String(localized: "내일 · \(label)") }
        return label
    }

    /// "한 번만" 알람의 다음 발화 날짜 표기(예: 6월 21일 (토)). 매 호출 생성 비용을 피하려 static.
    static let repeatSummaryDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        // 로케일 고정 금지 — 사용자에게 보이는 날짜다(위 `nextFireDateLabel` 주석 참조).
        formatter.locale = .autoupdatingCurrent
        formatter.setLocalizedDateFormatFromTemplate("MMMd EEE")
        return formatter
    }()

    /// 저장이 막혔는가. ⚠ **사유 문구는 두지 않는다**(2026-08-18 변경. 그전에는 편집기
    /// 본문 아래에 한 줄씩 떴다 — `saveBlockedNotice`). 안드로이드가 같은 날 같은 이유로
    /// `editorSaveBlocked` 로 바꿨고, iOS 도 맞춘다.
    ///
    /// 이유를 말하는 자리는 **그 값이 사는 곳**이다. 갈래마다 짝이 있다:
    ///  - 플랜 잠금·사용 불가 목소리 → 목소리 행 아래 `unusableVoiceBanner`("삭제된 목소리").
    ///  - 목소리 미선택 → 목소리 행이 "고르기" 로 비어 있음을 말하고, 목록이 없으면
    ///    '목소리 탭에서 만들기' 버튼이 해결 액션까지 갖고 있다.
    ///  - 녹음 미완료 → `RecordingCard` 자체가 CTA 다.
    ///  - 날씨 테마 지역 없음 / 문구 정보 미완 / 빈 직접 입력 → 문구 행과 문구 화면의
    ///    상세 카드(`PromptDetailCard`)가 "아직 정하지 않았어요" 로 말한다.
    ///
    /// 한 줄로 또 쓰면 같은 순간 **두 문장이 서로 다른 얘기를 한다.** 실제로 그랬다 —
    /// 배너는 "저장된 목소리는 그대로 울리지만" 인데 아래 줄은 "쓸 수 없어요" 였다.
    ///
    /// ⚠ **생성 실패는 여기 갈래가 아니다.** 그건 일어난 시점에 알럿으로 낸다
    /// (`showSaveFailureAlert`). 예전에는 `voiceStudio.statusMessage` 를 이 자리가 주워
    /// 보여 줘서, 성격이 다른 두 문장이 같은 한 줄을 번갈아 차지했다.
    ///
    /// 중요: 단일 저장 버튼이 캐시 미스 시 직접 생성하므로(saveFlow), "아직 생성 안 됨" 은
    /// 막을 사유가 아니다. 정말로 만족 불가능한 상태만 막는다. 신규 랜덤 문구 한-탭 생성
    /// 경로(randomPrompt=true, preset)는 false 여야 저장이 활성화돼 탭 시 생성이 돈다.
    var editorSaveBlocked: Bool {
        if draft.playMode == .alarmOnly { return false }

        // ⚠ **무료 플랜의 유료 목소리 알람은 저장 전에 막는다.**
        // iOS 에는 이 게이트가 **아예 없어서**, 무료 사용자가 녹음 알람을 저장할 수 있었고
        // 그 행은 곧바로 `applyFreePlanVoiceLockIfNeeded` 에 잡혀 **방금 만든 알람이
        // 잠겼다**(2026-08-11 확인). 사용자에겐 "왜 사라졌지" 로만 보인다.
        //
        // ⚠ **무료여도 기본(스톡) 프리셋 목소리 알람은 만들 수 있다** — 이건 유료 자산이
        // 아니다. 안드로이드 `MainViewModelAlarmActions.voiceAlarmAllowed` 와 같은 규칙이고,
        // 서버 `alarm-mutation.ts` 의 `usesOnlySystemStockVoice` 도 같은 선을 긋는다.
        // 말하는 자리: `unusableVoiceBanner`(목소리 행 아래).
        if planAccess != .paid, !usesFreeSystemVoiceSelection { return true }

        if voiceSourceMode == .localAudio {
            // 말하는 자리: `RecordingCard` 자체가 CTA 다.
            let hasNewSource = selectedLocalAudioURL != nil || localRecorder.latestRecordingURL != nil
            return !(hasNewSource || existingLocalAudioLabel != nil)
        }

        // tts_profile 분기. 테마를 골랐으면 곧바로 저장 가능 — 음원은 저장이 받는다
        // (`prepareSelectedBucketClipIfNeeded`). ⚠ 예전에는 음원이 준비됐는가
        // (`preparedAlarm` 의 `stock_` 키)를 봤는데, 그러면 아직 안 받은 테마 알람의 저장이 막혔다.
        if let bucket = selectedFreeBucket {
            // ⚠ **조건으로 클립을 고르는 테마는 그 조건값이 있어야 한다.**
            //  - 날씨: 도시가 없으면 서버가 조건을 못 맞춰 서울로 폴백한다 — 사용자는
            //    자기 지역 날씨를 들을 줄 알고 저장한다.
            //  - 운세: 사주가 없으면 `BucketVariantResolver.fortuneThemeIndex` 가 빈 seed 로
            //    같은 인덱스만 돌려줘 **매일 같은 클립**이 나간다. 조용한 오작동이라
            //    막지 않으면 아무도 눈치채지 못한다.
            //    (2026-09-02 추가 — 그전에는 기본 목소리가 운세를 고를 수 없어 날씨만
            //     봐도 충분했다. 문구 목록을 합치면서 이 갈래가 열렸다.
            //     안드로이드 `AlarmEditorScreen` 의 `SaveBlockReason.FORTUNE_INFO_MISSING` 짝.)
            // 말하는 자리: 문구 화면의 `PromptDetailCard`("아직 정하지 않았어요").
            switch bucket {
            case .weather: return (voiceStudio.weatherCity).nilIfBlank == nil
            case .fortune: return !fortuneInfoReady
            default: return false
            }
        }

        // 말하는 자리: 목소리 행("고르기") + 목록이 비면 '목소리 탭에서 만들기'.
        guard let profileID = (voiceStudio.selectedProfileID).nilIfBlank else { return true }
        // 선택된 목소리가 더 이상 alarm 선택 대상이 아니면(삭제/미준비 등) 사용 불가.
        // 단, 기존 알람의 음원이 그대로 재사용 가능한 경우엔 막지 않는다(아래 생성 경로가 흡수).
        // 말하는 자리: `unusableVoiceBanner`.
        // ⚠ 정리 중인 목소리는 **저장도 막는다**(Codex #703 P1) — 이미 선택돼 있던 경우가
        // 남기 때문이다(자동 선택을 막아도 편집기를 열기 전부터 골라져 있을 수 있다).
        // 말하는 자리는 아래 배너다.
        let profileReady = (
            voiceStudio.profiles.contains { $0.id == profileID && $0.isReadyForAlarmSelection } ||
                voiceStudio.familyVoices.contains { $0.id == profileID && $0.isReadyForAlarmSelection }
        )
        let preparedForProfile = voiceStudio.preparedAlarm?.voiceProfileID == profileID
        // ⚠ **정리 중으로는 버튼을 죽이지 않는다**(Codex #703 P1 — CLAUDE.md 「잠그는 것은
        // '저장 중' 일 때뿐이다」). 곧 풀리는 상태라 죽은 버튼은 고장으로 읽힌다 —
        // 누를 수 있게 두고 **누르면 이유를 말한다**(`saveFlow` 첫머리). 배너도 함께 뜬다.
        if !profileReady, !preparedForProfile, !reuseExistingTtsForCurrentSelection { return true }
        // 말하는 자리: 문구 화면의 `PromptDetailCard`("아직 정하지 않았어요").
        if voiceStudio.randomPrompt { return !randomPromptSettingsComplete }
        // 말하는 자리: 문구 화면의 '문구' 상세 카드("아직 입력하지 않았어요").
        return voiceStudio.ttsText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// 랜덤 문구가 켜졌을 때 컨텍스트별 필수 정보가 채워졌는지. 가족 알람은 상대의 준비
    /// 상태(weatherReady/fortuneReady)도 인정한다 — generateTTS 검증(688-694) 미러.
    var randomPromptSettingsComplete: Bool {
        guard voiceStudio.randomPrompt else { return true }
        let context = activePromptContext
        if context.usesWeather, !voiceStudio.hasWeatherInfo, !targetWeatherReady {
            return false
        }
        if context.usesFortune, !fortuneInfoReady {
            return false
        }
        return true
    }

    /// 사주가 갖춰졌는가. ⚠ **판정은 여기 한 곳이다** — 스톡 클립 '운세' 게이트
    /// (`editorSaveBlocked`)와 라이브 경로가 같은 답을 내야 한다. 안드로이드
    /// `AlarmEditorScreen.fortuneInfoReady()` 의 짝.
    var fortuneInfoReady: Bool { voiceStudio.hasFortuneInfo || targetFortuneReady }

    /// 지금 편집기 선택이 **무료로 허용되는 기본(스톡) 목소리**인가.
    ///
    /// 안드로이드 `usesFreeSystemVoiceAlarm` 의 편집기판이다. 저장된 행이 아니라
    /// **선택 상태**로 판단해야 해서 따로 둔다.
    ///
    /// **직접 녹음은 무료다**(2026-08-12 확정) — 내 폰의 파일을 재생할 뿐 서버 자산을
    /// 쓰지 않는다. 유료인 것은 클론 목소리와 서버가 만든 클립이다.
    private var usesFreeSystemVoiceSelection: Bool {
        if voiceSourceMode == .localAudio { return true }
        if selectedFreeBucket != nil { return true }
        return voiceStudio.isSystemVoiceProfile(id: voiceStudio.selectedProfileID)
    }

    /// editorSaveBlocked 전용 — 현재 선택으로 기존 알람의 TTS 음원을 그대로 재사용할 수
    /// 있는지. saveFlow 와 같은 방식으로 다음 발화 시각을 계산해 넘긴다(랜덤 문구일 때만 의미).
    private var reuseExistingTtsForCurrentSelection: Bool {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let fireAt = (try? AlarmTimeCalculator.nextFireAtMillis(
            hour: draft.hour,
            minute: draft.minute,
            repeatDaysMask: draft.repeatDaysMask,
            holidayOff: draft.holidayOff,
            nowMillis: now,
            isHoliday: holidayStore.holidayPredicate()
        )) ?? LocalAlarmRecord.fallbackFireAtMillis(
            hour: draft.hour,
            minute: draft.minute,
            referenceMillis: now
        )
        return AlarmEditDraft.canReuseExistingTtsAudio(
            existing: editingAlarm,
            selectedProfileID: voiceStudio.selectedProfileID,
            text: voiceStudio.ttsText,
            randomPrompt: voiceStudio.randomPrompt,
            randomContext: voiceStudio.randomContext,
            language: voiceStudio.ttsLanguage,
            // 번역 없음 — 직접 입력은 그대로 읽는다(2026-08-12).
            fireAtMillis: fireAt,
            listenerTitle: ttsListenerTitleForCurrentSelection(existing: editingAlarm)
        )
    }

    private func shouldPreserveExistingTtsListenerTitle(existing: LocalAlarmRecord?) -> Bool {
        guard let existing,
              existing.playModeEnum != .alarmOnly,
              existing.voiceSourceEnum != .localAudio,
              !ttsProfileChangedDuringEdit,
              (existing.voiceListenerTitle).nilIfBlank != nil,
              let selectedProfileID = (voiceStudio.selectedProfileID).nilIfBlank,
              selectedProfileID == (existing.voiceProfileId).nilIfBlank else {
            return false
        }
        return true
    }

    private func ttsListenerTitleForCurrentSelection(existing: LocalAlarmRecord?) -> String? {
        if shouldPreserveExistingTtsListenerTitle(existing: existing) {
            return existing?.voiceListenerTitle
        }
        return voiceStudio.selectedListenerTitle
    }

    /// 고를 수 있는 **목소리 프로필** — 내 목소리 → 공유받은 목소리 → 기본 목소리.
    ///
    /// ⚠ **여기에 '직접 녹음' 을 넣지 말 것.** 그건 프로필이 아니라 갈래 전환이라
    /// `voiceOptions` 에서만 붙인다 — 섞으면 "고를 목소리가 하나도 없다" 판정이
    /// 영영 거짓이 되어 '목소리 탭에서 만들기' 안내가 사라진다.
    ///
    /// ⚠ **기본(시스템) 목소리 4종을 전부 노출한다.** 예전에는 '기본으로 설정해 둔 1개'
    /// 만 보여줬는데, 이제 4개를 미리 받아 두므로 알람마다 자유롭게 고를 수 있어야 한다
    /// (안드로이드 `VoiceAudioCard.kt:130-133` 주석).
    var voiceProfileOptions: [VoiceSelectionSheet.Option] {
        let own = voiceStudio.profiles
            .filter { $0.isReadyForAlarmSelection && !isSystemVoice($0) }
            .map {
                VoiceSelectionSheet.Option(
                    id: $0.id,
                    name: $0.name,
                    detail: $0.relationshipLabel?.nilIfBlank,
                    // 무료 등급은 시스템 목소리만 쓸 수 있다(서버 `tts.ts:684-693`).
                    locked: freeVoiceTier,
                    // 교체 정리가 끝나지 않은 목소리는 **자리에 두되 못 고른다** — 감추면
                    // 사라진 것으로 보여 고장으로 읽힌다.
                    unavailableReason: voiceStudio.isReplacementSettling($0.id)
                        ? "목소리 정리 중이에요"
                        : nil
                )
            }
        let shared = voiceStudio.familyVoices
            .filter(\.isReadyForAlarmSelection)
            .map {
                VoiceSelectionSheet.Option(
                    id: $0.id,
                    name: $0.name,
                    detail: $0.sharedFromLabel,
                    locked: freeVoiceTier
                )
            }
        let system = voiceStudio.profiles
            .filter { $0.isReadyForAlarmSelection && isSystemVoice($0) }
            .map { VoiceSelectionSheet.Option(id: $0.id, name: $0.name, detail: "기본 목소리") }
        return own + shared + system
    }

    /// 목소리 시트가 실제로 그리는 목록 = 프로필들 + **마지막에 '직접 녹음'**.
    ///
    /// ⚠ 별도 세그먼트로 되돌리지 말 것 — 안드로이드도 한 목록이다
    /// (`VoiceAudioCard.kt` 의 `options = profileOptions + recordingOption`).
    var voiceOptions: [VoiceSelectionSheet.Option] {
        voiceProfileOptions + [
            VoiceSelectionSheet.Option(
                id: Self.recordingOptionID,
                name: "직접 녹음",
                detail: "이 알람에만 쓸 소리를 직접 녹음하기",
                // ⚠ **잠그지 말 것** — 직접 녹음은 유료 기능이 아니다(2026-08-12 확정).
                // 예전 주석은 "안드로이드 `VoiceAudioCard.kt` 와 같은 판정" 이라고 했지만
                // 안드로이드의 `VoiceProfileOption` 에는 `locked` 필드가 **아예 없다** —
                // 틀린 근거였다.
                locked: false,
                // 아직 녹음한 것이 없으니 들어볼 것도 없다.
                previewable: false
            )
        ]
    }

    /// 목소리 목록에서 '직접 녹음' 을 가리키는 id. `VoiceSource.localAudio` 의 원시값과
    /// 같게 두어 안드로이드(`VoiceSources.LOCAL_AUDIO`)와 문자열까지 일치시킨다.
    static let recordingOptionID = VoiceSource.localAudio.rawValue

    /// 목소리 행이 보여줄 값 — 녹음 갈래면 '직접 녹음', 아니면 고른 목소리 이름.
    var voiceRowSubtitle: String {
        if voiceSourceMode == .localAudio { return "직접 녹음" }
        return selectedVoiceName ?? "고르기"
    }

    var selectedVoiceName: String? {
        voiceProfileOptions.first { $0.id == voiceStudio.selectedProfileID }?.name
    }

    func selectVoiceOption(_ option: VoiceSelectionSheet.Option) {
        if option.locked {
            showVoicePlanLockedAlert()
            return
        }
        // 교체 정리가 끝나지 않은 목소리 — 지금 고르면 뒤이은 정리가 그 알람까지 되돌릴 수
        // 없이 벗긴다. 이유를 말하고 물러선다(행은 목록에 그대로 있다).
        if option.unavailableReason != nil {
            voiceGateAlert = VoiceGateAlertContent(
                title: "아직 준비 중이에요",
                message: "바꾼 목소리를 정리하고 있어요. 잠시 후 다시 골라 주세요.",
                offersPlanActions: false
            )
            return
        }
        // '직접 녹음' 은 프로필이 아니라 **갈래 전환**이다. 예전에는 이 전환을 세그먼트의
        // `.onChange` 가 맡았는데, 세그먼트를 없앴으니 부수효과도 여기로 옮긴다 —
        // 준비된 음성 무효화 / 미리듣기 정지 / (TTS 로 돌아갈 때) 녹음 중단.
        if option.id == Self.recordingOptionID {
            switchVoiceSource(to: .localAudio)
            return
        }
        if voiceSourceMode != .ttsProfile {
            switchVoiceSource(to: .ttsProfile)
        }
        // 공유받은 목소리는 '나를 부를 호칭' 이 없으면 먼저 받는다 — 없이 저장하면
        // 서버가 호칭 자리를 비운 문장을 만든다.
        if let shared = voiceStudio.familyVoices.first(where: { $0.id == option.id }), shared.requiresViewerInfo {
            sharedVoiceSetupTarget = shared
            return
        }
        // 기본 목소리는 준비된 문구로만 말할 수 있다 — 직접 입력한 문구가 있으면 묻는다.
        if losesManualText(switchingTo: option) {
            pendingVoiceSwitch = option
            return
        }
        applyVoiceSelection(option)
    }

    func applyVoiceSelection(_ option: VoiceSelectionSheet.Option) {
        voiceStudio.selectedProfileID = option.id
        voiceStudio.preparedAlarm = nil
    }

    /// 음성 갈래 전환 — 목소리(TTS) ↔ 직접 녹음.
    func switchVoiceSource(to newValue: VoiceSource) {
        guard voiceSourceMode != newValue else { return }
        voiceSourceMode = newValue
        voiceStudio.preparedAlarm = nil
        stopAllEditorPreviews()
        if newValue == .ttsProfile {
            localRecorder.stop()
        }
    }

    /// 판정식은 안드로이드와 같다: **시스템 목소리로 바꾸는데** 직접 입력 문구가 있고,
    /// 랜덤 생성도 버킷도 아닌 경우. ⚠ `!voiceRandomPrompt` 하나만 보면 안 된다 —
    /// 버킷이 붙으면 랜덤이 꺼지므로 버킷 알람까지 경고 대상이 되어 버린다
    /// (CLAUDE.md 「버킷이 붙으면 voiceRandomPrompt 가 꺼진다」).
    ///
    /// ⚠ **`draft.voiceRandomPrompt` 를 보지 말 것.** 그 값은 편집기를 여는 순간
    /// (`AlarmEditDraft.newDefault` / `init(record:)`) 정해지고 **편집 중 한 번도
    /// 갱신되지 않는다.** 살아 있는 상태는 `voiceStudio.randomPrompt` 이고, 문구 화면
    /// 저장(`applyMessageSettings`)이 그쪽만 바꾼다. draft 를 보던 시절에는 새 알람이
    /// 언제나 `true` 로 굳어 있어 **경고가 아예 뜨지 않았고**, 직접 입력한 문장이
    /// 말없이 버려졌다(기존 알람에서는 반대로 잃을 게 없는데 경고가 떴다).
    func losesManualText(switchingTo option: VoiceSelectionSheet.Option) -> Bool {
        isSystemVoiceId(option.id)
            && !voiceStudio.ttsText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !voiceStudio.randomPrompt
            && selectedFreeBucket == nil
    }

    /// 이 목소리로 쓸 수 있는 무료 테마. 서버가 내려준 스톡 클립의 카테고리에서 뽑되,
    /// 순서는 안드로이드 `FreeBucketOrder` 를 따른다.
    /// ⚠ **언어로 거른다.** 서버는 `ORDER BY … language ASC` 로 주므로 필터가 없으면
    /// 한국어 기기에서도 영어 클립이 먼저 잡힌다. 선다운로드(`StockClipPrefetcher`)는
    /// 기기 언어분만 받으므로, 그렇게 잡힌 클립은 **받아 둔 적도 없다.**
    /// 안드로이드 `ui/editor/AlarmEditorControls.kt` 의 `freeBucketsFor` 와 같은 식이다.
    ///
    /// ⚠ **매니페스트가 아직 없으면 빈 목록을 준다.** 예전에는 `FreeBucket.order` 전체로
    /// 폴백했는데, 그러면 클립이 하나도 없는 테마를 고를 수 있게 되고 고르는 순간 실패한다.
    /// 안드로이드도 `emptyList()` 다.
    var availableFreeBuckets: [FreeBucket] {
        guard let profileID = (voiceStudio.selectedProfileID).nilIfBlank else { return [] }
        let language = VoiceStudioViewModel.appVoiceLanguage()
        var variantsByCategory: [String: Set<Int>] = [:]
        for clip in voiceStudio.stockClips
        where clip.voiceProfileId == profileID && (clip.language ?? "ko") == language {
            guard let category = clip.category, let variant = clip.variant else { continue }
            variantsByCategory[category, default: []].insert(variant)
        }
        // ⚠ **'하나라도 있으면' 이 아니라 '전부 있어야' 한다**(2026-09-02 리뷰, 안드로이드
        //   `freeBucketsFor` 와 같은 규칙). 매니페스트는 클립이 하나 구워질 때마다 그
        //   카테고리를 곧바로 노출하므로, 시딩이 도는 중에는 **부분 세트**가 보인다.
        //   그때 고르면 그 순간의 variant 만 알람에 박히고 나중에 넓혀지지 않는다 —
        //   조건형(날씨·운세)에서는 엉뚱한 조건의 클립이 나가는 것이다.
        //   `expectedVariants` 가 없으면(매니페스트 미수신) 막지 않는다.
        let isSystem = voiceStudio.isSystemVoiceProfile(id: profileID)
        return FreeBucket.order.filter { bucket in
            guard let variants = variantsByCategory[bucket.rawValue] else { return false }
            guard let expected = voiceStudio.expectedVariants?.count(
                category: bucket.rawValue,
                isSystemVoice: isSystem
            ), expected > 0 else { return true }
            return variants == Set(0..<expected)
        }
    }

    /// 지금 고른 테마.
    ///
    /// ⚠ **순서가 중요하다.** 편집기에서 방금 고른 값이 먼저고, 없을 때만 저장된
    /// `bucketId` 로 되짚는다. 반대로 두면 편집기에서 테마를 바꿔도 저장된 옛 값이 이긴다.
    ///
    /// ⚠ **네트워크·캐시를 보지 않는다.** 예전에는 준비된 클립의 카테고리에서 읽어서,
    /// 음원을 못 받으면 **고른 적 없는 것으로 표시**됐다(= "불러오는 중이에요").
    /// 테마 선택은 값 하나이고, 음원은 저장할 때 받는다.
    var selectedFreeBucket: FreeBucket? { selectedBucketDraft }

    /// 테마 이어받기를 시도할 시점을 알리는 합성 키.
    /// 스톡 매니페스트 도착과 제한 여부 확정이 각각 다른 때에 오므로 둘을 묶는다.
    var freeBucketReadinessKey: String {
        "\(voiceStudio.stockClips.count)|\(usesStockClips)|\(voiceStudio.selectedProfileID ?? "")"
    }

    /// 이어받으려던 테마를 실제로 집는다. 목소리와 스톡 클립이 모두 준비된 뒤에 한 번만.
    ///
    /// ⚠ **이미 고른 게 있으면 덮지 않는다.** 사용자가 화면에서 고른 값이 우선이다.
    func applyPendingFreeBucketIfNeeded() {
        guard usesStockClips else { return }
        // 이미 고른 게 있으면 덮지 않는다 — 사용자가 화면에서 고른 값이 우선이다.
        guard selectedFreeBucket == nil else { pendingFreeBucket = nil; return }
        guard !voiceStudio.stockClips.isEmpty, voiceStudio.selectedProfileID != nil else { return }

        let buckets = availableFreeBuckets
        guard !buckets.isEmpty else { return }

        // 직전에 고른 테마를 잇는다. 단 **날씨는 도시가 있어야** 잇는다 — 도시가 없으면
        // 조건을 못 맞추고 저장도 막히므로, 그때는 다음 후보로 넘어간다.
        let remembered = pendingFreeBucket.flatMap { bucket -> FreeBucket? in
            guard buckets.contains(bucket) else { return nil }
            if bucket == .weather, (voiceStudio.weatherCity).nilIfBlank == nil { return nil }
            return bucket
        }

        // ⚠ **한 번도 고른 적 없어도 무언가는 붙여야 한다.** 예전에는 `pendingFreeBucket`
        // 이 nil 이면(= 이 계정이 테마를 고른 적 없음) 그대로 return 해서, 문구 행이
        // **"불러오는 중이에요" 에서 영영 벗어나지 못했다.** 사용자는 고른 적이 없을 뿐
        // 무언가 잘못한 게 아니다. 안드로이드도 `?: buckets.firstOrNull()` 로 항상 붙인다.
        guard let target = remembered ?? buckets.first else { return }

        selectFreeBucket(target)
        pendingFreeBucket = nil
    }

    /// 테마를 고른다. **값만 바꾼다 — 네트워크를 타지 않는다.**
    ///
    /// 음원은 저장할 때 받는다(`prepareSelectedBucketClipIfNeeded`). 예전에는 여기서
    /// 곧바로 다운로드했고, 그 결과가 곧 '고른 테마' 였다 — 그래서 회선이 느리거나
    /// 끊기면 고른 게 화면에 아예 안 나타났다.
    func selectFreeBucket(_ bucket: FreeBucket) {
        selectedBucketDraft = bucket
        // ⚠ **문구 종류를 테마와 맞춰 둔다**(2026-09-02 리뷰, 안드로이드 `setBucketAudio` 의
        //   `randomPromptContextForBucket(bucket)?.let { voiceRandomContext = it }` 미러).
        //   이걸 안 하면 이어받기(`applyPendingFreeBucketIfNeeded`)로 테마가 붙어도
        //   `randomContext` 는 기본값 `preset` 에 남는다. 요약 행이 이제 종류를 그리므로
        //   화면은 '기본 인사말' 이라고 말하는데 실제로는 예컨대 '약' 이 울리고, 문구 화면에는
        //   선택된 라디오가 하나도 없다(preset 은 기본 목소리 목록에 없다).
        //   저장까지 `voiceRandomContext = preset` 으로 남아 다시 열어도 어긋난 채다.
        if let context = RandomPromptContext.forBucket(bucket.rawValue) {
            voiceStudio.randomContext = context.rawValue
        }
        // 테마를 바꾸면 앞 테마로 준비해 둔 음원은 더 이상 맞지 않는다.
        voiceStudio.preparedAlarm = nil
        stockSelectedMessageID = nil
    }

    /// **저장 시점에** 고른 테마의 음원을 준비한다. 성공하면 true.
    ///
    /// 편집 중에는 아무것도 받지 않으므로(선택은 값 하나다) 저장이 이 일을 대신한다.
    /// 그동안 저장 버튼은 이미 '저장 중…' 을 보여준다(`EditorActionBar(saving:)`).
    ///
    /// ⚠ **실패하면 저장을 중단해야 한다.** 음원 없이 넘어가면 `LocalAlarmStore.validateDraft`
    /// 가 `voiceAudioRequired` 로 던져 "저장할 수 없어요" 만 뜨고 이유를 알 수 없다.
    /// 저장할 때 붙일 **사전렌더 버킷 카테고리**. nil 이면 라이브 생성 경로로 간다.
    ///
    /// ⚠ **유료 클론도 사전렌더를 쓴다 — iOS 는 2026-08-18 까지 이 갈래가 없었다.**
    /// `restrictToWeatherMedication`(무료이거나 기본 목소리) 하나로만 갈라서, 클론 목소리를
    /// 고르면 **사전렌더가 100% 끝나 있어도 매번 라이브 합성**했다. 그래서 클론 알람은
    /// 오프라인에서 만들 수 없었고, 매일 갱신 서비스가 그 알람들을 계속 다시 만들었다.
    /// 안드로이드는 `clonePrerenderBucketCategoryFor` → `hasCompleteCloneBucket` →
    /// `bindStockBucketClips` 를 먼저 시도하고 라이브는 **폴백**이다. 그 순서를 맞춘다.
    func bucketCategoryForSave() -> String? {
        guard let profileID = (voiceStudio.selectedProfileID).nilIfBlank else { return nil }
        // ⚠ **갈래는 하나다**(2026-09-02). 그전에는 기본 목소리면 `selectedFreeBucket`,
        //   클론이면 문구 종류로 갈랐는데, 그 둘은 애초에 같은 값을 다른 이름으로 담고
        //   있었다(`RandomPromptContext.bucketCategory` ↔ `FreeBucket.rawValue`). 갈라 두면
        //   한쪽만 고치는 사고가 나고, 실제로 문구 목록이 두 벌로 벌어진 원인이었다.
        // ⚠ **이미 붙어 있는 테마가 먼저다**(2026-09-02 리뷰). 스톡 클립 알람은
        //   `randomPrompt = false` 로 저장되므로, 기존 알람을 다시 열면 `loadVoicePromptState`
        //   가 테마만 복원하고 randomPrompt 는 false 로 둔다. 그때 아래 `randomPrompt` 가드에
        //   걸려 nil 이 나가면 `prepareSelectedBucketClipIfNeeded()` 가 클립을 **다시 받지
        //   않는다** — 캐시된 음원이 사라진 기기에서는 소리 없는 알람으로 저장된다.
        let category: String
        if let bucket = selectedFreeBucket {
            category = bucket.rawValue
        } else {
            guard voiceStudio.randomPrompt,
                  let context = RandomPromptContext(rawValue: voiceStudio.randomContext) else { return nil }
            category = context.bucketCategory
        }
        // ⚠ **부분 세트면 쓰지 않는다.** 날씨·운세는 **절대 인덱스**로 조건을 고르므로
        // (variant 3 = 미세먼지) 중간이 비면 엉뚱한 문구가 나간다. 그때는 라이브로 폴백한다.
        guard hasCompleteBucket(category: category, profileID: profileID) else { return nil }
        return category
    }

    /// 이 (목소리 · 카테고리) 세트가 **완전한가** — variant 0..N-1 이 다 있는가.
    ///
    /// ⚠ **N 을 앱에 박지 않는다.** 서버가 내려주는 `expected_variants` 를 쓴다
    /// (운영이 시드를 늘리면 앱 업데이트 없이 따라와야 한다). 그리고 **기본 목소리와 등록
    /// 목소리는 개수가 다르다** — `medication` 이 지금도 2 vs 3 이라 하나로 합치면 한쪽이 깨진다.
    func hasCompleteBucket(category: String, profileID: String) -> Bool {
        let variants = Set(stockClips(forCategory: category).compactMap { $0.variant })
        guard !variants.isEmpty,
              let expected = voiceStudio.expectedVariants?.count(
                  category: category,
                  isSystemVoice: voiceStudio.isSystemVoiceProfile(id: profileID)
              ),
              expected > 0
        else { return false }
        return variants == Set(0..<expected)
    }

    /// **이 목소리로 이 문구 종류를 지금 고를 수 있는가** — 서버가 사전렌더 클립을 다 만들어 뒀는가.
    ///
    /// ⚠ **이 판정식을 어디에도 베끼지 말 것. 부르는 자리가 셋이다:**
    ///  1. 목소리 선택 — `selectedProfileID` 의 `onChange`
    ///  2. **문구 종류 선택** — `applyMessageSettings`
    ///  3. **저장 직전** — `saveFlow`
    ///
    /// 2026-08-18 전에는 **1번에만** 있었다. 그래서 목소리를 고를 때는 통과했는데 그 뒤
    /// 문구 종류를 바꾸면 아무도 안 막았다 — 종류마다 버킷 category 가 다르고
    /// (`RandomPromptContext.bucketCategory`), 서버 렌더는 category 단위로 끝나므로 **같은
    /// 목소리가 종류에 따라 준비됐을 수도 아닐 수도 있다.** 특히 방금 공유받은 목소리가
    /// 그렇다(소유자 쪽 렌더가 진행 중).
    ///
    /// 지금은 그 상태로 저장까지 가도 라이브 생성으로 폴백해서 티가 안 난다. 라이브 생성을
    /// 걷어내면 그대로 **저장이 실패하는 막다른 길**이 된다. 그래서 세 자리 모두에서 막고,
    /// 막을 때는 반드시 **준비 페이지로 보낸다**(막기만 하면 빠져나갈 길이 없다).
    ///
    /// 안드로이드 짝은 `AlarmEditorScreen.needsClipPreparation` 이고 같은 갈래·같은 순서다.
    ///
    /// 통과시키는 갈래:
    ///  - 기본(시스템) 목소리 — 선다운로드 대상이라 여기서 막을 일이 아니다.
    ///  - 랜덤 문구가 아님(직접 입력·녹음) — 클립이 필요 없다.
    ///  - 매니페스트 미수신 — 못 물어본 것이 사용자를 막는 근거가 되면 안 된다.
    ///  - 버킷으로 매핑되지 않는 종류.
    func needsClipPreparation(
        profileID: String,
        randomPrompt: Bool,
        randomContext: String
    ) -> Bool {
        guard !voiceStudio.isSystemVoiceProfile(id: profileID) else { return false }
        guard randomPrompt,
              let context = RandomPromptContext(rawValue: randomContext) else { return false }
        // 매니페스트를 아직 못 받았으면 판단할 수 없다 — 막지 않는다(못 물어본 것이
        // 사용자를 막는 근거가 되면 안 된다).
        guard voiceStudio.expectedVariants != nil else { return false }
        return !hasCompleteBucket(category: context.bucketCategory, profileID: profileID)
    }

    func prepareSelectedBucketClipIfNeeded() async -> Bool {
        guard let bucketCategory = bucketCategoryForSave() else { return true }
        let clips = stockClips(forCategory: bucketCategory)
        guard let firstClip = clips.first else {
            voiceStudio.statusMessage = "이 테마의 문구를 아직 받지 못했어요. 잠시 뒤에 다시 시도해 주세요."
            return false
        }

        // ⚠ **세트를 통째로 받는다**(2026-08-18). 예전에는 `.first` **하나만** 받았는데,
        // 저장은 `bucketClipKeys(forCategory:)` 로 **전체 키 목록**을 행에 박았다. 그래서
        // 울릴 때 `AlarmSoundResolver.rotatedBucketClipKey` 가 고른 자리의 파일이 없어
        // `keys.first { cached }` 로 떨어졌고 — **언제나 variant 0** 이 나갔다.
        // 비 오는 날에 맑음 문구("하늘 한 번 올려다보세요")가 울린 원인이다.
        // 안드로이드 `bindStockBucketClips` 는 처음부터 `clips.forEach` 로 전부 받는다.
        //
        // 부분 세트 금지 규약이 **저장 판정(`hasCompleteBucket`)에만 있고 다운로드에는
        // 없었던 것**이 원인이라, 하나라도 못 받으면 저장을 막는다.
        // 이미 받아 둔 것은 `prepareStockClip` 이 캐시 우선이라 값이 거의 들지 않는다.

        // 이미 이 테마로 준비돼 있으면 그 클립을 그대로 쓴다(고른 것을 바꾸지 않는다).
        // 없으면 첫 클립. **회전은 저장된 뒤 울릴 때** 일어난다.
        let boundClip: StockClip = {
            if let prepared = voiceStudio.preparedAlarm,
               prepared.audioCacheKey.hasPrefix("stock_"),
               let match = clips.first(where: { $0.messageId == prepared.messageID }) {
                return match
            }
            return firstClip
        }()

        // ⚠ 묶을 클립을 **마지막에** 준비한다 — `prepareStockClip` 이 `preparedAlarm` 을
        // 갈아 끼우므로 순서가 곧 결과다.
        for clip in clips where clip.id != boundClip.id {
            guard await voiceStudio.prepareStockClip(clip, session: auth.session) != nil else {
                return false
            }
        }
        guard await voiceStudio.prepareStockClip(boundClip, session: auth.session) != nil else {
            return false
        }
        stockSelectedMessageID = boundClip.id
        return true
    }

    /// 이 (목소리 · 테마 · **기기 언어**)의 클립. 고르는 자리와 묶는 자리가 같은 목록을
    /// 봐야 회전이 어긋나지 않는다.
    func stockClips(forCategory category: String) -> [StockClip] {
        guard let profileID = (voiceStudio.selectedProfileID).nilIfBlank else { return [] }
        let language = bucketClipLanguage(forCategory: category, profileID: profileID)
        return voiceStudio.stockClips.filter {
            $0.voiceProfileId == profileID
                && $0.category == category
                && ($0.language ?? "ko") == language
        }
    }

    /// 이 (목소리 · 카테고리)의 클립이 실제로 존재하는 언어.
    ///
    /// 기기 언어가 있으면 그걸 쓰고, **없으면 있는 것 중 하나**로 떨어진다. 기기 언어만
    /// 고집하면 일본어로 만든 클론을 한국어 기기에서 쓸 때 세트가 통째로 비어 보여
    /// **오프라인 재생이 영영 안 켜진다**(안드로이드 `bucketClipLanguageFor` 와 같은 규칙).
    func bucketClipLanguage(forCategory category: String, profileID: String) -> String {
        let appLanguage = VoiceStudioViewModel.appVoiceLanguage()
        let languages = Set(
            voiceStudio.stockClips
                .filter { $0.voiceProfileId == profileID && $0.category == category }
                .map { $0.language ?? "ko" }
        )
        if languages.contains(appLanguage) { return appLanguage }
        return languages.sorted().first ?? appLanguage
    }

    /// 이 테마에 묶을 클립 캐시 키 전부. 매니페스트 순서를 그대로 쓴다 —
    /// 순서가 흔들리면 회전이 같은 문구를 두 번 내거나 건너뛴다.
    ///
    /// ⚠ **언어를 안 거르면 회전이 en→ja→ko 를 돌아가며 울린다.** 한 알람이 매일 다른
    /// 언어로 말하게 되고, 게다가 기기 언어가 아닌 클립은 받아 둔 적이 없어 소리도 안 난다.
    /// 날씨 테마 알람에 **그 날짜·그 도시의 실제 조건**을 붙인다.
    ///
    /// 실패(오프라인·위치 미상)하면 인덱스를 건드리지 않는다 — `nil` 은 '맑음' 이 아니라
    /// '아직 모른다' 이고, 0 으로 때우면 비 오는 날에 "하늘 한 번 올려다보세요" 가 나간다.
    /// 지역·발사날짜가 바뀌었으면 옛 값을 버린다(`shouldResetWeatherVariant`).
    private func applyWeatherVariant(to record: inout LocalAlarmRecord, previous: LocalAlarmRecord?) async {
        let reset = BucketVariantResolver.shouldResetWeatherVariant(
            previous: previous,
            nextBucketId: record.bucketId,
            nextCountry: record.voiceWeatherCountry,
            nextCity: record.voiceWeatherCity,
            nextFireAtMillis: record.fireAtMillis
        )
        var freshIndex: Int?
        if record.bucketId == "weather", let token = auth.session?.token {
            freshIndex = try? await AlarmTalkAPI.shared.getPrerenderVariant(
                context: "wake_weather",
                country: record.voiceWeatherCountry,
                city: record.voiceWeatherCity,
                targetDate: BucketVariantResolver.localDateString(millis: record.fireAtMillis),
                timezone: TimeZone.current.identifier,
                token: token
            )
        }
        let state = BucketVariantResolver.nextWeatherVariantState(
            nextBucketId: record.bucketId,
            resetVariant: reset,
            currentIndex: previous?.contextVariantIndex,
            currentResolvedAtMillis: previous?.contextResolvedAtMillis,
            freshIndex: freshIndex
        )
        record.contextVariantIndex = state.index
        record.contextResolvedAtMillis = state.resolvedAtMillis
    }

    /// ⚠ **`variant` 순으로 정렬하고 중복을 없앤다.** 날씨·운세 테마는 자리 번호가 곧
    /// 조건이라(`keys[i]` = variant i) 순서가 흔들리면 **맑은 날에 우산 얘기**를 한다.
    /// 서버가 `ORDER BY ... variant ASC` 로 주긴 하지만 그 순서에 기대지 않는다 —
    /// 같은 variant 가 둘이면 뒤 인덱스가 통째로 밀린다.
    /// 안드로이드 `bindStockBucketClips` 의 `sortedBy { it.variant }.distinctBy { it.variant }` 미러.
    func bucketClipKeys(forCategory category: String) -> [String] {
        var seenVariants = Set<Int>()
        return stockClips(forCategory: category)
            .enumerated()
            // variant 가 없는 옛 응답은 받은 순서를 유지하도록 큰 값으로 밀어 둔다.
            .sorted { ($0.element.variant ?? Int.max, $0.offset) < ($1.element.variant ?? Int.max, $1.offset) }
            .filter { seenVariants.insert($0.element.variant ?? -($0.offset + 1)).inserted }
            .map { AudioCacheStore.stockCacheKey(messageId: $0.element.messageId) }
    }

    /// 지금 고른 문구 갈래 — 요약 행과 문구 화면이 함께 읽는다.
    ///
    /// ⚠ **판정식은 `!randomPrompt && !isActiveStockClipAlarm` 이다.** `randomPrompt`
    /// 하나만 보면 스톡 클립(버킷) 알람이 '직접 입력' 으로 읽힌다 — 저장 시
    /// `voiceRandomPrompt = false` 가 되기 때문이다. 그러면 다시 열었을 때 요약 행은
    /// '사랑' 인데 눌러 열면 '직접 입력' 이 되고, 거기서 한 글자만 고쳐도 고른 클립도
    /// 방금 친 문구도 없이 일반 프리셋 알람으로 조용히 덮인다(CLAUDE.md 규약).
    var currentMessageContext: String {
        if !voiceStudio.randomPrompt && !isActiveStockClipAlarm {
            return MessageSettingsResult.manualContext
        }
        // ⚠ **테마가 붙어 있으면 그 테마가 답이다**(2026-09-02 리뷰). 울릴 때 무엇이
        //   나올지 정하는 것은 `bucketId` 이고 `randomContext` 는 그것을 부르는 이름일
        //   뿐이라, 둘이 어긋나면 **화면이 거짓말을 한다** — 저장된 종류가 `preset` 인데
        //   테마가 `medication` 이면 요약 행은 '기본 인사말' 이라고 하면서 실제로는 약
        //   문구가 울리고, 문구 화면에는 선택된 라디오가 하나도 없다(기본 목소리 목록에
        //   `preset` 이 없으므로).
        //
        //   쓰기 쪽은 이미 둘을 함께 맞춘다(`selectFreeBucket`·`applyMessageSettings`·
        //   안드로이드 `setBucketAudio`). 여기는 **읽을 때도** 실제로 울릴 것을 말하게
        //   하는 이중 안전장치다 — 어긋난 행이 어디서 오든(옛 저장분·동기화) 화면은
        //   진실을 말한다.
        if let bucket = selectedFreeBucket,
           let fromBucket = RandomPromptContext.forBucket(bucket.rawValue) {
            return fromBucket.rawValue
        }
        return voiceStudio.randomContext
    }

    /// 문구 화면의 저장 — 최종 반영은 여기 한 곳이다.
    func applyMessageSettings(_ result: MessageSettingsResult) {
        // ⚠ **관문 2/3 — 문구 종류 선택.** 판정은 `needsClipPreparation` 한 곳에만 있다.
        //
        // 같은 목소리라도 **종류마다 버킷 category 가 다르다**(`RandomPromptContext.bucketCategory`).
        // 서버 사전렌더는 category 단위로 끝나므로 '사랑' 은 준비됐는데 '약' 은 아직인 상태가
        // 정상적으로 존재한다 — 특히 방금 공유받은 목소리가 그렇다. 목소리를 고를 때(관문 1)
        // 통과한 것이 **그 뒤 고른 종류까지 보장하지는 않는다.**
        //
        // **아무것도 반영하지 않고** 준비 페이지로 보낸다 — 종류는 고르기 전 그대로 남는다
        // (목소리 관문이 목소리를 되돌리는 것과 같은 규칙). 이 함수는 문구 화면의
        // `onDisappear` 에서 불리므로 그 화면은 이미 닫혔고, 준비 페이지가 그 위에 뜬다.
        if !result.isManual,
           let profileID = voiceStudio.selectedProfileID.nilIfBlank,
           needsClipPreparation(
               profileID: profileID,
               randomPrompt: true,
               randomContext: result.context
           ) {
            preparationVoiceID = profileID
            return
        }
        voiceStudio.preparedAlarm = nil
        // ⚠ **테마를 비운다.** 문구 갈래와 테마는 동시에 켜질 수 없다. 안 비우면
        // `isActiveStockClipAlarm` 이 계속 참이라 '직접 입력' 을 골라도 입력창이 안 뜬다.
        selectedBucketDraft = nil
        stockSelectedMessageID = nil
        if result.isManual {
            voiceStudio.randomPrompt = false
            voiceStudio.ttsText = result.manualText
        } else {
            voiceStudio.randomPrompt = true
            voiceStudio.randomContext = result.context
            // 스톡 클립을 쓰는 목소리는 **고른 종류가 곧 테마**다. 여기서 같이 세우지 않으면
            // 요약 행·저장 갈래가 `selectedFreeBucket` 을 nil 로 읽어, 고른 것과 다르게 군다.
            if usesStockClips,
               let bucket = RandomPromptContext(rawValue: result.context).map({ FreeBucket(rawValue: $0.bucketCategory) }) ?? nil {
                selectedBucketDraft = bucket
            }
        }
        voiceStudio.weatherCountry = result.weatherCountry
        voiceStudio.weatherCity = result.weatherCity
        voiceStudio.fortuneGender = result.fortuneGender
        voiceStudio.fortuneBirthDate = result.fortuneBirthDate
        voiceStudio.fortuneBirthTime = result.fortuneBirthTime
    }

    /// 세부 설정 카드의 '다시 울림' 요약.
    private var snoozeSummary: String {
        guard draft.snoozeEnabled else { return "꺼짐" }
        let limit = SnoozeSettingsPane.repeatLabel(draft.snoozeRepeatLimit.rawValue)
        return "\(draft.snoozeMinutes)분 · \(limit)"
    }

    // MARK: - 같은 문구 재사용 (입력 캐시)

    /// 서버를 부르기 **전에** 만들 수 있는 입력 키. 재사용 대상이 아니면 nil.
    ///
    /// 제외하는 것:
    ///  - **랜덤 문구** — 매번 문장이 달라지는 게 기능이다
    ///  - **가족 알람** — 서버가 수신자별로 만들어야 하고, 내 로컬 캐시는 수신자 기기에
    ///    없어 그대로 저장하면 상대에게 **무음**이 된다
    func ttsInputKeyForReuse(listenerTitle: String?) -> String? {
        guard !voiceStudio.randomPrompt, !target.familyAlarmMode else { return nil }
        guard let userID = (auth.session?.user.id).nilIfBlank,
              let profileID = (voiceStudio.selectedProfileID).nilIfBlank else { return nil }
        let text = voiceStudio.ttsText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        return AudioCacheStore.ttsInputKey(
            userId: userID,
            profileId: profileID,
            text: text,
            // 랜덤이 아닌 경로의 카테고리·언어는 `VoiceStudioViewModel.generateTTS` 와 같다.
            category: "custom",
            // 번역을 없앴으므로 직접 입력 캐시 키 언어는 언제나 원문(ko)이다(2026-08-12).
            language: "ko",
            listenerTitle: listenerTitle
        )
    }

    func reusableTtsInputAlias(listenerTitle: String?) -> TtsInputAlias? {
        guard let key = ttsInputKeyForReuse(listenerTitle: listenerTitle) else { return nil }
        return AudioCacheStore.shared.resolveTtsInput(inputKey: key)
    }

    /// 별칭이 가리키는 오디오를 `preparedAlarm` 으로 세운다. 성공하면 true.
    func applyReusedTtsAudio(_ alias: TtsInputAlias) -> Bool {
        guard let profileID = (voiceStudio.selectedProfileID).nilIfBlank,
              let url = AudioCacheStore.shared.cachedURL(for: alias.cacheKey) else { return false }
        let meta = AudioCacheStore.shared.readMetadata(cacheKey: alias.cacheKey)
        voiceStudio.preparedAlarm = PreparedAlarmTalk(
            messageID: meta?.messageId ?? (editingAlarm?.ttsMessageId).nilIfBlank ?? "",
            voiceProfileID: profileID,
            localAudioFileName: url.lastPathComponent,
            audioCacheKey: alias.cacheKey,
            rawAudioURL: meta?.rawAudioUri,
            // ⚠ 입력 원문이 아니라 **그 오디오와 짝이 되는 서버 표시 문구**를 쓴다.
            // 번역이 켜지면 둘이 달라지는데, 원문을 쓰면 잠금화면 문구와 실제 음성이 어긋난다.
            text: alias.displayText,
            // 번역을 없앴으므로 직접 입력 캐시 키 언어는 언제나 원문(ko)이다(2026-08-12).
            language: "ko",
            listenerTitle: alias.displayText.isEmpty ? nil : voiceStudio.selectedListenerTitle
        )
        voiceStudio.statusMessage = "전에 만든 음성을 그대로 사용했어요."
        return true
    }

    /// 다음에 같은 문구를 넣으면 이 파일을 바로 찾도록 화살표를 남긴다.
    ///
    /// ⚠ **두 개를 남긴다** — 입력 원문 키와 **서버 표시 문구 키**. 알람에 저장되는 건
    /// 표시 문구이고 '마지막에 쓴 직접 입력 문구' 로 기억되는 것도 그 값이다. 번역이
    /// 켜진 기기에서는 둘이 달라서, 원문 키만 남기면 다음 새 알람이 표시 문구로 열려
    /// 캐시를 빗나간다 — '재생성도 한도 차감도 없다' 던 약속이 조용히 깨진다.
    func rememberTtsInputAlias(for prepared: PreparedAlarmTalk, listenerTitle: String?) {
        guard let inputKey = ttsInputKeyForReuse(listenerTitle: listenerTitle) else { return }
        let store = AudioCacheStore.shared
        store.linkTtsInput(inputKey: inputKey, serverCacheKey: prepared.audioCacheKey, displayText: prepared.text)

        guard let userID = (auth.session?.user.id).nilIfBlank,
              let profileID = (voiceStudio.selectedProfileID).nilIfBlank else { return }
        let displayTextKey = AudioCacheStore.ttsInputKey(
            userId: userID,
            profileId: profileID,
            text: prepared.text,
            category: "custom",
            // 번역을 없앴으므로 직접 입력 캐시 키 언어는 언제나 원문(ko)이다(2026-08-12).
            language: "ko",
            listenerTitle: listenerTitle
        )
        // 같은 값이면 굳이 두 번 쓰지 않는다.
        guard displayTextKey != inputKey else { return }
        store.linkTtsInput(inputKey: displayTextKey, serverCacheKey: prepared.audioCacheKey, displayText: prepared.text)
    }

    var navigationTitle: String {
        if target.familyAlarmMode { return "상대 알람 맞추기" }
        return target.editingAlarmID == nil ? "알람 만들기" : "알람 수정"
    }

    var activePromptContext: RandomPromptContext {
        RandomPromptContext.normalized(voiceStudio.randomContext)
    }

    var targetWeatherReady: Bool {
        target.familyAlarmMode && selectedFamilyRecipient?.dynamicPromptSettingsState?.weatherReady == true
    }

    var targetFortuneReady: Bool {
        target.familyAlarmMode && selectedFamilyRecipient?.dynamicPromptSettingsState?.fortuneReady == true
    }

    /// 음성 기능 접근 등급 (Android `AlarmEditorScreen.kt:144-146` 미러).
    /// - loggedOut: 로그아웃. 음성 모드 자체가 잠긴다 (alarm_only 강제).
    /// - free: 로그인했으나 유료 음성 권한 없음. 음성은 쓰되 시스템 보이스 +
    ///   랜덤 preset 으로만 제한된다.
    /// - paid: personal 이상. 모든 음성 기능 사용 가능.
    enum PlanAccess { case loggedOut, free, paid }

    /// `currentPlan` 만으로는 loggedOut 과 free 를 구분할 수 없다
    /// (`PlanTier.bestKnown` 은 두 경우 모두 .free 를 반환). Android 가
    /// `authSession == null` 로 판별하듯, 세션 유무를 discriminator 로 쓴다.
    var planAccess: PlanAccess {
        guard auth.session != nil else { return .loggedOut }
        return currentPlan.meetsOrExceeds(.personal) ? .paid : .free
    }

    /// 로그아웃 상태에서만 음성 모드를 통째로 막는다 (재생 방식 picker + 저장/로드 시
    /// alarm_only 강제). 기존 `voicePlanLocked` 의 자리를 대체.
    var voiceModeBlocked: Bool { planAccess == .loggedOut }

    /// 로그인 무료 등급 — 음성은 허용하되 시스템 보이스/preset 으로 강제하는 graduated 경로.
    var freeVoiceTier: Bool { planAccess == .free }

    /// 이 목소리가 **미리 구워 둔 스톡 클립**으로 우는가(무료 플랜이거나 기본 목소리).
    ///
    /// 안드로이드 `ui/editor/AlarmEditorScreen.kt` 의 `usesStockClips` 미러 —
    /// 판정식은 **OR** 다: `freeVoiceTier || 시스템 보이스 선택됨`.
    ///
    /// ⚠ **`&&` 로 쓰지 말 것.** iOS 는 이걸 `freeVoiceTier && 시스템보이스` 로 잘못 써서
    /// 유료 사용자가 기본 목소리에 라이브 문구를 붙일 수 있었다(2026-08-07 확인).
    ///
    /// ⚠ 예전 이름은 `restrictToWeatherMedication` 이었고, 이름 그대로 문구 목록을 날씨·약으로
    /// 잘랐다. 그건 등급 정책이 아니라 **기본 목소리에 운세·사랑 클립이 없다**는 사정이었고,
    /// 2026-09-02 에 그 클립을 채우고 목록을 하나로 합쳤다. 지금 이 값이 가르는 것은
    /// **오디오를 어떻게 얻는가** 하나이고, 등급으로 갈리는 것은 직접 입력 잠금뿐이다.
    var usesStockClips: Bool {
        freeVoiceTier || voiceStudio.isSystemVoiceProfile(id: voiceStudio.selectedProfileID)
    }

    var familyAlarmLocked: Bool {
        socialFeatures.familyGroup?.group == nil && !currentPlan.meetsOrExceeds(.couple)
    }

    var currentPlan: PlanTier {
        PlanTier.bestKnown(
            serverSubscription: socialFeatures.subscription,
            storeTier: subscriptions.currentTier,
            userPlan: auth.session?.user.plan
        )
    }

    var defaultPlayModeForPlan: AlarmPlayMode {
        voiceModeBlocked ? .alarmOnly : .voiceOnly
    }



    var editingAlarm: LocalAlarmRecord? {
        target.editingAlarmID.flatMap { id in
            store.alarms.first { $0.id == id }
        }
    }

    var existingLocalAudioLabel: String? {
        guard selectedLocalAudioURL == nil,
              localRecorder.latestRecordingURL == nil,
              !clearExistingLocalAudio,
              let alarm = editingAlarm,
              alarm.voiceSourceEnum == .localAudio,
              alarm.audioCacheKey != nil else {
            return nil
        }
        return "저장된 녹음/파일 음성을 사용 중이에요."
    }

    var familyRecipients: [FamilyGroupMember] {
        let currentUserID = auth.session?.user.id
        let currentEmail = auth.session?.user.email
        return (socialFeatures.familyGroup?.members ?? []).filter { member in
            member.userId != currentUserID &&
                member.email != currentEmail &&
                member.allowFamilyAlarms == true
        }
    }

    var selectedFamilyRecipient: FamilyGroupMember? {
        // 「누구를 깨울까요?」 에서 고른 사람이 우선이다.
        let preferredID = selectedFamilyRecipientID ?? target.recipientUserID
        if let preferredID,
           let selected = familyRecipients.first(where: { $0.userId == preferredID }) {
            return selected
        }
        // ⚠ 폴백은 **고른 적이 없을 때만**이다. 고른 값을 흘리면 첫 번째 사람에게 간다.
        return familyRecipients.first
    }

    // MARK: - Initial load

    func loadInitialState() {
        if let editingID = target.editingAlarmID,
           let alarm = store.alarms.first(where: { $0.id == editingID }) {
            draft = AlarmEditDraft(from: alarm)
            voiceSourceMode = alarm.voiceSourceEnum == .localAudio ? .localAudio : .ttsProfile
            clearExistingLocalAudio = false
            if voiceModeBlocked && draft.playMode != .alarmOnly {
                draft.playMode = .alarmOnly
            }
            loadVoicePromptState(from: alarm)
        } else {
            draft = .newDefault(defaultPlayMode: defaultPlayModeForPlan)
            voiceSourceMode = .ttsProfile
            clearExistingLocalAudio = false
            loadVoicePromptState(from: nil)
            selectDefaultFamilyRecipientIfNeeded()
        }
    }

    func loadVoicePromptState(from alarm: LocalAlarmRecord?) {
        let saved = savedPromptPreferences()
        ttsProfileChangedDuringEdit = false
        suppressProfileChangeInvalidation = true
        voiceStudio.selectedProfileID = alarm?.voiceProfileId
        voiceStudio.preparedAlarm = nil
        stockSelectedMessageID = nil
        // 저장된 테마를 편집기 상태로 **한 번** 옮긴다. 이 뒤로는 편집기가 소유한다 —
        // 저장값을 계속 읽으면 사용자가 문구 갈래를 바꿔도 테마가 안 풀린다.
        selectedBucketDraft = FreeBucket.stored(alarm?.bucketId)
        stopAllEditorPreviews()
        voiceStudio.ttsText = alarm?.voiceText ?? ""
        voiceStudio.ttsCategory = alarm?.voiceCategory ?? "morning"
        voiceStudio.ttsLanguage = alarm?.voiceLanguage ?? "ko"
        // 신규 알람은 랜덤 문구 ON 으로 열려 한-탭 저장이 가능해야 한다
        // (Android `AlarmEditorState.from` line 331-333). 기존 알람은 저장값을 따른다.
        voiceStudio.randomPrompt = alarm?.voiceRandomPrompt ?? true
        // 종류를 떨어뜨리던 시절(2026-08-12 저장 수정 이전)에 저장된 테마 알람은 이 값이
        // nil 이라, 그대로 두면 '직접 입력' 으로 열린다. 테마 id 로 되짚는다 —
        // `RandomPromptContext.forBucket` 은 저장 쪽 `bucketCategory` 의 역이고 **한 쌍**이다.
        voiceStudio.randomContext = (
            alarm?.voiceRandomContext.nilIfBlank.map(RandomPromptContext.normalized)
                ?? RandomPromptContext.forBucket(alarm?.bucketId)
                ?? .defaultContext
        ).rawValue

        // **직전 선택 유지 — 새 알람에만 적용한다.**
        // 기존 알람을 열 때는 저장된 자기 값만 쓴다(열기만 해도 문구가 바뀌면 안 된다).
        // 규약 전문은 CLAUDE.md 「알람 편집기 기본값 = 직전 선택 유지」.
        if alarm == nil {
            let store = DynamicPromptPreferenceStore()
            let userID = auth.session?.user.id
            if let manual = store.lastManualText(userID: userID) {
                // `last_manual_text` 가 차 있다 = 마지막 선택이 직접 입력이었다.
                // 문구까지 함께 이어받는다 — 종류만 이어받으면 빈 직접입력으로 열려
                // 저장이 막힌다(2026-08-06 규칙 변경의 근거).
                voiceStudio.randomPrompt = false
                voiceStudio.ttsText = manual
            } else if let context = store.lastMessageContext(userID: userID) {
                voiceStudio.randomPrompt = true
                voiceStudio.randomContext = RandomPromptContext.normalized(context).rawValue
            }
            // 무료 테마는 **문구 종류·직접입력과 다른 축**이라 따로 이어받는다.
            // 실제 클립 바인딩은 목소리·스톡 매니페스트가 준비된 뒤라야 하므로 여기서는
            // 의도만 남기고, `applyPendingFreeBucketIfNeeded` 가 준비되면 집는다.
            pendingFreeBucket = FreeBucket.stored(store.lastFreeBucket(userID: userID))
            // 한 번도 고른 적 없으면 위에서 정한 폴백(랜덤 ON + preset)을 그대로 쓴다.
        }

        // ⚠ 여기서 번역 플래그를 세우던 자리다 — **번역을 없앴다**(2026-08-12).
        // 직접 입력한 문구는 그대로 읽는다.
        voiceStudio.weatherCountry = alarm?.voiceWeatherCountry ?? saved.weatherCountry
        voiceStudio.weatherCity = alarm?.voiceWeatherCity ?? saved.weatherCity
        voiceStudio.fortuneGender = alarm?.voiceFortuneGender ?? saved.fortuneGender
        voiceStudio.fortuneBirthDate = alarm?.voiceFortuneBirthDate ?? saved.fortuneBirthDate
        voiceStudio.fortuneBirthTime = alarm?.voiceFortuneBirthTime ?? saved.fortuneBirthTime
        // 기존 스톡 클립 알람은 선택/준비 상태로 복원해 저장 시 같은 캐시 음원을 재사용한다
        // (P2). selectedProfileID 가 위에서 먼저 설정되고 그 onChange 훅이
        // stockSelectedMessageID 를 비우므로, 복원은 반드시 그 이후 — 즉 coerce 직전 —
        // 에 수행한다. coerce 가 보기 전에 preparedAlarm/stockSelectedMessageID 가 채워져
        // 있어야 803 라인 가드가 4-값 강제를 건너뛴다.
        restoreStockClipSelectionIfNeeded(from: alarm)
        coerceFreeVoiceTierConstraints()
        DispatchQueue.main.async {
            suppressProfileChangeInvalidation = false
        }
    }

    /// 기존에 저장된 스톡 클립 알람을 다시 "선택/준비" 상태로 복원한다(P2).
    /// P1 과 동일한 신호(`audioCacheKey` 의 `stock_` prefix + 시스템 voiceProfileId)로
    /// 스톡 알람을 식별하고, 스테이징됐던 캐시 파일이 디스크에 그대로 있을 때만
    /// `preparedAlarm` + `stockSelectedMessageID` 를 재구성한다. 이렇게 하면 saveFlow 의
    /// 스톡 분기(`prepared.audioCacheKey` 의 `stock_` prefix 판정)가 동일 audioCacheKey 를
    /// 재사용한다. 캐시가 sweep 됐으면 복원하지 않아 saveFlow 가 정상 재생성 경로를
    /// 타게 둔다(dangling 파일 재사용 방지, risk 1).
    private func restoreStockClipSelectionIfNeeded(from alarm: LocalAlarmRecord?) {
        guard let alarm, alarm.isStockVoiceClip,
              let cacheKey = alarm.audioCacheKey,
              let messageID = (alarm.ttsMessageId).nilIfBlank,
              let profileID = (alarm.voiceProfileId).nilIfBlank,
              let localFileName = (alarm.localAudioUri).nilIfBlank else {
            return
        }
        // 스테이징된 `stock_<id>` 캐시 파일이 살아 있을 때만 재사용한다.
        guard AudioCacheStore.shared.cachedURL(for: cacheKey) != nil else { return }
        voiceStudio.preparedAlarm = PreparedAlarmTalk(
            messageID: messageID,
            voiceProfileID: profileID,
            localAudioFileName: localFileName,
            audioCacheKey: cacheKey,
            rawAudioURL: alarm.rawAudioUri,
            text: alarm.voiceText ?? "",
            language: alarm.voiceLanguage ?? "ko",
            listenerTitle: alarm.voiceListenerTitle
        )
        stockSelectedMessageID = messageID
        // 스톡 클립은 고정 음원이므로 랜덤 문구가 아니다(저장값 voiceRandomPrompt=false 미러).
        voiceStudio.randomPrompt = false
    }

    /// 무료 등급 음성 제약을 강제한다 (Android `AlarmEditorScreen.kt:863-882` 미러).
    /// `freeVoiceTier && playMode != .alarmOnly` 일 때 음성을 다음 4-값으로 고정한다:
    /// tts_profile 소스 + randomPrompt=true + randomContext='preset' + translate=false.
    /// 값이 실제로 달라질 때만 재할당하고 preparedAlarm 을 무효화한다(무한 무효화 방지).
    @discardableResult
    func coerceFreeVoiceTierConstraints() -> Bool {
        // ⚠ `freeVoiceTier` 가 아니라 `usesStockClips` 다 — 유료가 기본
        // 목소리를 골랐을 때도 preset 4-값으로 고정해야 화면과 저장이 어긋나지 않는다.
        guard usesStockClips, draft.playMode != .alarmOnly else { return false }
        // ⚠ **직접 녹음에는 이 제한을 걸지 않는다**(안드로이드
        // `AlarmEditorScreen.kt` 의 `voiceSource != LOCAL_AUDIO` 가드 미러).
        // 녹음본은 그냥 로컬 오디오 재생이라 플랜·목소리 종류와 무관하게 허용된다.
        // 여기서 `ttsProfile` 로 되돌리면 **녹음해 둔 것이 지워진다** — 특히 유료
        // 사용자가 기본 목소리를 고른 채 녹음했을 때(선택 목소리 id 는 시스템인데
        // 소스는 녹음) 제한이 걸려 녹음이 날아간다.
        guard voiceSourceMode != .localAudio else { return false }
        // 스톡 클립이 스테이징된 동안에는 4-값 강제를 건너뛴다. 스톡 선택은 생성을
        // 우회해 preparedAlarm 을 직접 채우므로, 혹시라도 randomPrompt 등이 흔들려
        // coerce 가 preparedAlarm 을 무효화하면 선택이 사라진다(spec risk 3 mitigation).
        // 정상 상태에서는 4-값이 이미 고정돼 있어 어차피 변경이 없다.
        // ⚠ **테마를 고른 상태면 4-값 강제를 건너뛴다.** 예전에는 `preparedAlarm != nil`
        // 을 함께 요구했는데, 음원 준비를 저장 시점으로 옮긴 뒤로 편집 중에는 그게 늘 nil
        // 이다 — 그대로 두면 테마를 골라도 `randomPrompt = true`, `randomContext = "preset"`
        // 로 되돌아가 고른 테마가 저장되지 않는다.
        if selectedFreeBucket != nil { return false }
        // ⚠ **직접 입력을 고른 유료 사용자를 건드리지 않는다**(2026-09-02, 안드로이드
        // `AlarmEditorScreen` 의 `if (!freeVoiceTier && manualChosen) return@LaunchedEffect`
        // 미러). `usesStockClips` 는 `freeVoiceTier || 시스템보이스` 라 **유료가 기본
        // 목소리를 고른 경우도 포함**하는데, 직접 입력은 테마가 아니라 위 가드에 걸리지
        // 않는다. 그대로 두면 저장 직전 이 강제가 `randomPrompt = true`·`preset` 으로
        // 되돌려, 방금 친 문구 대신 **목소리 자기소개 클립**이 알람으로 저장된다 —
        // 경고도 알럿도 없이. 잠긴 등급(무료)에서는 예전 그대로 돈다.
        if !freeVoiceTier, !voiceStudio.randomPrompt,
           (voiceStudio.ttsText).nilIfBlank != nil {
            return false
        }
        var changed = false
        if voiceSourceMode != .ttsProfile {
            voiceSourceMode = .ttsProfile
            changed = true
        }
        if !voiceStudio.randomPrompt {
            voiceStudio.randomPrompt = true
            changed = true
        }
        let presetContext = RandomPromptContext.preset.rawValue
        if RandomPromptContext.normalized(voiceStudio.randomContext).rawValue != presetContext {
            voiceStudio.randomContext = presetContext
            changed = true
        }
        // 언어를 비번역 기본값 "ko"(source)로 고정한다. randomPrompt 분기에서
        // activeLanguage = ttsLanguage 이므로(VoiceStudioViewModel generateTTS:756) translate=false
        // 라도 stale en/ja 가 그대로 전송돼 서버가 번역 경로로 흐른다. source 로 맞춰 무료
        // 프리셋 요청이 번역을 유발하지 못하게 막는다(서버가 source of truth, 이는 클라 차단).
        if voiceStudio.ttsLanguage != "ko" {
            voiceStudio.ttsLanguage = "ko"
            changed = true
        }
        if changed {
            voiceStudio.preparedAlarm = nil
        }
        return changed
    }

    /// 시각 변경 시 랜덤 문구용 준비 음원을 무효화한다. 랜덤 클립은 발화 시각에 종속되어
    /// 다른 시각용으로 합성된 음원을 그대로 저장하면 stale 이 된다. 고정 문구/스톡 클립은
    /// 시각과 무관하므로 무효화하지 않는다(스크롤 중간값이 스톡 선택을 지우는 것 방지).
    func invalidatePreparedRandomClipOnTimeChange() {
        guard voiceStudio.randomPrompt else { return }
        guard selectedFreeBucket == nil else { return }
        voiceStudio.preparedAlarm = nil
    }

    func savedPromptPreferences() -> DynamicPromptPreferences {
        let server = DynamicPromptPreferences.from(settings: auth.session?.user.dynamicPromptSettings)
        return server == DynamicPromptPreferences() ? .load(userID: auth.session?.user.id) : server
    }

    /// 저장 시 사용자가 입력한 날씨 지역·운세 정보를 계정 기본값에 보존해, 다음 알람을
    /// 만들 때 매번 도시·생년월일을 다시 입력하지 않게 한다.
    /// 안드로이드 `ui/editor/AlarmEditorScreen.kt` 의 `saveWeatherLocation`/`saveFortuneInfo`
    /// 미러 — 가족(상대) 알람은 상대 정보라 내 기본값을 덮어쓰지 않는다.
    ///
    /// ⚠ **테마(스톡) 알람도 여기 들어와야 한다.** 테마 알람은 `randomPrompt` 가 꺼지므로
    /// 그것만 보고 걸러내면 '날씨' 테마로 도시를 넣어도 저장되지 않아, 다음 새 알람이
    /// 날씨를 이어받지 못하고 매번 '약' 으로 돌아간다. 안드로이드 `weatherContextForSave()`·
    /// `fortuneContextForSave()` 가 버킷 알람을 예외 처리하는 것과 같은 이유다.
    func persistDynamicPromptPreferencesIfNeeded() {
        guard !target.familyAlarmMode else { return }
        guard voiceStudio.randomPrompt || isActiveStockClipAlarm else { return }
        let context = activePromptContext
        var prefs = DynamicPromptPreferences.load(userID: auth.session?.user.id)
        var changed = false
        if context.usesWeather,
           let country = (voiceStudio.weatherCountry).nilIfBlank,
           let city = (voiceStudio.weatherCity).nilIfBlank {
            prefs.weatherCountry = country
            prefs.weatherCity = city
            changed = true
        }
        if context.usesFortune,
           let gender = (voiceStudio.fortuneGender).nilIfBlank,
           let birthDate = (voiceStudio.fortuneBirthDate).nilIfBlank,
           let birthTime = (voiceStudio.fortuneBirthTime).nilIfBlank {
            prefs.fortuneGender = gender
            prefs.fortuneBirthDate = birthDate
            prefs.fortuneBirthTime = birthTime
            changed = true
        }
        if changed {
            prefs.save(userID: auth.session?.user.id)
        }
    }

    func applyVoicePromptState(to record: inout LocalAlarmRecord) {
        let enabled = record.playModeEnum != .alarmOnly && voiceStudio.randomPrompt
        let context = RandomPromptContext.normalized(voiceStudio.randomContext)
        record.voiceRandomPrompt = enabled
        record.voiceRandomContext = enabled ? context.rawValue : nil
        record.voiceWeatherCountry = enabled && context.usesWeather ? (voiceStudio.weatherCountry).nilIfBlank : nil
        record.voiceWeatherCity = enabled && context.usesWeather ? (voiceStudio.weatherCity).nilIfBlank : nil
        record.voiceFortuneGender = enabled && context.usesFortune ? (voiceStudio.fortuneGender).nilIfBlank : nil
        record.voiceFortuneBirthDate = enabled && context.usesFortune ? (voiceStudio.fortuneBirthDate).nilIfBlank : nil
        record.voiceFortuneBirthTime = enabled && context.usesFortune ? (voiceStudio.fortuneBirthTime).nilIfBlank : nil
    }

    func showVoicePlanLockedAlert() {
        // ⚠ **상태는 셋이다 — 둘로 가르지 말 것.** 예전에는 `voiceModeBlocked` 하나로
        // 갈라, 그 `else` 에 **로그인한 유료 사용자**까지 들어가 이미 가진 이용권을
        // 사라고 말했다. 안드로이드도 같은 결함이 있었고 `VoiceGateReason` 으로 고쳤다
        // (2026-08-07, 사용자 문의로 확인).
        let message: String
        switch planAccess {
        case .loggedOut:
            message = "음성 알람은 로그인 후 사용할 수 있어요."
        case .free:
            // 유료 게이트 설명은 `PaidGateCopy` 한 곳에서만 정한다(안드 `plan_gate_paid_message`).
            message = PaidGateCopy.message
        case .paid:
            // 유료인데 막혔다 = 플랜이 아니라 **목소리 종류**의 문제다.
            message = "기본 목소리는 준비된 문구로만 말할 수 있어요. 직접 입력한 문구로 깨우려면 내 목소리를 골라 주세요."
        }
        let title: String
        switch planAccess {
        case .loggedOut: title = "로그인이 필요해요"
        case .free: title = "유료 이용권이 필요해요"
        case .paid: title = "기본 목소리로는 직접 입력을 쓸 수 없어요"
        }
        voiceGateAlert = VoiceGateAlertContent(
            title: title,
            message: message,
            // ⚠ 쿠폰·결제 액션은 **이용권이 없어서 막힌 경우에만**. 비로그인에게는
            // 등록할 계정이 없고, 이미 유료인 사람에게는 눌러도 아무 일이 없다.
            offersPlanActions: planAccess == .free
        )
    }

    func selectDefaultFamilyRecipientIfNeeded() {
        guard target.familyAlarmMode else { return }
        if let selectedFamilyRecipientID,
           familyRecipients.contains(where: { $0.userId == selectedFamilyRecipientID }) {
            return
        }
        if let first = familyRecipients.first {
            selectFamilyRecipient(first.userId)
        }
    }

    func selectDefaultVoiceProfileIfNeeded() {
        guard draft.playMode != .alarmOnly else { return }
        let selected = voiceStudio.selectedProfileID
        // ⚠ **정리 중인 목소리는 자동으로 고르지 않는다**(Codex #703 P1). 선택 시트의 탭만
        // 막아서는 부족하다 — 그 목소리가 **마지막에 쓴 것**이면 새 편집기가 스스로 그것을
        // 골라, 사용자는 아무것도 누르지 않았는데 그 목소리로 저장하게 된다. 뒤이은 정리가
        // 그 새 알람을 되돌릴 수 없이 벗긴다. 시트에는 그대로 보인다(흐리게).
        let readyOwn = voiceStudio.profiles.filter {
            $0.isReadyForAlarmSelection && !voiceStudio.isReplacementSettling($0.id)
        }
        let readyShared = voiceStudio.familyVoices.filter {
            $0.isReadyForAlarmSelection && !voiceStudio.isReplacementSettling($0.id)
        }

        // 무료 등급은 서버가 시스템 보이스만 허용한다(tts.ts:684-693).
        // 비-시스템 프로필이 선택돼 있으면 시스템 보이스로 갈아끼워 403 을 예방한다.
        // 온보딩/목소리 탭에서 고른 기본 목소리(시스템)를 우선 선택 — Android VoiceAudioCard 미러.
        let defaultVoice = readyOwn.first { $0.id == voiceStudio.defaultVoiceId }

        // **마지막에 쓴 목소리가 기본·그룹보다 우선한다**(CLAUDE.md 「목소리 프리셀렉트는
        // 마지막에 쓴 것이 그룹보다 우선」). `refresh` 안에도 같은 판단이 있지만 그건 성공
        // 경로 안이라, 조기 반환(다른 refresh 진행 중)이나 네트워크 실패로 여기까지 오면
        // 선택이 비어 있고 아래 폴백이 온보딩 기본 목소리를 집는다.
        let lastUsedID = voiceStudio.lastUsedVoiceId
        let lastUsedOwn = readyOwn.first { $0.id == lastUsedID }
        let lastUsedShared = readyShared.first { $0.id == lastUsedID && !$0.requiresViewerInfo }

        if freeVoiceTier {
            // 무료 등급은 서버가 시스템 보이스만 허용하므로, 마지막에 쓴 것도 시스템일 때만 쓴다.
            let lastUsedSystem = lastUsedOwn.flatMap { isSystemVoice($0) ? $0 : nil }
            let systemVoice = lastUsedSystem ?? defaultVoice ?? readyOwn.first { isSystemVoice($0) }
            let selectedIsSystem = voiceStudio.isSystemVoiceProfile(id: selected)
            if selectedIsSystem,
               readyOwn.contains(where: { $0.id == selected }) {
                return
            }
            if let systemVoice {
                voiceStudio.selectedProfileID = systemVoice.id
            }
            return
        }

        let selectedStillAvailable = selected.map { selectedID in
            readyOwn.contains(where: { $0.id == selectedID }) ||
                readyShared.contains(where: { $0.id == selectedID })
        } ?? false
        if selectedStillAvailable {
            return
        }
        if let lastUsedOwn {
            voiceStudio.selectedProfileID = lastUsedOwn.id
        } else if let lastUsedShared {
            voiceStudio.selectedProfileID = lastUsedShared.id
        } else if let defaultVoice {
            voiceStudio.selectedProfileID = defaultVoice.id
        } else if let first = readyOwn.first {
            voiceStudio.selectedProfileID = first.id
        } else if let first = readyShared.first, !first.requiresViewerInfo {
            voiceStudio.selectedProfileID = first.id
        }
    }

    func selectFamilyRecipient(_ userID: String) {
        selectedFamilyRecipientID = userID
        voiceStudio.preparedAlarm = nil
        guard let recipient = familyRecipients.first(where: { $0.userId == userID }) else { return }
        let preferences = DynamicPromptPreferences.from(settings: recipient.dynamicPromptSettings)
        voiceStudio.weatherCountry = preferences.weatherCountry
        voiceStudio.weatherCity = preferences.weatherCity
        voiceStudio.fortuneGender = preferences.fortuneGender
        voiceStudio.fortuneBirthDate = preferences.fortuneBirthDate
        voiceStudio.fortuneBirthTime = preferences.fortuneBirthTime
    }

    // MARK: - Save flow

    func saveFlow() async {
        guard !isWorking else { return }
        isWorking = true
        defer { isWorking = false }

        // ⚠ **정리 중인 목소리는 여기서 막는다**(버튼은 살려 둔다 — 위 `editorSaveBlocked`
        // 주석). 지금 저장하면 뒤이은 정리가 그 알람을 되돌릴 수 없이 벗긴다.
        if let profileID = (voiceStudio.selectedProfileID).nilIfBlank,
           draft.playMode != .alarmOnly,
           voiceSourceMode == .ttsProfile,
           voiceStudio.isReplacementSettling(profileID) {
            voiceGateAlert = VoiceGateAlertContent(
                title: "아직 준비 중이에요",
                message: "바꾼 목소리를 정리하고 있어요. 잠시 후 다시 저장해 주세요.",
                offersPlanActions: false
            )
            return
        }
        let errors = draft.validate()
        if let first = errors.first {
            validationAlert = ValidationAlertContent(
                title: "저장할 수 없어요",
                message: errorMessage(first)
            )
            return
        }

        // 권한 확인은 **TTS 생성보다 먼저**여야 한다.
        // `alarmKit.schedule()` 안에도 확인이 있지만 그건 서버 호출이 끝난 뒤라,
        // 결국 저장되지 않을 알람 때문에 이번 달 목소리 생성 한도만 깎인다.
        // (편집기를 연 뒤 설정에 다녀와 권한을 끄면 진입 시 검사만으로는 못 막는다.)
        alarmKit.refreshAuthorizationState()
        if !alarmKit.alarmAuthorized {
            await alarmKit.requestAuthorization()
            alarmKit.refreshAuthorizationState()
            guard alarmKit.alarmAuthorized else {
                validationAlert = ValidationAlertContent(
                    title: "알람 권한이 필요해요",
                    message: alarmKit.permissionRecoveryNeeded
                        ? AlarmKitViewModel.alarmRecoveryMessage
                        : "알람 권한을 허용해야 알람을 저장할 수 있어요. \(AlarmKitViewModel.alarmDeniedConsequence)"
                )
                return
            }
        }

        if voiceModeBlocked && draft.playMode != .alarmOnly {
            draft.playMode = .alarmOnly
            showVoicePlanLockedAlert()
            return
        }

        // 무료 등급은 음성을 쓰되 시스템 보이스 + preset 으로 강제. 저장 직전에도
        // 4-값 잠금을 재확인해 사용자 조작/레이스로 빠져나간 경우를 막는다.
        coerceFreeVoiceTierConstraints()

        if target.familyAlarmMode && familyAlarmLocked {
            validationAlert = ValidationAlertContent(
                title: "이용권이 필요해요",
                message: "상대 알람은 커플/가족 이용권에서 사용할 수 있어요."
            )
            return
        }

        let familyRecipient = target.familyAlarmMode ? validateFamilyAlarmTarget() : nil
        if target.familyAlarmMode && familyRecipient == nil {
            return
        }

        let existing = editingAlarm

        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let fireAt: Int64 = (try? AlarmTimeCalculator.nextFireAtMillis(
            hour: draft.hour,
            minute: draft.minute,
            repeatDaysMask: draft.repeatDaysMask,
            holidayOff: draft.holidayOff,
            nowMillis: now,
            isHoliday: holidayStore.holidayPredicate()
        )) ?? LocalAlarmRecord.fallbackFireAtMillis(
            hour: draft.hour,
            minute: draft.minute,
            referenceMillis: now
        )

        // 단일 저장 버튼 게이트(Android saveEditor 미러). 음성 알람인데 준비된 음원이 없고
        // 기존 음원도 재사용할 수 없으면 — 그냥 막지 않고 여기서 직접 생성한다. 생성이
        // 실패하면(generateTTS 가 mapVoiceError 로 statusMessage 를 채우고 nil 반환) 저장을
        // 중단해, 음성 없는 알람이 저장되거나 설정한 시간/이름/반복이 사라지는 일이 없다.
        let shouldPreserveExistingListenerTitle = shouldPreserveExistingTtsListenerTitle(existing: existing)
        let currentListenerTitle = ttsListenerTitleForCurrentSelection(existing: existing)

        // ⚠ **테마 갈래를 TTS 생성보다 먼저 처리한다.** 안 그러면 시스템 목소리 알람이
        // 그대로 아래 `generateTTS` 로 흘러 **테마 클립 대신 라이브 생성 문장**이 저장된다
        // (서버는 시스템 보이스 라이브 생성을 허용한다).
        if draft.playMode != .alarmOnly, voiceSourceMode == .ttsProfile {
            guard await prepareSelectedBucketClipIfNeeded() else {
                showSaveFailureAlert()
                return
            }
        }

        if draft.playMode != .alarmOnly,
           voiceSourceMode == .ttsProfile,
           voiceStudio.preparedAlarm == nil,
           !AlarmEditDraft.canReuseExistingTtsAudio(
                existing: existing,
                selectedProfileID: voiceStudio.selectedProfileID,
                text: voiceStudio.ttsText,
                randomPrompt: voiceStudio.randomPrompt,
                randomContext: voiceStudio.randomContext,
                language: voiceStudio.ttsLanguage,
                // 번역 없음 — 직접 입력은 그대로 읽는다(2026-08-12).
                fireAtMillis: fireAt,
                listenerTitle: currentListenerTitle
            ) {
            // ⚠ **관문 3/3 — 저장 직전.** 판정은 `needsClipPreparation` 한 곳에만 있다.
            //
            // ⚠ **자리가 중요하다 — 이 블록 안이어야 한다.** 여기 도달했다는 것은 위
            // `prepareSelectedBucketClipIfNeeded` 가 클립을 못 묶었고 기존 음원도 재사용할 수
            // 없다는 뜻, 즉 **라이브 생성으로 떨어진다**는 뜻이다. 라이브 생성을 걷어내면
            // (「알람 음성의 최종 목적지」) 그대로 울릴 오디오가 없는 알람이 된다.
            //
            // 이 블록 **밖**(예: `prepareSelectedBucketClipIfNeeded` 앞)에 두면 **이미 오디오가
            // 붙어 있는 알람의 시각만 고치는 재저장**까지 준비 페이지로 튀긴다 — 생성할 것도
            // 바인딩할 것도 없는데 클립을 기다리게 하는 셈이다. 안드로이드가 관문을
            // `hasFreshTtsAudio` 조기 submit **뒤**에 두는 것과 같은 이유다.
            //
            // 막되 **저장 버튼을 죽이지 않는다**. 여기까지 온 사람은 저장하려던 사람이고,
            // 말 없이 비활성화된 버튼보다 준비 페이지가 낫다.
            if let profileID = voiceStudio.selectedProfileID.nilIfBlank,
               needsClipPreparation(
                   profileID: profileID,
                   randomPrompt: voiceStudio.randomPrompt,
                   randomContext: voiceStudio.randomContext
               ) {
                preparationVoiceID = profileID
                return
            }
            // ⚠ **라이브 랜덤 생성은 없앴다**(2026-08-18). 알람 음성은 **프리셋 + 직접 입력**
            // 둘뿐이다(docs/qa/dev-test-handoff.md 5절). 랜덤 문구인 채로 여기 도달했다는 건
            // 위 `prepareSelectedBucketClipIfNeeded` 가 클립을 못 묶었다는 뜻이므로,
            // 서버에 문장을 지어 달라고 하는 대신 **막는다.**
            //
            // 폴백을 남겨 두면 그 경로로 저장된 알람이 **매일 같은 한 문장**을 반복한다 —
            // 서버가 다시 지어 줄 주기적 경로가 없기 때문이다(그 일을 하던
            // `DynamicVoiceRefreshService` 도 함께 걷어냈다).
            // 안드로이드 `saveEditor` 의 같은 자리와 짝이다.
            if voiceStudio.randomPrompt {
                if let profileID = voiceStudio.selectedProfileID.nilIfBlank {
                    preparationVoiceID = profileID
                } else {
                    showSaveFailureAlert()
                }
                return
            }
            // 문구가 글자까지 똑같으면 **서버를 부르지 않고** 전에 만든 오디오를 그대로 쓴다
            // (대기 없음 + 직접 입력 월 한도 안 깎임 + 오프라인에서도 저장됨).
            // CLAUDE.md 가 '직접 입력 문구를 기억한다' 로 바꾼 근거가 바로 이 경로다 —
            // 이게 없으면 이어받은 문구로 새 알람을 만들 때마다 서버 왕복이 필요하고,
            // 오프라인이면 저장 자체가 실패한다.
            if let alias = reusableTtsInputAlias(listenerTitle: currentListenerTitle),
               applyReusedTtsAudio(alias) {
                // 재사용 성공 — 서버 호출을 건너뛴다.
            } else {
            let prepared = await voiceStudio.generateTTS(
                session: auth.session,
                alarmHour: draft.hour,
                alarmMinute: draft.minute,
                targetUserId: target.familyAlarmMode ? selectedFamilyRecipient?.userId : nil,
                targetDynamicPromptState: target.familyAlarmMode ? selectedFamilyRecipient?.dynamicPromptSettingsState : nil,
                listenerTitleOverride: currentListenerTitle,
                useListenerTitleOverride: shouldPreserveExistingListenerTitle,
                // 저장 흐름의 인라인 생성: 성공 햅틱은 이어지는 finishScheduling 이
                // 울린다. 여기서도 울리면 두 번 진동하므로 억제한다.
                triggerSuccessHaptic: false
            )
            // 실패 게이트: nil 이면 statusMessage 에 사유가 남고, 레코드를 만들거나
            // finishScheduling 하기 전에 중단한다. draft(시간/이름/반복)는 @State 라 그대로다.
            // ⚠ 사유를 **알럿으로 낸다** — 조용히 return 하면 저장을 눌렀는데 아무 일도
            // 없는 것처럼 보인다(`showSaveFailureAlert` 주석).
            guard let prepared else {
                showSaveFailureAlert()
                return
            }
            rememberTtsInputAlias(for: prepared, listenerTitle: currentListenerTitle)
            }
        }

        let familyLocalVoiceSource: FamilyLocalVoiceUploadSource?
        if familyRecipient != nil,
           draft.playMode != .alarmOnly,
           voiceSourceMode == .localAudio {
            do {
                let prepared = try await preparedLocalAlarmAudioSource()
                familyLocalVoiceSource = FamilyLocalVoiceUploadSource(
                    url: prepared.url,
                    durationMs: prepared.durationMs,
                    displayName: localAudioUploadDisplayName(for: prepared.url)
                )
            } catch {
                localAudioMessage = AudioUserFacingError.message(for: error, fallback: "선택한 알람 음성을 준비하지 못했어요.")
                return
            }
        } else {
            familyLocalVoiceSource = nil
        }

        let cachedLocalAudio: CachedLocalAlarmAudio?
        if familyRecipient == nil,
           draft.playMode != .alarmOnly,
           voiceSourceMode == .localAudio {
            do {
                cachedLocalAudio = try await cachedLocalAudioForSave(existing: existing)
            } catch {
                localAudioMessage = AudioUserFacingError.message(for: error, fallback: "선택한 알람 음성을 준비하지 못했어요.")
                return
            }
        } else {
            cachedLocalAudio = nil
        }

        if let familyRecipient {
            await createFamilyTargetAlarm(
                recipient: familyRecipient,
                localVoiceSource: familyLocalVoiceSource
            )
            return
        }

        // playMode 가 음성을 포함하면, voiceStudio 의 prepared 결과를 record 의
        // 음원/프로필 필드에 합쳐 둔다.
        var merged = draft.toRecord(existing: existing, fireAtMillis: fireAt, nowMillis: now)
        // ⚠ **소유자를 새긴다.** 예전에는 실사용 알람의 `ownerUserId` 가 전부 nil 이었고
        // (값을 쓰는 곳이 DEBUG 시드와 pull 병합의 '기존 값 보존' 뿐이었다), '옛 행은 이
        // 계정 것으로 본다' 는 관용이 **모든 행에** 적용됐다. 그러면 계정을 바꿨을 때
        // 앞 계정 알람까지 무료 잠금·복원 대상이 된다. 신규 저장부터 채워야 그 관용이
        // 예외로 남는다(안드로이드 `expectedOwnerUserId` 게이트와 같은 취지).
        merged.ownerUserId = auth.session?.user.id ?? existing?.ownerUserId
        applyVoicePromptState(to: &merged)
        // 입력한 날씨 지역/운세 정보를 기기 기본값에 보존(다음 알람 입력 생략). 음성 비활성
        // 알람은 randomPrompt 가 무시되므로 enabled 분기를 한 번 더 게이트한다.
        if merged.playModeEnum != .alarmOnly {
            persistDynamicPromptPreferencesIfNeeded()
        }
        if let cachedLocalAudio, draft.playMode != .alarmOnly {
            merged.voiceSource = VoiceSource.localAudio.rawValue
            merged.localAudioUri = cachedLocalAudio.fileName
            merged.audioCacheKey = cachedLocalAudio.cacheKey
            merged.rawAudioUri = nil
            merged.voiceProfileId = nil
            merged.voiceListenerTitle = nil
            merged.voiceText = nil
            merged.voiceCategory = nil
            merged.voiceLanguage = nil
            merged.voiceRandomPrompt = false
            merged.voiceRandomContext = nil
            merged.voiceWeatherCountry = nil
            merged.voiceWeatherCity = nil
            merged.voiceFortuneGender = nil
            merged.voiceFortuneBirthDate = nil
            merged.voiceFortuneBirthTime = nil
            merged.dynamicVoicePreparedForFireAtMillis = nil
            merged.ttsMessageId = nil
        } else if let prepared = voiceStudio.preparedAlarm, draft.playMode != .alarmOnly {
            // 스톡 클립은 cacheKey 가 `stock_` prefix 다. 안드로이드 `setBucketAudio` 와
            // 같이 `voiceRandomPrompt = false` 로 두어, 이 행이 '생성형' 으로 읽히지 않게
            // 한다 — 그 값이 참으로 남으면 편집기 판정과 옛 행 재바인딩
            // (`StockClipLanguageRebinder.rebindLiveGenerationRows`)이 이 알람을 아직
            // 안 옮긴 옛 행으로 오해한다.
            let isStockClip = prepared.audioCacheKey.hasPrefix("stock_")
            // ⚠ `server_tts` 로 쓰지 말 것. 안드로이드에서 그 값은 **'남에게서 받은 알람'**
            // 이라는 뜻이고, pull 경로(`RemoteAlarmMapper`)에서만 붙는다. 내가 편집기에서
            // 만든 것은 `tts_profile` 이다(2026-08-07 수정).
            merged.voiceSource = VoiceSource.ttsProfile.rawValue
            merged.localAudioUri = prepared.localAudioFileName
            merged.audioCacheKey = prepared.audioCacheKey
            merged.rawAudioUri = prepared.rawAudioURL ?? merged.rawAudioUri
            merged.voiceProfileId = prepared.voiceProfileID
            merged.voiceListenerTitle = prepared.listenerTitle
            merged.voiceText = prepared.text
            let usesRandomPrompt = voiceStudio.randomPrompt && !isStockClip
            merged.voiceCategory = usesRandomPrompt ? activePromptContext.ttsCategory : "custom"
            merged.voiceLanguage = prepared.language
            merged.dynamicVoicePreparedForFireAtMillis = usesRandomPrompt ? merged.fireAtMillis : nil
            merged.ttsMessageId = prepared.messageID
            if isStockClip {
                merged.voiceRandomPrompt = false
                // ⚠ **여기서 종류를 nil 로 지우지 말 것**(2026-08-12 수정 전까지 그랬다).
                // 테마 클립을 붙이면 `voiceRandomPrompt` 가 꺼지는데, 그때 종류까지 떨어뜨리면
                // 사용자가 고른 문구 갈래가 **모든 테마 저장에서** 사라진다. 증상은 둘로
                // 갈라져 보이지만 원인은 하나다 — (1) 다음 새 알람이 매번 '기본 인사말'
                // 이고 (2) 이 알람을 다시 열면 '직접 입력' 으로 보인다.
                // 안드로이드 `AlarmEditorState.toDraft` 가 `(!voiceRandomPrompt &&
                // !isActiveBucketAlarm())` 일 때만 null 로 두는 것과 같은 규약이다.
                merged.voiceRandomContext = activePromptContext.rawValue
                // 고른 테마를 **행에 적는다.** 캐시 파일이 사라져도 무엇을 골랐는지 남는다.
                let category = voiceStudio.stockClips
                    .first { $0.messageId == prepared.messageID }?.category?.nilIfBlank
                    ?? (editingAlarm?.bucketId).nilIfBlank
                merged.bucketId = category
                // ⚠ **그 테마의 클립을 전부 묶는다.** 하나만 들고 있으면 매일 같은 문구를
                // 듣는다 — 무료 테마는 울릴 때마다 다음 클립으로 넘어가는 게 기능이다.
                //
                // ⚠ **테마가 그대로면 회전 상태를 건드리지 않는다.** 예전에는 저장할
                // 때마다 목록을 다시 만들고 인덱스를 `firstIndex(of:) ?? 0` 으로 새로
                // 잡아서, 시각만 고쳐 저장해도 **회전이 처음으로 되돌아갔다** — 매일
                // 같은 첫 문구를 듣게 된다. 게다가 `bucketClipKeys(forCategory:)` 는
                // 메모리의 `voiceStudio.stockClips` 를 거르는데 그 배열은 네트워크로만
                // 채워지므로, 목록을 못 받은 상태에서 저장하면 **빈 배열로 덮여 회전이
                // 영구히 죽는다.** 그래서 (a) 테마가 바뀌었거나 (b) 기존 목록이 비었을
                // 때만 새로 계산하고, 새로 계산한 결과가 비면 기존 값을 지키다.
                let freshKeys = category.map { bucketClipKeys(forCategory: $0) } ?? []
                let keptKeys = editingAlarm?.bucketClipKeys ?? []
                let sameBucket = editingAlarm?.bucketId != nil && editingAlarm?.bucketId == category
                if sameBucket && !keptKeys.isEmpty {
                    // 같은 테마를 계속 쓴다 — 목록도 회전 위치도 그대로 이어받는다.
                    merged.bucketClipKeys = keptKeys
                    merged.bucketRotationIndex = editingAlarm?.bucketRotationIndex ?? 0
                } else if !freshKeys.isEmpty {
                    merged.bucketClipKeys = freshKeys
                    // 지금 준비된 클립이 몇 번째인지에서 시작한다(편집기에서 들어본 그 문구부터).
                    merged.bucketRotationIndex = freshKeys.firstIndex(of: prepared.audioCacheKey) ?? 0
                } else {
                    // 목록을 못 받았다 — 빈 배열로 덮지 않는다. 다음에 목록이 들어오면
                    // 그때 채워진다.
                    merged.bucketClipKeys = keptKeys.isEmpty ? nil : keptKeys
                    merged.bucketRotationIndex = editingAlarm?.bucketRotationIndex
                }
            } else {
                // 테마 알람이 아니게 됐으면 값을 비운다 — 남겨 두면 다음에 열 때 없는
                // 테마가 고른 것처럼 보인다.
                merged.bucketId = nil
                merged.bucketClipKeys = nil
                merged.bucketRotationIndex = nil
            }
        }

        // ── 날씨 테마는 **저장하면서 실제 예보를 받아** 어느 클립을 틀지 확정한다.
        //
        // 여기서 받는 이유: iOS 는 발사 시점에 우리 코드가 돌지 않는다. 예약해 둔 사운드가
        // 그대로 울리므로 조건은 **예약 전에** 정해져 있어야 한다. 저장 뒤 백그라운드로
        // 미뤘다가 그 전에 울리면 '날씨를 못 봤어요' 안내가 나간다.
        // 오프라인이면 조용히 미해결로 저장한다(알람 생성을 막지 않는다) — 준비창 갱신이 채운다.
        // 안드로이드 `withResolvedWeatherVariant` 와 같은 자리다.
        await applyWeatherVariant(to: &merged, previous: editingAlarm)

        do {
            try LocalAlarmStore.validateDraft(merged)
        } catch {
            validationAlert = ValidationAlertContent(
                title: "저장할 수 없어요",
                message: AudioUserFacingError.message(for: error, fallback: "알람 설정을 확인해 주세요.")
            )
            return
        }

        // "한 시각에는 알람 하나" — 같은 시각 알람이 있으면 바로 거부하지 않고
        // 교체 여부를 모달로 묻는다(자동 삭제하지 않음). 동의 시 confirmReplaceDuplicate.
        // ⚠ 소유자를 넘긴다 — 안 넘기면 남의 계정 알람이 교체 후보로 잡혀 **이름이 노출되고
        // 삭제까지 된다**(Codex #699 P1).
        let conflicts = store.conflictingAlarms(
            hour: merged.hour,
            minute: merged.minute,
            excludingID: existing?.id,
            ownerUserId: auth.session?.user.id
        )
        if !conflicts.isEmpty {
            duplicateAlarmConfirm = DuplicateAlarmConfirmContent(
                timeLabel: String(format: "%02d:%02d", merged.hour, merged.minute),
                existingLabel: conflicts.first?.label,
                merged: merged,
                existing: existing,
                conflicts: conflicts
            )
            return
        }

        await finishScheduling(merged: merged, existing: existing)
    }

    /// 충돌이 없거나 교체 동의 후, 실제 저장 + AlarmKit 예약을 수행한다. 예약 실패 시
    /// 롤백하고 false 를 반환한다(교체 흐름이 충돌 알람을 지우지 않도록).
    @discardableResult
    /// 저장이 **실제로 일어나는 유일한 자리**. 그래서 정리 중 판정도 여기서 한 번 더 한다.
    ///
    /// ⚠ `saveFlow` 의 탭 시점 판정만으로는 부족하다(Codex #703 P1) — 같은 시각 알람 교체
    /// 확인(`confirmReplaceDuplicate`)은 그 판정을 지나온 뒤 **다시 이 함수로 들어오고**,
    /// 그 사이에 다른 기기의 교체가 반영돼 정리 중이 될 수 있다. 여기서 막지 않으면 정리
    /// 중인 목소리로 알람이 저장되고, 그 호출은 **기존 알람까지 지운다.**
    func finishScheduling(merged: LocalAlarmRecord, existing: LocalAlarmRecord?) async -> Bool {
        if let profileID = merged.voiceProfileId?.nilIfBlank,
           voiceStudio.isReplacementSettling(profileID) {
            voiceGateAlert = VoiceGateAlertContent(
                title: "아직 준비 중이에요",
                message: "바꾼 목소리를 정리하고 있어요. 잠시 후 다시 저장해 주세요.",
                offersPlanActions: false
            )
            return false
        }
        // ⚠ 편집 커밋은 전용 진입점을 쓴다. 화면 진입 시점의 스냅샷으로 전체 행을 덮으면,
        // TTS 생성(수 초~수십 초) 사이에 push 가 새긴 remoteAlarmId 를 nil 로 되돌려
        // 다음 push 가 같은 알람을 또 create 한다(서버에 두 행).
        store.upsertPreservingServerSyncFields(merged)
        let scheduled = await alarmKit.schedule(record: merged, store: store)
        guard scheduled else {
            if let existing {
                store.upsert(existing)
            } else {
                // 신규 저장 롤백. 반환되는 releasedAudioCacheKey 는 의도적으로
                // 무시한다 — 같은 키의 음원을 voiceStudio.preparedAlarm 이 아직
                // 들고 있어 사용자가 곧바로 재시도하면 그대로 재사용되기 때문.
                // 재시도 없이 버려진 캐시는 30일 sweep 이 회수한다.
                store.deleteByID(merged.id)
            }
            validationAlert = ValidationAlertContent(
                title: "예약할 수 없어요",
                message: alarmKit.statusMessage ?? "알람 예약에 실패했어요."
            )
            return false
        }
        if let existing {
            await alarmKit.cancelScheduledAlarm(record: existing)
        }
        rememberChoicesUsed(merged)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        onSchedulingDidFinish()
        return true
    }

    /// **저장 성공 시에만** 직전 선택을 기록한다. 편집기에서 눌러만 보고 취소한 것은
    /// 기억하지 않는다 — 선택 즉시 저장하는 코드를 넣지 말 것
    /// (CLAUDE.md 「알람 편집기 기본값 = 직전 선택 유지」).
    private func rememberChoicesUsed(_ record: LocalAlarmRecord) {
        // ⚠ **문구 개념이 없는 알람은 기록을 건드리지 않는다**(안드로이드의 조기 return 미러).
        // 알람 전용·녹음/파일 알람은 `voiceText` 가 nil 인데, 가드 없이 내려가면
        // `saveLastManualText(nil)` 이 **직전에 기억해 둔 직접 입력 문구를 지운다.**
        // 알람음 알람 하나 저장했다고 취향이 사라지면 안 된다(2026-08-07 수정).
        guard record.playModeEnum != .alarmOnly else { return }
        guard record.voiceSourceEnum != .localAudio else { return }

        let userID = auth.session?.user.id

        // 목소리 — 온보딩 완료 판정(`default_voice_`)과는 **다른 키**에 쓴다.
        if let voiceID = record.voiceProfileId?.nilIfBlank {
            DefaultVoicePreferenceStore().setLastUsedVoiceId(userID: userID, voiceId: voiceID)
        }

        let promptStore = DynamicPromptPreferenceStore()

        // ⚠ **스톡 클립(무료 테마)은 '직접 입력' 이 아니다.** 스톡은 고정 음원이라
        // `voiceRandomPrompt = false` 로 저장되는데, 그것만 보고 else 로 떨어뜨리면
        // **서버 스톡 클립의 문장**이 '내가 친 직접 입력 문구' 로 기억된다. 그러면 다음
        // 새 알람이 직접 입력으로 열리고 테마 선택은 매번 초기화된다.
        if let bucket = selectedFreeBucketCategory(for: record) {
            promptStore.saveLastFreeBucket(userID: userID, bucket: bucket)
            return
        }

        // 문구 — 생성형이면 종류를, 직접 입력이면 문구를 기록한다. 저장소가 반대쪽 키를
        // 지워 '마지막 선택은 하나' 를 지킨다.
        if record.voiceRandomPrompt {
            promptStore.saveLastMessageContext(userID: userID, context: record.voiceRandomContext)
        } else if let text = record.voiceText?.nilIfBlank {
            // 기억하는 값은 입력 원문이 아니라 **알람에 저장된 문구**다 — 잠금화면 문구와
            // 음성을 맞추려고 그 값을 저장하기 때문이다.
            // 빈 값이면 저장소를 건드리지 않는다(지우지도 않는다).
            promptStore.saveLastManualText(userID: userID, text: text)
        }
    }

    /// 이 레코드가 무료 테마(스톡 클립)로 저장된 것이면 그 카테고리를 돌려준다.
    ///
    /// 저장된 `bucketId` 를 **먼저** 본다 — 매니페스트를 못 받았거나(오프라인) 클립이
    /// 목록에서 빠져도 무엇을 골랐는지는 행에 남아 있다. 옛 행(그 필드가 없던 시절)만
    /// `stock_<messageId>` 로 매니페스트를 되짚는다.
    private func selectedFreeBucketCategory(for record: LocalAlarmRecord) -> String? {
        if let saved = (record.bucketId).nilIfBlank { return saved }
        guard let cacheKey = record.audioCacheKey, cacheKey.hasPrefix("stock_") else { return nil }
        let messageID = String(cacheKey.dropFirst("stock_".count))
        return voiceStudio.stockClips.first { $0.messageId == messageID }?.category?.nilIfBlank
    }

    /// 중복 시각 교체 동의: 새 알람을 먼저 저장·예약한 뒤, 충돌 알람을 삭제한다.
    /// 순서가 중요하다 — 충돌 알람을 먼저 지우면 둘이 공유하는 audioCacheKey 음성이
    /// 마지막 참조로 간주돼 삭제되어, 같은 음성을 재사용하는 새 알람이 깨진다.
    /// 저장 실패 시에는 충돌 알람을 보존한다.
    func confirmReplaceDuplicate(_ content: DuplicateAlarmConfirmContent) async {
        let saved = await finishScheduling(merged: content.merged, existing: content.existing)
        guard saved else { return }
        for conflict in content.conflicts {
            // 서버에도 알린 뒤 로컬을 지운다(AlarmsListView.deleteAlarm 와 같은 순서).
            // ⚠ 로컬만 지우면 **받은 알람이 다음 pull 에 새 UUID 로 되살아난다** —
            // decline 이 기록되지 않아 프루닝 조건(`state.declined`)에 걸리지 않고,
            // 서버 목록에는 그대로 있기 때문이다. 본인 알람도 서버에 남아 되살아난다.
            await remoteSync.deleteRemote(record: conflict, session: auth.session)
            // cancel(record:store:) = AlarmKit 예약 취소 + store.delete + 고아 캐시만 정리.
            _ = await alarmKit.cancel(record: conflict, store: store)
        }
    }

    private func duplicateAlarmMessage(_ content: DuplicateAlarmConfirmContent) -> String {
        if let label = content.existingLabel, !label.isEmpty {
            return "\(content.timeLabel)에 이미 '\(label)' 알람이 있어요.\n기존 알람을 새 알람으로 교체할까요?"
        }
        return "\(content.timeLabel)에 이미 알람이 있어요.\n기존 알람을 새 알람으로 교체할까요?"
    }

    func validateFamilyAlarmTarget() -> FamilyGroupMember? {
        guard let recipient = selectedFamilyRecipient else {
            validationAlert = ValidationAlertContent(
                title: "받을 사람이 없어요",
                message: "상대가 내 알람 맞추기를 허용하면 여기에 표시돼요."
            )
            return nil
        }

        let nowMillis = Int64(Date().timeIntervalSince1970 * 1000)
        let fireAtMillis = (try? AlarmTimeCalculator.nextFireAtMillis(
            hour: draft.hour,
            minute: draft.minute,
            repeatDaysMask: draft.repeatDaysMask,
            holidayOff: draft.holidayOff,
            nowMillis: nowMillis
        )) ?? LocalAlarmRecord.fallbackFireAtMillis(
            hour: draft.hour,
            minute: draft.minute,
            referenceMillis: nowMillis
        )
        if fireAtMillis - nowMillis < Self.familyAlarmMinLeadMillis {
            // ⚠ **언제부터 되는지 시각으로 말한다**(안드로이드 문구와 같은 형태).
            // "지금부터 N분 뒤" 는 사용자가 직접 계산해야 해서, 바로 고칠 수가 없다.
            let earliest = Date(
                timeIntervalSince1970: Double(Self.earliestSelectableFamilyAlarmMillis(nowMillis: nowMillis)) / 1000
            )
            validationAlert = ValidationAlertContent(
                title: "조금 더 뒤로 설정해 주세요",
                message: "상대 알람은 \(Self.leadTimeFormatter.string(from: earliest)) 이후로 맞춰 주세요. 상대 기기에 전달될 시간이 조금 필요해요."
            )
            return nil
        }
        if FamilyAlarmScheduleRules.isTimeUnavailable(
            member: recipient,
            hour: draft.hour,
            minute: draft.minute,
            repeatDaysMask: draft.repeatDaysMask,
            nowMillis: nowMillis
        ) {
            validationAlert = ValidationAlertContent(
                title: "받을 수 없는 시간이에요",
                message: "상대가 이 시간에는 알람을 받지 않도록 해뒀어요."
            )
            return nil
        }
        return recipient
    }

    func createFamilyTargetAlarm(
        recipient: FamilyGroupMember,
        localVoiceSource: FamilyLocalVoiceUploadSource?
    ) async {
        guard let token = auth.session?.token else {
            validationAlert = ValidationAlertContent(title: "로그인이 필요해요", message: "상대 알람은 로그인 후 사용할 수 있어요.")
            return
        }
        do {
            if let localVoiceSource {
                let upload = try await AlarmTalkAPI.shared.uploadVoiceAudio(
                    audioFileURL: localVoiceSource.url,
                    durationMs: localVoiceSource.durationMs,
                    originalName: localVoiceSource.displayName,
                    token: token
                )
                let request = FamilyAlarmTalkRequest(
                    recipientUserId: recipient.userId,
                    wakeAt: String(format: "%02d:%02d", draft.hour, draft.minute),
                    voiceUploadId: upload.id,
                    label: (draft.label).nilIfBlank ?? "가족이 보낸 음성",
                    dubTargetLanguage: nil,
                    repeatDays: RemoteAlarmMapper.repeatDays(fromMask: draft.repeatDaysMask)
                )
                _ = try await AlarmTalkAPI.shared.createFamilyAlarmTalk(request, token: token)
            } else {
                let prepared = voiceStudio.preparedAlarm
                let request = RemoteAlarmWriteRequest(
                    time: String(format: "%02d:%02d", draft.hour, draft.minute),
                    repeatDays: RemoteAlarmMapper.repeatDays(fromMask: draft.repeatDaysMask),
                    snoozeMinutes: draft.snoozeMinutes,
                    mode: prepared == nil ? "sound-only" : "tts",
                    vibrationPattern: draft.vibrationPattern.rawValue,
                    wakeMode: draft.playMode.remoteWakeMode,
                    isActive: true,
                    messageId: prepared?.messageID,
                    voiceProfileId: prepared?.voiceProfileID,
                    targetUserId: recipient.userId,
                    // ⚠ **테마 정체성은 이것 하나로만 건너간다.** 클립 키 목록은 보내는
                    // 사람 기기의 캐시 파일을 가리켜 수신자에게 아무 뜻이 없다 — 받는 쪽이
                    // `bucketId` 로 자기 클립을 다시 묶는다. 안 실으면 테마를 고른 가족
                    // 알람이 **테마 없이** 도착한다(2026-08-18 확인. 안드로이드
                    // `AlarmDraft.toRemoteAlarmWriteRequest` 도 같이 고쳤다).
                    bucketId: bucketIdForSave(prepared: prepared)
                )
                _ = try await AlarmTalkAPI.shared.createAlarm(request, token: token)
            }
            await remoteSync.refresh(session: auth.session, force: true)
            await socialFeatures.refreshAll(session: auth.session, force: true)
            validationAlert = nil
            // 가족(상대) 알람 저장 성공 햅틱. self-alarm 경로의 finishScheduling 과 동일하게
            // 정확히 1회만 울리도록, 인라인 생성 호출은 triggerSuccessHaptic:false 로 둔다.
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            onSchedulingDidFinish()
        } catch {
            validationAlert = ValidationAlertContent(
                title: "상대 알람 설정에 실패했어요",
                message: userFacingErrorMessage(
                    error,
                    fallback: "상대 알람 설정에 실패했어요."
                )
            )
        }
    }

    func handleLocalAudioModeChange(_ mode: AlarmLocalAudioInputMode) {
        stopAllEditorPreviews()
        // 알람 편집기에는 녹음뿐이다 — 파일 갈래는 없앴다(2026-08-11).
        // 옛 행이 남긴 파일 선택 상태만 비운다.
        do {
            selectedLocalAudioURL = nil
            selectedLocalAudioName = nil
            selectedLocalAudioDurationMs = nil
            localAudioCropStartMs = 0
            localAudioCropEndMs = Int(AlarmAudioLimits.maxDurationMillis)
        }
        localAudioMode = mode
        clearExistingLocalAudio = true
        localAudioMessage = nil
    }

    func toggleLocalRecording() {
        stopAllEditorPreviews()
        if localRecorder.isRecording {
            localRecorder.stop()
            localAudioMessage = "녹음을 저장했어요."
            clearExistingLocalAudio = false
            return
        }
        selectedLocalAudioURL = nil
        selectedLocalAudioName = nil
        selectedLocalAudioDurationMs = nil
        localRecorder.clearLatest()
        clearExistingLocalAudio = false
        localAudioCropStartMs = 0
        localAudioCropEndMs = Int(AlarmAudioLimits.maxDurationMillis)
        Task {
            do {
                try await localRecorder.start()
                localAudioMessage = "녹음 중…"
            } catch {
                localAudioMessage = AudioUserFacingError.message(for: error, fallback: "녹음을 시작하지 못했어요.")
            }
        }
    }

    func previewLocalAlarmAudio() {
        if editorPreviewPlayer.isPlaying,
           previewTarget == .selectedCrop || previewTarget == .cachedLocalAudio {
            stopAllEditorPreviews()
            return
        }
        // 항상 크롭 윈도우로 재생해 알람 구간만 들려준다(change 1). 녹음 클립은 start=0
        // 이라 윈도우가 무해하다. file 모드는 preparedLocalAlarmAudioSource 가 이미
        // 크롭 파일을 만들어 주므로 start=0, 전체 길이를 그대로 윈도우로 쓴다.
        let startMs = localAudioCropStartMs
        Task {
            stopAllEditorPreviews()
            do {
                if selectedLocalAudioURL == nil,
                   localRecorder.latestRecordingURL == nil,
                   let url = existingLocalAudioURL() {
                    // 기존 캐시 경로도 저장된 크롭 윈도우(start..start+limit)를 적용해
                    // 알람과 동일 구간만 audition 한다.
                    previewTarget = .cachedLocalAudio
                    let stopAfter = max(0, localAudioCropEndMs - startMs)
                    // 캐시 파일은 저장 시 이미 크롭 시작점부터 잘려 있으므로 파일 자체가
                    // start 에서 시작한다. startMs 로 다시 seek 하면 이중 오프셋이 되어
                    // (start 가 0 이 아닐 때) 구간이 밀리므로 startMs 를 0 으로 고정한다.
                    try editorPreviewPlayer.play(
                        url: url,
                        startMs: 0,
                        stopAfterMs: stopAfter > 0 ? stopAfter : nil
                    )
                } else {
                    let prepared = try await preparedLocalAlarmAudioSource()
                    previewTarget = .selectedCrop
                    // preparedLocalAlarmAudioSource 가 크롭을 끝낸 파일을 주므로(또는 녹음
                    // 전체) 0 부터 그 길이만큼만 재생한다.
                    try editorPreviewPlayer.play(
                        url: prepared.url,
                        startMs: 0,
                        stopAfterMs: prepared.durationMs > 0 ? prepared.durationMs : nil
                    )
                }
            } catch {
                stopAllEditorPreviews()
                localAudioMessage = AudioUserFacingError.message(for: error, fallback: "미리듣기를 재생하지 못했어요.")
            }
        }
    }

    func clearLocalAlarmAudio() {
        stopAllEditorPreviews()
        localRecorder.clearLatest()
        selectedLocalAudioURL = nil
        selectedLocalAudioName = nil
        selectedLocalAudioDurationMs = nil
        clearExistingLocalAudio = true
        localAudioCropStartMs = 0
        localAudioCropEndMs = Int(AlarmAudioLimits.maxDurationMillis)
        localAudioMessage = "음성 오디오를 지웠어요."
    }

    func cachedLocalAudioForSave(existing: LocalAlarmRecord?) async throws -> CachedLocalAlarmAudio {
        let hasNewSource = selectedLocalAudioURL != nil || localRecorder.latestRecordingURL != nil
        if hasNewSource {
            let prepared = try await preparedLocalAlarmAudioSource()
            let data = try Data(contentsOf: prepared.url)
            let cacheKey = AudioCacheStore.computeCacheKey(data)
            let mimeType = AudioCacheStore.mimeType(forFormat: prepared.url.pathExtension.isEmpty ? "m4a" : prepared.url.pathExtension)
            let cachedURL = try await AudioCacheStore.shared.cacheBytesOffMain(
                data,
                cacheKey: cacheKey,
                mimeType: mimeType,
                source: "raw_audio",
                durationOverrideMs: Int64(prepared.durationMs),
                enforceMaxDuration: true
            )
            return CachedLocalAlarmAudio(fileName: cachedURL.lastPathComponent, cacheKey: cacheKey)
        }

        guard !clearExistingLocalAudio,
              let existing,
              existing.voiceSourceEnum == .localAudio,
              let cacheKey = existing.audioCacheKey,
              AudioCacheStore.shared.cachedURL(for: cacheKey) != nil else {
            throw LocalAlarmAudioError.missingSource
        }
        return CachedLocalAlarmAudio(fileName: existing.localAudioUri ?? "", cacheKey: cacheKey)
    }

    func existingLocalAudioURL() -> URL? {
        guard !clearExistingLocalAudio,
              let alarm = editingAlarm,
              alarm.voiceSourceEnum == .localAudio,
              let cacheKey = alarm.audioCacheKey else {
            return nil
        }
        return AudioCacheStore.shared.cachedURL(for: cacheKey)
    }

    func preparedLocalAlarmAudioSource() async throws -> (url: URL, durationMs: Int) {
        switch localAudioMode {
        case .record:
            guard let url = localRecorder.latestRecordingURL else {
                throw LocalAlarmAudioError.missingSource
            }
            let durationMs = localRecorder.latestDurationMs ?? Int(localRecorder.elapsedSeconds * 1000)
            guard durationMs >= 1_000 else { throw LocalAlarmAudioError.tooShort }
            guard durationMs <= Int(AlarmAudioLimits.maxDurationMillis + AlarmAudioLimits.durationToleranceMillis) else {
                throw LocalAlarmAudioError.tooLong
            }
            return (url, min(durationMs, Int(AlarmAudioLimits.maxDurationMillis)))
        }
    }

    func localAudioUploadDisplayName(for url: URL) -> String {
        // 알람 오디오는 녹음뿐이다 — 이름도 하나다.
        _ = url
        return "alarm-recording.m4a"
    }

    // MARK: - Error formatting

    func errorMessage(_ error: AlarmEditDraft.ValidationError) -> String {
        switch error {
        case .invalidHour:
            return "시간 값이 올바르지 않아요. 0~23 사이여야 해요."
        case .invalidMinute:
            return "분 값이 올바르지 않아요. 0~59 사이여야 해요."
        case .invalidRepeatDaysMask:
            return "반복 요일 값이 올바르지 않아요."
        case .invalidSnoozeMinutes:
            return "스누즈 간격은 1~30분 사이여야 해요."
        case .invalidAlarmVolume:
            return "알람 볼륨은 0~100% 사이여야 해요."
        case .invalidVoiceVolume:
            return "목소리 크기는 30~100% 사이여야 해요."
        }
    }
}
