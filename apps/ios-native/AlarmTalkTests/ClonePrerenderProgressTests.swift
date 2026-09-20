import XCTest
@testable import AlarmTalk

/// **등록한 목소리의 진행률은 하나다** — 서버 생성 0~50%, 기기 다운로드 50~100%.
///
/// 단계마다 따로 세면 생성이 끝나는 순간 100% 에서 0% 로 되돌아가 **진행이 후퇴한 것처럼**
/// 보인다(안드로이드 `CloneVoiceReadiness` 주석이 같은 이유를 적고 있다). 이 테스트가
/// 그 이어 붙임을 고정한다.
final class ClonePrerenderProgressTests: XCTestCase {

    private func percent(
        generated: Int = 0,
        generationTotal: Int = 21,
        downloaded: Int = 0,
        downloadTotal: Int = 0,
        phase: ClonePrerenderDrive.Phase
    ) -> Int {
        ClonePrerenderDrive.mergedPercent(
            generated: generated,
            generationTotal: generationTotal,
            downloaded: downloaded,
            downloadTotal: downloadTotal,
            phase: phase
        )
    }

    func test_생성_구간은_0에서_50까지만_쓴다() {
        XCTAssertEqual(percent(generated: 0, phase: .generating), 0)
        XCTAssertEqual(percent(generated: 21, phase: .generating), 50)
        // 21개 중 10개 → 절반의 절반 남짓.
        XCTAssertEqual(percent(generated: 10, phase: .generating), 23)
    }

    func test_다운로드_구간은_50에서_시작해_100에서_끝난다() {
        XCTAssertEqual(percent(downloaded: 0, downloadTotal: 21, phase: .downloading), 50)
        XCTAssertEqual(percent(downloaded: 21, downloadTotal: 21, phase: .downloading), 100)
        XCTAssertEqual(percent(downloaded: 11, downloadTotal: 21, phase: .downloading), 76)
    }

    func test_생성에서_다운로드로_넘어갈_때_뒤로_가지_않는다() {
        let lastOfGeneration = percent(generated: 21, phase: .generating)
        let firstOfDownload = percent(downloaded: 0, downloadTotal: 21, phase: .downloading)
        XCTAssertEqual(lastOfGeneration, 50)
        XCTAssertEqual(firstOfDownload, 50)
        XCTAssertGreaterThanOrEqual(firstOfDownload, lastOfGeneration)
    }

    func test_전체_개수를_모르면_0이다_100이_아니다() {
        // ⚠ 매니페스트에 아직 이 목소리가 없을 때 100% 로 보이면 "다 됐다" 로 읽혀
        //   사용자가 화면을 닫는다 — 실제로는 아무것도 준비되지 않았다.
        XCTAssertEqual(percent(generated: 0, generationTotal: 0, phase: .generating), 0)
        XCTAssertEqual(percent(downloaded: 0, downloadTotal: 0, phase: .downloading), 50)
    }

    func test_값이_범위를_벗어나도_0에서_100_안에_머문다() {
        XCTAssertEqual(percent(generated: -3, phase: .generating), 0)
        XCTAssertEqual(percent(generated: 99, phase: .generating), 50)
        XCTAssertEqual(percent(downloaded: 99, downloadTotal: 21, phase: .downloading), 100)
    }

    func test_실패는_생성_몫만_남기고_다운로드를_세지_않는다() {
        XCTAssertEqual(percent(downloaded: 10, downloadTotal: 21, phase: .failed), 50)
    }
}
