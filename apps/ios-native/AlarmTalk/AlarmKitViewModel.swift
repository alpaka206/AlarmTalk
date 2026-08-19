import Foundation
import OSLog
import SwiftUI

#if canImport(UIKit)
import UIKit
#endif

#if canImport(AlarmKit)
import AlarmKit
#endif

@MainActor
final class AlarmKitViewModel: ObservableObject {
    private static let paidGateLogger = Logger(subsystem: "com.alarmtalk.app", category: "PaidVoiceGate")

    @Published var authorizationLabel = "확인 전"
    @Published private(set) var alarmAuthorized = false
    /// 권한이 `.denied`/`.restricted` 로 굳어 in-app 재프롬프트가 막힌 상태인지.
    /// true 면 CTA 를 일반 권한 요청 대신 "설정에서 권한 켜기" (openAppSettings) 로 바꿔야 한다.
    /// `.notDetermined` 는 false — 아직 일반 요청 프롬프트로 회복 가능. (Android denied 분기 parity)
    @Published private(set) var permissionRecoveryNeeded = false
    @Published var statusMessage: String?

    /// PR3: 앱 lifetime 동안 살아있는 단일 HolidayStore 를 주입받는다.
    /// AlarmTalkApp 의 @StateObject HolidayStore (AlarmAppContext.holidayPredicate 와
    /// timezone 재무장이 공유하는 그것) 와 동일 인스턴스를 가리켜야, 서버 sync 직후
    /// 로드 윈도우에서 공휴일 집합이 어긋나지 않는다 (Android 단일 holidayCalendarStore parity).
    /// 주입 전(`configure(holidayStore:)` 호출 전)에도 안전하도록 자체 인스턴스로 초기화하고,
    /// AlarmTalkApp 구성 시점에 앱-레벨 store 로 교체한다.
    private var holidayStore = HolidayStore()

    /// AlarmTalkApp 에서 앱-레벨 @StateObject HolidayStore 를 주입한다 (단일 source-of-truth).
    func configure(holidayStore: HolidayStore) {
        self.holidayStore = holidayStore
    }

    /// PR3 FIX: 같은 record 에 대해 재무장(`schedule()`)이 진행 중임을 표시하는 in-flight guard.
    /// rearmIfHolidayOffOneShot 와 recoverScheduledAlarms 두 @MainActor 경로가 동시에
    /// `alarmKitID == nil` guard 를 통과한 뒤 await 지점에서 인터리브되면, 각자 새 `.fixed`
    /// 알람을 schedule 해 미취소 중복이 남고 다음 회차가 이중 발화한다. id 를 await 전에
    /// 넣고 schedule 완료 후 defer 로 제거해, 진행 중인 record 를 concurrent sweep 이 건너뛴다.
    /// 두 경로 모두 @MainActor 격리라 추가 락 없이 안전하다.
    private var rearmInFlight: Set<String> = []

    /// **방금 만든 예약을 되돌린다.**
    ///
    /// ⚠ **`try?` 로 실패를 버리지 말 것**(Codex #699 P1). 되돌리기가 실패하면 OS 에는
    /// 예약이 남는데 행에는 아직 그 UUID 가 적히기 전이라, **아무도 모르는 고아**가 된다 —
    /// 행에도 없고 회수 목록에도 없으니 다음 로그인도, 회수 sweep 도 그 예약을 못 찾는다.
    /// 그래서 실패는 반드시 회수 목록에 태운다. OS 에 이미 없는 경우는 회수 sweep 가
    /// `AlarmManager.shared.alarms` 로 확인해 목록에서 조용히 빼 준다.
    private func revertJustScheduled(_ id: UUID) async {
        #if canImport(AlarmKit)
        do {
            try AlarmManager.shared.cancel(id: id)
        } catch {
            PendingAlarmCancellationStore.add(id.uuidString)
        }
        #endif
    }

    /// 활성 계정이 바뀐 횟수. **예약이 await 하는 동안 계정이 바뀌었는지** 가르는 값이다.
    ///
    /// ⚠ `SchedulingSnapshot` 으로는 이걸 못 잡는다(Codex #699 P1) — 그 스냅샷은 **행**이
    /// 바뀌었는지만 보고, 활성 계정도 `ownerUserId` 도 담고 있지 않다. 그래서 이런 일이
    /// 벌어졌다: A 의 복구가 `AlarmManager.schedule` 을 await 하는 사이 B 가 로그인하면,
    /// 로그인 정리(`cancelScheduledAlarmsNotOwnedBy`)는 **아직 저장되지 않은 새 UUID** 를
    /// 못 보고 지나가고, 뒤늦게 끝난 A 의 예약이 **B 의 앱에 보이지 않는 A 의 예약**으로
    /// 남는다. 소유자 판정은 await **앞**에서만 이뤄지므로 순서를 어떻게 놓아도 닫히지 않는다.
    ///
    /// 그래서 값 하나로 잰다 — await 전에 적어 두고, 돌아와서 달라졌으면 방금 건 예약을 되돌린다.
    private(set) var accountEpoch = 0

    /// 마지막으로 본 활성 계정. `nil` 은 '아직 본 적 없음' 이라 첫 관찰은 세대를 올리지 않는다
    /// (앱을 켤 때마다 진행 중인 예약을 무의미하게 취소하지 않기 위해).
    private var lastObservedAccountID: String??

    /// **지금 계정을 떠나는 중인가.** 참이면 새 예약을 만들지 않는다.
    ///
    /// ⚠ 진행 중인 예약을 무효화하는 것만으로는 부족하다(Codex #699 P1). 무효화 **뒤에**
    /// 시작한 예약은 새 세대를 들고 시작하므로 그대로 성공하고, 종료가 끝난 뒤에 **켜진
    /// 채 로그인 화면 뒤에 숨은 알람**이 된다. 원격 pull 이 종료 도중에 받은 알람을
    /// 들여오는 경우가 실제로 그렇다.
    ///
    /// 경로마다 쫓는 대신 **만드는 것 자체를 막는다** — 종료 중에는 아무도 예약하지 못한다.
    ///
    /// ⚠ **불리언이 아니라 카운터다**(Codex #699 P1). 종료 sweep 는 겹칠 수 있다 —
    /// 콜드 스타트 로그아웃이 로드를 끝내는 순간, 로그아웃 태스크와 '미완 로그아웃 이어서
    /// 끝내기' 가 **둘 다** 들어온다. 불리언이면 **먼저 끝난 쪽이 문을 열어 버려**,
    /// 아직 취소를 기다리는 다른 쪽 옆으로 새 예약이 빠져나간다.
    var isLeavingAccount: Bool { leavingAccountDepth > 0 }

    private var leavingAccountDepth = 0

    /// **진행 중인 예약을 그 자리에서 무효화한다.**
    ///
    /// ⚠ 계정이 실제로 바뀌기 **전에** 불러야 하는 경우가 있다(Codex #699 P1). 로그아웃은
    /// 예약을 다 끊은 **뒤에야** 세션을 비우므로, 그 사이에 끝난 예약은 `noteActiveAccount`
    /// 만으로는 못 막는다 — 그때는 아직 계정이 그대로다.
    func invalidateInFlightSchedules() {
        accountEpoch &+= 1
    }

    /// 활성 계정을 알린다. 바뀌었으면 세대를 올린다.
    func noteActiveAccount(_ userID: String?) {
        let normalized = userID?.nilIfBlank
        defer { lastObservedAccountID = .some(normalized) }
        guard let previous = lastObservedAccountID else { return }  // 첫 관찰
        if previous != normalized {
            accountEpoch &+= 1
        }
    }

    /// 지금 이 알람을 다른 경로가 재예약하는 중인가.
    ///
    /// ⚠ **예약 경로가 겹치면 취소 불가능한 유령 알람이 남는다.** `schedule` 은 매번 새 UUID를
    /// 만들고 `markScheduled` 는 **마지막 것만** 행에 남기므로, 겹친 쪽의 핸들은 어느 행도
    /// 가리키지 않게 되어 앱이 영영 취소하지 못한다(그 알람은 계속 울린다).
    /// `AlarmScheduleReconciler` 가 이 값을 보고 겹침을 피한다.
    func isRearmInFlight(_ recordID: String) -> Bool { rearmInFlight.contains(recordID) }

    /// AlarmSoundResolver / AlarmVoicePlayer 가 사용하는 캐시.
    /// `AudioCacheStore.shared` 를 의도적으로 instance 로 잡아 두어 테스트 가능성 유지.
    let audioCache: AudioCacheStore = .shared
    /// 유료 목소리 권한 재확인용 로컬 스냅샷. 안드로이드 `RingingService` 가
    /// `AccessSnapshotStore` 를 직접 읽는 것과 같은 방식이다 — 예약은 앱 어느 경로에서나
    /// 일어나므로 주입 경로를 늘리지 않고 여기서 읽는다.
    let accessSnapshotStore = AccessSnapshotStore()

    /// 가장 최근 schedule(...) 호출이 결정한 사운드 전략. ContentView / debug surface
    /// 에서 in-app 폴백 안내 문구를 띄울 때 참조한다. nil = 아직 schedule 호출 없음.
    @Published private(set) var lastSoundResolution: AlarmSoundResolution?

