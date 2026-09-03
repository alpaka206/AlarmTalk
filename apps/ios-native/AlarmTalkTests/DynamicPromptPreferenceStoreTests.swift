import XCTest
@testable import AlarmTalk

/// `DynamicPromptPreferenceStore` — 새 알람 편집기의 「직전 선택 유지」 저장소.
///
/// 안드로이드 `DynamicPromptPreferenceStoreTest` 와 같은 축을 본다.
/// **키 이름이 안드로이드와 같아야 한다** — 같은 규약을 두 앱이 각자 구현하는 것이라,
/// 이름이 갈리면 문서가 가리키는 곳이 둘이 된다.
final class DynamicPromptPreferenceStoreTests: XCTestCase {

    private var defaults: UserDefaults!
    private var suiteName: String!
    private var store: DynamicPromptPreferenceStore!
    private let userID = "user-1"

    override func setUp() {
        super.setUp()
        suiteName = "DynamicPromptPreferenceStoreTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        store = DynamicPromptPreferenceStore(defaults: defaults)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    // MARK: - 기본

    func test_emptyByDefault() {
        XCTAssertNil(store.lastMessageContext(userID: userID))
        XCTAssertNil(store.lastManualText(userID: userID))
    }

    func test_keysMatchAndroid() {
        store.saveLastMessageContext(userID: userID, context: "cheer")
        XCTAssertEqual(defaults.string(forKey: "last_message_context_user-1"), "cheer")

        store.saveLastManualText(userID: userID, text: "일어나")
        XCTAssertEqual(defaults.string(forKey: "last_manual_text_user-1"), "일어나")
    }

    // MARK: - 마지막 선택은 하나

    /// 생성형 문구를 저장하면 직접 입력 기록이 **지워진다.**
    /// 별도 '어느 쪽이 마지막' 플래그를 두지 않는 것이 규약이다 — 플래그와 값이
    /// 어긋나는 상태 자체를 없앤다.
    func test_savingContext_clearsManualText() {
        store.saveLastManualText(userID: userID, text: "일어나")
        XCTAssertNotNil(store.lastManualText(userID: userID))

        store.saveLastMessageContext(userID: userID, context: "fortune")

        XCTAssertEqual(store.lastMessageContext(userID: userID), "fortune")
        XCTAssertNil(store.lastManualText(userID: userID), "생성형을 저장하면 직접 입력 기록은 지워진다")
    }

    /// 반대 방향도 같다 — `last_manual_text` 가 차 있다 = 마지막이 직접 입력이었다.
    func test_savingManualText_clearsContext() {
        store.saveLastMessageContext(userID: userID, context: "weather")
        XCTAssertNotNil(store.lastMessageContext(userID: userID))

        store.saveLastManualText(userID: userID, text: "출근해야지")

        XCTAssertEqual(store.lastManualText(userID: userID), "출근해야지")
        XCTAssertNil(store.lastMessageContext(userID: userID))
    }

    // MARK: - 빈 값

    func test_blankValuesClearInsteadOfStoring() {
        store.saveLastMessageContext(userID: userID, context: "cheer")
        store.saveLastMessageContext(userID: userID, context: "   ")
        XCTAssertNil(store.lastMessageContext(userID: userID))

        store.saveLastManualText(userID: userID, text: "일어나")
        store.saveLastManualText(userID: userID, text: "")
        XCTAssertNil(store.lastManualText(userID: userID))
    }

    /// 빈 직접 입력을 저장할 때는 문구 종류를 지우지 않는다 — 지우면 아무것도 안 남아
    /// 새 알람이 폴백으로 열린다(사용자는 아무것도 안 바꿨는데 취향을 잃는다).
    func test_blankManualText_doesNotClearContext() {
        store.saveLastMessageContext(userID: userID, context: "medication")
        store.saveLastManualText(userID: userID, text: "  ")
        XCTAssertEqual(store.lastMessageContext(userID: userID), "medication")
    }

    // MARK: - 계정 분리

    func test_perUserIsolation() {
        store.saveLastMessageContext(userID: "a", context: "cheer")
        store.saveLastMessageContext(userID: "b", context: "weather")

        XCTAssertEqual(store.lastMessageContext(userID: "a"), "cheer")
        XCTAssertEqual(store.lastMessageContext(userID: "b"), "weather")
    }

    func test_nilOrBlankUserID_isNoOp() {
        store.saveLastMessageContext(userID: nil, context: "cheer")
        store.saveLastMessageContext(userID: "   ", context: "cheer")
        XCTAssertNil(store.lastMessageContext(userID: nil))
        XCTAssertNil(store.lastMessageContext(userID: "   "))
    }

    // MARK: - 세션 정리

    /// 명시적 로그아웃·탈퇴에서만 지운다. 자동 401 에서 지우면 같은 사람이 다시
    /// 로그인할 때 취향을 잃는다(안드로이드에서 실제로 회귀했던 지점).
    func test_clear_removesBothKeysForThatUserOnly() {
        store.saveLastMessageContext(userID: "a", context: "cheer")
        store.saveLastManualText(userID: "b", text: "일어나")

        store.clear(userID: "a")

        XCTAssertNil(store.lastMessageContext(userID: "a"))
        XCTAssertEqual(store.lastManualText(userID: "b"), "일어나", "다른 계정 값은 남는다")
    }
}

/// last-used 목소리가 **온보딩 완료 판정과 분리**돼 있는지.
final class DefaultVoicePreferenceStoreLastUsedTests: XCTestCase {

