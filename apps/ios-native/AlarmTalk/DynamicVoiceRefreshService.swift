import Foundation

protocol DynamicVoiceTTSGenerating: Sendable {
    func generateTTS(_ requestBody: TtsGenerateRequest, token: String) async throws -> TtsGenerateResponse
}

extension AlarmTalkAPI: DynamicVoiceTTSGenerating {}

@MainActor
final class DynamicVoiceRefreshService {
    struct RefreshResult: Equatable {
        var total: Int
        var refreshed: Int
        var failed: Int
    }

    private let api: DynamicVoiceTTSGenerating
    private let store: LocalAlarmStore
    private let audioCache: AudioCacheStore
    private let cacheTTS: @MainActor (TtsGenerateResponse, String) throws -> CachedVoiceAudio

    init(
        api: DynamicVoiceTTSGenerating = AlarmTalkAPI.shared,
        store: LocalAlarmStore,
        audioCache: AudioCacheStore = .shared,
        cacheTTS: @escaping @MainActor (TtsGenerateResponse, String) throws -> CachedVoiceAudio = { response, cacheKey in
            try AudioCacheStore.cache(tts: response, cacheKey: cacheKey)
        }
    ) {
        self.api = api
        self.store = store
        self.audioCache = audioCache
        self.cacheTTS = cacheTTS
    }

    @discardableResult
    func refreshDue(token: String, nowMillis: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) async -> RefreshResult {
        let candidates = store.alarms
            .filter(Self.isRepeatingDynamicAlarmTalk)
            .sorted { $0.fireAtMillis < $1.fireAtMillis }

        var refreshed = 0
        var failed = 0

        for alarm in candidates {
            guard Self.shouldRefreshDynamicVoice(alarm, nowMillis: nowMillis) else { continue }
            guard let profileID = alarm.voiceProfileId?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !profileID.isEmpty else {
                continue
            }

            do {
                let requestCategory = alarm.voiceCategory ?? Self.ttsCategory(for: alarm.voiceRandomContext)
                let requestLanguage = alarm.voiceLanguage ?? "ko"
                let response = try await api.generateTTS(
                    TtsGenerateRequest(
                        voiceProfileId: profileID,
                        text: "",
                        category: requestCategory,
                        language: requestLanguage,
                        translate: false,
                        random: true,
                        randomContext: alarm.voiceRandomContext ?? RandomPromptContext.defaultContext.rawValue,
                        alarmHour: alarm.hour,
                        alarmMinute: alarm.minute,
                        weatherCountry: (alarm.voiceWeatherCountry).nilIfBlank,
                        weatherCity: (alarm.voiceWeatherCity).nilIfBlank,
                        fortuneGender: (alarm.voiceFortuneGender).nilIfBlank,
                        fortuneBirthDate: (alarm.voiceFortuneBirthDate).nilIfBlank,
                        fortuneBirthTime: (alarm.voiceFortuneBirthTime).nilIfBlank
                    ),
                    token: token
                )
                let cacheKey = AudioCacheStore.ttsCacheKey(
                    profileId: profileID,
                    text: response.text,
                    category: alarm.voiceCategory ?? Self.ttsCategory(for: response.randomContext),
                    language: requestLanguage,
                    serverCacheKey: response.cacheKey
                )
                let cached = try cacheTTS(response, cacheKey)
                let oldCacheKey = alarm.audioCacheKey
                store.updateDynamicVoiceAudio(
                    id: alarm.id,
                    localAudioUri: cached.fileName,
                    audioCacheKey: cached.cacheKey,
                    rawAudioUri: response.remoteAudioURI,
                    voiceText: response.text,
                    ttsMessageId: response.messageId,
                    preparedForFireAtMillis: alarm.fireAtMillis
                )
                if let oldCacheKey,
                   oldCacheKey != cached.cacheKey,
                   store.countByAudioCacheKey(oldCacheKey) == 0 {
                    try? audioCache.deleteCachedAudio(cacheKey: oldCacheKey)
                }
                refreshed += 1
            } catch {
                failed += 1
            }
        }

        return RefreshResult(total: candidates.count, refreshed: refreshed, failed: failed)
    }

    static func isRepeatingDynamicAlarmTalk(_ alarm: LocalAlarmRecord) -> Bool {
        alarm.enabled &&
            alarm.repeatDaysMask != 0 &&
            alarm.voiceRandomPrompt &&
            alarm.playModeEnum != .alarmOnly &&
            // 스톡 클립(`stock_` prefix)은 고정 음원이므로 랜덤 TTS 로 덮어쓰지 않는다.
            // 저장 시 voiceRandomPrompt=false 로 빠지지만, 그 이전에 저장된 알람까지
            // 안전하게 제외하기 위한 방어선이다.
            alarm.audioCacheKey?.hasPrefix("stock_") != true &&
            alarm.voiceProfileId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    }

    static func shouldRefreshDynamicVoice(_ alarm: LocalAlarmRecord, nowMillis: Int64, calendar: Calendar = .current) -> Bool {
        if alarm.dynamicVoicePreparedForFireAtMillis == alarm.fireAtMillis { return false }

        let fireDate = Date(timeIntervalSince1970: TimeInterval(alarm.fireAtMillis) / 1000.0)
        var components = calendar.dateComponents([.year, .month, .day], from: fireDate)
        components.hour = 22
        components.minute = 0
        components.second = 0

        guard let fireDayPrepareTime = calendar.date(from: components),
              let prepareDate = calendar.date(byAdding: .day, value: -1, to: fireDayPrepareTime) else {
            return false
        }

        let prepareAtMillis = Int64(prepareDate.timeIntervalSince1970 * 1000)
        let latestPrepareMillis = alarm.fireAtMillis - 60_000
        return nowMillis >= prepareAtMillis && nowMillis < latestPrepareMillis
    }

    static func ttsCategory(for context: String?) -> String {
        switch RandomPromptContext.normalized(context) {
        case .meal:
            return "lunch"
        case .sleep:
            return "night"
        case .exercise:
            return "exercise"
        case .love:
            return "love"
        default:
            return "morning"
        }
    }

}
