import Foundation
import os

/// **저장하는 순간**의 날씨 조건 조회 — 기다리는 시간에 상한이 있다.
///
/// 날씨 테마 알람은 저장하면서 서버에 그 도시·그 날짜의 조건을 묻는다
/// (`AlarmEditorSheet.applyWeatherVariant`). 그 서버는 뒤에서 open-meteo 를 세 번 순차로
/// 부르므로(지오코딩 → 예보 → 미세먼지) 느린 망에서는 응답이 한참 뒤에 온다. 사용자는 그
/// 동안 저장 버튼이 잠긴 채(`isWorking`) 기다린다 — 여기서 **8초**를 넘기면 기다리기를
/// 그만두고 미해결로 저장한다. 안드로이드 `AlarmRepository.resolveWeatherVariantForDraft`
/// 의 `WEATHER_RESOLVE_TIMEOUT_MILLIS` 와 같은 값이다 — **한쪽만 바꾸지 말 것.**
///
/// 상한을 넘긴 결과는 **기존 실패(오프라인)와 같다**: `nil` 을 돌려주고 호출자는
/// `BucketVariantResolver.nextWeatherVariantState` 로 옛 값을 지키거나 미해결로 남긴다.
/// 그 알람은 `WeatherVariantRefreshService.refreshDue` 가 준비창(48h)에서 다시 물어 채운다
/// (`weatherVariantNeedsRefresh` 는 `contextVariantIndex == nil` 이면 참이다).
///
/// ⚠ **상한은 이슈가 아니다.** 느린 망은 사용자가 고칠 수 없고 우리도 고칠 코드가 없다 —
/// 로그에만 남기고 Sentry 로는 올리지 않는다. 취소된 요청이 내는 `URLError(.cancelled)` 도
/// 같다(`AlarmTalkLog.transientURLErrorCodes`).
enum WeatherVariantSaveLookup {
    private static let logger = Logger(subsystem: "com.alarmtalk.app", category: "WeatherVariant")

    /// 저장 흐름이 날씨 응답을 기다리는 상한(초).
    static let timeoutSeconds: TimeInterval = 8

    /// 이 알람이 울릴 날짜의 조건을 받아 온다. 날씨 테마가 아니면 묻지 않고 `nil`.
    ///
    /// - Returns: 서버가 준 조건 인덱스. **못 받았으면 `nil`** — 오프라인·서버 오류·상한 초과·
    ///   취소를 가리지 않는다. `nil` 은 '맑음(0)' 이 아니라 '아직 모른다' 이고, 호출자는 이
    ///   값을 그대로 `freshIndex` 로 넘긴다(0 으로 때우면 비 오는 날에 "하늘 한 번
    ///   올려다보세요" 가 나간다).
    /// - Parameter timeoutSeconds: 테스트가 짧게 주입한다. 앱은 기본값을 쓴다.
    static func freshIndex(
        record: LocalAlarmRecord,
        token: String,
        api: PrerenderVariantResolving = AlarmTalkAPI.shared,
        timeoutSeconds: TimeInterval = WeatherVariantSaveLookup.timeoutSeconds,
        timezone: String = TimeZone.current.identifier
    ) async -> Int? {
        guard record.bucketId == "weather" else { return nil }
        let country = record.voiceWeatherCountry
        let city = record.voiceWeatherCity
        let targetDate = BucketVariantResolver.localDateString(millis: record.fireAtMillis)
        do {
            return try await withTimeout(seconds: timeoutSeconds) {
                try await api.getPrerenderVariant(
                    context: "wake_weather",
                    country: country,
                    city: city,
                    targetDate: targetDate,
                    timezone: timezone,
                    token: token
                )
            }
        } catch let timeout as AsyncTimeoutError {
            logger.info(
                "Pre-save weather variant lookup exceeded \(timeout.seconds, privacy: .public)s — saving unresolved (background refresh will fill)"
            )
            return nil
        } catch {
            // 오프라인·취소·서버 오류 — 어느 쪽이든 미해결로 저장하고 갱신이 채운다.
            logger.warning(
                "Pre-save weather variant lookup failed — saving unresolved: \(String(describing: type(of: error)), privacy: .public)"
            )
            return nil
        }
    }
}