    private var defaults: UserDefaults!
    private var suiteName: String!
    private var store: DefaultVoicePreferenceStore!

    override func setUp() {
        super.setUp()
        suiteName = "DefaultVoiceLastUsedTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        store = DefaultVoicePreferenceStore(defaults: defaults)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    /// ⚠ **핵심 계약**: last-used 를 기록해도 온보딩이 '완료' 로 바뀌면 안 된다.
    /// `default_voice_<uid>` 는 `hasChosen` → `hasCompletedSetup` → `RootView` 로 이어져
    /// 온보딩을 건너뛸지 정하는 키다. 알람 저장이 그걸 덮으면 온보딩을 안 본 사용자가
    /// 갑자기 완료 상태가 된다.
    func test_lastUsedVoice_doesNotAffectOnboardingCompletion() {
        XCTAssertFalse(store.hasCompletedSetup(userID: "u1"))

        store.setLastUsedVoiceId(userID: "u1", voiceId: "clone-abc")

        XCTAssertEqual(store.lastUsedVoiceId(userID: "u1"), "clone-abc")
        XCTAssertFalse(store.hasChosen(userID: "u1"), "온보딩 기본 목소리는 여전히 미선택")
        XCTAssertFalse(store.hasCompletedSetup(userID: "u1"), "온보딩 완료로 바뀌면 안 된다")
        XCTAssertNil(store.defaultVoiceId(userID: "u1"))
    }

    func test_lastUsedVoice_usesSeparateKey() {
        store.setLastUsedVoiceId(userID: "u1", voiceId: "clone-abc")
        XCTAssertEqual(defaults.string(forKey: "last_voice_u1"), "clone-abc")
        XCTAssertNil(defaults.string(forKey: "default_voice_u1"))
    }

    func test_lastUsedVoice_blankClears() {
        store.setLastUsedVoiceId(userID: "u1", voiceId: "clone-abc")
        store.setLastUsedVoiceId(userID: "u1", voiceId: "  ")
        XCTAssertNil(store.lastUsedVoiceId(userID: "u1"))
    }

    func test_clear_removesLastUsedToo() {
        store.setDefaultVoiceId(userID: "u1", voiceId: "system-1")
        store.setLastUsedVoiceId(userID: "u1", voiceId: "clone-abc")

        store.clear(userID: "u1")

        XCTAssertNil(store.lastUsedVoiceId(userID: "u1"))
        XCTAssertNil(store.defaultVoiceId(userID: "u1"))
    }
}
