import XCTest
@testable import AlarmTalk

/// **같은 매니페스트를 되풀이해 받지 않게 하는 가드 둘**(2026-09-29 효율 감사 M1 — iOS).
///
/// - 재바인딩 진행 중 가드(`StockReplacementStatus.beginRebind`) — 콜드 스타트에 언어 키 `.task` 와
///   전경 복귀가 `AlarmTalkApp.rebindStockClipsIfNeeded` 를 거의 동시에 불러 두 회차가 나란히 돌았다.
/// - 준비 화면의 3초 폴링 종료 조건(`ClipPreparationView.pollingCanStop`) — 끝낼 조건이 없어 "준비됐어요"
///   를 띄운 채 매니페스트·렌더 상태를 계속 다시 받았다.
@MainActor
final class StockClipRefetchGuardTests: XCTestCase {

    // MARK: - 재바인딩 진행 중 가드

    func test_같은_키의_재바인딩이_돌고_있으면_물러나고_끝나면_다시_받는다() {
        let status = StockReplacementStatus.shared
        let key = "guard-\(UUID().uuidString)|ko"
        XCTAssertTrue(status.beginRebind(key: key))
        XCTAssertTrue(status.working, "도는 동안 차단 화면의 '다시 시도' 를 잠근다")
        XCTAssertFalse(status.beginRebind(key: key), "같은 계정·언어의 두 번째 호출은 물러난다 — 도는 회차가 같은 일을 한다")
        status.endRebind(key: key)
        XCTAssertFalse(status.working)
        XCTAssertTrue(status.beginRebind(key: key), "끝난 뒤의 호출(다음 전경 복귀)은 다시 돈다")
        status.endRebind(key: key)
        XCTAssertFalse(status.working)
    }

    /// 계정 전환·언어 변경은 키가 달라 막지 않는다. 그리고 **먼저 끝난 회차가 `working` 을 내리지 않는다** —
    /// 예전에는 두 회차가 나란히 돌 때 먼저 끝난 쪽이 내려, 다른 회차가 도는 중에 '다시 시도' 가 풀렸다.
    func test_다른_키는_막지_않고_working_은_모든_회차가_끝나야_내린다() {
        let status = StockReplacementStatus.shared
        let account = "guard-\(UUID().uuidString)"
        let korean = "\(account)|ko"
        let english = "\(account)|en"
        XCTAssertTrue(status.beginRebind(key: korean))
        XCTAssertTrue(status.beginRebind(key: english), "언어가 바뀌면 새 언어의 회차가 따로 돈다")
        status.endRebind(key: korean)
        XCTAssertTrue(status.working, "다른 회차가 아직 돈다")
        status.endRebind(key: english)
        XCTAssertFalse(status.working)
    }

    /// 물러난 쪽은 **도는 회차가 끝날 때까지 기다린다**(합류, 코덱스 #827) — 전경 복귀는 재바인딩 뒤에
    /// 보충을 시작하므로, 곧바로 돌아오면 도는 회차의 강제 조회가 공개되기 전에 매니페스트를 또 받는다.
    func test_물러난_호출은_도는_회차가_끝날_때까지_기다린다() async {
        let status = StockReplacementStatus.shared
        let key = "guard-\(UUID().uuidString)|ko"
        await status.waitForRebind(key: key) // 도는 회차가 없으면 곧바로 돌아온다

        XCTAssertTrue(status.beginRebind(key: key))
        XCTAssertFalse(status.beginRebind(key: key))
        let joined = JoinedFlag()
        let waiter = Task { @MainActor in
            await status.waitForRebind(key: key)
            joined.value = true
        }
        for _ in 0..<20 { await Task.yield() }
        XCTAssertFalse(joined.value, "도는 회차가 끝나기 전에는 돌아오지 않는다")
        status.endRebind(key: key)
        await waiter.value
        XCTAssertTrue(joined.value, "회차가 끝나면 깨어난다")
        XCTAssertFalse(status.working)
    }

    // MARK: - 준비 화면 폴링 종료

    func test_준비_화면_폴링은_다_받고_관문_목록에도_실린_뒤에만_멈춘다() {
        XCTAssertTrue(ClipPreparationView.pollingCanStop(isReady: true, awaitingOwner: false, targetClipsLoaded: true))
        XCTAssertFalse(
            ClipPreparationView.pollingCanStop(isReady: false, awaitingOwner: false, targetClipsLoaded: true),
            "아직 받는 중·서버 생성 실패(준비 안 됨)는 계속 묻는다 — 실패로는 멈추지 않는다"
        )
        XCTAssertFalse(
            ClipPreparationView.pollingCanStop(isReady: true, awaitingOwner: true, targetClipsLoaded: true),
            "공유받은 목소리의 소유자 생성을 기다리는 중이면 다른 목소리가 다 됐어도 계속 묻는다"
        )
        XCTAssertFalse(
            ClipPreparationView.pollingCanStop(isReady: true, awaitingOwner: false, targetClipsLoaded: false),
            "관문이 보는 매니페스트에 그 목소리가 아직 없으면 다음 회차가 다시 맞춘다"
        )
    }
}

/// 기다리던 쪽이 깨어났는가 — 메인 액터에서만 읽고 쓴다.
@MainActor
private final class JoinedFlag {
    var value = false
}
