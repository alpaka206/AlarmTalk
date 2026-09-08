import XCTest
@testable import AlarmTalk

@MainActor
final class AlarmIntentsTests: XCTestCase {

    private var store: LocalAlarmStore!
    private var ctx: AlarmAppContext!
    /// 인텐트가 적은 사용 기록. 실제 큐 대신 여기로 받는다(디스크·키체인을 타지 않는다).
    private var recorded: [(UsageEventType, String?, String?)] = []
    /// 전역 훅을 갈아 끼우므로 원래대로 되돌려 놓는다 — 안 그러면 다른 테스트로 샌다.
    private var originalRecordUsageEvent: ((UsageEventType, LocalAlarmRecord?, String?) -> Void)!
    private var originalRearmCountdown: ((UUID) throws -> Void)!

    override func setUp() async throws {
        // 경로는 저장소에게 묻는다 — 손으로 조립하면 기기의 진짜 알람 파일을 지운다.
        try? FileManager.default.removeItem(at: LocalAlarmStore.defaultStorageURL())
        store = LocalAlarmStore()
        try? await Task.sleep(nanoseconds: 50_000_000)
        for r in store.alarms { store.delete(r) }
        ctx = AlarmAppContext(store: store)
        ObservedRingMarkerStore.reset()
        recorded = []
        originalRecordUsageEvent = AlarmAppContext.recordUsageEvent
        originalRearmCountdown = AlarmAppContext.rearmCountdown
        // 시뮬레이터에서 실제 AlarmKit 카운트다운을 걸 수 없으므로 성공으로 둔다.
        AlarmAppContext.rearmCountdown = { _ in }
        AlarmAppContext.recordUsageEvent = { [weak self] type, record, detail in
            self?.recorded.append((type, record?.id, detail))
        }
    }

