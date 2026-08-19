import XCTest
@testable import AlarmTalk

/// **읽기 새로고침과 사용자 쓰기는 서로 다른 플래그를 쓴다** — 회귀 방지.
///
/// 예전에는 두 뷰모델이 `isBusy` 하나만 두고, 화면 진입·전경 복귀·푸시가 돌리는
/// **읽기 새로고침**도 그 플래그를 올렸다. 쓰기 액션은 전부
/// `guard !isBusy else { return }` 로 조용히 물러서므로, 새로고침이 도는 동안
/// 사용자가 누른 버튼이 **아무 일도 안 하고 끝났다**(2026-08-10 사용자 보고).
/// 확인 알럿의 버튼은 `.disabled` 로 막을 수도 없어서 알럿만 닫혔다.
///
/// 안드로이드는 같은 문제를 먼저 겪고 갈라 두었다 —
/// `ui/main/MainViewModelBillingActions.kt` 의 `billingRefreshing` vs `billingBusy`.
///
/// ⚠ 이 테스트가 깨지면 **둘을 도로 합친 것**이다. 합치지 말 것.
@MainActor
final class BusyFlagSeparationTests: XCTestCase {

    /// 새로고침은 쓰기 플래그를 건드리지 않는다 — 세션이 없어 즉시 반환하는 경로에서도
    /// 마찬가지고, 무엇보다 **두 플래그가 별개의 저장소**여야 한다.
    func test_socialViewModel_새로고침플래그와_쓰기플래그는_별개다() async {
        let vm = SocialFeatureViewModel()

        XCTAssertFalse(vm.isBusy)
        XCTAssertFalse(vm.isRefreshing)

        // 쓰기 플래그를 올려도 읽기 플래그는 따라 올라가지 않는다.
        vm.isBusy = true
        XCTAssertFalse(vm.isRefreshing, "isRefreshing 이 isBusy 의 별칭이 되면 안 된다")
        vm.isBusy = false
    }

    func test_voiceStudioViewModel_새로고침플래그와_쓰기플래그는_별개다() async {
        let vm = VoiceStudioViewModel()

        XCTAssertFalse(vm.isBusy)
        XCTAssertFalse(vm.isRefreshing)

        vm.isBusy = true
        XCTAssertFalse(vm.isRefreshing, "isRefreshing 이 isBusy 의 별칭이 되면 안 된다")
        vm.isBusy = false
    }

    /// 세션 없이 부른 새로고침이 **쓰기 플래그를 남겨 두지 않는다**.
    /// 남으면 그 뒤의 모든 쓰기 액션이 영구히 막힌다.
    func test_세션없는_새로고침은_쓰기플래그를_남기지_않는다() async {
        let social = SocialFeatureViewModel()
        await social.refreshAll(session: nil)
        XCTAssertFalse(social.isBusy)
        XCTAssertFalse(social.isRefreshing)

        let voice = VoiceStudioViewModel()
        await voice.refresh(session: nil)
        XCTAssertFalse(voice.isBusy)
        XCTAssertFalse(voice.isRefreshing)
    }

    /// 로그인 없이 누른 목소리 쓰기 액션은 **조용히 끝나지 않고 이유를 남긴다**.
    /// 안드로이드가 같은 자리에서 `msg_voice_{delete,edit,share}_login_required` 를 띄운다.
    func test_로그인없는_목소리_쓰기액션은_안내를_남긴다() async {
        let profile = VoiceProfile(id: "voice-1", name: "엄마 목소리", status: "ready")

        let deleteVM = VoiceStudioViewModel()
        _ = await deleteVM.deleteProfile(profile, session: nil)
        XCTAssertNotNil(deleteVM.statusMessage, "삭제가 조용히 실패하면 안 된다")

        let renameVM = VoiceStudioViewModel()
        await renameVM.renameProfile(profile, newName: "아빠 목소리", session: nil)
        XCTAssertNotNil(renameVM.statusMessage, "이름 변경이 조용히 실패하면 안 된다")

        let shareVM = VoiceStudioViewModel()
        await shareVM.toggleShare(profile, isShared: true, session: nil)
        XCTAssertNotNil(shareVM.statusMessage, "공유 토글이 조용히 실패하면 안 된다")
    }
}
