import XCTest
@testable import AlarmTalk

#if DEBUG
/// **진행률을 한 번 묻는 데 캐시 디렉터리를 한 번만 훑는다**(2026-09-21, ALARMTALK-IOS-3 후속).
///
/// 고치기 전 `StockClipPrefetcher.missingClips` 는 클립 하나당 `AudioCacheStore.cachedURL` 을
/// **두 번**(존재 확인 + `isStale`) 불렀고, 그 함수는 부를 때마다 디렉터리를 통째로 훑는다 —
/// 클립 76개면 한 번 세는 데 전량 스캔 152회다. 그걸 부르는 자리가 전부 메인 액터다:
/// 2초 폴링(`Views/Auth/StockReplacementView`), 1.5초 폴링(`ClonePrerenderDrive`),
/// 목소리 목록 본문(`Views/Voices/VoiceProfileManagementPanel`), 그리고 프리페치 배치마다의
/// 진행률 갱신(`StockClipPrefetcher.run`). 전경 정체를 만드는 실제 경로였다.
///
/// 이 테스트는 **스캔 횟수**(`AudioCacheScanCounter`)로 그 회귀를 고정한다. 함께 고정하는 것
/// 둘: 세는 **값이 그대로일 것**(퍼센트가 뒤로 가거나 100% 에 못 닿으면 안 된다), 그리고
/// **memo 를 얹지 않을 것**(방금 받은 클립이 다음 질문에서 곧바로 보여야 한다).
///
/// ⚠ **횟수는 `measuringScans` 로 잰다 — 프로세스 전역 카운터가 아니다.** 유닛 테스트는
/// **호스트 앱 프로세스**에서 돌고, `AlarmTalkApp` 이 루트 뷰의 `.task` 에서 세션과 무관하게
/// `Task.detached { sweepStaleCache(...) }` 를 띄운다. 그것도 같은 목록 함수를 부르므로,
/// 전역 숫자를 읽던 예전 방식은 그 청소가 초기화와 단언 **사이에** 한 번만 끼어들어도
/// 깨졌다(재현 안 되는 실패). `@TaskLocal` 관측자는 재는 쪽의 작업 범위만 보고,
/// `Task.detached` 는 태스크 로컬을 물려받지 않아 구조적으로 새지 않는다.
@MainActor
final class StockClipProgressScanTests: XCTestCase {

    private var directory: URL!

