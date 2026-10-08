import XCTest
@testable import AlarmTalk

/// 유료 목소리를 못 쓰게 된 알람의 **기본 목소리 대체** — 예약 때 판정(`PaidVoiceGate.shouldDowngrade`
/// → `DefaultVoiceSubstitute`)과 소리 결정(`AlarmSoundResolver.plan`).
///
/// 2026-09-29 dev 리허설(안드로이드 SM-A325N · dev 1.2.10): 기간 한정 개인 플랜 종료 뒤 클론 목소리 알람이
/// **아무 소리 없이** 울렸다(`Free plan at ring time — downgrading paid voice to alarm tone` →
/// `Alarm tone off (soundEnabled=false, volume=10)`). iOS 는 AlarmKit 이 시스템 기본음을 울려 조용하지는
/// 않았지만, 규칙은 같다 — 기본 목소리로 운다(`docs/spec/billing-lifecycle.md` 「목소리를 못 쓰게 되면」).
/// 안드로이드 짝은 `DefaultVoiceFallbackTest` · `RingSoundDecisionTest`.
@MainActor
final class DefaultVoiceSubstituteTests: XCTestCase {

    private let firstSystemVoice = bundledSystemVoiceProfiles()[0].id
    private let secondSystemVoice = bundledSystemVoiceProfiles()[1].id

    private func rehearsalAlarm() -> LocalAlarmRecord {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var record = LocalAlarmRecord(
            id: "rehearsal-1",
            label: "리허설",
            hour: 10,
            minute: 35,
            fireAtMillis: now + 60_000,
            vibrationPattern: VibrationPattern.none.rawValue,
            playMode: AlarmPlayMode.voiceOnly.rawValue,
            localAudioUri: "stock_clone-weather-0.mp3",
            audioCacheKey: "stock_clone-weather-0",
            voiceProfileId: "clone-a",
            voiceListenerTitle: "우리 딸",
            voiceText: "비 온대, 우산 챙겨",
            voiceLanguage: "ko",
            voiceRandomContext: RandomPromptContext.wakeWeather.rawValue,
            voiceVolumePercent: 80,
            ttsMessageId: "clone-weather-0",
            remoteAlarmId: "remote-1",
            syncState: AlarmSyncState.synced.rawValue,
            alarmVolumePercent: 10,
            createdAtMillis: now,
            updatedAtMillis: now
        )
        record.bucketId = "weather"
        record.bucketClipKeys = (0..<9).map { "stock_clone-weather-\($0)" }
        record.bucketRotationIndex = 0
        record.contextVariantIndex = 1
        return record
    }

    private func weatherManifest(voice: String, language: String = "ko") -> [StockClip] {
        (0..<9).map { (variant: Int) -> StockClip in
            StockClip(
                messageId: "\(voice)-weather-\(language)-\(variant)",
                voiceProfileId: voice,
                voiceName: nil,
                category: "weather",
                language: language,
                text: "날씨 \(variant)",
                audioUrl: "https://cdn.example/\(voice)/weather/\(variant).mp3",
                variant: variant
            )
        }
    }

    private func allCached(_ key: String) -> URL? { URL(fileURLWithPath: "/tmp/\(key).mp3") }

    // MARK: - 어느 목소리 · 어느 테마

    /// 대체 목소리는 **미나 하나**다(2026-09-29 "미나로 통일도 해") — 알람이 이미 기본 목소리면 그 목소리,
    /// 아니면 미나. 마지막에 쓴 기본 목소리는 보지 않는다. 안드로이드 `DefaultVoiceFallbackTest` 짝.
    func test_pickVoice_keepsSystemVoice_otherwiseMina() {
        XCTAssertEqual(DefaultVoiceSubstitute.pickVoiceID(alarmVoiceID: firstSystemVoice), firstSystemVoice)
        XCTAssertEqual(bundledSystemVoiceProfiles().first { $0.id == substituteSystemVoiceID }?.name, "미나")
        XCTAssertEqual(DefaultVoiceSubstitute.pickVoiceID(alarmVoiceID: "clone-a"), substituteSystemVoiceID)
        XCTAssertEqual(DefaultVoiceSubstitute.pickVoiceID(alarmVoiceID: nil), substituteSystemVoiceID)
    }

