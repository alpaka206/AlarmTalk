import XCTest
@testable import AlarmTalk

@MainActor
final class AlarmIntentsTests: XCTestCase {

    private var store: LocalAlarmStore!
    private var ctx: AlarmAppContext!
    /// 인텐트가 적은 사용 기록. 실제 큐 대신 여기로 받는다(디스크·키체인을 타지 않는다).
    private var recorded: [(UsageEventType, String?)] = []
    /// 전역 훅을 갈아 끼우므로 원래대로 되돌려 놓는다 — 안 그러면 다른 테스트로 샌다.
    private var originalRecordUsageEvent: ((UsageEventType, LocalAlarmRecord?) -> Void)!

    override func setUp() async throws {
        // 경로는 저장소에게 묻는다 — 손으로 조립하면 기기의 진짜 알람 파일을 지운다.
        try? FileManager.default.removeItem(at: LocalAlarmStore.defaultStorageURL())
        store = LocalAlarmStore()
        try? await Task.sleep(nanoseconds: 50_000_000)
        for r in store.alarms { store.delete(r) }
        ctx = AlarmAppContext(store: store)
        recorded = []
        originalRecordUsageEvent = AlarmAppContext.recordUsageEvent
        AlarmAppContext.recordUsageEvent = { [weak self] type, record in
            self?.recorded.append((type, record?.id))
        }
    }

    override func tearDown() async throws {
        AlarmAppContext.recordUsageEvent = originalRecordUsageEvent
        AlarmAppContext.shared = nil
        ctx = nil
        store = nil
    }

    private func armedRecord(
        alarmKitID: String,
        canSnooze: Bool = true,
        state: AlarmRuntimeState = .armed
    ) -> LocalAlarmRecord {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        return LocalAlarmRecord(
            label: "test",
            hour: 7,
            minute: 30,
            fireAtMillis: now + 60_000,
            snoozeEnabled: canSnooze,
            playMode: AlarmPlayMode.voiceOnly.rawValue,
            voiceProfileId: "profile-1",
            state: state.rawValue,
            createdAtMillis: now,
            updatedAtMillis: now,
            alarmKitID: alarmKitID
        )
    }

    // MARK: - StopAlarmIntent

    func test_stopIntent_defaultInit_emptyAlarmID() {
        let intent = StopAlarmIntent()
        XCTAssertEqual(intent.alarmID, "")
    }

    func test_stopIntent_parameterInit_preservesAlarmID() {
        let uuid = UUID().uuidString
        let intent = StopAlarmIntent(alarmID: uuid)
        XCTAssertEqual(intent.alarmID, uuid)
    }

    func test_stopIntent_perform_invalidUUID_returnsResult() async throws {
        // 빈 ID 또는 비-UUID 문자열은 early-return 으로 graceful no-op.
        let intent = StopAlarmIntent(alarmID: "not-a-uuid")
        _ = try await intent.perform()
        // perform 이 throw 하지 않으면 OK. AlarmKit stop 은 호출되지 않는다.
    }

    func test_stopIntent_perform_validUUID_noContext_isNoOp() async throws {
        // AlarmAppContext.shared 가 nil 이면 store 변형 없이 AlarmKit stop 만
        // 시도. 시뮬레이터에서 AlarmKit 이 없거나 unknown id 면 catch.
        AlarmAppContext.shared = nil
        let intent = StopAlarmIntent(alarmID: UUID().uuidString)
        _ = try await intent.perform()
    }

    // MARK: - SnoozeAlarmIntent

    func test_snoozeIntent_defaultInit_zeroMinutes() {
        let intent = SnoozeAlarmIntent()
        XCTAssertEqual(intent.alarmID, "")
        XCTAssertEqual(intent.snoozeMinutes, 0)
    }

    func test_snoozeIntent_parameterInit_preservesValues() {
        let uuid = UUID().uuidString
        let intent = SnoozeAlarmIntent(alarmID: uuid, snoozeMinutes: 9)
        XCTAssertEqual(intent.alarmID, uuid)
        XCTAssertEqual(intent.snoozeMinutes, 9)
    }

    func test_snoozeIntent_perform_invalidUUID_returnsResult() async throws {
        let intent = SnoozeAlarmIntent(alarmID: "", snoozeMinutes: 5)
        _ = try await intent.perform()
    }

