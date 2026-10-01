import Foundation

/// 공휴일 달력이 바뀌면 **'공휴일에는 끄기' 반복 알람을 다시 계산해 다시 건다** — 멱등.
///
/// 그런 알람은 AlarmKit 에 **한 번짜리 `.fixed` 예약**으로 걸린다(`LocalAlarmRecord.isHolidayOffRecurring`
/// — AlarmKit 반복은 공휴일을 건너뛸 줄 모른다). 절대 시각이라 OS 가 스스로 옮기지 않으므로, 나라가
/// 바뀐 뒤 다시 걸지 않으면 **다음 한 번은 옛 나라 달력으로** 울린다 — 새 나라의 평일인데 옛 나라의
/// 공휴일이라 **안 울리거나**, 새 나라의 공휴일인데 울린다. 안 울리는 쪽이 사고다.
///
/// 달력이 바뀌는 때는 셋이다: 사용자가 지역을 고를 때(설정·편집기 → `HolidayStore.adoptCountry(ofWeatherRegion:)`),
/// 서버에서 계정 지역을 받을 때(`adoptCountry(ofAccountWeatherRegion:userID:)`), 그리고 JP·US 공휴일을 서버에서 받아 왔을 때
/// (나라는 그대로지만 달력이 비어 있다가 채워진다 — `HolidayStore.calendarMarker` 의 `:pending`).
///
/// **멱등이다.** 마지막으로 다시 건 달력의 표지를 UserDefaults 에 남기고, 지금 표지와 같으면 아무것도 하지 않는다.
/// 그래서 몇 번을 불러도 달력 하나에 한 번만 돈다 — 같은 지역을 다시 고르거나 계정 설정을 받을 때마다 불려도
/// 예약을 흔들지 않는다. 표지는 **다 건 뒤에** 적으므로 도중에 앱이 죽으면 다음 실행에 다시 돈다.
/// 도는 중에 또 불리면 그 호출은 그냥 돌아가고, 도는 쪽이 끝날 때 표지를 다시 본다(그 사이 나라가 또
/// 바뀌었으면 한 번 더 돈다) — 같은 알람을 두 흐름이 동시에 다시 걸지 않는다.
@MainActor
final class HolidayOffRescheduler {
    /// 공휴일off 예약이 마지막으로 계산된 달력의 표지(`HolidayStore.calendarMarker` 모양).
    nonisolated static let markerDefaultsKey = "holiday.holidayOffScheduledCalendar"

    static let shared = HolidayOffRescheduler()

    private let defaults: UserDefaults
    private var running = false

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// 표지가 아직 없으면(이 업데이트 뒤 처음) 지금 나라로 적는다 — `HolidayStore.init` 이 부른다.
    ///
    /// 이미 걸려 있는 예약은 이 나라 달력으로 계산된 것이므로 다시 걸 까닭이 없다. **나라가 바뀌기 전에**
    /// 적어야 콜드 스타트에서 곧바로 바뀌는 나라(계정 지역을 받는 순간)를 놓치지 않는다.
    nonisolated static func recordInitialCalendarIfAbsent(_ country: String, defaults: UserDefaults = .standard) {
        guard defaults.string(forKey: markerDefaultsKey) == nil else { return }
        defaults.set(country.uppercased(), forKey: markerDefaultsKey)
    }

    /// 달력이 바뀌었으면 `recompute` 를 한 번 부르고 표지를 적는다.
    ///
    /// - Parameters:
    ///   - currentMarker: 지금 달력의 표지. nil 이면 **아직 판단할 수 없다**(공휴일 캐시·알람 저장소를 읽기 전,
    ///     로그인 전) — 아무것도 하지 않고, 표지도 건드리지 않는다. 조건이 갖춰지면 다시 불린다.
    ///   - recompute: 공휴일off 알람을 다시 계산해 다시 건다(`AlarmKitViewModel.recomputeHolidayOffAlarms`).
    ///     **끝까지 돌았는가**를 돌려준다 — 도중에 멈췄으면(계정을 떠나는 중) 표지를 적지 않아 다음에 다시 돈다
    ///     (Codex #837). 적어 버리면 남은 알람이 옛 달력의 날짜로 굳는다.
    /// - Returns: `recompute` 를 부른 횟수.
    @discardableResult
    func runIfNeeded(
        currentMarker: () -> String?,
        recompute: () async -> Bool
    ) async -> Int {
        guard !running else { return 0 }
        running = true
        defer { running = false }
        var runs = 0
        repeat {
            guard let marker = currentMarker() else { break }
            guard let done = defaults.string(forKey: Self.markerDefaultsKey) else {
                // 보통은 `HolidayStore.init` 이 먼저 적는다. 없으면 지금 달력을 기준으로 삼는다.
                defaults.set(marker, forKey: Self.markerDefaultsKey)
                continue
            }
            guard marker != done else { continue }
            let completed = await recompute()
            runs += 1
            guard completed else { break }
            // ⚠ **다시 건 그 달력의 표지를 적는다** — 지금 표지를 다시 읽지 않는다. 도는 사이 나라가 또
            //   바뀌었으면 여기 적힌 옛 표지와 달라서 아래 조건이 한 번 더 돌린다.
            defaults.set(marker, forKey: Self.markerDefaultsKey)
        } while needsRun(currentMarker())
        return runs
    }

    /// 표지에 **계정**을 싣는다(Codex #837). 다시 걸기는 지금 계정의 알람만 보므로, 표지가 달력만이면 한 기기의 다른
    /// 계정(A)이 같은 달력을 이미 적어 둔 뒤 들어온 B 의 알람은 옛 달력의 날짜로 남는다. 계정이 바뀌면 한 번 더 돈다
    /// (멱등). 안드로이드 `MainViewModel` 의 `calendarReadyFor` 도 계정을 함께 본다.
    nonisolated static func ownerScopedMarker(ownerUserID: String, calendarMarker: String) -> String {
        "\(ownerUserID)|\(calendarMarker)"
    }

    private func needsRun(_ marker: String?) -> Bool {
        guard let marker else { return false }
        return marker != defaults.string(forKey: Self.markerDefaultsKey)
    }
}
