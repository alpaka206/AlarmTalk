import XCTest
@testable import AlarmTalk

/// **`AlarmTalkMetadata` 는 프로세스 경계를 넘는다** — 앱이 인코딩하고 위젯이 디코딩한다
/// (`AlarmAttributes` 가 `Codable` 이라 AlarmKit 이 그렇게 나른다).
///
/// 손으로 적은 `CodingKeys` 에서 필드가 빠지면 **컴파일은 통과하고 값만 사라진다**.
/// 실제로 `hour`·`minute` 가 그래서 빠져 있었고, Live Activity 의 큰 시계가 한 번도
/// 그려지지 않았다(2026-09-08 실기기 지적). 왕복을 고정해 같은 사고를 막는다.
final class AlarmMetadataCodableTests: XCTestCase {

    func test_시각이_왕복에서_살아남는다() throws {
        let original = AlarmTalkMetadata(
            localAlarmID: "a",
            label: "아침",
            playMode: "voice_only",
            voiceCacheKey: "k",
            alarmKitID: UUID().uuidString,
            voiceText: "일어나",
            hour: 7,
            minute: 30
        )

        let round = try JSONDecoder().decode(
            AlarmTalkMetadata.self,
            from: JSONEncoder().encode(original)
        )

        XCTAssertEqual(round.hour, 7, "인코딩에서 빠지면 위젯이 시계를 못 그린다")
        XCTAssertEqual(round.minute, 30)
        XCTAssertEqual(round.clockLabel, original.clockLabel)
        XCTAssertEqual(round, original)
    }

    /// 옛 레코드(시각 필드가 없던 시절)는 그대로 읽혀야 한다 — 그때는 시계 없이 폴백한다.
    func test_시각이_없는_옛_레코드도_읽힌다() throws {
        let json = Data(#"{"localAlarmID":"a","label":"아침"}"#.utf8)

        let decoded = try JSONDecoder().decode(AlarmTalkMetadata.self, from: json)

        XCTAssertNil(decoded.clockLabel)
        XCTAssertEqual(decoded.label, "아침")
    }
}