    /// AlarmKit alarmUpdates 가 직전에 emit 한 알람들의 (alarmKitID, state-raw) 스냅샷.
    /// `.alerting` 진입 감지(idempotent) 와 사라짐 감지(dismiss) 를 위해 유지.
    private var lastAlarmStateSnapshot: [String: String] = [:]
    private var observationTask: Task<Void, Never>?

    private static let alarmUnavailableMessage = "이 iOS 버전에서는 알람 기능을 사용할 수 없어요."

    nonisolated static func authorizationDisplayLabel(_ rawValue: String) -> String {
        let normalized = rawValue
            .lowercased()
            .replacingOccurrences(of: "_", with: "")
            .replacingOccurrences(of: " ", with: "")
        if normalized.contains("unavailable") {
            return "사용 불가"
        }
        if normalized.contains("denied")
            || normalized.contains("restricted")
            || normalized.contains("notauthorized") {
            return "거부됨"
        }
        if normalized == "authorized" || normalized.hasSuffix(".authorized") {
            return "허용됨"
        }
        if normalized.contains("notdetermined") || normalized.contains("unknown") {
            return "확인 필요"
        }
        return "확인 필요"
    }

    /// 권한이 거부/제한으로 굳어 in-app 재프롬프트가 막혔는지 판정.
    /// `.notDetermined`/`.unknown`/`.authorized` 는 false — 설정 우회가 불필요.
    /// (Android `firstMissingTarget` 의 denied 분기 parity)
    nonisolated static func isPermissionRecoveryNeeded(_ rawValue: String) -> Bool {
        let normalized = rawValue
            .lowercased()
            .replacingOccurrences(of: "_", with: "")
            .replacingOccurrences(of: " ", with: "")
        if normalized.contains("notdetermined") || normalized.contains("unknown") {
            return false
        }
        return normalized.contains("denied")
            || normalized.contains("restricted")
            || normalized.contains("notauthorized")
    }

    func refreshAuthorizationState() {
        #if canImport(AlarmKit)
        applyAuthorizationState(AlarmManager.shared.authorizationState)
        #else
        authorizationLabel = Self.authorizationDisplayLabel("unavailable")
        alarmAuthorized = true
        permissionRecoveryNeeded = false
        #endif
    }

    /// 권한이 없을 때 **무슨 일이 벌어지는지**를 말한다 — 상태 이름("거부됨")이 아니라 결과다.
    ///
    /// ⚠ **안드로이드와 문구가 반대인 것이 의도다.** 규칙은 양쪽 다 "사실을 말한다" 로 같은데,
    /// 두 OS 의 사실이 다르다:
    ///  - 안드로이드는 권한 셋이 다 없어도 `RingingService` 가 소리·진동을 직접 시작한다.
    ///    그래서 "울리지 않는다" 고 쓰면 멀쩡히 울릴 알람을 없는 것으로 믿고 다른 알람을 또
    ///    맞춘다 — CLAUDE.md 가 그 문구를 금지하는 이유다.
    ///  - **iOS 에는 그 폴백이 없다.** AlarmKit 권한이 없으면 `AlarmManager.schedule` 이 던져
    ///    알람이 **예약조차 되지 않는다**. 울릴 코드가 애초에 돌지 않으므로 정말 안 울린다.
    ///
    /// 그러니 안드로이드 문구("알림만 안 뜬다")를 iOS 로 옮겨 오면 그게 거짓말이 된다.
    nonisolated static let alarmDeniedConsequence = "권한이 없으면 알람이 예약되지 않아 울리지 않아요."

    /// 거부가 굳은 뒤의 안내. **"다시 시도" 라고 하지 않는다** — iOS 는 권한 프롬프트를 한 번만
    /// 띄우므로 눌러도 아무 일이 없다. 유일하게 남은 경로(설정 앱)를 그대로 말한다.
    nonisolated static let alarmRecoveryMessage =
        "설정에서 알람 권한을 켜 주세요. \(alarmDeniedConsequence)"

    /// 울림 알럿 제목 — "오전 7:30 · 아침 알람". 라벨이 없으면 시각만.
    /// 안드로이드 울림 화면이 시각을 가장 크게 보여주는 것에 맞춘 최소 대응이다.
    nonisolated static func alertTitle(for record: LocalAlarmRecord) -> String {
        let time = "\(record.meridiemLabel) \(record.clockLabel12h)"
        let label = record.label.trimmingCharacters(in: .whitespacesAndNewlines)
        return label.isEmpty ? time : "\(time) · \(label)"
    }

    func requestAuthorization() async {
        // 화면 확인 모드에서는 권한 팝업이 화면을 가린다(스크립트로 탭할 방법이 없다).
        if UIPreviewSeed.isEnabled { return }
        #if canImport(AlarmKit)
        do {
            let state = try await AlarmManager.shared.requestAuthorization()
            applyAuthorizationState(state)
            if alarmAuthorized {
            } else if permissionRecoveryNeeded {
                // 프롬프트가 뜨지 않은 채 돌아온 경우다. "다시 시도" 를 안내하면
                // 눌러도 아무 일이 없는 버튼을 계속 누르게 만든다.
                statusMessage = Self.alarmRecoveryMessage
            } else {
                statusMessage = "알람 권한을 허용한 뒤 다시 시도해 주세요."
            }
        } catch {
            statusMessage = "알람 권한을 확인하지 못했어요. 잠시 후 다시 시도해 주세요."
        }
        #else
        statusMessage = Self.alarmUnavailableMessage
        #endif
    }

    func startObserving(store: LocalAlarmStore) async {
        // 화면 확인 모드에서는 구독하지 않는다 — `alarmUpdates` 구독만으로도 시스템이
        // 권한 팝업을 띄워 화면을 가린다.
        if UIPreviewSeed.isEnabled { return }
        #if canImport(AlarmKit)
        refreshAuthorizationState()
        guard observationTask == nil else { return }
        observationTask = Task { [weak self, weak store] in
            guard let self, let store else { return }
            await self.observeAlarmUpdates(store: store)
        }
        #endif
    }

    #if canImport(AlarmKit)
    private func applyAuthorizationState(_ state: AlarmManager.AuthorizationState) {
        let raw = String(describing: state)
        authorizationLabel = Self.authorizationDisplayLabel(raw)
        alarmAuthorized = state == .authorized
        permissionRecoveryNeeded = Self.isPermissionRecoveryNeeded(raw)
    }

    private func observeAlarmUpdates(store: LocalAlarmStore) async {
        for await alarms in AlarmManager.shared.alarmUpdates {
            await processAlarmUpdate(alarms: alarms, store: store)
        }
    }

