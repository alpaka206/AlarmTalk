import XCTest
@testable import AlarmTalk

/// 사용 기록 2판의 콘텐츠 종류(`docs/spec/usage-events.md` §7.1) — 싣는 칸이 정해진 칸 하나뿐이고 문구 ID 같은 원문이
/// 끼어들 자리가 없는가, 그리고 저장 성공 때만 적는가. 안드로이드 짝은 `ContentSignalsTest`·`ContentSignalWiringTest`.
final class ContentSignalsTests: XCTestCase {
    private func cheerAlarm(mode: String?, playMode: AlarmPlayMode = .voiceOnly, bucket: String? = CheerVariety.bucketID) -> LocalAlarmRecord {
        var record = LocalAlarmRecord(
            label: "",
            hour: 7,
            minute: 0,
            fireAtMillis: 1_800_000_000_000,
            repeatDaysMask: 0b1111111,
            playMode: playMode.rawValue,
            voiceProfileId: "70000000-0000-4000-9000-000000000102",
            voiceLanguage: "ko",
            createdAtMillis: 1,
            updatedAtMillis: 1
        )
        record.bucketId = bucket
        record.cheerMode = mode
        record.cheerPinnedContentId = mode == CheerMode.pinned.rawValue ? "cheer_v2_05" : nil
        return record
    }

    private func keys(_ props: UsageEventProps) throws -> Set<String> {
        let data = try JSONEncoder().encode(props)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        return Set(object.keys)
    }

    func test_cheerModeMapsToContentMode() {
        XCTAssertEqual(CheerVariety.contentSelectionProps(for: cheerAlarm(mode: "pinned"))?.contentMode, .fixed)
        XCTAssertEqual(CheerVariety.contentSelectionProps(for: cheerAlarm(mode: "vary"))?.contentMode, .varied)
        // 모르는 저장값은 다양하게로 읽는다(`CheerMode.normalize`).
        XCTAssertEqual(CheerVariety.contentSelectionProps(for: cheerAlarm(mode: "something"))?.contentMode, .varied)
    }

    func test_notACheerAlarmIsNotRecorded() {
        XCTAssertNil(CheerVariety.contentSelectionProps(for: cheerAlarm(mode: "pinned", bucket: "weather")))
        XCTAssertNil(CheerVariety.contentSelectionProps(for: cheerAlarm(mode: nil)))
        // iOS 알람 전용은 테마를 남긴다 — 응원을 울리지 않으니 적지 않는다(안드로이드는 이때 모드를 저장하지 않는다).
        XCTAssertNil(CheerVariety.contentSelectionProps(for: cheerAlarm(mode: "vary", playMode: .alarmOnly)))
    }

    func test_contentSelectionCarriesOnlyTheMode() throws {
        let props = try XCTUnwrap(CheerVariety.contentSelectionProps(for: cheerAlarm(mode: "pinned")))
        // 고정한 문구 ID 는 싣지 않는다 — 담을 정해진 칸이 없다.
        XCTAssertEqual(try keys(props), ["content_mode"])
        XCTAssertEqual(props.sanitized(), props)
    }

    /// 저장이 **성공한 뒤에만**, 저장을 시작한 계정으로 적는다 — 예약 실패·롤백 갈래(`return false`)보다 뒤다.
    func test_contentSelectedIsRecordedOnlyAfterSaveSucceeds() throws {
        let source = try AppSourceText.read("Views/Editor/AlarmEditorSheet.swift")
        XCTAssertEqual(source.components(separatedBy: ".contentSelected").count - 1, 1, "기록 자리는 한 곳이다")
        let body = String(try AppSourceText.region(of: source, from: "func finishScheduling(", to: "private func recordSaveUsageEvent("))
        let record = try XCTUnwrap(body.range(of: ".contentSelected"))
        let lastFailure = try XCTUnwrap(body.range(of: "return false", options: .backwards))
        XCTAssertLessThan(lastFailure.upperBound, record.lowerBound)
        XCTAssertTrue(body.contains("let ownerID = auth.session?.user.id"))
        XCTAssertTrue(body[record.lowerBound...].contains("userID: ownerID"))
    }

    // MARK: - 팩 목소리 사용(`pack_selected`)

    private let packVoiceID = voicePackVoiceIDPrefix + "0000000000aa"

    private var heldPacks: [HeldVoicePack] {
        [HeldVoicePack(
            packId: "first-pack", voiceId: packVoiceID, speakerName: "화자", language: "ko", description: "", usageNote: "",
            contentRevision: 1, latestRevision: 1, clips: [], state: .ready, previewClipId: nil, withdrawnPlaybackUntil: nil
        )]
    }

    func test_packSelectionCarriesOnlyThePackID() throws {
        var record = cheerAlarm(mode: nil, bucket: "weather")
        record.voiceProfileId = packVoiceID
        let props = try XCTUnwrap(VoicePacks.packSelectionProps(for: record, held: heldPacks))
        XCTAssertEqual(try keys(props), ["pack_id"], "문구·클립 id 같은 원문이 끼어들 칸이 없다")
        XCTAssertEqual(props.packID, "first-pack")
    }

    func test_packSelectionIsNotRecordedWhenThePackVoiceDoesNotSpeak() {
        var record = cheerAlarm(mode: nil, bucket: "weather")
        XCTAssertNil(VoicePacks.packSelectionProps(for: record, held: heldPacks), "팩 목소리가 아니다")
        record.voiceProfileId = packVoiceID
        XCTAssertNil(VoicePacks.packSelectionProps(for: record, held: []), "그 계정이 받은 팩이 아니다")
        var alarmOnly = record
        alarmOnly.playMode = AlarmPlayMode.alarmOnly.rawValue
        XCTAssertNil(VoicePacks.packSelectionProps(for: alarmOnly, held: heldPacks), "알람 모드는 팩 목소리로 울지 않는다")
        var recorded = record
        recorded.voiceSource = VoiceSource.localAudio.rawValue
        XCTAssertNil(VoicePacks.packSelectionProps(for: recorded, held: heldPacks), "직접 녹음은 팩 목소리가 아니다")
    }

    /// 응원 선택과 같은 자리 — 저장이 **성공한 뒤에만**, 저장을 시작한 계정으로.
    func test_packSelectedIsRecordedOnlyAfterSaveSucceeds() throws {
        let source = try AppSourceText.read("Views/Editor/AlarmEditorSheet.swift")
        XCTAssertEqual(source.components(separatedBy: ".packSelected").count - 1, 1, "기록 자리는 한 곳이다")
        let body = String(try AppSourceText.region(of: source, from: "func finishScheduling(", to: "private func recordSaveUsageEvent("))
        let record = try XCTUnwrap(body.range(of: ".packSelected"))
        let content = try XCTUnwrap(body.range(of: ".contentSelected"))
        let lastFailure = try XCTUnwrap(body.range(of: "return false", options: .backwards))
        XCTAssertLessThan(lastFailure.upperBound, record.lowerBound)
        XCTAssertLessThan(content.upperBound, record.lowerBound, "응원 선택 옆이다")
        XCTAssertTrue(body[record.lowerBound...].contains("userID: ownerID"))
        XCTAssertTrue(body.contains("voicePacks.activeUserID == ownerID"), "팩 목록은 저장을 시작한 계정의 것만 본다")
    }
}
