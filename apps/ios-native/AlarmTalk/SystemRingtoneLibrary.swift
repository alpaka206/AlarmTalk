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
/// 2026-08-17 전수 확인(같은 기기) — 합쳐서 **102개**가 목록에 오른다:
/// - `/Library/Ringtones`(85, `.m4r`) = **시스템 벨소리 그 자체**다. 시계·설정 앱이 내주는
///   목록과 같은 파일이라 이름이 하나하나 대응한다 — 시계 앱 알람음의 Radar·Apex·Beacon·
///   Bulletin·By The Seaside·Chimes·Circuit·Constellation·Cosmic·Crystals·Hillside·
///   Illuminate·Night Owl·Opening·Playtime·Presto·Radiate·Reflection·Ripples·Sencha·
///   Signal·Silk·Slow Rise·Stargaze·Summit·Twinkle·Uplift·Waves 가 전부 여기 있다.
///   여기에 옛 벨소리(Marimba·Old Phone·Bark·Duck…)와 iOS 26 의 새 변주
///   (`-EncoreInfinitum`/`-EncoreRemix`)가 함께 들어 있고, `Alarm.m4r` 도 있다.
/// - `/System/Library/Audio/UISounds/New`(17, `.caf`) = **알림음**(Anticipate·Bloom·
///   Calypso·Choo Choo·…). 벨소리보다 짧다.
/// - `/System/Library/Audio/UISounds`(97) 는 **훑지 않는다.** 키보드 탭·잠금·결제음 같은
///   UI 효과음이라 알람음으로 내놓을 것이 아니다(`directories` 에 넣지 말 것).
///
/// 같은 날 함께 잰 것 — 알림음을 목록에 둘지 판단한 근거다:
/// - **애플 시계 앱의 알람 사운드 목록에는 알림음이 없다.** 실기기에서 그 화면을 열어
///   읽어 보니 새 벨소리 25종 + `클래식` + `없음` 뿐이고, `알림음` 구역 자체가 없었다.
///   (설정 앱의 벨소리·문자음 목록에는 있다 — **알람에만 안 준다.**)
/// - 길이: 벨소리 85개는 중앙값 10.6초(2.7~68.1), 알림음 17개는 **중앙값 2.2초**(0.9~7.0).
/// - AlarmKit 은 짧은 파일을 **반복 재생한다**(1초짜리를 걸고 10초를 녹음했더니 끝까지
///   소리가 이어졌다 — `AlarmSoundAcousticProbe`). 즉 짧아도 '한 번 삑' 은 아니다.
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
        /// 사람이 읽는 이름 — 확장자와 `-Encore…` 꼬리표를 떼고 밑줄을 공백으로.
        let name: String
        /// 시계 앱의 `클래식` 안에 있는 옛 벨소리인가.
        let isClassic: Bool

        var id: String { url.path }
    }

    /// 훑는 디렉터리 — **벨소리 하나뿐**이다.
    ///
    /// ⚠ **알림음(`/System/Library/Audio/UISounds/New`)을 다시 넣지 말 것**(2026-08-17).
    /// 시계 앱의 알람 사운드 목록에 **알림음 구역이 없다**(실기기에서 그 화면을 읽었다).
    /// 설정 앱의 벨소리·문자음 목록에는 있으니 없어서 못 주는 게 아니라 **알람에만 안 주는**
    /// 것이다. 길이도 다르다 — 알림음 중앙값 2.2초(최소 0.9초) vs 벨소리 10.6초.
    private static let directories = [
        "/Library/Ringtones",
    ]

    /// 시계 앱 알람 목록에 **없는** 벨소리. 통화용 리믹스로 보인다.
    ///
    /// 실기기 대조(2026-08-17): 벨소리 85개 = 클래식 53 + `-EncoreInfinitum` 25 +
    /// `-EncoreRemix` 7. 시계 앱 알람 목록은 **79개**(최신 26 + 클래식 53)였고, 리믹스
    /// 7개 중 `Little Bird` 하나만 그 안에 있었다(`작은새`). 나머지 여섯이 이 목록이다.
    /// ⚠ `-EncoreRemix` 를 통째로 거르면 `Little Bird` 까지 사라져 애플 목록과 어긋난다.
    private static let excludedBaseNames: Set<String> = [
        "Buoyant-EncoreRemix",
        "Dreamer-EncoreRemix",
        "Pond-EncoreRemix",
        "Pop-EncoreRemix",
        "Reflected-EncoreRemix",
        "Surge-EncoreRemix",
    ]

    /// 알람음으로 쓸 만한 확장자. `.m4r` 은 벨소리, `.caf` 는 시스템 사운드다.
    private static let allowedExtensions: Set<String> = ["m4r", "caf", "aiff", "wav", "m4a"]

    /// ⚠ **한 번만 훑고 캐시한다.** 화면을 열 때마다 80개 넘는 파일을 stat 하면
    /// 목록이 눈에 띄게 늦게 뜬다.
    private static var cached: [Entry]?

    /// 최신 벨소리 먼저, 그 뒤에 클래식 — 시계 앱과 같은 순서다.
    static var entries: [Entry] {
        if let cached { return cached }
        let found = directories.flatMap { scan($0) }
        // ⚠ **보이는 이름으로 중복을 지우지 말 것**(2026-08-17). 디렉터리가 둘이던 시절의
        // 코드인데, 꼬리표를 떼고 나니 `Reflection.m4r`(클래식)과
        // `Reflection-EncoreInfinitum.m4r`(최신)이 같은 이름이 되어 **한 쪽이 조용히
        // 사라졌다**(79개가 78개로). 애플도 둘 다 준다 — 구역이 다르니 헷갈리지 않는다.
        var seen = Set<String>()
        let unique = found.filter { seen.insert($0.url.path).inserted }
        let byName: (Entry, Entry) -> Bool = {
            $0.name.localizedStandardCompare($1.name) == .orderedAscending
        }
        let ordered = unique.filter { !$0.isClassic }.sorted(by: byName)
            + unique.filter(\.isClassic).sorted(by: byName)
        cached = ordered
        return ordered
    }

    /// 시계 앱이 위쪽에 내주는 최신 벨소리.
    static var modernEntries: [Entry] { entries.filter { !$0.isClassic } }
    /// 시계 앱이 `클래식` 안에 넣어 둔 옛 벨소리.
    static var classicEntries: [Entry] { entries.filter(\.isClassic) }

    static func entry(forPath path: String?) -> Entry? {
        guard let path, !path.isEmpty else { return nil }
        return entries.first { $0.url.path == path || $0.url.absoluteString == path }
    }

    private static func scan(_ directory: String) -> [Entry] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory)) ?? []
        return names.compactMap { file -> Entry? in
            let url = URL(fileURLWithPath: directory).appendingPathComponent(file)
            guard allowedExtensions.contains(url.pathExtension.lowercased()) else { return nil }
            // 이름이 비거나 점으로 시작하는 숨김 파일은 거른다.
            let base = url.deletingPathExtension().lastPathComponent
            guard !base.isEmpty, !base.hasPrefix("."), !excludedBaseNames.contains(base) else { return nil }
            // ⚠ **`-Encore…` 꼬리표는 보여 주지 말 것.** 파일 이름일 뿐이고, 시계 앱은
            // 그냥 '걸음'·'골짜기' 로 부른다. 떼지 않으면 목록이 "Steps-EncoreInfinitum"
            // 처럼 읽힌다.
            let display = base
                .replacingOccurrences(of: "-EncoreInfinitum", with: "")
                .replacingOccurrences(of: "-EncoreRemix", with: "")
                .replacingOccurrences(of: "_", with: " ")
            return Entry(url: url, name: display, isClassic: !base.contains("-Encore"))
        }
    }
}
