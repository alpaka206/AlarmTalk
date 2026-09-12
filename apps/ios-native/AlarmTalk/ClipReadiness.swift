import Foundation

/// **"알람을 만들 준비가 됐는가"** 를 한 값으로 계산한다.
///
/// 사용자에게는 '서버가 만드는 중' 과 '폰이 받는 중' 이 구분되지 않는다. 둘을 합쳐 하나의
/// 진행률로 보여 주기 위한 계산이 여기 있다(화면은 이 값을 그리기만 한다).
///
/// ⚠ **개수를 앱에 박지 않는다.** 기준은 서버 매니페스트(`ExpectedVariantCounts`)이고,
/// 앱은 그것과 **디스크에 실제로 있는 것**을 비교해 부족분만 센다. 운영이 시드를 늘리면
/// (예: 날씨 9 → 11) 앱 업데이트 없이 그 2개가 '부족' 으로 잡혀야 한다.
/// 그리고 **기본 목소리와 등록 목소리는 개수가 다르다** — 목소리 종류로 갈라 본다.
enum ClipReadiness {

    /// 한 목소리의 준비 상태.
    struct VoiceProgress: Equatable, Identifiable {
        var voiceProfileID: String
        /// 서버가 아직 만들고 있는가(클론 사전렌더 큐).
        var isRendering: Bool
        /// 서버가 만들다 실패했는가 — 재시도 대상.
        var renderFailed: Bool
        /// 이 목소리가 완전하려면 있어야 할 클립 수(서버 기준).
        var expected: Int
        /// 그중 **디스크에 실제로 있는** 클립 수.
        var cached: Int

        var id: String { voiceProfileID }
        var missing: Int { max(expected - cached, 0) }
        var isReady: Bool { expected > 0 && missing == 0 && !isRendering && !renderFailed }
    }

    /// 전체 진행률(0.0~1.0). **생성과 다운로드를 합친다.**
    ///
    /// 아직 서버가 만들고 있는 목소리는 그 몫이 통째로 남은 것으로 센다 — 사용자에게는
    /// '만드는 중' 도 '받는 중' 도 똑같이 기다리는 시간이다.
    static func progress(_ voices: [VoiceProgress]) -> Double {
        let expected = voices.reduce(0) { $0 + $1.expected }
        guard expected > 0 else { return 1 }
        let done = voices.reduce(0) { partial, voice in
            // 렌더 중이면 아직 받을 수 있는 것이 없다(매니페스트에 안 올라와 있다).
            partial + (voice.isRendering ? 0 : voice.cached)
        }
        return min(Double(done) / Double(expected), 1)
    }

    /// 퍼센트 표시용 정수(0~100). **100% 는 진짜 다 됐을 때만** 나오게 내림한다 —
    /// 99.6% 가 100% 로 보이면 사용자는 끝난 줄 알고 나간다.
    static func percent(_ voices: [VoiceProgress]) -> Int {
        let ratio = progress(voices)
        if ratio >= 1 { return 100 }
        return min(Int(ratio * 100), 99)
    }

    static func isReady(_ voices: [VoiceProgress]) -> Bool {
        !voices.isEmpty && voices.allSatisfy { $0.isReady }
    }

    /// 매니페스트 + 캐시 상태로 목소리별 준비도를 만든다.
    ///
    /// - Parameters:
    ///   - voiceProfileIDs: 준비 대상 목소리(기본 목소리 전부 + 내가 등록한 것. 공유받은
    ///     목소리는 **고를 때** 대상이 되므로 호출자가 넣고 뺀다).
    ///   - expectedVariants: 서버가 내려준 카테고리별 세트 크기.
    ///   - isSystemVoice: 그 목소리가 기본(시스템) 목소리인가 — 개수 표가 갈린다.
    ///   - categories: 그 목소리에서 준비해야 할 카테고리(기본 목소리는 무료 테마만,
    ///     클론은 매니페스트에 있는 전부).
    ///   - isCached: 캐시 키가 디스크에 있는가.
    static func evaluate(
        voiceProfileIDs: [String],
        clips: [StockClip],
        expectedVariants: ExpectedVariantCounts?,
        isSystemVoice: (String) -> Bool,
        categories: (String) -> [String],
        renderState: (String) -> (rendering: Bool, failed: Bool),
        isCached: (StockClip) -> Bool
    ) -> [VoiceProgress] {
        voiceProfileIDs.map { voiceID in
            let system = isSystemVoice(voiceID)
            let wanted = categories(voiceID)
            var expected = 0
            var cached = 0
            for category in wanted {
                guard let full = expectedVariants?.count(category: category, isSystemVoice: system), full > 0 else {
                    continue
                }
                expected += full
                // 한 카테고리 안에서 **같은 variant 를 두 번 세지 않는다.** 언어가 섞여
                // 내려오면 같은 자리가 여러 번 잡혀 '다 받았다' 로 읽힌다.
                let have = Set(
                    clips
                        .filter { $0.voiceProfileId == voiceID && $0.category == category && isCached($0) }
                        .compactMap { $0.variant }
                        .filter { $0 < full }
                )
                cached += have.count
            }
            let state = renderState(voiceID)
            return VoiceProgress(
                voiceProfileID: voiceID,
                isRendering: state.rendering,
                renderFailed: state.failed,
                expected: expected,
                cached: cached
            )
        }
    }
}
