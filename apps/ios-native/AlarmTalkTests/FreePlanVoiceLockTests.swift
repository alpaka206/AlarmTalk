import XCTest
@testable import AlarmTalk

/// 무료 전환 시 목소리 알람을 **지우지 않고 기본 목소리 알람으로 잠그는지** 고정하는 회귀 테스트.
///
/// 2026-08-07 이전 iOS 는 `alarmKit.cancel` 로 행과 음원을 **영구 삭제**했다.
/// 시각·반복·문구·목소리 선택이 전부 사라지고 재결제해도 돌아오지 않았다.
/// 2026-09-29 전에는 `alarm_only` 로 내려 목록·편집기에서 **그냥 기본 알람**이 됐다(dev 리허설 —
/// 안드로이드는 그 모양이 무음으로 울렸다). 이제 재생 방식은 그대로 두고 목소리만 기본 목소리로
/// 바꾼다 — `DefaultVoiceSubstitute.locked` / `restored`(안드로이드 `lockedToDefaultVoice` /
/// `restoredFromLock` 미러). 규칙: `docs/spec/billing-lifecycle.md` 「목소리를 못 쓰게 되면」.
final class FreePlanVoiceLockTests: XCTestCase {

    private let systemVoice = bundledSystemVoiceProfiles()[0].id

    private func cloneAlarm() -> LocalAlarmRecord {
        var record = LocalAlarmRecord(label: "t", hour: 7, minute: 0, fireAtMillis: 0, playMode: AlarmPlayMode.voiceOnly.rawValue)
        record.voiceProfileId = "clone-a"
        record.audioCacheKey = "stock_clone-greeting-0"
        record.localAudioUri = "stock_clone-greeting-0.mp3"
        record.ttsMessageId = "clone-greeting-0"
        record.bucketId = "greeting"
        record.voiceRandomContext = RandomPromptContext.preset.rawValue
        return record
    }

    /// 잠금은 원래 재생 방식·목소리를 보관하고 **목소리 모드 그대로** 기본 목소리로 바꾼다.
    func test_잠금은_원래값을_보관하고_기본_목소리로_바꾼다() {
        let record = cloneAlarm()
        XCTAssertNil(record.preLockPlayMode, "처음에는 잠긴 적이 없다")

        let locked = DefaultVoiceSubstitute.locked(record, voiceID: systemVoice, binding: nil, nowMillis: 1)

        XCTAssertEqual(locked.preLockPlayMode, AlarmPlayMode.voiceOnly.rawValue)
        XCTAssertEqual(locked.playMode, AlarmPlayMode.voiceOnly.rawValue, "'그냥 기본 알람' 이 되지 않는다")
        XCTAssertEqual(locked.voiceProfileId, systemVoice)
        XCTAssertEqual(locked.preLockVoice?.voiceProfileId, "clone-a")
        XCTAssertNil(locked.bucketId, "기본 목소리의 greeting 은 테마가 아니다")
        XCTAssertFalse(locked.isPaidVoiceForDowngrade, "이제 무료 기본 목소리 알람이다 — 다음 잠금 대상이 아니다")
    }

    /// ⚠ 두 번 잠가도 원래 값을 잃지 않는다.
    /// 이 가드가 없으면 두 번째 잠금이 보관본을 기본 목소리로 덮어써서 복원이 불가능해진다.
    func test_두번_잠가도_원래값을_잃지_않는다() {
        var record = cloneAlarm()
        for _ in 0..<2 {
            record = DefaultVoiceSubstitute.locked(record, voiceID: systemVoice, binding: nil, nowMillis: 1)
        }
        XCTAssertEqual(record.preLockPlayMode, AlarmPlayMode.voiceOnly.rawValue)
        XCTAssertEqual(record.preLockVoice?.voiceProfileId, "clone-a", "두 번째 잠금이 원래 값을 덮어쓰면 복원이 불가능해진다")
    }