    /// 한 번의 alarmUpdates emit 을 처리. 별도 메서드로 분리해 테스트 가능성을
    /// 높이고 (직접 Alarm 배열을 주입 가능), 두 책임을 명시한다:
    ///   1. 사라진 alarmKitID -> markStopped (+ dismiss-time 공휴일 재계산/재무장)
    ///   2. 새로 `.alerting` 진입한 alarmKitID -> markRinging
    ///
    /// Apple `Alarm.State` (https://developer.apple.com/documentation/AlarmKit/Alarm/State):
    ///   scheduled / countdown / alerting / paused
    /// 본 메서드는 알람의 `.state` 프로퍼티를 읽어 raw 문자열로 스냅샷한다.
    func processAlarmUpdate(alarms: [Alarm], store: LocalAlarmStore) async {
        let currentSnapshot = Dictionary(
            uniqueKeysWithValues: alarms.map { ($0.id.uuidString, String(describing: $0.state)) }
        )

        // 1. 사라진 알람 = stopped 로 간주.
        //    이전 스냅샷에 있었지만 이번에 없는 ID, 또는 store 에 alarmKitID 가
        //    있고 아직 dismiss 되지 않았는데 currentSnapshot 에 없는 ID 만 검사.
        //    이미 dismissed 인 record 는 알람이 끝난 뒤 store 에 alarmKitID 가
        //    잔존할 수 있어 매 emit 마다 중복 처리하는 것을 막아야 한다.
        let currentIDs = Set(currentSnapshot.keys)
        let previouslyKnownIDs = Set(lastAlarmStateSnapshot.keys)
        let activeStoredIDs: Set<String> = Set(
            store.alarms
                .filter { $0.runtimeStateEnum != .dismissed && $0.runtimeStateEnum != .disabled }
                .compactMap { $0.alarmKitID }
        )

        let disappearedIDs = previouslyKnownIDs
            .union(activeStoredIDs)
            .subtracting(currentIDs)
        let holidayPredicate = holidayStore.holidayPredicate()
        for kitID in disappearedIDs {
            let recordBeforeStop = store.recordByAlarmKitID(kitID)
            // In-app voice fallback 재생 중이면 정지 (AlarmKit 자체 stop 과 별개).
            //
            // ⚠ **무조건 끄지 말 것.** 이 루프는 '목록에서 사라진 알람' 을 도는데,
            // 사용자가 **다른** 알람을 지우거나 끄면 그 알람도 여기 들어온다. 그때
            // 조건 없이 끄면 **지금 울리고 있는 알람의 목소리가 끊긴다**(알람은 계속
            // 울리는데 목소리만 사라져 '왜 목소리가 안 나오지' 로 보인다).
            // 안드로이드 `ringingTeardownBelongsToCurrentAlarm`(Codex #666 P1)과 같은 규칙.
            AlarmAppContext.stopVoiceIfOwnedStatic(by: recordBeforeStop?.id)
            // LiveActivity 가 아닌 경로(앱이 살아있는 채 알람이 사라진 경우)의 stop 도
            // AlarmAppContext 로 수렴시켜 markStopped + dismiss-time 공휴일 재계산/재무장을
            // 한 곳에서 처리한다.
            if recordBeforeStop != nil, let ctx = AlarmAppContext.shared {
                await ctx.handleAlarmStopped(alarmKitIDString: kitID)
            } else {
                // ctx 가 nil 인데 observer 는 살아있는 경로. markStopped 에 공휴일
                // 술어를 넘겨 store 측 fireAtMillis 전진을 공휴일-정확하게 만들고,
                // `.fixed` 서브셋이면 OS 재무장까지 직접 수행한다 (그러지 않으면
                // `.fixed` 알람이 발화 후 다음 recovery sweep 까지 재무장되지 않음).
                store.markStopped(alarmKitID: kitID, isHoliday: holidayPredicate)
                if let stopped = recordBeforeStop, stopped.isHolidayOffRecurring {
                    await rearmIfHolidayOffOneShot(localID: stopped.id, store: store)
                }
            }
        }

        // 2. `.alerting` 진입 감지 = markRinging + voice fallback 재생.
        //    스냅샷 비교: 이전이 nil 또는 비-alerting 이고 현재 alerting 인 경우.
        for alarm in alarms {
            let kitID = alarm.id.uuidString
            let currentStateRaw = String(describing: alarm.state)
            let previousStateRaw = lastAlarmStateSnapshot[kitID]
            let didEnterAlerting =
                currentStateRaw.lowercased().contains("alerting") &&
                previousStateRaw?.lowercased().contains("alerting") != true
            if didEnterAlerting {
                if let record = store.recordByAlarmKitID(kitID) {
                    store.markRinging(id: record.id)
                    // GROUP 3 (6): 포그라운드 ring-time 1회성 햅틱. didEnterAlerting 의
                    // 스냅샷 멱등성으로 ring 당 1회만 진입하므로 별도 가드 불필요. 앱이
                    // 활성(.active)일 때만 발화 — 백그라운드/락스크린에선 AlarmKit/시스템이
                    // 자체 진동을 소유하므로 중복을 피한다 (Android RingingService 진동과 분리).
                    // ⚠ **진동을 '없음' 으로 끈 사용자에게는 울리지 않는다.**
                    // 실제 알람 진동은 시스템이 소유하지만, 이 한 번의 햅틱은 우리가
                    // 내는 것이라 사용자 선택을 따라야 한다(2026-08-07 수정).
                    fireForegroundRingHaptic(for: record)
                    // 30s 초과 또는 트랜스코드 실패로 AlarmKit 가 시스템 톤만 울리는 경우,
                    // 앱이 활성일 때 캐싱된 voice 를 동시 재생한다 (mixWithOthers).
                    //
                    // ⚠ **여기도 유료 게이트를 지나야 한다.** 예약 시점 게이트
                    // (`schedule`)는 AlarmKit 에 넘길 사운드만 강등하고 store 의 원본은
                    // 그대로 두는데, 이 폴백은 그 원본을 다시 읽는다. 게이트를 안 걸면
                    // 구독이 끝난 사용자가 앱을 열어 둔 상태에서 유료 복제 목소리를
                    // 그대로 듣게 된다 — 게이트가 있다고 믿는 바로 그 상황에서 샌다.
                    let snapshot = KeychainStore.readSession()
                        .map { accessSnapshotStore.read(userID: $0.user.id) } ?? .empty
                    let effective = PaidVoiceGate.shouldDowngrade(record: record, snapshot: snapshot)
                        ? PaidVoiceGate.downgraded(record)
                        : record
                    let resolution = AlarmSoundResolver.resolve(for: effective, audioCache: audioCache)
                    if resolution.requiresInAppFallback {
                        AlarmVoicePlayer.shared.playIfNeeded(for: effective, audioCache: audioCache)
                    }
                }
            }
        }

        lastAlarmStateSnapshot = currentSnapshot
    }

    /// GROUP 3 (6): ring-moment 포그라운드 1회성 경고 햅틱.
    /// 호출부(`processAlarmUpdate` 의 didEnterAlerting)가 ring 당 1회만 진입하므로
    /// 멱등성은 그쪽에서 보장된다. 앱이 포그라운드 활성일 때만 발화한다 — 백그라운드/
    /// 락스크린에서는 AlarmKit/시스템이 자체 진동을 소유하기 때문이다.
    private func fireForegroundRingHaptic(for record: LocalAlarmRecord) {
        #if canImport(UIKit)
        guard record.vibrationPatternEnum != .none else { return }
        guard UIApplication.shared.applicationState == .active else { return }
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(.warning)
        #endif
    }
    #endif

