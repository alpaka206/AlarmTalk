import XCTest
@testable import AlarmTalk

/// 다음 알람 상태 카드의 우선순위(`NextAlarmStatus.resolve`, v1.3 W06). 안드로이드 `NextAlarmStatusTest` 짝.
final class NextAlarmStatusTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let hour: TimeInterval = 3600

    private func alarm(voice: String? = systemVoiceIDPrefix + "000000000102", bucket: String? = "cheer", resolvedAt: Date? = nil) -> LocalAlarmRecord {
        var record = LocalAlarmRecord(
            id: UUID().uuidString, label: "", hour: 7, minute: 0,
            fireAtMillis: 0, createdAtMillis: 0, updatedAtMillis: 0
        )
        record.playMode = AlarmPlayMode.voiceOnly.rawValue
        record.voiceProfileId = voice
        record.bucketId = bucket
        record.contextResolvedAtMillis = resolvedAt.map { Int64($0.timeIntervalSince1970 * 1000) }
        return record
    }

    private func resolve(_ a: LocalAlarmRecord, fireIn: TimeInterval = 8 * 3600, authorized: Bool = true, downloading: Bool = false, endsAt: Date? = nil) -> NextAlarmStatus {
        NextAlarmStatus.resolve(alarm: a, nextFire: now.addingTimeInterval(fireIn), alarmAuthorized: authorized,
                                defaultVoiceDownloadInProgress: downloading, limitedPlanEndsAt: endsAt, now: now)
    }

    func test_permissionComesFirst() {
        XCTAssertEqual(resolve(alarm(), authorized: false, downloading: true), .permissionMissing)
    }

    func test_downloadOnlyMattersForDefaultVoices() {
        XCTAssertEqual(resolve(alarm(), downloading: true), .voicePreparing)
        XCTAssertEqual(resolve(alarm(voice: "clone"), downloading: true), .ready)
    }

    func test_weatherStaleOnlyWithinTheDayBefore() {
        let stale = alarm(bucket: "weather", resolvedAt: now.addingTimeInterval(-40 * hour))
        XCTAssertEqual(resolve(stale), .weatherStale)
        XCTAssertEqual(resolve(stale, fireIn: 48 * hour), .ready)
        XCTAssertEqual(resolve(alarm(bucket: "weather", resolvedAt: now.addingTimeInterval(-hour))), .ready)
        // 지금 기준으로 잰다 — 8시간 전에 받은 답은 23시간 뒤 알람이라도 새 답이다.
        XCTAssertEqual(resolve(alarm(bucket: "weather", resolvedAt: now.addingTimeInterval(-8 * hour)), fireIn: 23 * hour), .ready)
    }

    func test_registeredVoiceEndingBeforeTheAlarm() {
        let ends = now.addingTimeInterval(hour)
        XCTAssertEqual(resolve(alarm(voice: "clone", bucket: nil), endsAt: ends), .voiceEnding(ends))
        XCTAssertEqual(resolve(alarm(), endsAt: ends), .ready)
    }
}
