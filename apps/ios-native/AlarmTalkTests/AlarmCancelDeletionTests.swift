import XCTest
@testable import AlarmTalk

/// **취소 실패가 삭제를 막으면 안 된다** — 2026-08-18 실기기 보고 회귀 테스트.
///
/// `AlarmManager.cancel(id:)` 은 그 id 를 AlarmKit 이 **모를 때 throw** 한다(이미 울리고 끝난
/// 알람, 이미 해제된 알람, 재설치로 남은 낡은 UUID). 예전에는 그때 로컬 행을 남겨서
/// 삭제 → "알람 취소에 실패했어요" → 목록에 그대로 → 또 삭제 … 로 **영영 지울 수 없는
/// 알람**이 됐다.
///
/// 반대쪽도 막아야 한다: OS 가 아직 들고 있는데 행만 지우면 **끌 수도 지울 수도 없는 알람**이
/// 울린다. 그래서 판정은 "AlarmKit 이 그 id 를 들고 있는가" 하나다.
final class AlarmCancelDeletionTests: XCTestCase {

    private let id = "11111111-1111-4111-8111-111111111111"
    private let other = "22222222-2222-4222-8222-222222222222"

    func testDeletesWhenAlarmKitNoLongerHoldsIt() {
        // 취소 실패의 대다수 — 이미 예약돼 있지 않다. 지워야 사용자가 원한 결과가 된다.
        XCTAssertTrue(
            AlarmKitViewModel.mayDeleteAfterCancelFailure(alarmKitID: id, scheduledIDs: [])
        )
        XCTAssertTrue(
            AlarmKitViewModel.mayDeleteAfterCancelFailure(alarmKitID: id, scheduledIDs: [other])
        )
    }

    func testKeepsRowWhenAlarmKitStillHoldsIt() {
        // 여기서 지우면 끌 수도 지울 수도 없는 알람이 울린다.
        XCTAssertFalse(
            AlarmKitViewModel.mayDeleteAfterCancelFailure(alarmKitID: id, scheduledIDs: [id])
        )
        XCTAssertFalse(
            AlarmKitViewModel.mayDeleteAfterCancelFailure(alarmKitID: id, scheduledIDs: [id, other])
        )
    }
}