    func test_bucket_followsTheme_andHasNoneForGreetingOrManual() {
        XCTAssertEqual(DefaultVoiceSubstitute.bucket(bucketId: "weather", voiceRandomContext: nil), "weather")
        XCTAssertEqual(DefaultVoiceSubstitute.bucket(bucketId: "love", voiceRandomContext: nil), "cheer")
        XCTAssertEqual(DefaultVoiceSubstitute.bucket(bucketId: nil, voiceRandomContext: "medication"), "medication")
        XCTAssertNil(DefaultVoiceSubstitute.bucket(bucketId: "greeting", voiceRandomContext: "preset"))
        XCTAssertNil(DefaultVoiceSubstitute.bucket(bucketId: nil, voiceRandomContext: "manual"))
    }

    // MARK: - 묶기

    func test_binding_requiresEveryClipCached() {
        let record = rehearsalAlarm()
        let manifest = weatherManifest(voice: firstSystemVoice)

        let bound = DefaultVoiceSubstitute.binding(
            for: record, voiceID: firstSystemVoice, manifest: manifest, expectedVariants: nil,
            languages: ["ko"], cachedURL: allCached
        )
        XCTAssertEqual(bound?.keys.count, 9)
        XCTAssertEqual(bound?.keys.first, "stock_\(firstSystemVoice)-weather-ko-0")

        // 하나라도 빠지면 묶지 않는다 — 날씨는 자리 번호가 곧 조건이다.
        let missing = DefaultVoiceSubstitute.binding(
            for: record, voiceID: firstSystemVoice, manifest: manifest, expectedVariants: nil, languages: ["ko"],
            cachedURL: { $0.hasSuffix("-3") ? nil : self.allCached($0) }
        )
        XCTAssertNil(missing)
    }

    /// 매니페스트 자체가 모자란 경우(Codex #820) — 가운데 variant 가 빠진 목록을 순서대로 묶으면 뒤 자리가
    /// 밀려 다른 날씨 조건을 튼다. 캐시가 다 있어도 묶지 않는다. 안드로이드 `aManifestMissingAMiddleVariantIsNeverBound` 짝.
    func test_binding_rejectsAManifestWithAMissingVariant() {
        let record = rehearsalAlarm()
        let gap = weatherManifest(voice: firstSystemVoice).filter { $0.variant != 4 }
        let nine = ExpectedVariantCounts(system: ["weather": 9], clone: ["weather": 3])

        XCTAssertNil(DefaultVoiceSubstitute.binding(
            for: record, voiceID: firstSystemVoice, manifest: gap, expectedVariants: nil,
            languages: ["ko"], cachedURL: allCached
        ), "개수를 몰라도 빈틈은 안다")
        XCTAssertNil(DefaultVoiceSubstitute.binding(
            for: record, voiceID: firstSystemVoice, manifest: gap, expectedVariants: nine,
            languages: ["ko"], cachedURL: allCached
        ))
        // 꼬리가 잘린 세트 — 서버가 9개라고 하니 모자란다.
        let truncated = weatherManifest(voice: firstSystemVoice).filter { ($0.variant ?? 0) < 3 }
        XCTAssertNil(DefaultVoiceSubstitute.binding(
            for: record, voiceID: firstSystemVoice, manifest: truncated, expectedVariants: nine,
            languages: ["ko"], cachedURL: allCached
        ))
        XCTAssertEqual(DefaultVoiceSubstitute.binding(
            for: record, voiceID: firstSystemVoice, manifest: weatherManifest(voice: firstSystemVoice),
            expectedVariants: nine, languages: ["ko"], cachedURL: allCached
        )?.keys.count, 9)
    }

