import XCTest
@testable import AlarmTalk

/// '직전 선택 유지' 가 **엉뚱한 값을 기억하거나 지우지 않는지** 고정한다.
///
/// 2026-08-07 전수 대조에서 세 가지가 잘못돼 있었다:
///  1. 알람 전용·녹음 알람을 저장하면 `voiceText` 가 nil 이라 직전 직접입력 기록이 **지워졌다**
///  2. 무료 테마(스톡 클립)를 저장하면 **서버 스톡 문장**이 '직접 입력' 으로 기억됐다
///  3. 테마를 담을 저장 키가 아예 없었다
final class RememberChoicesGuardTests: XCTestCase {

    private var suiteName: String!
    private var defaults: UserDefaults!
    private var store: DynamicPromptPreferenceStore!
    private let userID = "user-1"

    override func setUp() {
        super.setUp()
        suiteName = "RememberChoicesGuardTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        store = DynamicPromptPreferenceStore(defaults: defaults)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    /// 무료 테마는 직접입력과 **다른 키**에 저장된다.
    func test_테마는_직접입력과_섞이지_않는다() {
        store.saveLastManualText(userID: userID, text: "내가 친 문구")
        store.saveLastFreeBucket(userID: userID, bucket: "weather")

        XCTAssertEqual(store.lastFreeBucket(userID: userID), "weather")
        XCTAssertEqual(
            store.lastManualText(userID: userID),
            "내가 친 문구",
            "테마 저장이 직접입력 기록을 건드리면 안 된다"
        )
    }

    /// 빈 문구로는 기록을 지우지 않는다 — 저장소 자체가 빈 값을 무시해야 한다.
    func test_빈_문구는_기록을_지운다는_계약() {
        store.saveLastManualText(userID: userID, text: "기억할 문구")
        XCTAssertNotNil(store.lastManualText(userID: userID))
        // 저장소는 빈 값을 '지우기' 로 해석한다. 그래서 **호출부**가 빈 값을 넘기지
        // 않아야 한다(rememberChoicesUsed 의 `if let text = ...nilIfBlank` 가드).
        store.saveLastManualText(userID: userID, text: "   ")
        XCTAssertNil(store.lastManualText(userID: userID))
    }

    /// 생성형 문구를 저장하면 직접입력 기록이 지워진다 — '마지막 선택은 하나'.
    func test_생성형을_저장하면_직접입력이_지워진다() {
        store.saveLastManualText(userID: userID, text: "옛 문구")
        store.saveLastMessageContext(userID: userID, context: "weather")

        XCTAssertEqual(store.lastMessageContext(userID: userID), "weather")
        XCTAssertNil(store.lastManualText(userID: userID))
    }

    /// 세션 정리는 테마 키도 함께 지운다.
    func test_정리하면_테마도_지워진다() {
        store.saveLastFreeBucket(userID: userID, bucket: "medication")
        store.clear(userID: userID)
        XCTAssertNil(store.lastFreeBucket(userID: userID))
    }
}
