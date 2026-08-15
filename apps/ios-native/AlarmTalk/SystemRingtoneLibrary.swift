import Foundation

/// 기기에 들어 있는 알람음(벨소리) 목록.
///
/// ⚠ **이 경로는 공개 API 가 아니다 — 파일시스템을 직접 읽는다.** 2026-08-16 에 실기기
/// (iPhone 14 Pro, iOS 26)에서 앱 샌드박스 안에서 확인한 사실:
///
/// ```
/// /Library Ringtones            목록 가능 85개   Hillside.m4r, Illuminate.m4r, Timba.m4r …
/// /System/Library/Audio/UISounds/New   17개    Choo_Choo.caf, Fanfare.caf, Bloom.caf …
/// Hillside.m4r                  읽기 가능 34,286 bytes
/// 앱 컨테이너 Library/Sounds 로 복사   성공
/// ```
///
/// AlarmKit 은 `AlertConfiguration.AlertSound.named(_)` 로 **앱 번들 / 앱 컨테이너의
/// `Library/Sounds`** 만 본다(SDK 인터페이스에 `.default` 와 `.named(_)` 둘뿐). 그래서
/// 고른 파일을 `AlarmSoundStaging` 이 CAF 로 변환해 그 폴더에 넣고 이름으로 넘긴다.
///
/// ⚠ **애플 자산이다.** 기기 안에서 복사해 쓰는 것과 그 기능을 실은 앱이 심사를 통과하는
/// 것은 다른 문제다 — 리젝 위험을 알고 넣은 기능이다(2026-08-16 사용자 결정).
/// 목록이 비면 화면은 '기본 알람음' 하나로 조용히 되돌아간다(아래 `entries` 는 빈 배열).
@MainActor
enum SystemRingtoneLibrary {

    struct Entry: Identifiable, Equatable {
        /// 파일 경로 전체. 그대로 `alarmSoundUri` 에 저장한다.
        let url: URL
        /// 사람이 읽는 이름 — 확장자를 떼고 밑줄을 공백으로.
        let name: String

        var id: String { url.path }
    }

    /// 훑는 디렉터리. 앞쪽이 우선이다.
    private static let directories = [
        "/Library/Ringtones",
        "/System/Library/Audio/UISounds/New",
    ]

    /// 알람음으로 쓸 만한 확장자. `.m4r` 은 벨소리, `.caf` 는 시스템 사운드다.
    private static let allowedExtensions: Set<String> = ["m4r", "caf", "aiff", "wav", "m4a"]

    /// ⚠ **한 번만 훑고 캐시한다.** 화면을 열 때마다 100개 넘는 파일을 stat 하면
    /// 목록이 눈에 띄게 늦게 뜬다.
    private static var cached: [Entry]?

    static var entries: [Entry] {
        if let cached { return cached }
        let found = directories.flatMap { scan($0) }
        // 같은 이름이 두 디렉터리에 있으면 앞쪽(벨소리)을 남긴다.
        var seen = Set<String>()
        let unique = found.filter { seen.insert($0.name).inserted }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        cached = unique
        return unique
    }

    static func entry(forPath path: String?) -> Entry? {
        guard let path, !path.isEmpty else { return nil }
        return entries.first { $0.url.path == path || $0.url.absoluteString == path }
    }

    private static func scan(_ directory: String) -> [Entry] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory)) ?? []
        return names.compactMap { file in
            let url = URL(fileURLWithPath: directory).appendingPathComponent(file)
            guard allowedExtensions.contains(url.pathExtension.lowercased()) else { return nil }
            // 이름이 비거나 점으로 시작하는 숨김 파일은 거른다.
            let base = url.deletingPathExtension().lastPathComponent
            guard !base.isEmpty, !base.hasPrefix(".") else { return nil }
            return Entry(url: url, name: base.replacingOccurrences(of: "_", with: " "))
        }
    }
}
