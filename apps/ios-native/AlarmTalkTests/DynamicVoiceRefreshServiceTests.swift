import XCTest
@testable import AlarmTalk

@MainActor
final class DynamicVoiceRefreshServiceTests: XCTestCase {

    func test_shouldRefreshDynamicVoice_matchesAndroidWindow() {
        let calendar = utcCalendar()
        let fireAt = millis(2026, 5, 20, 8, 0)
        var alarm = dynamicAlarm(fireAtMillis: fireAt)

        XCTAssertFalse(DynamicVoiceRefreshService.shouldRefreshDynamicVoice(
            alarm,
            nowMillis: millis(2026, 5, 19, 21, 59),
            calendar: calendar
        ))
        XCTAssertTrue(DynamicVoiceRefreshService.shouldRefreshDynamicVoice(
            alarm,
            nowMillis: millis(2026, 5, 19, 22, 0),
            calendar: calendar
        ))
        XCTAssertFalse(DynamicVoiceRefreshService.shouldRefreshDynamicVoice(
            alarm,
            nowMillis: fireAt - 30_000,
            calendar: calendar
        ))

        alarm.dynamicVoicePreparedForFireAtMillis = fireAt
        XCTAssertFalse(DynamicVoiceRefreshService.shouldRefreshDynamicVoice(
            alarm,
            nowMillis: millis(2026, 5, 19, 22, 0),
            calendar: calendar
        ))
    }

    func test_refreshDue_generatesAndStoresNewDynamicVoiceAudio() async {
        let store = makeStore()
        let fireAt = millis(2026, 5, 20, 8, 0)
        let alarm = dynamicAlarm(
            fireAtMillis: fireAt,
            audioCacheKey: "old-key",
            voiceWeatherCountry: " 대한민국 ",
            voiceWeatherCity: "   "
        )
        store.upsert(alarm)

        let api = FakeDynamicVoiceAPI(response: TtsGenerateResponse(
            messageId: "message-new",
            audioBase64: "AA==",
            audioFormat: "mp3",
            audioUrl: nil,
            audioObjectKey: "tts/message-new.mp3",
            text: "오늘도 좋은 하루예요.",
            voiceProfileId: "voice-1",
            cacheKey: "new-key",
            cacheHit: false,
            provider: "fake",
            randomContext: RandomPromptContext.wakeWeather.rawValue
        ))
        let service = DynamicVoiceRefreshService(
            api: api,
            store: store,
            cacheTTS: { response, cacheKey in
                CachedVoiceAudio(
                    url: URL(fileURLWithPath: "/tmp/\(response.messageId).mp3"),
                    fileName: "\(response.messageId).mp3",
                    format: "mp3",
                    cacheKey: cacheKey
                )
            }
        )

        let result = await service.refreshDue(
            token: "token",
            nowMillis: millis(2026, 5, 19, 22, 0)
        )

        XCTAssertEqual(result, .init(total: 1, refreshed: 1, failed: 0))
        XCTAssertEqual(api.requests.count, 1)
        XCTAssertEqual(api.requests.first?.voiceProfileId, "voice-1")
        XCTAssertEqual(api.requests.first?.text, "")
        XCTAssertEqual(api.requests.first?.category, "morning")
        XCTAssertEqual(api.requests.first?.random, true)
        XCTAssertEqual(api.requests.first?.randomContext, RandomPromptContext.wakeWeather.rawValue)
        XCTAssertEqual(api.requests.first?.alarmHour, 8)
        XCTAssertEqual(api.requests.first?.alarmMinute, 0)
        XCTAssertEqual(api.requests.first?.weatherCountry, "대한민국")
        XCTAssertNil(api.requests.first?.weatherCity)

        let updated = store.record(id: alarm.id)
        XCTAssertEqual(updated?.localAudioUri, "message-new.mp3")
        XCTAssertEqual(updated?.audioCacheKey, "new-key")
        XCTAssertEqual(updated?.rawAudioUri, "r2://tts/message-new.mp3")
        XCTAssertEqual(updated?.voiceText, "오늘도 좋은 하루예요.")
        XCTAssertEqual(updated?.ttsMessageId, "message-new")
        XCTAssertEqual(updated?.dynamicVoicePreparedForFireAtMillis, fireAt)
    }