    /// ⚠ **디렉터리를 비우는 것이 다른 테스트·앱과 부딪히지 않는 근거 둘.**
    /// 1. 여기서 여는 것은 사용자 캐시가 아니라 **테스트 전용 디렉터리**다
    ///    (`TestIsolation.storageSuffix` — `AudioCacheRoundTripTests` 의 `TestIsolationTests`
    ///    가 그 갈림을 고정한다). 기기의 스톡 클립은 이 비우기에 지워지지 않는다.
    /// 2. XCTest 는 한 프로세스 안에서 테스트를 **하나씩** 돌리므로 다른 테스트의 파일과
    ///    겹치지 않고, 같은 디렉터리를 쓰는 `StockAudioPruneTests` 도 자기 setUp 에서 같은
    ///    비우기를 한다. 호스트 앱의 `sweepStaleCache` 는 `stock_` 접두 파일을 **일부러
    ///    건너뛰므로**(iOS 는 한 번 지우면 다시 받을 길이 좁다) 여기 깔아 둔 것을 치우지 않는다.
    override func setUpWithError() throws {
        directory = try AudioCacheStore.audioDirectory()
        for name in (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? [] {
            try? FileManager.default.removeItem(at: directory.appendingPathComponent(name))
        }
    }

    /// 매니페스트가 주는 모양 그대로 — 기본(시스템) 목소리의 무료 테마 클립 한 건.
    private func stockClip(_ messageId: String, audioUrl: String?) -> StockClip {
        StockClip(
            messageId: messageId,
            voiceProfileId: "system-voice",
            voiceName: nil,
            category: "weather",
            language: "ko",
            text: "오늘은 맑아요",
            audioUrl: audioUrl,
            variant: nil,
            renderedForCurrentVoice: nil
        )
    }

    /// 받아 둔 클립 한 건(본체 + 메타 사이드카)을 캐시에 놓는다.
    /// `rawAudioUri` 가 nil 이면 **세대 표식이 없는 옛 캐시**다.
    private func putCachedClip(messageId: String, rawAudioUri: String?) throws {
        let key = AudioCacheStore.stockCacheKey(messageId: messageId)
        let safeKey = AudioCacheStore.safeCacheKey(key)
        try Data("audio".utf8).write(to: directory.appendingPathComponent("\(safeKey).mp3"))
        try AudioCacheStore.shared.writeMetadata(
            AudioCacheMetadata(
                cacheKey: key,
                source: "tts",
                mimeType: "audio/mpeg",
                durationMs: 1_000,
                createdAtMillis: 0,
                messageId: messageId,
                rawAudioUri: rawAudioUri
            )
        )
    }

    func test_클립이_몇_개든_전량_스캔은_한_번이다() throws {
        let clips = (0..<12).map { stockClip("msg-\($0)", audioUrl: "https://r2.example/\($0).mp3") }
        for clip in clips.prefix(5) {
            try putCachedClip(messageId: clip.messageId, rawAudioUri: clip.audioUrl)
        }

        let (missing, scans) = AudioCacheScanCounter.measuringScans {
            StockClipPrefetcher.missingClips(clips)
        }

        // 세는 값은 그대로다 — 받아 둔 다섯은 빠진 목록에서 빠진다.
        XCTAssertEqual(missing.count, 7)
        XCTAssertEqual(
            Set(missing.map(\.messageId)),
            Set((5..<12).map { "msg-\($0)" })
        )
        // 고치기 전에는 클립당 2회 = 24회였다.
        XCTAssertEqual(scans, 1, "클립 수와 무관하게 디렉터리는 한 번만 훑어야 한다")
    }

    /// ⚠ **진짜 불변식은 '클립 수와 무관' 이다.** 숫자 1 만 재면 "클립당 한 번"(= 8개면 8회)
    /// 으로 되돌아가도 8개짜리 테스트 하나는 통과할 수 있다. 개수를 다섯 배로 벌려 **같은
    /// 횟수**인지로 못 박는다.
    func test_클립_수를_다섯_배로_늘려도_스캔_횟수는_같다() throws {
        let few = (0..<8).map { stockClip("few-\($0)", audioUrl: "https://r2.example/few-\($0).mp3") }
        let many = (0..<40).map { stockClip("many-\($0)", audioUrl: "https://r2.example/many-\($0).mp3") }
        // 절반은 이미 받아 둔다 — 캐시에 있는 갈래도 추가 스캔을 부르지 않아야 한다.
        for clip in many.prefix(20) {
            try putCachedClip(messageId: clip.messageId, rawAudioUri: clip.audioUrl)
        }

        let (fewMissing, fewScans) = AudioCacheScanCounter.measuringScans {
            StockClipPrefetcher.missingClips(few)
        }
        let (manyMissing, manyScans) = AudioCacheScanCounter.measuringScans {
            StockClipPrefetcher.missingClips(many)
        }

        XCTAssertEqual(fewMissing.count, 8)
        XCTAssertEqual(manyMissing.count, 20)
        XCTAssertEqual(fewScans, manyScans, "클립이 다섯 배가 됐는데 스캔이 늘었다 = 다시 클립당 훑고 있다")
        XCTAssertEqual(manyScans, 1)
    }

    /// ⚠ **memo 를 얹으면 여기서 깨진다.** 진행률은 받는 도중에 계속 물어보는 값이라,
    /// 목록을 메모리에 이고 있으면 방금 받은 클립이 다음 회차에 안 보여 **퍼센트가 그
    /// 자리에 멈춘다**(완료 판정도 영영 안 선다).
    func test_방금_받은_클립은_다음_질문에서_곧바로_보인다() throws {
        let clip = stockClip("msg-fresh", audioUrl: "https://r2.example/fresh.mp3")

        XCTAssertEqual(StockClipPrefetcher.missingClips([clip]).count, 1)

        try putCachedClip(messageId: clip.messageId, rawAudioUri: clip.audioUrl)

        XCTAssertTrue(
            StockClipPrefetcher.missingClips([clip]).isEmpty,
            "받은 직후 같은 질문에 새 답이 나와야 한다"
        )
    }

    /// 낡음 판정(`AudioCacheStore.isStaleCachedFile`)의 뜻이 배치 질의에서도 같아야 한다.
    func test_주소가_바뀐_클립만_다시_받을_목록에_남는다() throws {
        // 교체됨 — 저장해 둔 주소와 매니페스트가 가리키는 주소가 다르다.
        try putCachedClip(messageId: "msg-replaced", rawAudioUri: "https://r2.example/old.mp3")
        let replaced = stockClip("msg-replaced", audioUrl: "https://r2.example/new.mp3")

        // 세대 표식이 없는 옛 캐시는 **모르는 것이지 낡은 것이 아니다** — 낡음으로 읽으면
        // 알람마다 네트워크를 타고 오프라인에서는 아예 못 쓴다.
        try putCachedClip(messageId: "msg-unknown", rawAudioUri: nil)
        let unknown = stockClip("msg-unknown", audioUrl: "https://r2.example/whatever.mp3")

        // 서버가 주소를 안 준 클립도 판단 근거가 없으므로 다시 받지 않는다.
        try putCachedClip(messageId: "msg-no-url", rawAudioUri: "https://r2.example/kept.mp3")
        let noURL = stockClip("msg-no-url", audioUrl: nil)

        let missing = StockClipPrefetcher.missingClips([replaced, unknown, noURL])

        XCTAssertEqual(missing.map(\.messageId), ["msg-replaced"])
    }

    /// 아무것도 안 받아 둔 상태에서도 스캔은 한 번이고, 전부 '빠짐' 이다.
    func test_하나도_없으면_전부_빠진_것으로_세고_스캔은_한_번이다() throws {
        let clips = (0..<8).map { stockClip("msg-empty-\($0)", audioUrl: "https://r2.example/\($0).mp3") }

        let (missing, scans) = AudioCacheScanCounter.measuringScans {
            StockClipPrefetcher.missingClips(clips)
        }

        XCTAssertEqual(missing.count, 8)
        XCTAssertEqual(scans, 1)
    }

    /// 물어볼 것이 없으면 디스크를 건드리지 않는다(매니페스트가 비었을 때의 경로).
    func test_빈_목록은_디스크를_건드리지_않는다() {
        let (missing, scans) = AudioCacheScanCounter.measuringScans {
            StockClipPrefetcher.missingClips([])
        }

        XCTAssertTrue(missing.isEmpty)
        XCTAssertEqual(scans, 0)
    }

    /// ⚠ **관측자는 재는 범위 밖으로 새지 않는다.** 이 줄이 무너지면(=다시 전역 카운터가
    /// 되면) 호스트 앱이 배경에서 돌리는 캐시 청소가 위 단언들에 섞여 든다.
    func test_재는_범위_밖의_스캔은_세지_않는다() throws {
        let clips = (0..<4).map { stockClip("leak-\($0)", audioUrl: "https://r2.example/leak-\($0).mp3") }

        // 범위 **밖**에서 미리 한 번 훑어 둔다.
        _ = StockClipPrefetcher.missingClips(clips)

        let (_, scans) = AudioCacheScanCounter.measuringScans {
            StockClipPrefetcher.missingClips(clips)
        }
        XCTAssertEqual(scans, 1, "바깥에서 난 스캔이 섞이면 이 값이 2가 된다")

        // 범위를 벗어난 뒤의 스캔도 그 관측자에 쌓이지 않는다.
        let (observer, insideScans) = AudioCacheScanCounter.measuringScans {
            AudioCacheScanCounter.current
        }
        XCTAssertEqual(insideScans, 0)
        _ = StockClipPrefetcher.missingClips(clips)
        XCTAssertEqual(observer?.count, 0, "범위를 벗어난 뒤의 스캔까지 쌓이면 앱의 배경 청소가 섞여 든다")
    }
}
#endif