    // MARK: - 사용 기록 (안드로이드 RingingService.dismiss/snooze 미러)

    func test_stopIntent_recordsAlarmDismissed() async throws {
        let kitID = UUID().uuidString
        // 관찰자가 이미 울림을 봤다(= 행이 ringing) — 울림을 또 적지 않는다.
        let record = armedRecord(alarmKitID: kitID, state: .ringing)
        store.upsert(record)

        _ = try await StopAlarmIntent(alarmID: kitID).perform()

        // 알람 id 로 적힌다 — AlarmKit UUID 가 아니다(서버는 우리 id 를 안다).
        XCTAssertEqual(recorded.map(\.0), [.alarmDismissed])
        XCTAssertEqual(recorded.first?.1, record.id)
    }

    func test_stopIntent_recordsRingWhenObserverMissedIt() async throws {
        // 밤새 앱이 죽어 있었으면 `.alerting` 을 본 사람이 없다 — 행이 ringing 이 아니다.
        // 그때 해제만 적으면 **울림 없는 해제**가 남아 통계가 기운다.
        let kitID = UUID().uuidString
        let record = armedRecord(alarmKitID: kitID)
        store.upsert(record)

        _ = try await StopAlarmIntent(alarmID: kitID).perform()

        XCTAssertEqual(recorded.map(\.0), [.alarmRang, .alarmDismissed])
        XCTAssertEqual(recorded.first?.1, record.id)
    }

    func test_snoozeIntent_recordsAlarmSnoozed() async throws {
        let kitID = UUID().uuidString
        let record = armedRecord(alarmKitID: kitID, state: .ringing)
        store.upsert(record)

        _ = try await SnoozeAlarmIntent(alarmID: kitID, snoozeMinutes: 5).perform()

        XCTAssertEqual(recorded.map(\.0), [.alarmSnoozed])
        XCTAssertEqual(recorded.first?.1, record.id)
    }

    func test_snoozeIntent_limitReached_recordsSnoozedOnly() async throws {
        // 다시 울림이 꺼진 알람 — 인텐트는 알람을 끝내지만, 사건은 '다시 울림을 눌렀다'
        // 하나다(안드로이드도 이때 해제를 따로 적지 않는다).
        let kitID = UUID().uuidString
        store.upsert(armedRecord(alarmKitID: kitID, canSnooze: false, state: .ringing))

        _ = try await SnoozeAlarmIntent(alarmID: kitID, snoozeMinutes: 5).perform()

        XCTAssertEqual(recorded.map(\.0), [.alarmSnoozed])
    }

    func test_stopIntent_noContext_stillRecordsDismissed() async throws {
        // 락스크린 콜드 부팅 — Scene 의 .task 가 아직 안 돌아 컨텍스트가 없다.
        // 그래도 **누른 사실**은 남아야 한다(식별자는 못 붙일 뿐이다).
        AlarmAppContext.shared = nil

        _ = try await StopAlarmIntent(alarmID: UUID().uuidString).perform()

        // 행을 못 찾으면 관찰자도 없었다는 뜻이라 울림도 함께 적는다(식별자는 못 붙인다).
        XCTAssertEqual(recorded.map(\.0), [.alarmRang, .alarmDismissed])
        XCTAssertNil(recorded.first?.1)
    }

    func test_snoozeIntent_storeNotLoaded_stillRecordsSnoozed() async throws {
        // 저장소에 그 알람이 아직 없다(디스크 로드 전). 다시 울림 판단은 .unknown 으로
        // 이미 이 창을 인정하고 있으므로, 기록도 같은 태도여야 한다.
        _ = try await SnoozeAlarmIntent(alarmID: UUID().uuidString, snoozeMinutes: 5).perform()

        XCTAssertEqual(recorded.map(\.0), [.alarmRang, .alarmSnoozed])
        XCTAssertNil(recorded.first?.1)
    }

    func test_handleAlarmStopped_alone_recordsNothing() async throws {
        // 스위치를 끄거나 알람을 지우면 '목록에서 사라짐' 루프가 이 함수를 부른다 —
        // 거기서 해제를 적으면 누른 적 없는 해제가 기록된다.
        let kitID = UUID().uuidString
        store.upsert(armedRecord(alarmKitID: kitID))

        await ctx.handleAlarmStopped(alarmKitIDString: kitID)

        XCTAssertTrue(recorded.isEmpty)
    }
}