    /// 테마가 있는 종류인데 클립을 다 받아 두지 못했다 — 오디오 없이 두되 **테마는 남긴다**(Codex #820).
    /// 비우면 편집기가 종류를 잃어 첫 테마로 바꿔 붙인다. 안드로이드 `lockingAThemeWithoutClipsKeepsTheTheme` 짝.
    func test_locked_withoutBinding_keepsTheTheme() {
        let record = rehearsalAlarm()

        let locked = DefaultVoiceSubstitute.locked(record, voiceID: firstSystemVoice, binding: nil, nowMillis: 1)

        XCTAssertEqual(locked.bucketId, "weather")
        XCTAssertNil(locked.bucketClipKeys)
        XCTAssertNil(locked.audioCacheKey)
        XCTAssertNil(locked.ttsMessageId)
        XCTAssertEqual(locked.contextVariantIndex, record.contextVariantIndex)
        XCTAssertEqual(locked.voiceRandomContext, RandomPromptContext.wakeWeather.rawValue)

        var greeting = rehearsalAlarm()
        greeting.bucketId = "greeting"
        greeting.voiceRandomContext = RandomPromptContext.preset.rawValue
        XCTAssertNil(
            DefaultVoiceSubstitute.locked(greeting, voiceID: firstSystemVoice, binding: nil, nowMillis: 1).bucketId,
            "기본 인사말은 기본 목소리 테마가 없다"
        )
    }

    // MARK: - 예약 때 대체

    func test_rehearsalAlarm_isScheduledWithADefaultVoiceNotTheAlarmTone() {
        let record = rehearsalAlarm()
        let freeSnapshot = AccessSnapshot(
            subscriptionResponse: BillingSubscriptionResponse(subscription: nil, plan: nil),
            familyGroup: nil,
            storePlanKey: nil,
            storeEntitlementUntilMillis: nil,
            userPlan: "free"
        )
        XCTAssertTrue(PaidVoiceGate.shouldDowngrade(record: record, snapshot: freeSnapshot))

        let binding = DefaultVoiceSubstitute.binding(
            for: record, voiceID: secondSystemVoice, manifest: weatherManifest(voice: secondSystemVoice),
            expectedVariants: nil, languages: ["ko"], cachedURL: allCached
        )
        let substitute = DefaultVoiceSubstitute.substitutedForScheduling(record, voiceID: secondSystemVoice, binding: binding)

        XCTAssertEqual(substitute.playMode, AlarmPlayMode.voiceOnly.rawValue)
        XCTAssertEqual(substitute.voiceProfileId, secondSystemVoice)
        XCTAssertEqual(substitute.bucketId, "weather")
        XCTAssertEqual(substitute.audioCacheKey, "stock_\(secondSystemVoice)-weather-ko-0")
        XCTAssertEqual(substitute.contextVariantIndex, 1, "날씨 조건 자리는 variant 축이 같아 그대로 간다")
        XCTAssertEqual(BucketVariantResolver.variantIndex(for: substitute), 1)
        XCTAssertEqual(substitute.vibrationPattern, record.vibrationPattern, "진동은 알람 설정 그대로")
        XCTAssertFalse(PaidVoiceGate.shouldDowngrade(record: substitute, snapshot: freeSnapshot))
    }

    func test_entitledOwner_isNotSubstituted() {
        let paidSnapshot = AccessSnapshot(
            subscriptionResponse: BillingSubscriptionResponse(
                subscription: BillingSubscription(
                    id: "sub-1", planId: "plan-1", status: "active", expiresAt: "2099-01-01T00:00:00Z"
                ),
                plan: nil
            ),
            familyGroup: nil,
            storePlanKey: nil,
            storeEntitlementUntilMillis: nil,
            userPlan: "plus"
        )
        XCTAssertFalse(PaidVoiceGate.shouldDowngrade(record: rehearsalAlarm(), snapshot: paidSnapshot))
    }

    func test_receivedAlarm_isNotJudgedByTheRecipientsPlan() {
        var received = rehearsalAlarm()
        received.origin = AlarmOrigin.receivedRemote.rawValue
        XCTAssertFalse(PaidVoiceGate.shouldDowngrade(record: received, snapshot: .empty))
        let freeSnapshot = AccessSnapshot(
            subscriptionResponse: BillingSubscriptionResponse(subscription: nil, plan: nil),
            familyGroup: nil,
            storePlanKey: nil,
            storeEntitlementUntilMillis: nil,
            userPlan: "free"
        )
        XCTAssertFalse(PaidVoiceGate.shouldDowngrade(record: received, snapshot: freeSnapshot))
    }