    override func tearDown() async throws {
        ObservedRingMarkerStore.reset()
        AlarmAppContext.recordUsageEvent = originalRecordUsageEvent
        AlarmAppContext.rearmCountdown = originalRearmCountdown
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

    func test_snoozeIntent_defaultInit_emptyID() {
        let intent = SnoozeAlarmIntent()
        XCTAssertEqual(intent.alarmID, "")
    }

    func test_snoozeIntent_parameterInit_preservesID() {
        let uuid = UUID().uuidString
        let intent = SnoozeAlarmIntent(alarmID: uuid)
        XCTAssertEqual(intent.alarmID, uuid)
    }

    func test_snoozeIntent_perform_invalidUUID_returnsResult() async throws {
        let intent = SnoozeAlarmIntent(alarmID: "")
        _ = try await intent.perform()
    }

    // MARK: - 사용 기록 (안드로이드 RingingService.dismiss/snooze 미러)

    func test_stopIntent_recordsAlarmDismissed() async throws {
        let kitID = UUID().uuidString
        // 관찰자가 이미 울림을 적었다(표시가 남아 있다) — 울림을 또 적지 않는다.
        let record = armedRecord(alarmKitID: kitID, state: .ringing)
        store.upsert(record)
        ObservedRingMarkerStore.mark(alarmKitID: kitID)

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
        ObservedRingMarkerStore.mark(alarmKitID: kitID)

        _ = try await SnoozeAlarmIntent(alarmID: kitID).perform()

        XCTAssertEqual(recorded.map(\.0), [.alarmSnoozed])
        XCTAssertEqual(recorded.first?.1, record.id)
    }

    func test_snoozeIntent_limitReached_recordsDismissedWithReason() async throws {
        // 다시 울림이 꺼진 알람 — **미뤄지지 않는다.** 그때는 미룸이 아니라 종료를 적고,
        // 누른 사실은 `detail` 이 나른다(2026-09-07 리뷰 37차).
        let kitID = UUID().uuidString
        store.upsert(armedRecord(alarmKitID: kitID, canSnooze: false, state: .ringing))
        ObservedRingMarkerStore.mark(alarmKitID: kitID)

        _ = try await SnoozeAlarmIntent(alarmID: kitID).perform()

        XCTAssertEqual(recorded.map(\.0), [.alarmDismissed])
        XCTAssertEqual(recorded.first?.2, "snooze_denied")
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
        _ = try await SnoozeAlarmIntent(alarmID: UUID().uuidString).perform()

        XCTAssertEqual(recorded.map(\.0), [.alarmRang, .alarmSnoozed])
        XCTAssertNil(recorded.first?.1)
    }

    func test_stopIntent_coldRelaunch_doesNotDuplicateObservedRing() async throws {
        // 관찰자가 적은 **직후 프로세스가 죽고** 인텐트가 콜드로 깨어난 상황 — 행을 못 읽는다.
        // 행 상태로 가르던 시절에는 여기서 울림을 한 번 더 적었다(id 가 달라 서버도 못 지운다).
        let kitID = UUID().uuidString
        ObservedRingMarkerStore.mark(alarmKitID: kitID)
        AlarmAppContext.shared = nil

        _ = try await StopAlarmIntent(alarmID: kitID).perform()

        XCTAssertEqual(recorded.map(\.0), [.alarmDismissed])
    }

    func test_stopIntent_staleRingingRow_stillRecordsRing() async throws {
        // 앞 회차의 콜드 해제로 행에 `ringing` 이 남아 있는 상태. 그 낡은 상태로 가르면
        // 이번 회차의 **정당한 울림을 삼킨다** — 삼키는 쪽이 중복보다 나쁘다.
        let kitID = UUID().uuidString
        store.upsert(armedRecord(alarmKitID: kitID, state: .ringing))

        _ = try await StopAlarmIntent(alarmID: kitID).perform()

        XCTAssertEqual(recorded.map(\.0), [.alarmRang, .alarmDismissed])
    }

    func test_snoozeIntent_rearmFails_recordsDismissedNotSnoozed() async throws {
        // 재무장이 실패하면 **미룬 것이 아니다.** 행을 전진시키면 '5분 뒤 울림' 인데 OS 에는
        // 카운트다운이 없고, 어떤 복구 경로도 그 행을 후보로 보지 않아 조용히 안 울린다.
        struct RearmFailure: Error {}
        AlarmAppContext.rearmCountdown = { _ in throw RearmFailure() }
        let kitID = UUID().uuidString
        store.upsert(armedRecord(alarmKitID: kitID, state: .ringing))
        ObservedRingMarkerStore.mark(alarmKitID: kitID)

        _ = try await SnoozeAlarmIntent(alarmID: kitID).perform()

        XCTAssertEqual(recorded.map(\.0), [.alarmDismissed])
        XCTAssertEqual(recorded.first?.2, "snooze_failed")
    }

    func test_lateCommit_afterConsume_leavesNoMarker() async throws {
        // 콜백은 도착 시각에 상한이 없다 — 앱이 잠들면 몇 분 뒤에 온다. 그때 표시를 남기면
        // 아무도 소비하지 않아 **다음 회차의 정당한 울림을 삼킨다.**
        let kitID = UUID().uuidString
        let observation = ObservedRingMarkerStore.beginObservation(alarmKitID: kitID)
        XCTAssertNotNil(observation)

        // 그 사이에 사용자가 눌러 소비가 지나갔다.
        _ = ObservedRingMarkerStore.consume(alarmKitID: kitID)
        // 한참 뒤에 콜백이 도착한다(시각으로는 못 거르는 지점).
        ObservedRingMarkerStore.commit(
            alarmKitID: kitID,
            observation: observation!,
            now: Date().addingTimeInterval(600)
        )

        XCTAssertFalse(
            ObservedRingMarkerStore.consume(alarmKitID: kitID, now: Date().addingTimeInterval(600)),
            "늦게 온 커밋이 표시를 남기면 다음 울림이 삼켜진다"
        )
    }

    /// ⚠ **미래에 앉은 표시는 믿지 않는다**(리뷰 39차). 기기 시계가 뒤로 가면 `now - stamp`
    /// 가 음수라 6시간 창을 **언제나** 통과해, 어제 표시가 오늘의 정당한 울림을 삼킨다.
    func test_미래_표시는_이번_회차로_보지_않는다() {
        let kitID = UUID().uuidString
        // 시계가 3시간 앞선 상태에서 적혔다(그 뒤 보정으로 되돌아왔다).
        ObservedRingMarkerStore.mark(alarmKitID: kitID, now: Date().addingTimeInterval(3 * 3600))

        XCTAssertFalse(
            ObservedRingMarkerStore.consume(alarmKitID: kitID),
            "미래 표시를 이번 회차로 읽으면 울림 기록이 통째로 삼켜진다"
        )
    }

    /// 정리에서도 함께 걷어낸다 — 안 그러면 나이가 음수라 만료되지 않는다.
    func test_미래_표시는_정리에서_걷힌다() {
        let kitID = UUID().uuidString
        let other = UUID().uuidString
        ObservedRingMarkerStore.mark(alarmKitID: kitID, now: Date().addingTimeInterval(3 * 3600))
        // 다른 알람의 표시를 남기며 정리가 돌면, 미래 표시는 그때 걷힌다.
        ObservedRingMarkerStore.mark(alarmKitID: other)

        XCTAssertFalse(ObservedRingMarkerStore.consume(alarmKitID: kitID))
        XCTAssertTrue(ObservedRingMarkerStore.consume(alarmKitID: other), "멀쩡한 표시까지 걷었다")
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