    /// 예약 복구 sweep.
    /// - Parameter forceHolidayOffRecompute: true 면 발화 시각이 미래여도 모든
    ///   enabled `.fixed` 공휴일off one-shot 을 후보에 포함해 절대 시각을 재계산+재무장한다.
    ///   timezone/시간 변경 알림용 — `.fixed` 는 절대 instant 라 새 zone 에 자동 재anchor
    ///   되지 않으므로(어느 방향으로든 이동 가능) 강제 recompute 가 필요하다.
    /// **계정을 떠날 때 알람을 전부 끈다** — OS 예약을 취소하고 행도 `enabled = false` 로.
    ///
    /// 로그아웃·탈퇴에서 부른다. 두 가지를 지킨다:
    ///  1. **떠난 계정으로 알람이 울리면 안 된다.** 받은 알람은 보낸 사람의 복제 목소리를
    ///     담고 있어, 로그아웃한 기기가 남의 생체정보로 우는 셈이 된다.
    ///  2. **다시 로그인해도 저절로 울리기 시작하지 않는다.**
    ///
    /// ⚠ **`enabled` 도 끈다 — 예약만 끊고 끝내지 말 것**(2026-08-19 지시).
    /// 처음엔 "`enabled` 는 사용자 의도라 남긴다" 로 만들었지만, **로그아웃은 이 앱을 그만
    /// 쓰겠다는 뜻**이라는 쪽이 맞다. 목소리는 서버에 있어 로그아웃하면 핵심 기능 자체를
    /// 못 쓰고 그동안 알람도 울리지 않는다 — 그렇게 지내다 돌아왔는데 옛 알람이 저절로
    /// 울리기 시작하는 편이 오히려 놀랍다.
    ///
    /// ⚠ **로그아웃 상태에서는 알람 화면에 들어갈 수도 없다** — `RootView` 가
    /// `!auth.isAuthenticated` 면 `AuthGateView` 를 띄운다. 그래서 예약이 남아 있으면
    /// 사용자가 **끌 방법이 없는 알람**이 우는 셈이다. 끊어야 하는 진짜 이유가 이것이다.
    ///
    /// 꺼 두는 것이 안전한 이유는 **돌아왔을 때** 화면이 그 사실을 말하기 때문이다 —
    /// `NextAlarmHeadline` 이 "모든 알람이 꺼진 상태입니다." 를 headline 으로 띄운다.
    /// 로그아웃 중에는 아무 화면도 못 보지만, 그때는 울리지도 않으므로 알 필요가 없다.
    ///
    /// ⚠ **자동 401(세션 만료)에서는 부르지 않는다.** 그건 사용자가 그만두겠다고 한 게
    /// 아니라 토큰이 낡은 것뿐이라, 내일 아침 알람을 조용히 없애면 안 된다.
    /// (저장소의 `clearSessionKeepingAlarms` 와 같은 판단이다.)
    ///
    /// ⚠ **끄는 것은 떠나는 계정 것만이다 — 예약 취소와 범위가 다르다**(Codex #699 P1).
    /// 예약 취소는 **전부**에 건다(로그아웃 상태에서는 누구의 알람도 울리면 안 되고, 그건
    /// 되돌릴 수 있다 — 주인이 다시 로그인하면 `recoverScheduledAlarms` 가 다시 건다).
    /// 반면 `enabled = false` 는 **되돌릴 수 없다.** 남의 계정 행까지 끄면 이렇게 된다:
    /// A 가 자동 401 로 세션만 잃고(행은 일부러 켜 둔다) → B 가 로그인했다 로그아웃 →
    /// **A 의 알람이 영영 꺼진 채**로 A 가 돌아온다. 자동 401 을 예외로 둔 뜻이 사라진다.
    ///
    /// - Parameter ownerUserId: 지금 떠나는 계정. `nil`(누구인지 모름)이면 켜진 행을 전부
    ///   끈다 — 판단할 근거가 없을 때는 **안 울리는 쪽**이 안전하다.
    /// - Returns: 실제로 끈 알람 수.
    ///
    /// 로그인 쪽 짝은 `cancelScheduledAlarmsNotOwnedBy` 다 — **한쪽만 고치지 말 것.**
    /// **취소에 실패해 남겨 둔 손잡이를 다시 써 본다.**
    ///
    /// ⚠ 이게 없으면 손잡이를 남긴 의미가 없다(Codex #699 P1). `stopAllScheduledAlarms` 는
    /// 취소가 실패하면 다시 시도하려고 `alarmKitID` 를 남기는데, **그 뒤로 아무도 그 값을
    /// 쓰지 않았다**: 그 행은 이미 꺼져 있어 `recoverScheduledAlarms` 가 건너뛰고,
    /// 같은 계정으로 다시 로그인하면 `cancelScheduledAlarmsNotOwnedBy` 도 건너뛴다.
    /// 그동안 OS 예약은 살아 있어 **꺼 놓은 알람이 운다** — 게다가 울리면
    /// `processAlarmUpdate` 가 `markRinging` 으로 그 행을 **도로 켠다.**
    ///
    /// 대상은 **꺼져 있는데 손잡이가 남은 행**이다. 평소에는 끄면서 손잡이를 함께 비우므로
    /// (`setEnabled`), 이 조합은 위의 '취소 실패' 에서만 생긴다 — 정확한 신호다.
    ///
    /// 소유자·`enabled` 와 무관하게 돈다. 지우는 것은 **우리가 못 끈 예약**뿐이라 남의
    /// 계정 것을 건드릴 위험이 없다.
    @discardableResult
    func retryPendingCancellations(store: LocalAlarmStore) async -> Int {
        #if canImport(AlarmKit)
        let pending = PendingAlarmCancellationStore.all
        guard !pending.isEmpty else { return 0 }
        // `AlarmManager.shared.alarms` 가 권위다 — 이미 사라진 예약을 취소하려 들지 않는다.
        // 목록을 못 읽으면(권한 회수 등) 이번 회차는 건너뛴다. 목록은 그대로 남아 다음 기회에.
        guard let live = try? AlarmManager.shared.alarms else { return 0 }
        let liveIDs = Set(live.map(\.id))
        var cleared = 0
        // 이번 회차에 **끝난** UUID 들(끊었거나, OS 에 이미 없다고 확인했거나).
        var resolved: Set<String> = []
        for raw in pending {
            guard let uuid = UUID(uuidString: raw) else {
                // UUID 로 읽히지 않으면 취소할 방법이 없다 — 붙들고 있을 이유도 없다.
                PendingAlarmCancellationStore.remove(raw)
                resolved.insert(raw)
                continue
            }
            if !liveIDs.contains(uuid) {
                // OS 에 이미 없다(사용자가 지웠거나 발화 후 사라졌다).
                PendingAlarmCancellationStore.remove(raw)
                resolved.insert(raw)
                cleared += 1
                continue
            }
            do {
                try AlarmManager.shared.cancel(id: uuid)
                PendingAlarmCancellationStore.remove(raw)
                resolved.insert(raw)
                cleared += 1
            } catch {
                // ⚠ **여기서 `statusMessage` 를 세우지 않는다.** 이 sweep 는 앱을 열 때마다
                // 도는데, 사용자가 시킨 적 없는 실패를 매번 알리면 그 문구가 소음이 된다.
                // 목록에 그대로 두어 다음 기회에 다시 시도한다.
            }
        }
        // 끝난 UUID 를 가리키던 손잡이를 비운다.
        //
        // ⚠ **`enabled` 를 보지 말 것**(Codex #699 P1). 회수가 늦어져 그 고아가 울면
        // `markRinging` 이 행을 켜는데, 그때 이 정리를 건너뛰면 행에 **이미 취소된 UUID** 가
        // 남는다 — 복구 sweep 는 "핸들이 있으니 예약돼 있다" 고 보고 건너뛰어, 반복 알람의
        // 다음 회차부터 **조용히 안 울린다.**
        // 안전판은 `enabled` 가 아니라 **UUID 일치**다: 그 사이 새 UUID 로 다시 예약된
        // 행이라면 값이 달라 여기 걸리지 않는다.
        for record in store.alarms {
            guard let handle = record.alarmKitID, resolved.contains(handle) else { continue }
            store.clearScheduleHandle(id: record.id)
        }
        return cleared
        #else
        return 0
        #endif
    }

    /// **다른 계정 소유의 OS 예약을 끊는다.** 로그인 확정 직후에 부른다.
    ///
    /// 안드로이드 `data/AlarmRepository.cancelAlarmsNotOwnedBy` 의 짝이다. 없으면 이런 일이
    /// 벌어진다(Codex #699 P1): A 의 세션이 **자동 401** 로 끊기면 예약은 일부러 살려 두는데,
    /// 그 상태에서 B 가 로그인하면 목록·복구는 소유자로 걸러 A 의 알람을 **감추기만 한다** —
    /// 예약은 그대로라 **A 의 알람이 울리는데 B 는 그걸 볼 수도 끌 수도 없다.**
    ///
    /// 행(`enabled`)은 건드리지 않는다. A 의 의도는 A 것이고, A 가 다시 로그인하면
    /// `recoverScheduledAlarms` 가 그대로 되살린다 — 여기서 끄면 그 길이 막힌다.
    /// 소유자 미기록(옛 행)은 건너뛴다: 그건 지금 계정 것으로 보는 게 저장소의 관용이다.
    @discardableResult
    func cancelScheduledAlarmsNotOwnedBy(_ ownerUserId: String?, store: LocalAlarmStore) async -> Int {
        #if canImport(AlarmKit)
        guard let owner = ownerUserId?.nilIfBlank else { return 0 }
        var cancelled = 0
        for record in store.alarms {
            guard let recordOwner = record.ownerUserId?.nilIfBlank, recordOwner != owner else { continue }
            guard record.alarmKitID != nil else { continue }
            // 취소에 실패하면 손잡이를 남긴다 — 지우면 고아 예약이 된다(위 주석과 같은 규칙).
            if await cancelScheduledAlarm(record: record) {
                store.clearScheduleHandle(id: record.id)
                cancelled += 1
            }
            // 실패해도 여기서 따로 적지 않는다 — `cancelScheduledAlarm` 이 이미 회수
            // 목록에 남긴다. 남의 계정 행은 **끄지 않으므로**(그 의도는 그 사람 것이다)
            // 행 상태로는 이 실패를 기억할 수 없고, 그래서 UUID 목록이 필요하다.
        }
        return cancelled
        #else
        return 0
        #endif
    }

    @discardableResult
    func stopAllScheduledAlarms(store: LocalAlarmStore, ownerUserId: String?) async -> Int {
        #if canImport(AlarmKit)
        let owner = ownerUserId?.nilIfBlank
        // ⚠ **먼저 진행 중인 예약을 무효화한다**(Codex #699 P1). 세션은 이 함수가 끝난
        // 뒤에야 비므로, 그 전에 끝나는 예약은 계정이 그대로라 스스로 물러서지 않는다.
        // 아래 루프의 스냅샷은 그 새 UUID 를 못 보고 지나가는데, 이어지는 `setEnabled` 가
        // **방금 저장된 손잡이를 지워** 아무도 모르는 예약이 남는다.
        invalidateInFlightSchedules()
        leavingAccountDepth += 1
        defer { leavingAccountDepth -= 1 }
        var stopped = 0
        // ⚠ **한 번 훑고 끝내지 않는다.** 훑는 도중에 원격 pull 이 받은 알람을 들여오면
        // 그 행은 스냅샷에 없어 통째로 건너뛰어진다. 더 할 일이 없을 때까지 돈다
        // (상한을 두는 것은 무한 루프 방지 — 그 사이에도 `isLeavingAccount` 가 새 예약을 막는다).
        for _ in 0..<5 {
            let handled = await stopOnePass(store: store, owner: owner)
            stopped += handled
            if handled == 0 { break }
        }
        return stopped
        #else
        return 0
        #endif
    }