    /// 옛 모양(`alarm_only` + `preLockPlayMode`)도 목소리 모드로 옮긴다.
    func test_옛_모양_잠금은_목소리_모드로_옮긴다() {
        var legacy = cloneAlarm()
        legacy.playMode = AlarmPlayMode.alarmOnly.rawValue
        legacy.preLockPlayMode = AlarmPlayMode.voiceOnly.rawValue

        let locked = DefaultVoiceSubstitute.locked(legacy, voiceID: systemVoice, binding: nil, nowMillis: 1)

        XCTAssertEqual(locked.playMode, AlarmPlayMode.voiceOnly.rawValue)
        XCTAssertEqual(locked.preLockPlayMode, AlarmPlayMode.voiceOnly.rawValue)
    }

    /// 복원은 원래 목소리로 되돌리고 표시를 지운다.
    func test_복원하면_원래_목소리로_돌아온다() {
        let original = cloneAlarm()
        let locked = DefaultVoiceSubstitute.locked(original, voiceID: systemVoice, binding: nil, nowMillis: 1)

        let restored = DefaultVoiceSubstitute.restored(locked, nowMillis: 2)

        XCTAssertEqual(restored.playMode, AlarmPlayMode.voiceOnly.rawValue)
        XCTAssertEqual(restored.voiceProfileId, original.voiceProfileId)
        XCTAssertEqual(restored.audioCacheKey, original.audioCacheKey)
        XCTAssertEqual(restored.ttsMessageId, original.ttsMessageId)
        XCTAssertEqual(restored.bucketId, original.bucketId)
        XCTAssertNil(restored.preLockPlayMode, "복원 뒤에는 잠금 표시가 남으면 안 된다")
        XCTAssertNil(restored.preLockVoice)
    }

    // MARK: - 잠긴 행의 오디오 참조 · 저장이 잠금을 잇는가 (Codex #820)

    /// 잠금은 원래 오디오를 `audioCacheKey` 에서 보관본으로 옮긴다 — 참조 개수가 그걸 안 세면 같은 클립을
    /// 쓰던 다른 알람을 지울 때 파일이 지워지고, 재결제로 복원한 알람은 들을 소리가 없다.
    /// 안드로이드 `AlarmDao.countByAudioCacheKey`(`preLockVoiceJson`) 짝.
    @MainActor
    func test_참조_개수는_잠금_보관본이_붙든_키도_센다() {
        let store = LocalAlarmStore(
            storageURL: FileManager.default.temporaryDirectory
                .appendingPathComponent("lock-refcount-\(UUID().uuidString).json"),
            loadFromDisk: false
        )
        var original = cloneAlarm()
        original.bucketClipKeys = ["stock_clone-greeting-0", "stock_clone-greeting-1"]
        store.upsert(DefaultVoiceSubstitute.locked(original, voiceID: systemVoice, binding: nil, nowMillis: 1))

        XCTAssertEqual(store.countByAudioCacheKey("stock_clone-greeting-0"), 1, "보관본의 대표 클립")
        XCTAssertEqual(store.countByAudioCacheKey("stock_clone-greeting-1"), 1, "보관본의 클립 세트")
        XCTAssertEqual(store.countByAudioCacheKey("stock_unrelated"), 0)
    }

    /// 테마를 남긴 채 오디오 없이 잠긴 행을 시각만 고쳐 저장하면, 편집기가 그 테마의 기본 목소리 클립을
    /// 받아 묶어 `audioCacheKey` 가 nil → 클립 키로 바뀐다. 그건 편집이 아니다 — 잠금을 잇는다.
    func test_같은_테마의_클립을_채운_저장은_잠금을_잇는다() {
        var weather = cloneAlarm()
        weather.bucketId = "weather"
        weather.voiceRandomContext = RandomPromptContext.wakeWeather.rawValue
        let locked = DefaultVoiceSubstitute.locked(weather, voiceID: systemVoice, binding: nil, nowMillis: 1)
        XCTAssertNil(locked.audioCacheKey, "전제 — 오디오 없이 잠겼다")
        XCTAssertEqual(locked.bucketId, "weather", "전제 — 테마는 남았다")

        var hydrated = locked
        hydrated.hour = 8
        hydrated.audioCacheKey = "stock_\(systemVoice)-weather-0"
        hydrated.bucketClipKeys = (0..<9).map { "stock_\(systemVoice)-weather-\($0)" }
        XCTAssertTrue(DefaultVoiceSubstitute.saveKeepsLock(saved: hydrated, editing: locked))

        var timeOnly = locked
        timeOnly.minute = 30
        XCTAssertTrue(DefaultVoiceSubstitute.saveKeepsLock(saved: timeOnly, editing: locked))

        var otherTheme = hydrated
        otherTheme.bucketId = "cheer"
        XCTAssertFalse(DefaultVoiceSubstitute.saveKeepsLock(saved: otherTheme, editing: locked), "테마를 바꾼 것은 편집이다")

        var otherVoice = hydrated
        otherVoice.voiceProfileId = bundledSystemVoiceProfiles()[1].id
        XCTAssertFalse(DefaultVoiceSubstitute.saveKeepsLock(saved: otherVoice, editing: locked))

        var alarmMode = timeOnly
        alarmMode.playMode = AlarmPlayMode.alarmOnly.rawValue
        XCTAssertFalse(DefaultVoiceSubstitute.saveKeepsLock(saved: alarmMode, editing: locked))

        // 이미 클립이 묶인 잠금에서 오디오가 바뀌면 편집이다(예전 규칙 그대로).
        var reAudio = hydrated
        reAudio.audioCacheKey = "stock_\(systemVoice)-weather-3"
        XCTAssertFalse(DefaultVoiceSubstitute.saveKeepsLock(saved: reAudio, editing: hydrated))
    }

