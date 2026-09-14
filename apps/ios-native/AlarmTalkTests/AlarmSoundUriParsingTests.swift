import XCTest
@testable import AlarmTalk

/// **저장된 알람음 값이 파일 URL 로 읽혀야 한다.**
///
/// 2026-08-16 실기기에서 잡은 버그: 알람음 픽커는 `/Library/Ringtones/Alarm.m4r` 같은
/// **맨 경로**를 저장하는데, 판정이 `URL(string:)` 하나로 되어 있었다. 스킴이 없는
/// 문자열은 상대 URL 이 되어 `isFileURL` 이 false 라 — **스테이징은 멀쩡히 되는데**
/// 판정만 `systemDefault` 로 떨어져 고른 벨소리가 조용히 기본음으로 울렸다.
///
/// 화면에는 체크가 켜져 있고 미리듣기도 나오므로, 이 버그는 **알람이 실제로 울릴 때만**
/// 드러난다. 그래서 순수 함수로 못 박는다.
@MainActor
final class AlarmSoundUriParsingTests: XCTestCase {

    func test_맨_경로도_파일_URL_로_읽는다() {
        let url = AlarmSoundResolver.fileURL(forStoredURI: "/Library/Ringtones/Alarm.m4r")
        XCTAssertEqual(url?.path, "/Library/Ringtones/Alarm.m4r")
        XCTAssertEqual(url?.isFileURL, true)
    }

    func test_file_스킴도_그대로_읽는다() {
        let url = AlarmSoundResolver.fileURL(forStoredURI: "file:///Library/Ringtones/Apex.m4r")
        XCTAssertEqual(url?.path, "/Library/Ringtones/Apex.m4r")
    }

    /// 안드로이드에서 동기화된 `content://` 는 이 기기에 없는 파일이다 — 기본음으로 가야 한다.
    func test_안드로이드_content_URI_는_받지_않는다() {
        XCTAssertNil(AlarmSoundResolver.fileURL(forStoredURI: "content://media/internal/audio/media/57"))
    }

    func test_빈_값은_nil() {
        XCTAssertNil(AlarmSoundResolver.fileURL(forStoredURI: nil))
        XCTAssertNil(AlarmSoundResolver.fileURL(forStoredURI: ""))
    }
}