    /// `stopAllScheduledAlarms` 의 한 회차. 처리한 행 수를 돌려준다(0이면 더 할 일이 없다).
    private func stopOnePass(store: LocalAlarmStore, owner: String?) async -> Int {
        #if canImport(AlarmKit)
        var stopped = 0
        for snapshot in store.alarms {
            // ⚠ **행을 다시 읽는다.** 위 배열은 루프 시작 시점의 **복사본**이고, 아래
            // `await` 사이에 다른 경로가 새 UUID 를 적을 수 있다. 낡은 값으로 판단하면
            // 그 예약을 건너뛰고, 그러고도 손잡이를 지워 흔적을 없앤다.
            guard let record = store.record(id: snapshot.id) else { continue }
            // ⚠ **취소가 실패했으면 핸들을 지우지 말 것**(Codex #699 P1).
            // `alarmKitID` 는 그 예약을 취소할 **유일한 손잡이**다. 실패했는데 지우면
            // OS 에는 예약이 남고 우리에겐 취소할 방법이 없는 **고아 예약**이 된다 —
            // 로그아웃 뒤라 화면에 들어갈 수도 없으니 사용자는 울리는 걸 보고만 있게 된다.
            // 남겨 두면 다음 기회(재로그인·복구 sweep)에 그 손잡이로 다시 시도한다.
            var keepHandle = false
            if record.alarmKitID != nil {
                if await cancelScheduledAlarm(record: record) {
                    // 예약이 사라졌으니 핸들도 지운다 — 남겨 두면 다음에 켤 때 어긋난다.
                    store.clearScheduleHandle(id: record.id)
                } else {
                    // 실패는 `cancelScheduledAlarm` 이 회수 목록에 적어 둔다(단일 출처).
                    // 여기서는 손잡이만 남긴다 — 다음에 켤 때 어긋나지 않도록.
                    keepHandle = true
                }
            }
            // 소유자 미기록(옛 행)은 현재 계정 것으로 본다 — 저장소의 다른 경로와 같은 관용.
            let departing = owner == nil || record.ownerUserId == nil || record.ownerUserId == owner
            if record.enabled && departing {
                // ⚠ `setEnabled` 는 기본적으로 핸들을 함께 비운다 — 위에서 취소에 실패해
                // 남겨 둔 손잡이를 **그 한 줄이 도로 버린다.** 그래서 여기까지 이어 준다.
                store.setEnabled(id: record.id, enabled: false, keepScheduleHandle: keepHandle)
                stopped += 1
            }
        }
        return stopped
        #else
        return 0
        #endif
    }

    @discardableResult
    /// - Parameter ownerUserId: **지금 로그인한 계정.** 반드시 넘긴다.
    ///   - `nil`(로그아웃 상태) 이면 **아무것도 재무장하지 않는다.** 계정을 떠난 기기에서
    ///     알람이 다시 살아나면 안 된다 — `stopAllScheduledAlarms` 로 끊어 둔 것을 이
    ///     sweep 가 곧바로 되살리면 그 조치가 무의미해진다.
    ///   - 다른 계정으로 로그인했으면 **앞 계정 알람은 건드리지 않는다.** 예전에는 소유자를
    ///     보지 않아, B 로 로그인하면 A 의 알람이 그대로 다시 걸렸다(2026-08-19 지적).
    ///   - 소유자 미기록(옛 행)은 이 계정 것으로 본다 — 저장소의 다른 경로와 같은 관용.
    func recoverScheduledAlarms(
        store: LocalAlarmStore,
        ownerUserId: String?,
        forceHolidayOffRecompute: Bool = false
    ) async -> Int {
        #if canImport(AlarmKit)
        let nowMillis = Int64(Date().timeIntervalSince1970 * 1000)
        let holidayPredicate = holidayStore.holidayPredicate()
        // ⚠ **계정이 없다고 재무장을 통째로 건너뛰지도, 아무나 되살리지도 말 것**
        // (Codex #699 P1 — 두 번에 걸쳐 양쪽 극단을 다 밟았다).
        //
        // 처음에는 여기서 곧바로 `return 0` 이었다. 그러면 **자동 401** 로 세션만 잃은
        // 기기가 부팅·업데이트·타임존 변경으로 예약을 잃었을 때 **다시 로그인할 때까지
        // 아무 알람도 안 울린다** — 자동 401 을 예외로 둔 뜻이 정반대로 뒤집힌다.
        //
        // 그렇다고 `nil` 을 "아무나" 로 읽으면 반대쪽으로 넘어간다. 한 기기에 계정이 여럿
        // 오갔다면(A 만료 → B 로그인 → B 도 만료) **A 와 B 의 알람이 함께** 살아난다.
        // 그래서 **자동으로 끊긴 그 계정**을 남겨 두고 그것만 되살린다.
        // 안드로이드 `network/AuthSessionStore.kt` 의 `sessionExpiredOwnerUserId` 를 옮긴 것이다.
        // 표시가 없는 기기는 아무것도 되살리지 않는다 — 못 가릴 때는 되살려서 못 끄게
        // 만드는 쪽보다 로그인 한 번 시키는 쪽이 안전하다.
        guard let owner = ownerUserId?.nilIfBlank ?? SessionExpiryStore.expiredOwnerUserId else {
            return 0
        }
        let candidates = store.alarms.filter { record in
            // 앞 계정 알람을 **다른 계정의** 로그인으로 되살리지 않는다.
            (record.ownerUserId == nil || record.ownerUserId == owner) &&
            record.enabled && (
                record.alarmKitUUID == nil ||
                record.runtimeStateEnum == .failed ||
                // PR3: `.fixed` 공휴일off 반복 one-shot 은 발화 후에도 OS 자동 재무장이
                // 없으므로, 발화 시각이 지난(또는 도달한) 건을 후보에 추가해 prepareFor-
                // ScheduleRecovery 의 과거->advance/failed 분기로 다음 비공휴일 회차를
                // 재무장한다 (Android reschedulePendingAlarms 의 안전망). 네이티브
                // `.relative` 알람은 발화해도 alarmKitID 를 유지하고 AlarmKit 이 recurrence
                // 를 소유하므로 후보에서 제외되어야 한다 (이 술어가 그 분리를 보장).
                (record.isHolidayOffRecurring && record.fireAtMillis <= nowMillis) ||
                // timezone/시간 변경 시: 미래 건도 강제 재계산 (절대 instant 재anchor).
                (forceHolidayOffRecompute && record.isHolidayOffRecurring)
            )
        }
        var recovered = 0

        for record in candidates {
            // PR3 FIX: double-arm race guard. rearmIfHolidayOffOneShot(dismiss 경로)나
            // 또 다른 recovery sweep 가 같은 record 를 await schedule() 중이면 건너뛴다.
            // (`.fixed` one-shot 이 중복 schedule 되어 다음 회차가 이중 발화하는 것을 방지)
            guard !rearmInFlight.contains(record.id) else { continue }
            rearmInFlight.insert(record.id)
            defer { rearmInFlight.remove(record.id) }

            // timezone 강제 recompute 경로: 발화 시각이 아직 미래여도 새 zone 기준으로
            // fireAtMillis 를 다시 박아야 한다. prepareForScheduleRecovery 는 미래 건을
            // 건드리지 않으므로, `.fixed` 서브셋에 한해 setEnabled 로 재계산을 강제한다.
            if forceHolidayOffRecompute,
               record.isHolidayOffRecurring,
               record.fireAtMillis > nowMillis {
                store.setEnabled(id: record.id, enabled: true, nowMillis: nowMillis, isHoliday: holidayPredicate)
            }

            guard let prepared = store.prepareForScheduleRecovery(
                id: record.id,
                nowMillis: nowMillis,
                isHoliday: holidayPredicate
            ) else {
                continue
            }

            let scheduled = await schedule(record: prepared, store: store)
            if scheduled {
                recovered += 1
                if record.alarmKitUUID != nil {
                    _ = await cancelScheduledAlarm(record: record)
                }
            } else {
                store.markFailed(id: prepared.id)
            }
        }

        if recovered > 0 {
            statusMessage = "예약된 알람 \(recovered)개를 다시 연결했어요."
        }
        return recovered
        #else
        statusMessage = Self.alarmUnavailableMessage
        return 0
        #endif
    }

    /// PR3: dismiss 직후 `.fixed` 공휴일off one-shot 을 다음 비공휴일 회차로 재무장한다.
    /// markStopped(sync, store 계층)는 AlarmManager 를 await 할 수 없으므로 실제 OS
    /// 재무장은 async ViewModel 계층에서 수행한다. handleAlarmStopped 와 disappearance
    /// 폴백이 모두 이 헬퍼를 호출해 멱등하게 재무장한다.
    ///
    /// 멱등 guard: markStopped 가 `.fixed` 서브셋에 대해 alarmKitID 를 nil 로 비워
    /// "재무장 필요" 신호를 남긴다. 두 dismiss 경로가 겹쳐도, 먼저 도는 쪽이
    /// schedule() -> markScheduled 로 새 alarmKitID 를 세우면 두 번째는 guard 에서
    /// no-op 이 된다. iOS 판 Android dismiss 의 alarmScheduler.schedule(next).
    func rearmIfHolidayOffOneShot(localID: String, store: LocalAlarmStore) async {
        #if canImport(AlarmKit)
        guard let record = store.record(id: localID) else { return }
        guard record.enabled,
              record.isHolidayOffRecurring,
              record.alarmKitID == nil else { return }
        // PR3 FIX: double-arm race guard. await schedule() 사이에 concurrent sweep 가
        // 같은 nil guard 를 통과해 중복 `.fixed` 를 schedule 하는 것을 막는다.
        guard !rearmInFlight.contains(record.id) else { return }
        rearmInFlight.insert(record.id)
        defer { rearmInFlight.remove(record.id) }
        await schedule(record: record, store: store)
        #endif
    }