    /// 잠긴 동안 지역을 고쳐 저장해도 잠금은 이어진다 — 그때 복원이 보관본의 옛 조건 자리·받은 시각을 되살리면
    /// 재결제한 알람이 **옛 지역의 날씨**를 말한다(Codex #828). 조건 자리는 목소리와 무관하니 지금 값을 둔다.
    /// 안드로이드 `DefaultVoiceFallbackTest.restoringKeepsTheCurrentWeatherCondition` 짝.
    func test_복원은_지금의_날씨_조건_자리를_둔다() {
        var weather = cloneAlarm()
        weather.bucketId = "weather"
        weather.voiceRandomContext = RandomPromptContext.wakeWeather.rawValue
        weather.contextVariantIndex = 1
        weather.contextResolvedAtMillis = 100
        let locked = DefaultVoiceSubstitute.locked(weather, voiceID: systemVoice, binding: nil, nowMillis: 1)
        XCTAssertEqual(locked.preLockVoice?.contextVariantIndex, 1, "전제 — 보관본의 옛 자리")

        var edited = locked
        edited.voiceWeatherCity = "부산"
        edited.contextVariantIndex = 4
        edited.contextResolvedAtMillis = 900
        let restored = DefaultVoiceSubstitute.restored(edited, nowMillis: 1_000)

        XCTAssertEqual(restored.voiceProfileId, "clone-a")
        XCTAssertEqual(restored.voiceWeatherCity, "부산")
        XCTAssertEqual(restored.contextVariantIndex, 4)
        XCTAssertEqual(restored.contextResolvedAtMillis, 900)

        // 날씨가 아닌 보관본은 예전처럼 보관본 값을 되살린다.
        var greeting = cloneAlarm()
        greeting.contextVariantIndex = 2
        var greetingLocked = DefaultVoiceSubstitute.locked(greeting, voiceID: systemVoice, binding: nil, nowMillis: 1)
        greetingLocked.contextVariantIndex = nil
        XCTAssertEqual(DefaultVoiceSubstitute.restored(greetingLocked, nowMillis: 2).contextVariantIndex, 2)
    }