    // MARK: - 소리 결정 — 오디오 없는 기본 목소리 알람은 내장 인사말

    func test_plan_defaultVoiceWithoutAudio_usesBundledGreetingNotTheAlarmTone() {
        var record = rehearsalAlarm()
        // 기본 인사말 종류 — 기본 목소리에 테마가 없어 늘 내장 인사말로 간다(시뮬레이터의 캐시 상태와 무관).
        record.bucketId = "greeting"
        record.voiceRandomContext = RandomPromptContext.preset.rawValue
        record = DefaultVoiceSubstitute.substitutedForScheduling(record, voiceID: firstSystemVoice, binding: nil)
        XCTAssertNil(record.audioCacheKey)
        XCTAssertNil(record.bucketId)

        let plan = AlarmSoundResolver.plan(for: record, audioCache: AudioCacheStore())

        guard case .voiceClip(let key, let url, _, let volume, _) = plan else {
            return XCTFail("기본 목소리 알람이 알람음으로 떨어졌다: \(plan)")
        }
        XCTAssertTrue(key.hasPrefix("greeting-voice_greeting_"), key)
        XCTAssertEqual(url.pathExtension, "mp3")
        XCTAssertEqual(volume, record.voiceVolumePercent)
    }

    func test_fallbackClip_prefersTheAlarmsConditionClip() {
        var record = rehearsalAlarm()
        record.voiceProfileId = firstSystemVoice

        let fallback = DefaultVoiceSubstitute.fallbackClip(
            for: record,
            manifest: weatherManifest(voice: firstSystemVoice),
            expectedVariants: nil,
            deviceLanguage: "ko",
            cachedURL: allCached
        )

        XCTAssertEqual(fallback?.key, "stock_\(firstSystemVoice)-weather-ko-1", "알람에 적힌 날씨 조건 자리")
    }

    /// 모자란 세트로 자리를 세지 않는다 — 가운데가 빠지면 뒤 자리가 밀려 다른 조건을 튼다(Codex #820).
    func test_fallbackClip_neverCountsPositionsInAnIncompleteWeatherSet() {
        var record = rehearsalAlarm()
        record.voiceProfileId = firstSystemVoice

        let fallback = DefaultVoiceSubstitute.fallbackClip(
            for: record,
            manifest: weatherManifest(voice: firstSystemVoice).filter { $0.variant != 0 },
            expectedVariants: ExpectedVariantCounts(system: ["weather": 9], clone: [:]),
            deviceLanguage: "ko",
            cachedURL: allCached
        )

        XCTAssertEqual(fallback.map { $0.key.hasPrefix("greeting-") }, true, "다른 조건 대신 인사말")
    }

    func test_fallbackClip_neverPlaysAnotherWeatherCondition() {
        var record = rehearsalAlarm()
        record.voiceProfileId = firstSystemVoice

        let fallback = DefaultVoiceSubstitute.fallbackClip(
            for: record,
            manifest: weatherManifest(voice: firstSystemVoice),
            expectedVariants: nil,
            deviceLanguage: "ko",
            cachedURL: { $0.hasSuffix("-1") ? nil : self.allCached($0) }
        )

        XCTAssertEqual(fallback.map { $0.key.hasPrefix("greeting-") }, true, "다른 조건 대신 인사말")
    }

    // MARK: - 보관본 왕복

    func test_lockSnapshot_survivesCodableRoundTrip() throws {
        let locked = DefaultVoiceSubstitute.locked(rehearsalAlarm(), voiceID: firstSystemVoice, binding: nil, nowMillis: 1)
        let data = try JSONEncoder().encode(locked)
        let decoded = try JSONDecoder().decode(LocalAlarmRecord.self, from: data)

        XCTAssertEqual(decoded.preLockVoice, locked.preLockVoice)
        XCTAssertEqual(decoded.preLockVoice?.voiceProfileId, "clone-a")
        XCTAssertEqual(decoded.preLockVoice?.bucketClipKeys?.count, 9)
    }
}
