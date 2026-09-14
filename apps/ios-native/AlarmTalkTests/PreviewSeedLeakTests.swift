import XCTest
@testable import AlarmTalk

/// **화면 확인용 표본 알람이 사용자 계정으로 새어 나가지 않는다.**
///
/// 2026-08-17 실기기에서 잡힌 사고다. `-UIPreviewSeed` 가 심은 표본을 `alarmStore.upsert`
/// 로 넣었는데 그 저장소는 **디스크에 쓴다.** 표본이 기기에 남은 뒤 로그인한 채로 앱을
/// 켜면 push sync 가 그걸 사용자 알람으로 보고 서버에 올렸다:
///
///   · `preview-morning` — voiceProfileId 가 "preview-voice"(UUID 아님)라 서버가 매번
///     400 INVALID_VOICE_PROFILE_ID 로 거절 → "알람 변경사항 일부를 저장하지 못했어요"
///     안내가 회차마다 다시 떴다(실패한 건은 다음 회차에 또 걸린다).
///   · `preview-weekday` — 올라가는 데 **성공**해서, 앱을 켤 때마다 07:30 평일 알람이
///     계정에 하나씩 새로 생겼다(dev 계정에 11개, 대부분 켜진 채였다 — 실제로 울린다).
final class PreviewSeedLeakTests: XCTestCase {

    private func tempURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("preview-leak-\(UUID().uuidString).json")
    }

    func test_저장소에_남아_있던_표본_알람은_읽을_때_걸러진다() async throws {
        let url = tempURL()
        defer { try? FileManager.default.removeItem(at: url) }

        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var mine = LocalAlarmRecord(
            id: UUID().uuidString,
            label: "내 알람",
            hour: 7, minute: 0,
            fireAtMillis: now + 3_600_000,
            repeatDaysMask: 0,
            createdAtMillis: now, updatedAtMillis: now
        )
        mine.enabled = true

        let seeded = LocalAlarmRecord(
            id: LocalAlarmRecord.previewIDPrefix + "weekday",
            label: "평일 기상",
            hour: 7, minute: 30,
            fireAtMillis: now + 7_200_000,
            repeatDaysMask: 0,
            createdAtMillis: now, updatedAtMillis: now
        )

        // 쓰기는 동기·비동기가 같은 기록기를 거친다(늦은 옛 스냅샷이 새 파일을 덮지 않게).
        let persistence = LocalAlarmPersistence(
            storageURL: url,
            writer: LocalAlarmFileWriter(url: url)
        )
        await persistence.save([mine, seeded], seq: 1)

        let loaded = await persistence.load()
        XCTAssertEqual(loaded.map(\.id), [mine.id], "표본 알람이 그대로 읽혔다 — sync 가 이걸 서버에 올린다")
    }

    #if DEBUG
    func test_표본_알람_id_는_모두_접두사를_갖는다() {
        // 걸러내는 쪽이 id 접두사만 보므로, 표본 하나가 접두사 없이 만들어지면 그 알람은
        // 조용히 사용자 알람이 된다.
        let ids = UIPreviewSeed.makeAlarms().map(\.id)
            + [UIPreviewSeed.makeRingSoonAlarm(inSeconds: 30).id]
        for id in ids {
            XCTAssertTrue(
                id.hasPrefix(LocalAlarmRecord.previewIDPrefix),
                "표본 알람 id '\(id)' 에 접두사가 없다 — 저장소에서 걸러지지 않는다"
            )
        }
    }
    #endif
}
