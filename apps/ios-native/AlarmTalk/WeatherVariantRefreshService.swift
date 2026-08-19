import Foundation
import os

protocol PrerenderVariantResolving: Sendable {
    func getPrerenderVariant(
        context: String,
        country: String?,
        city: String?,
        targetDate: String,
        timezone: String,
        token: String
    ) async throws -> Int?
}

extension AlarmTalkAPI: PrerenderVariantResolving {}

/// 곧 울릴 **날씨 테마 알람**의 조건을 미리 받아 둔다.
///
/// 왜 저장만으로는 부족한가: 반복 알람은 매일 다시 울린다. 저장할 때 받은 조건은 그날의
/// 것이라, 내일 아침에는 어제 날씨를 말하게 된다. 그래서 발사 전 준비창에서 한 번 더 받는다.
///
/// ⚠ **울리는 순간에는 받을 수 없다.** iOS 는 발사 시점에 우리 코드가 돌지 않으므로
/// (AlarmKit 이 예약해 둔 사운드를 그대로 울린다) 준비창 안에서 미리 확정해 둬야 한다.
/// 안드로이드 `AlarmRepository.resolveDueCloneBucketVariants` 미러.
@MainActor
final class WeatherVariantRefreshService {
    private static let logger = Logger(subsystem: "com.alarmtalk.app", category: "WeatherVariant")

    private let api: PrerenderVariantResolving
    private let store: LocalAlarmStore
    private let alarmKit: AlarmKitViewModel?

    /// - Parameter alarmKit: 조건이 바뀌면 **다시 예약해야** 한다(아래 `reschedule` 주석).
    ///   테스트에서는 생략한다.
    init(
        api: PrerenderVariantResolving = AlarmTalkAPI.shared,
        store: LocalAlarmStore,
        alarmKit: AlarmKitViewModel? = nil
    ) {
        self.api = api
        self.store = store
        self.alarmKit = alarmKit
    }

    /// - Returns: 조건이 실제로 바뀐 알람 수.
    @discardableResult
    func refreshDue(
        token: String,
        nowMillis: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    ) async -> Int {
        let due = store.alarms.filter { BucketVariantResolver.weatherVariantNeedsRefresh($0, nowMillis: nowMillis) }
        guard !due.isEmpty else { return 0 }

        // 같은 (도시, 날짜)는 한 번만 물어본다 — 같은 답을 받으려고 open-meteo 를 여러 번
        // 두드리면 배터리와 쿼터만 쓴다.
        let timezone = TimeZone.current.identifier
        var groups: [GroupKey: [LocalAlarmRecord]] = [:]
        for alarm in due {
            let key = GroupKey(
                country: alarm.voiceWeatherCountry?.trimmed ?? "",
                city: alarm.voiceWeatherCity?.trimmed ?? "",
                targetDate: BucketVariantResolver.localDateString(millis: alarm.fireAtMillis)
            )
            groups[key, default: []].append(alarm)
        }

        var changed = 0
        for (key, alarms) in groups {
            // ⚠ **취소되면 멈춘다.** 아래 `try?` 는 취소도 nil 로 삼키므로, 그것만 믿으면
            // 워치독이 회차를 접은 뒤에도 남은 그룹을 돌며 **알람을 계속 고친다**
            // (2026-08-18 Codex #697 이 push·pull·목소리에서 지적한 것과 같은 형태 —
            // 지적을 기다리지 않고 같은 사이클의 나머지도 함께 맞춘다).
            if Task.isCancelled { break }
            let index = try? await api.getPrerenderVariant(
                context: "wake_weather",
                country: key.country.nilIfBlank,
                city: key.city.nilIfBlank,
                targetDate: key.targetDate,
                timezone: timezone,
                token: token
            )
            // 조회 실패(nil)면 **기존 인덱스를 유지한다.** 0(맑음)으로 덮어쓰지 않는다.
            guard let index else { continue }
            for alarm in alarms {
                // 네트워크를 기다리는 사이 사용자가 시각·지역을 고쳤을 수 있다. 그러면 이 답은
                // 다른 조건의 것이므로 버린다(안드로이드의 DAO 조건부 UPDATE 와 같은 가드).
                guard let current = store.record(id: alarm.id),
                      current.bucketId == "weather",
                      (current.voiceWeatherCountry?.trimmed ?? "") == key.country,
                      (current.voiceWeatherCity?.trimmed ?? "") == key.city,
                      BucketVariantResolver.localDateString(millis: current.fireAtMillis) == key.targetDate
                else { continue }
                let didChange = current.contextVariantIndex != index
                // 값이 그대로여도 **받은 시각은 갱신한다.** 안 그러면 안정된 날씨에서 시계가
                // 전진하지 않아 준비창 내내 매번 다시 물어본다.
                store.applyWeatherVariant(
                    id: current.id,
                    index: index,
                    resolvedAtMillis: Int64(Date().timeIntervalSince1970 * 1000)
                )
                if didChange {
                    changed += 1
                    await reschedule(alarmID: current.id)
                }
            }
        }
        if changed > 0 {
            Self.logger.info("Resolved weather bucket variants (count: \(changed, privacy: .public))")
        }
        return changed
    }

    /// ⚠ **조건이 바뀌면 다시 예약해야 한다 — 여기가 안드로이드와 갈리는 지점이다.**
    /// 안드로이드는 울릴 때 클립을 고르지만, iOS 는 **예약 시점에 정해진 사운드 파일**이
    /// 그대로 울린다(`AlarmSoundResolver` → `AlertSound.named`). 값만 고쳐 두면 행에는
    /// 비 문구가 적혀 있는데 실제로는 어제 스테이징한 맑음 클립이 울린다.
    private func reschedule(alarmID: String) async {
        guard let alarmKit,
              let updated = store.record(id: alarmID),
              updated.enabled else { return }
        let previous = updated
        // 새 예약을 먼저 성공시킨 뒤 옛 핸들을 해제한다 — 순서를 뒤집으면 실패했을 때
        // 알람이 **무예약 상태로** 남는다(`RemoteAlarmPullSync.rescheduleReceivedRemote` 와 같은 규칙).
        let scheduled = await alarmKit.schedule(record: updated, store: store)
        if scheduled, previous.alarmKitID != nil {
            await alarmKit.cancelScheduledAlarm(record: previous)
        }
    }

    private struct GroupKey: Hashable {
        var country: String
        var city: String
        var targetDate: String
    }
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