    /// 기본 인사말 알람은 **테마 없이** 잠긴다 — 편집기는 그 알람을 열면 기본 목소리에 줄 수 있는 첫 테마를
    /// **스스로** 붙이고(`applyPendingFreeBucketIfNeeded`) 저장할 때 그 클립을 묶는다. 시각만 고친 저장이
    /// 그걸로 보관본을 버리면 재결제해도 원래 목소리가 영영 안 돌아온다(2026-09-29). 안드로이드
    /// `DefaultVoiceLockRepositoryTest.theEditorsOwnFirstThemeOnAGreetingLockIsNotAnEdit` 짝.
    func test_테마_없이_잠긴_행에_편집기가_붙인_첫_테마는_편집이_아니다() {
        let locked = DefaultVoiceSubstitute.locked(cloneAlarm(), voiceID: systemVoice, binding: nil, nowMillis: 1)
        XCTAssertNil(locked.bucketId, "전제 — 기본 목소리의 greeting 은 테마가 아니다")
        XCTAssertNil(locked.audioCacheKey, "전제 — 오디오 없이 잠겼다")

        var autoThemed = locked
        autoThemed.hour = 6
        autoThemed.bucketId = "cheer"
        autoThemed.audioCacheKey = "stock_\(systemVoice)-cheer-0"
        autoThemed.bucketClipKeys = (0..<3).map { "stock_\(systemVoice)-cheer-\($0)" }
        XCTAssertTrue(DefaultVoiceSubstitute.saveKeepsLock(saved: autoThemed, editing: locked))

        // 목소리나 재생 방식을 바꿨으면 여전히 편집이다.
        var otherVoice = autoThemed
        otherVoice.voiceProfileId = bundledSystemVoiceProfiles()[1].id
        XCTAssertFalse(DefaultVoiceSubstitute.saveKeepsLock(saved: otherVoice, editing: locked))
        var alarmMode = autoThemed
        alarmMode.playMode = AlarmPlayMode.alarmOnly.rawValue
        XCTAssertFalse(DefaultVoiceSubstitute.saveKeepsLock(saved: alarmMode, editing: locked))
    }

    /// 잠금·복원은 **켜진 알람만** 다시 예약한다(Codex #820). `AlarmKitViewModel.schedule` 은
    /// `markScheduled` 로 `enabled = true` 를 박으므로, 꺼 둔 옛 모양 잠금을 옮기면서 예약하면 사용자가
    /// 끈 알람이 되살아난다. 안드로이드 `if (updated.enabled) alarmScheduler.schedule(updated)` 짝.
    func test_꺼진_알람은_잠금이_다시_예약하지_않는다() {
        var legacy = record("legacy-off", playMode: .alarmOnly)
        legacy.preLockPlayMode = AlarmPlayMode.voiceOnly.rawValue
        legacy.enabled = false
        let migrated = DefaultVoiceSubstitute.locked(legacy, voiceID: systemVoice, binding: nil, nowMillis: 1)

        XCTAssertFalse(migrated.enabled, "옮기는 것만으로 켜지지 않는다")
        XCTAssertFalse(FreePlanLockSelection.reschedules(migrated))
        XCTAssertFalse(FreePlanLockSelection.reschedules(DefaultVoiceSubstitute.restored(migrated, nowMillis: 2)))

        var on = legacy
        on.enabled = true
        XCTAssertTrue(FreePlanLockSelection.reschedules(
            DefaultVoiceSubstitute.locked(on, voiceID: systemVoice, binding: nil, nowMillis: 1)
        ))
    }

    // MARK: - 한 번의 잠금 실행이 건드리는 행 (`FreePlanLockSelection` — `applyFreePlanVoiceLock` 의 선별)

    private func record(
        _ id: String,
        owner: String? = "user-A",
        playMode: AlarmPlayMode = .voiceOnly
    ) -> LocalAlarmRecord {
        var record = cloneAlarm()
        record.id = id
        record.ownerUserId = owner
        record.playMode = playMode.rawValue
        return record
    }

    /// 선별대로 한 번 실행한다 — 예약(AlarmKit)만 빼고 `applyFreePlanVoiceLock` 과 같은 변환이다.
    private func runLock(_ alarms: [LocalAlarmRecord], owner: String?) -> (newLocks: Int, alarms: [LocalAlarmRecord]) {
        let selection = FreePlanLockSelection(alarms: alarms, expectedOwnerUserId: owner)
        var byID = Dictionary(uniqueKeysWithValues: alarms.map { ($0.id, $0) })
        for record in selection.toUnlock { byID[record.id] = FreePlanLockSelection.unlocked(record) }
        for record in selection.toLock {
            byID[record.id] = DefaultVoiceSubstitute.locked(record, voiceID: systemVoice, binding: nil, nowMillis: 1)
        }
        return (selection.newLockCount, alarms.map { byID[$0.id]! })
    }