    /// 예약에 **실제로 실리는** 값들. `await` 앞뒤로 비교해 그사이 바뀐 것을 잡는다.
    ///
    /// ⚠ `updatedAtMillis` 를 쓰지 않는다 — 예약과 무관한 쓰기(동기화 시각 등)에도 올라가
    /// 멀쩡한 예약을 헛되이 취소하게 된다. 실패로 처리되면 켜기 흐름이 알람을 도로 꺼
    /// 버리므로(`AlarmsListView`), 과잉 판정이 곧 피해다.
    struct SchedulingSnapshot: Equatable {
        // `makeSchedule` 이 보는 값
        let enabled: Bool
        let hour: Int
        let minute: Int
        let fireAtMillis: Int64
        let repeatDaysMask: Int
        let holidayOff: Bool
        // `makeConfiguration` 이 보는 값 — 라벨·스누즈 문구, 소리 선택, 목소리 문구까지
        // 알림에 그대로 박힌다. 여기서 빠뜨리면 그 변경은 **아무도 고치지 않는다**
        // (리컨사일러는 소리 지문만 본다).
        let playMode: String
        let label: String
        let snoozeEnabled: Bool
        let snoozeMinutes: Int
        let snoozeRepeatLimit: Int
        let audioCacheKey: String?
        let localAudioUri: String?
        let voiceText: String?
        let voiceProfileId: String?
        let bucketId: String?
        let bucketRotationIndex: Int?
        let contextVariantIndex: Int?
        let voiceRandomPrompt: Bool
        let defaultAlarmSoundId: String
        let alarmSoundUri: String?
        let voiceVolumePercent: Int
        let alarmVolumePercent: Int

        init(_ r: LocalAlarmRecord) {
            enabled = r.enabled
            hour = r.hour
            minute = r.minute
            fireAtMillis = r.fireAtMillis
            repeatDaysMask = r.repeatDaysMask
            holidayOff = r.holidayOff
            playMode = r.playMode
            label = r.label
            snoozeEnabled = r.snoozeEnabled
            snoozeMinutes = r.snoozeMinutes
            snoozeRepeatLimit = r.snoozeRepeatLimit
            audioCacheKey = r.audioCacheKey
            localAudioUri = r.localAudioUri
            voiceText = r.voiceText
            voiceProfileId = r.voiceProfileId
            bucketId = r.bucketId
            bucketRotationIndex = r.bucketRotationIndex
            contextVariantIndex = r.contextVariantIndex
            voiceRandomPrompt = r.voiceRandomPrompt
            defaultAlarmSoundId = r.defaultAlarmSoundId
            alarmSoundUri = r.alarmSoundUri
            voiceVolumePercent = r.voiceVolumePercent
            alarmVolumePercent = r.alarmVolumePercent
        }
    }

    @discardableResult
    func schedule(record: LocalAlarmRecord, store: LocalAlarmStore) async -> Bool {
        await self.schedule(record: record, store: store, retriesLeft: 1)
    }

    private func schedule(
        record: LocalAlarmRecord,
        store: LocalAlarmStore,
        retriesLeft: Int
    ) async -> Bool {
        // ⚠ **계정을 떠나는 중에는 새 예약을 만들지 않는다**(Codex #699 P1).
        // 종료 sweep 가 도는 동안 만들어진 예약은 그 sweep 가 못 보고 지나가, 로그아웃이
        // 끝난 뒤 **켜진 채 로그인 화면 뒤에 숨은 알람**으로 남는다.
        guard !isLeavingAccount else { return false }
        // ⚠ **await 하기 전에** 적어 둔다 — 돌아와서 달라졌으면 계정이 바뀐 것이다.
        let epochAtStart = accountEpoch
        // UI 미리보기 모드에서는 실제 예약을 하지 않는다 — 화면을 보려는 것이지 알람을
        // 걸려는 게 아니다. 권한 프롬프트가 떠서 화면을 가리는 것도 막는다.
        //
        // ⚠ 단, `-UIPreviewRingIn` 은 **울리는 것을 보려는** 진입점이라 통과시킨다.
        // 여기서 막으면 그 인자가 아무 일도 하지 않는다.
        if UIPreviewSeed.isEnabled && UIPreviewSeed.ringInSeconds == nil {
            alarmAuthorized = true
            authorizationLabel = "허용됨"
            return true
        }
        #if canImport(AlarmKit)
        do {
            if AlarmManager.shared.authorizationState != .authorized {
                let state = try await AlarmManager.shared.requestAuthorization()
                applyAuthorizationState(state)
                guard state == .authorized else {
                    statusMessage = "알람 권한이 필요해요. 권한을 허용한 뒤 다시 시도해 주세요."
                    return false
                }
            }
            let id = UUID()
            let schedule = makeSchedule(record)
            // Phase 2-B4: playMode + 캐시 상태에 따라 AlarmKit sound 전략 결정.
            // 결과는 lastSoundResolution 으로 expose 하여 ContentView 등이 in-app
            // fallback 안내 문구를 표시할 수 있다.
            // 유료 목소리 권한을 **예약 시점에** 재확인한다.
            //
            // 안드로이드는 RingingService 가 울릴 때 이 판단을 한다. iOS 는 발사 시점에
            // 우리 코드가 돌지 않으므로(AlarmKit 은 해제 시점의 stopIntent 뿐) 예약해 둔
            // 사운드가 그대로 울린다 — 그래서 같은 게이트를 여기로 옮겼다.
            // 강등되어도 **알람 자체는 그대로 울린다**(기본 톤으로). 자세한 근거는 PaidVoiceGate.
            let effectiveRecord = effectiveRecordForScheduling(record)
            if effectiveRecord.playMode != record.playMode {
                Self.paidGateLogger.info(
                    "Free plan at schedule time — downgrading paid voice to alarm tone (id: \(record.id, privacy: .public))"
                )
            }
            let resolution = AlarmSoundResolver.resolve(for: effectiveRecord, audioCache: audioCache)
            lastSoundResolution = resolution
            let configuration = makeConfiguration(
                record: effectiveRecord,
                alarmKitID: id,
                schedule: schedule,
                resolution: resolution
            )
            _ = try await AlarmManager.shared.schedule(id: id, configuration: configuration)

            // ⚠ **취소됐으면 방금 건 예약을 되돌린다.** 백그라운드 사이클이 접히는 중인데
            // 여기서 그냥 돌아가면 OS 에는 알람이 남고 로컬에는 핸들이 없다 — 취소할 방법이
            // 없는 고아다(아래 '지워졌다' 갈래와 같은 사고). `markScheduled` 로 나아가는
            // 것도 안 된다: 그건 "끝났다" 고 통보한 사이클이 로컬을 더 만지는 것이다.
            if Task.isCancelled {
                await revertJustScheduled(id)
                return false
            }

            // ⚠ **await 사이에 계정이 바뀌었을 수 있다**(Codex #699 P1). 그대로 나아가면
            // 지금 로그인한 사람에게는 **보이지도 끄지도 못하는 남의 예약**이 남는다.
            // 로그인 시점의 정리는 이 예약을 못 본다 — 그때는 아직 UUID 가 저장 전이다.
            if accountEpoch != epochAtStart || isLeavingAccount {
                await revertJustScheduled(id)
                Self.paidGateLogger.info(
                    "Account changed while scheduling — cancelled the OS alarm (id: \(record.id, privacy: .public))"
                )
                return false
            }

            // ⚠ **await 사이에 행이 바뀌었을 수 있다**(2026-08-18 Codex #697 P1).
            // 예약은 비동기라 그동안 사용자가 알람을 끄거나 지울 수 있고, 그대로
            // `markScheduled` 하면 두 가지가 난다:
            //   - **지운 알람**: `markScheduled` 는 행이 없으면 조용히 no-op 인데, OS 에는
            //     방금 만든 알람이 남는다. 로컬에 핸들이 없어 **취소할 방법도 없는 고아**가
            //     되어 지운 알람이 울린다.
            //   - **끈 알람**: `markScheduled` 가 `enabled = true` 를 **무조건** 쓰므로
            //     사용자가 방금 끈 알람이 도로 켜진다.
            // 그래서 여기서 다시 읽고, 우리가 만든 OS 알람을 되돌린다.
            //
            // 판정은 **await 동안 바뀐 경우만** 본다 — 처음부터 꺼진 행을 예약하는 경로가
            // 따로 있어(잠금 복원 등) `enabled` 를 무조건 요구하면 그쪽이 깨진다.
            guard let afterAwait = store.record(id: record.id) else {
                // **지워졌다.** `markScheduled` 는 행이 없으면 조용히 no-op 이라, 그냥 두면
                // OS 에만 남아 **취소할 핸들이 없는 고아**가 된다 — 지운 알람이 운다.
                await revertJustScheduled(id)
                Self.paidGateLogger.info(
                    "Alarm deleted while scheduling — cancelled the OS alarm (id: \(record.id, privacy: .public))"
                )
                return false
            }
            if SchedulingSnapshot(afterAwait) != SchedulingSnapshot(record) {
                // **예약에 실리는 값이 바뀌었다**(끄기·시각 변경·원격 pull 등).
                // 방금 건 예약은 낡았으므로 되돌린다. `AlarmScheduleReconciler` 는
                // **소리 지문만** 비교하므로 시각만 바뀐 경우는 아무도 고쳐 주지 않는다 —
                // 여기서 처리하지 않으면 알람이 옛 시각에 운다.
                await revertJustScheduled(id)
                Self.paidGateLogger.info(
                    "Alarm changed while scheduling — rescheduling with the fresh row (id: \(record.id, privacy: .public))"
                )
                // 새 행으로 한 번 다시 건다. 껐으면 그 자체가 '예약하지 않는다' 이므로
                // 재시도하지 않는다 — 켜기 흐름의 실패 처리(끄기)와 부딪히지 않게 false.
                guard afterAwait.enabled, retriesLeft > 0 else { return false }
                // `self.` 를 붙인다 — 이 함수 안의 지역변수 `schedule`(Alarm.Schedule)이 이름을 가린다.
                return await self.schedule(record: afterAwait, store: store, retriesLeft: retriesLeft - 1)
            }

            // **예약과 그 소리의 지문을 함께 적는다.** 나중에 행이 바뀌면
            // `AlarmScheduleReconciler` 가 이 값과 비교해 다시 예약한다 — 그게 없으면
            // 행에는 새 소리가 적혀 있는데 OS 는 옛 파일을 그대로 운다.
            //
            // ⚠ **지문은 '실제로 예약된 것' 이어야 한다.** `plan` 을 다시 계산해 새기면,
            // 스테이징이 실패해 OS 에는 기본 톤이 실렸는데 행에는 목소리 지문이 적힌다 —
            // 그 뒤로는 비교가 **영원히 일치**해서 리컨사일러가 눈이 먼다. 일시적 쓰기 실패
            // 한 번으로 목소리 알람이 잠금화면에서 영구히 톤으로 울린다(자는 동안 인앱
            // 폴백은 돌지 않는다). 그래서 손에 있는 `resolution` 으로 지문을 만든다.
            store.markScheduled(
                localID: record.id,
                alarmKitID: id.uuidString,
                soundFingerprint: AlarmScheduleReconciler.scheduledFingerprint(
                    plan: AlarmSoundResolver.plan(for: effectiveRecord, audioCache: audioCache),
                    resolution: resolution
                )
            )
            statusMessage = describeScheduleStatus(record: record, resolution: resolution)
            return true
        } catch {
            statusMessage = "알람 예약에 실패했어요. 잠시 후 다시 시도해 주세요."
            return false
        }
        #else
        statusMessage = Self.alarmUnavailableMessage
        return false
        #endif
    }