    func test_refreshDue_usesAndroidTtsCacheKeyFallback() async {
        let store = makeStore()
        let fireAt = millis(2026, 5, 20, 8, 0)
        let alarm = dynamicAlarm(fireAtMillis: fireAt)
        store.upsert(alarm)

        let api = FakeDynamicVoiceAPI(response: TtsGenerateResponse(
            messageId: "message-fallback",
            audioBase64: "AA==",
            audioFormat: "mp3",
            audioUrl: nil,
            audioObjectKey: "tts/message-fallback.mp3",
            text: "약 챙겨 드세요.",
            voiceProfileId: "voice-1",
            cacheKey: nil,
            cacheHit: false,
            provider: "fake",
            randomContext: RandomPromptContext.medication.rawValue
        ))
        let expectedCacheKey = AudioCacheStore.ttsCacheKey(
            profileId: "voice-1",
            text: "약 챙겨 드세요.",
            category: "medication",
            language: "ko"
        )
        let service = DynamicVoiceRefreshService(
            api: api,
            store: store,
            cacheTTS: { response, cacheKey in
                return CachedVoiceAudio(
                    url: URL(fileURLWithPath: "/tmp/\(response.messageId).mp3"),
                    fileName: "\(response.messageId).mp3",
                    format: "mp3",
                    cacheKey: cacheKey
                )
            }
        )

        _ = await service.refreshDue(
            token: "token",
            nowMillis: millis(2026, 5, 19, 22, 0)
        )

        XCTAssertEqual(store.record(id: alarm.id)?.audioCacheKey, expectedCacheKey)
    }

    private func dynamicAlarm(
        fireAtMillis: Int64,
        audioCacheKey: String? = nil,
        voiceWeatherCountry: String? = nil,
        voiceWeatherCity: String? = nil
    ) -> LocalAlarmRecord {
        LocalAlarmRecord(
            id: "dynamic-1",
            label: "Dynamic",
            hour: 8,
            minute: 0,
            fireAtMillis: fireAtMillis,
            repeatDaysMask: RepeatDay.wednesday.mask,
            playMode: AlarmPlayMode.voiceOnly.rawValue,
            localAudioUri: "old-message.mp3",
            audioCacheKey: audioCacheKey,
            rawAudioUri: "r2://old",
            voiceSource: VoiceSource.serverTts.rawValue,
            voiceProfileId: "voice-1",
            voiceText: "old",
            voiceCategory: nil,
            voiceLanguage: "ko",
            voiceRandomPrompt: true,
            voiceRandomContext: RandomPromptContext.wakeWeather.rawValue,
            voiceWeatherCountry: voiceWeatherCountry,
            voiceWeatherCity: voiceWeatherCity,
            enabled: true,
            state: AlarmRuntimeState.armed.rawValue
        )
    }

    private func makeStore() -> LocalAlarmStore {
        let url = FileManager.default
            .temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("json")
        return LocalAlarmStore(storageURL: url, loadFromDisk: false)
    }

    private func millis(_ y: Int, _ mo: Int, _ d: Int, _ h: Int, _ mi: Int) -> Int64 {
        let date = utcCalendar().date(from: DateComponents(
            timeZone: TimeZone(secondsFromGMT: 0),
            year: y,
            month: mo,
            day: d,
            hour: h,
            minute: mi,
            second: 0
        ))!
        return Int64(date.timeIntervalSince1970 * 1000)
    }

    private func utcCalendar() -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }
}

private final class FakeDynamicVoiceAPI: DynamicVoiceTTSGenerating, @unchecked Sendable {
    private let response: TtsGenerateResponse
    private(set) var requests: [TtsGenerateRequest] = []

    init(response: TtsGenerateResponse) {
        self.response = response
    }

    func generateTTS(_ requestBody: TtsGenerateRequest, token: String) async throws -> TtsGenerateResponse {
        requests.append(requestBody)
        return response
    }
}
