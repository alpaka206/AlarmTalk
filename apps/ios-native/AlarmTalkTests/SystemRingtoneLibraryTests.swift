import XCTest
@testable import AlarmTalk

/// 알람음 목록이 **시계 앱의 알람 사운드 목록과 같은 구성**인지 지킨다.
///
/// 시뮬레이터에는 `/Library/Ringtones` 가 없어 목록이 비므로 그때는 건너뛴다 — 이 검사는
/// 실기기에서 의미가 있다.
///
/// 2026-08-17 실기기 대조(iPhone 14 Pro / iOS 26):
///   벨소리 파일 85 = 클래식 53 + `-EncoreInfinitum` 25 + `-EncoreRemix` 7
///   시계 앱 알람 목록 79 = 최신 26(Infinitum 25 + Little Bird) + 클래식 53
@MainActor
final class SystemRingtoneLibraryTests: XCTestCase {

    private func requireDevice() throws {
        try XCTSkipIf(SystemRingtoneLibrary.entries.isEmpty, "기기에 벨소리가 없다(시뮬레이터)")
    }

    func test_알림음은_목록에_없다() throws {
        try requireDevice()
        // 시계 앱 알람 목록에는 알림음 구역이 아예 없다 — 우리도 벨소리만 낸다.
        let alertTones = SystemRingtoneLibrary.entries.filter {
            $0.url.path.hasPrefix("/System/Library/Audio/UISounds")
        }
        XCTAssertTrue(alertTones.isEmpty, "알림음이 섞여 있다: \(alertTones.map(\.name))")
    }

    func test_통화용_리믹스는_빠지고_작은새는_남는다() throws {
        try requireDevice()
        let files = SystemRingtoneLibrary.entries.map { $0.url.deletingPathExtension().lastPathComponent }
        for excluded in ["Buoyant-EncoreRemix", "Dreamer-EncoreRemix", "Pond-EncoreRemix",
                         "Pop-EncoreRemix", "Reflected-EncoreRemix", "Surge-EncoreRemix"] {
            XCTAssertFalse(files.contains(excluded), "\(excluded) 은 시계 앱 알람 목록에 없다")
        }
        // ⚠ 리믹스를 통째로 거르면 이게 사라진다 — 시계 앱은 '작은새' 를 알람음으로 준다.
        XCTAssertTrue(files.contains("Little Bird-EncoreRemix"), "Little Bird 가 빠졌다")
    }

    func test_이름에_파일_꼬리표가_남지_않는다() throws {
        try requireDevice()
        let leaked = SystemRingtoneLibrary.entries.filter { $0.name.contains("-Encore") }
        XCTAssertTrue(leaked.isEmpty, "파일 이름이 그대로 보인다: \(leaked.map(\.name))")
    }

    /// ⚠ 보이는 이름으로 중복을 지우면 `Reflection` 이 최신·클래식 양쪽에 있어 한 쪽이
    /// 조용히 사라진다(그래서 79개가 78개가 됐다). 파일 수와 목록 수가 같아야 한다.
    func test_파일_하나도_잃지_않는다() throws {
        try requireDevice()
        let files = ((try? FileManager.default.contentsOfDirectory(atPath: "/Library/Ringtones")) ?? [])
            .filter { $0.hasSuffix(".m4r") && !$0.hasPrefix(".") }
        let excluded = 6  // 통화용 리믹스(위 테스트)
        XCTAssertEqual(
            SystemRingtoneLibrary.entries.count, files.count - excluded,
            "벨소리 파일 \(files.count)개 중 \(SystemRingtoneLibrary.entries.count)개만 목록에 올랐다"
        )
    }

    func test_최신이_먼저_클래식이_나중이다() throws {
        try requireDevice()
        let entries = SystemRingtoneLibrary.entries
        let firstClassic = entries.firstIndex(where: \.isClassic) ?? entries.count
        let lastModern = entries.lastIndex(where: { !$0.isClassic }) ?? -1
        XCTAssertLessThan(lastModern, firstClassic, "클래식이 최신 벨소리 사이에 섞여 있다")
        print("[RINGTONES] 최신 \(SystemRingtoneLibrary.modernEntries.count)개 + 클래식 \(SystemRingtoneLibrary.classicEntries.count)개 = \(entries.count)개")
    }
}