    /// 예약에 실제로 실릴 행 — 유료 목소리 권한을 **예약 시점에** 재확인해 강등한 결과.
    ///
    /// ⚠ **예약과 지문 계산이 같은 행을 봐야 한다.** 한쪽만 강등을 적용하면 지문이 매번
    /// 어긋난 것으로 읽혀 `AlarmScheduleReconciler` 가 무한히 다시 예약한다.
    func effectiveRecordForScheduling(_ record: LocalAlarmRecord) -> LocalAlarmRecord {
        let snapshot = KeychainStore.readSession().map { accessSnapshotStore.read(userID: $0.user.id) } ?? .empty
        return PaidVoiceGate.shouldDowngrade(record: record, snapshot: snapshot)
            ? PaidVoiceGate.downgraded(record)
            : record
    }

    @discardableResult
    func cancelScheduledAlarm(record: LocalAlarmRecord) async -> Bool {
        #if canImport(AlarmKit)
        guard let alarmKitUUID = record.alarmKitUUID else { return true }
        do {
            try AlarmManager.shared.cancel(id: alarmKitUUID)
            // ⚠ **끈 것을 다시 말하지 않는다.** 스위치가 이미 꺼진 상태를 보여 주므로
            // 화면이 이미 답한 것을 한 번 더 말하는 셈이다. 안드로이드에도 이 토스트는 없다.
            // (실패는 결과가 달라지므로 아래 catch 에서 계속 알린다.)
            return true
        } catch {
            // ⚠ **실패한 취소는 예외 없이 여기서 회수 목록에 남긴다**(Codex #699 P1).
            // 호출부마다 기억하게 하면 언젠가 빠뜨리고, 빠뜨린 그 예약은 **아무도 모르는
            // 고아**가 된다 — 행에도 없고 목록에도 없으니 다음 로그인도 회수 sweep 도
            // 찾지 못한다. 판정을 취소 지점 **한 곳**에 둔다.
            PendingAlarmCancellationStore.add(alarmKitUUID.uuidString)
            statusMessage = "알람 취소에 실패했어요. 잠시 후 다시 시도해 주세요."
            return false
        }
        #else
        statusMessage = Self.alarmUnavailableMessage
        return false
        #endif
    }

    /// 알람을 지운다(사용자가 삭제·스와이프로 부른다).
    ///
    /// ⚠ **취소 실패가 삭제를 막지 않는다**(2026-08-18 수정. 그전에는 막았다).
    ///
    /// `AlarmManager.cancel(id:)` 은 그 id 를 AlarmKit 이 **모를 때 throw** 한다 — 이미
    /// 울리고 끝난 알람, 이미 해제된 알람, 재설치·복구로 남은 낡은 UUID 가 전부 그렇다.
    /// 예전에는 그때 `false` 를 돌려주고 로컬 행을 **남겼다.** 그래서:
    ///
    ///   삭제 → "알람 취소에 실패했어요" → 목록에 그대로 → 또 삭제 → 또 실패 …
    ///
    /// **영영 지울 수 없는 알람**이 된다(2026-08-18 실기기 보고). 게다가 그 실패는
    /// 대개 "이미 예약돼 있지 않다" 는 뜻이라, 남길 이유가 없는데 남긴 셈이다.
    ///
    /// ⚠ 그렇다고 **무조건** 지우면 반대쪽 사고가 난다 — OS 에는 아직 예약이 살아 있는데
    /// 행만 지우면, 끌 수도 지울 수도 없는 알람이 울린다(이 파일 위쪽 주석의 그 상황).
    /// 그래서 **AlarmKit 이 정말 안 들고 있을 때만** 지운다. 판단은 마지막으로 받은
    /// `alarmUpdates` 스냅샷(`lastAlarmStateSnapshot`)으로 한다.
    @discardableResult
    func cancel(record: LocalAlarmRecord, store: LocalAlarmStore) async -> Bool {
        guard let alarmKitUUID = record.alarmKitUUID else {
            deleteLocalAlarm(record, store: store)
            return true
        }
        if await cancelScheduledAlarm(record: record) {
            deleteLocalAlarm(record, store: store)
            return true
        }
        // 취소가 실패했다 — OS 가 이 알람을 아직 들고 있는가?
        //
        // ⚠ **AlarmKit 에 직접 묻는다.** `AlarmManager.alarms` 가 권위 있는 값이다.
        // 예전에는 `lastAlarmStateSnapshot`(마지막 `alarmUpdates` emit 의 캐시)으로 판단했는데,
        // 그 캐시는 취소·예약 때 갱신되지 않고 emit 이 올 때만 바뀐다. 그래서 알람이 울리고
        // 해제된 직후처럼 **emit 이 아직 안 온 창**에서는 "아직 예약돼 있다" 고 잘못 답하고,
        // 사용자에게는 지워지지 않는 알람으로 보인다. 되돌릴 수 없게 느껴지는 판단을
        // 신선도 보장이 없는 값으로 내리고 있었다.
        // 못 물어보면(throws) 그때만 캐시로 폴백한다 — 아무 근거도 없이 막는 것보다 낫다.
        let scheduledIDs: Set<String>
        do {
            scheduledIDs = Set(try AlarmManager.shared.alarms.map { $0.id.uuidString })
        } catch {
            scheduledIDs = Set(lastAlarmStateSnapshot.keys)
        }
        if Self.mayDeleteAfterCancelFailure(
            alarmKitID: alarmKitUUID.uuidString,
            scheduledIDs: scheduledIDs
        ) {
            // 안 들고 있다. 취소할 게 없어서 난 실패이므로 삭제는 그대로 진행한다.
            // 사용자가 원한 결과(목록에서 사라진다)가 정확히 이뤄지므로 사유도 지운다.
            statusMessage = nil
            deleteLocalAlarm(record, store: store)
            return true
        }
        // 정말로 아직 예약돼 있다 — 행을 남기고 알린다. 지우면 못 끄는 알람이 된다.
        return false
    }

    /// 취소가 실패했을 때 **로컬 행을 지워도 되는가.**
    ///
    /// AlarmKit 이 그 id 를 안 들고 있으면(`scheduledIDs` 에 없으면) 취소할 것이 없어서 난
    /// 실패이므로 지워도 된다. 들고 있으면 지우면 안 된다 — **끌 수도 지울 수도 없는 알람**이
    /// 울린다. 순수 함수로 빼 둔 이유는 이 판단이 회귀했을 때 증상이
    /// "영영 안 지워지는 알람" 또는 "안 꺼지는 유령 알람" 둘 다로 나올 수 있어서다.
    /// 회귀 테스트: `AlarmCancelDeletionTests`.
    nonisolated static func mayDeleteAfterCancelFailure(alarmKitID: String, scheduledIDs: Set<String>) -> Bool {
        !scheduledIDs.contains(alarmKitID)
    }

