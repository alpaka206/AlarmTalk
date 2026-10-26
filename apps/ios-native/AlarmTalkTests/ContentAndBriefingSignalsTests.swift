import XCTest
@testable import AlarmTalk

/// 사용 기록 2판의 콘텐츠·소식 종류(`docs/spec/usage-events.md` §7.1) — 싣는 칸이 정해진 칸 하나뿐이고 문구 ID·링크·
/// 제목 같은 원문이 끼어들 자리가 없는가, 그리고 저장 성공 때만 적는가. 안드로이드 짝은 `ContentAndBriefingSignalsTest`·
/// `ContentAndBriefingSignalWiringTest`.
final class ContentAndBriefingSignalsTests: XCTestCase {
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

    func test_briefingPropsCarryOnlyTheSourceKind() throws {
        for source in BriefingSource.allCases {
            let props = BriefingUsageSignals.sourceProps(source)
            XCTAssertEqual(props.sanitized(), props, "서버 코드 모양 안이어야 한다")
            XCTAssertEqual(try keys(props), ["surface"])
        }
        XCTAssertEqual(BriefingSource.disclosure.rawValue, "disclosure")
        XCTAssertEqual(BriefingSource.policyNews.rawValue, "policy_news")
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

    func test_briefingRecordsNeverTakeTheLinkOrText() throws {
        let source = try AppSourceText.read("Views/Settings/BriefingView.swift")
        let opened = source.components(separatedBy: "BriefingUsageSignals.sourceOpened(").dropFirst()
        XCTAssertEqual(opened.count, 1)
        for call in opened {
            let args = call.prefix(while: { $0 != ")" })
            XCTAssertEqual(String(args), "source, userID: auth.session?.user.id")
        }
        let generate = String(try AppSourceText.region(of: source, from: "private func generate() async", to: "private func play("))
        let requested = try XCTUnwrap(generate.range(of: "BriefingUsageSignals.audioRequested(target.source, voiceID: voiceID,"))
        let call = try XCTUnwrap(generate.range(of: "AlarmTalkAPI.shared.generateTTS("))
        XCTAssertLessThan(requested.lowerBound, call.lowerBound, "요청을 보내기 전에 적는다")
    }
}