    /// 소유자가 다르면 잠금 대상이 아니다(같은 기기에서 계정을 바꾼 경우). 소유자가 안 적힌 옛 행은
    /// 이 계정 것으로 본다.
    func test_다른_계정_알람은_대상이_아니다() {
        let alarms = [record("mine"), record("theirs", owner: "user-B"), record("legacy", owner: nil)]

        let selection = FreePlanLockSelection(alarms: alarms, expectedOwnerUserId: "user-A")

        XCTAssertEqual(Set(selection.toLock.map(\.id)), ["mine", "legacy"], "앞 계정 알람까지 잠그면 안 된다")
    }

    /// ⚠ 새 모양으로 잠긴 행(보관본 있음)은 **되돌리기 대상도 잠금 대상도 아니다.** 그 행은 이제 무료
    /// 기본 목소리 알람이라 `isPaidVoiceForDowngrade` 가 거짓인데, 되돌리기 갈래에서 빼지 않으면
    /// 보관본을 버린 채 잠금이 풀린다 — 재결제해도 내 목소리가 돌아오지 않는다.
    func test_새_모양으로_잠긴_행은_건드리지_않는다() {
        let locked = DefaultVoiceSubstitute.locked(record("locked"), voiceID: systemVoice, binding: nil, nowMillis: 1)
        XCTAssertFalse(locked.isPaidVoiceForDowngrade, "전제 — 되돌리기 갈래의 조건에 걸리는 모양이다")

        let selection = FreePlanLockSelection(alarms: [locked], expectedOwnerUserId: "user-A")

        XCTAssertTrue(selection.toUnlock.isEmpty, "되돌리면 보관본을 버린 채 풀린다")
        XCTAssertTrue(selection.toLock.isEmpty)
    }

    /// 옛 모양(`alarm_only` + `preLockPlayMode`)은 옮기되 **세지 않는다** — 이미 알린 알람이다.
    /// 자격을 잃은 옛 잠금(무료 기본 목소리 알람인데 잠긴 행)은 재생 방식만 되돌린다.
    func test_옛_모양은_옮기되_세지_않고_자격_잃은_잠금은_푼다() {
        var legacy = record("legacy-lock", playMode: .alarmOnly)
        legacy.preLockPlayMode = AlarmPlayMode.voiceOnly.rawValue
        var stale = LocalAlarmRecord(id: "stale", label: "t", hour: 7, minute: 0, fireAtMillis: 0, playMode: AlarmPlayMode.alarmOnly.rawValue)
        stale.voiceProfileId = systemVoice
        stale.preLockPlayMode = AlarmPlayMode.voiceOnly.rawValue
        stale.ownerUserId = "user-A"

        let result = runLock([legacy, stale], owner: "user-A")

        XCTAssertEqual(result.newLocks, 0, "옛 모양을 옮긴 것으로 강등 모달을 다시 띄우지 않는다")
        let moved = result.alarms[0]
        XCTAssertEqual(moved.playMode, AlarmPlayMode.voiceOnly.rawValue)
        XCTAssertEqual(moved.voiceProfileId, systemVoice)
        XCTAssertEqual(moved.preLockVoice?.voiceProfileId, "clone-a")
        let unlocked = result.alarms[1]
        XCTAssertEqual(unlocked.playMode, AlarmPlayMode.voiceOnly.rawValue)
        XCTAssertNil(unlocked.preLockPlayMode)
    }

    /// ⚠ 두 번째 실행은 **아무것도 바꾸지 않고 0 을 돌려준다** — 안 그러면 앱을 열 때마다 강등 모달이
    /// 다시 뜬다(2026-08-11 "모달 계속 뜨네"). 안드로이드 `aSecondLockRunChangesNothingAndCountsNothing` 짝.
    func test_두번째_실행은_아무것도_바꾸지_않는다() {
        var legacy = record("legacy-lock", playMode: .alarmOnly)
        legacy.preLockPlayMode = AlarmPlayMode.voiceOnly.rawValue
        let first = runLock([record("fresh"), legacy], owner: "user-A")
        XCTAssertEqual(first.newLocks, 1, "처음 잠그는 행만 센다")

        let selection = FreePlanLockSelection(alarms: first.alarms, expectedOwnerUserId: "user-A")
        let second = runLock(first.alarms, owner: "user-A")

        XCTAssertTrue(selection.toLock.isEmpty)
        XCTAssertTrue(selection.toUnlock.isEmpty)
        XCTAssertEqual(second.newLocks, 0)
        XCTAssertEqual(second.alarms, first.alarms)
    }
}