    private func deleteLocalAlarm(_ record: LocalAlarmRecord, store: LocalAlarmStore) {
        if let releasedAudioCacheKey = store.delete(record) {
            try? audioCache.deleteCachedAudio(cacheKey: releasedAudioCacheKey)
        }
    }

    #if canImport(AlarmKit)
    private func makeSchedule(_ record: LocalAlarmRecord) -> Alarm.Schedule {
        // PR3 하이브리드: 반복+공휴일off 알람만 `.fixed` one-shot 으로 무장한다.
        // record.fireAtMillis 는 모든 writer(upsert 호출자/setEnabled/markStopped/
        // prepareForScheduleRecovery/copyAlarm)가 nextFireAtMillis(holidayOff:isHoliday:)
        // 로 이미 공휴일 skip 된 다음 발화 시각을 채워두므로 `.fixed(record.nextFireDate)`
        // 가 정의상 정확하다. AlarmKit 은 단일 절대 one-shot 만 들고, 다음 회차는
        // 앱이 dismiss/recovery/timezone 경로에서 직접 재무장한다.
        if record.isHolidayOffRecurring {
            return .fixed(record.nextFireDate)
        }
        // 그 외는 기존 동작 그대로: 단발 -> .relative(.never), 반복 -> .relative(.weekly).
        // AlarmKit 이 timezone 적응 + 자동 재무장을 소유한다 (blast radius 최소화).
        let time = Alarm.Schedule.Relative.Time(hour: record.hour, minute: record.minute)
        let weekdays = record.repeatDaysMask.repeatDays.compactMap(localeWeekday)
        let recurrence: Alarm.Schedule.Relative.Recurrence = weekdays.isEmpty
            ? .never
            : .weekly(weekdays)
        return .relative(.init(time: time, repeats: recurrence))
    }

    // `nonisolated` — main actor 격리된 self 에 의존하지 않고 순수 입력값으로만
    // configuration 을 만든다. 그래야 결과 `AlarmConfiguration`(Sendable 미보장 타입)
    // 을 AlarmManager 로 sending 할 때 Swift 6 의 region-based isolation 검사가
    // main actor region 에 묶이지 않는다.
    private nonisolated func makeConfiguration(
        record: LocalAlarmRecord,
        alarmKitID: UUID,
        schedule: Alarm.Schedule,
        resolution: AlarmSoundResolution
    ) -> AlarmManager.AlarmConfiguration<AlarmTalkMetadata> {
        typealias AlarmConfiguration = AlarmManager.AlarmConfiguration<AlarmTalkMetadata>
        let stopButton = AlarmButton(text: "알람 끄기", textColor: .white, systemImageName: "stop.fill")
        // GROUP 3 (5): 다시 울림 버튼 라벨에 분을 접어 정직하게 만든다 (Android
        // RingingActivity 의 "N분 더 자기" parity). AlarmKit 제약상 한도 도달 시에도
        // alert 의 보조 버튼 자체는 숨길 수 없고(라벨만 우리가 정할 수 있음),
        // 한도 종료 분기는 SnoozeAlarmIntent.perform() 의 .deny 가 담당한다.
        let snoozeButton = AlarmButton(
            text: LocalizedStringResource(stringLiteral: "\(record.snoozeMinutes)분 더 자기"),
            textColor: .white,
            systemImageName: "moon.zzz.fill"
        )
        // .custom 으로 두어 다시 울림 분기 전체를 SnoozeAlarmIntent 가 결정하게 한다.
        // .countdown 이면 OS 가 secondaryIntent 와 별개로 postAlert countdown 을
        // 자동 재무장하므로, snoozeRepeatLimit 도달 시에도 알람이 계속 되살아난다
        // (Android AlarmRepository.snooze() 의 한도 종료 동작과 어긋남). .custom 은
        // OS 자동 동작을 끄고 우리 intent 가 countdown(id:) / stop(id:) 을 직접 호출.
        // ⚠ **여기가 iOS 에서 우리가 쓸 수 있는 유일한 울림 화면 문구다.** AlarmKit 이
        // 시스템 ALERT UI 를 소유해 안드로이드 `RingingActivity`(전용 잠금화면 씬 —
        // 날짜·104sp 시계·낭독 문구 카드·밀어서 끄기) 를 복제할 수 없다. 그래서 최소한
        // **시각만이라도** 제목에 넣는다 — 라벨 하나만 뜨면 잠결에 어느 알람인지 모른다.
        let alert = AlarmPresentation.Alert(
            title: LocalizedStringResource(stringLiteral: Self.alertTitle(for: record)),
            stopButton: stopButton,
            secondaryButton: snoozeButton,
            secondaryButtonBehavior: .custom
        )
        let countdown = AlarmPresentation.Countdown(
            title: LocalizedStringResource(stringLiteral: "\(record.label) 다시 울릴 준비 중")
        )
        let paused = AlarmPresentation.Paused(
            title: "일시정지됨",
            resumeButton: AlarmButton(text: "다시 시작", textColor: .white, systemImageName: "play.fill")
        )
        let presentation = AlarmPresentation(alert: alert, countdown: countdown, paused: paused)
        // Phase 2-B4: 메타데이터에 playMode + voiceCacheKey 를 실어 LiveActivity /
        // alarmUpdates handler 가 어떤 in-app 폴백 전략을 쓸지 식별 가능.
        // GROUP 3: alarmKitID 를 실어 LiveActivity 가 Stop/Snooze 인텐트를 구성할 수
        // 있게 하고, voiceText 는 Android RingingActivity parity 로 alarm_only 가 아니고
        // 비어있지 않을 때만 실어 LA 가 ring-moment 인용 문구를 보여 줄 수 있게 한다.
        let quotedVoiceText: String? = {
            guard record.playModeEnum != .alarmOnly else { return nil }
            let trimmed = record.voiceText?.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let trimmed, !trimmed.isEmpty else { return nil }
            // ⚠ **delivery 태그를 벗겨서 싣는다.** 이 문구는 잠금화면 alert 과 Live Activity
            // 인용문으로 그대로 보인다 — 태그가 섞이면 대괄호가 화면에 뜬다.
            // 판정은 **출처**다(안드로이드 `RingingActivity.toRingingUiState` 와 같은 축):
            // 생성 문구·테마 클립은 우리가 만든 것이라 벗기고, 직접 입력은 손대지 않는다.
            let generated = record.voiceRandomPrompt || (record.bucketId).nilIfBlank != nil
            return DeliveryTags.strip(trimmed, generated: generated)
        }()
        let metadata = AlarmTalkMetadata(
            localAlarmID: record.id,
            label: record.label,
            playMode: record.playMode,
            voiceCacheKey: record.audioCacheKey,
            alarmKitID: alarmKitID.uuidString,
            voiceText: quotedVoiceText,
            hour: record.hour,
            minute: record.minute
        )
        let attributes = AlarmAttributes(
            presentation: presentation,
            metadata: metadata,
            // GROUP 3 (3): alert tint 를 LA 와 동일한 단일 브랜드 토큰으로 둔다.
            // AlarmTalkTheme.primary 는 AlarmTalkBrand.primaryLight 에서 파생되고,
            // LA 위젯도 AlarmTalkBrand 를 참조하므로 alert tint 와 LA tint 가 동기된다.
            tintColor: AlarmTalkTheme.primary
        )
        let snoozeDuration = Alarm.CountdownDuration(preAlert: nil, postAlert: TimeInterval(record.snoozeMinutes * 60))
        let alertSound = AlarmSoundResolver.makeAlertSound(resolution)
        return AlarmConfiguration(
            countdownDuration: snoozeDuration,
            schedule: schedule,
            attributes: attributes,
            stopIntent: StopAlarmIntent(alarmID: alarmKitID.uuidString),
            secondaryIntent: SnoozeAlarmIntent(alarmID: alarmKitID.uuidString),
            sound: alertSound
        )
    }

    /// schedule(...) 의 statusMessage 문구를 사운드 전략에 맞춰 구성한다.
    private func describeScheduleStatus(
        record: LocalAlarmRecord,
        resolution: AlarmSoundResolution
    ) -> String {
        switch resolution {
        case .systemDefault:
            return "\(record.label) 알람을 예약했어요."
        case .bundledNamed:
            return "\(record.label) 알람을 예약했어요."
        case .cachedAudio(_, let durationMs):
            let seconds = max(1, Int((durationMs + 500) / 1000))
            return "\(record.label) 알람을 예약했어요. \(seconds)초 목소리는 iOS 제한으로 기본 알람음 뒤 앱이 열려 있을 때 재생돼요."
        }
    }

    private func localeWeekday(_ day: RepeatDay) -> Locale.Weekday? {
        switch day {
        case .sunday: return .sunday
        case .monday: return .monday
        case .tuesday: return .tuesday
        case .wednesday: return .wednesday
        case .thursday: return .thursday
        case .friday: return .friday
        case .saturday: return .saturday
        }
    }
    #endif
}
