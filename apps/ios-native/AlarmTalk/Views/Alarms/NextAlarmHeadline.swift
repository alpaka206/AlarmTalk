import SwiftUI

/// 알람 탭 맨 위의 상태 헤드라인 — "9시간 21분 후에 울려요."
///
/// 절대 시각은 바로 아래 카드에 이미 있으니 헤더는 **남은 시간**을 말한다.
/// '알람' 이라는 라벨을 따로 두지 않고 상태 문구를 그대로 헤드라인으로 승격한다
/// (디자인 언어: 제목 = 결론).
///
/// ⚠ **안드로이드와 한 곳만 다르다.** 안드로이드는 권한이 모자라도 `RingingService` 가
/// 소리를 내므로 헤드라인이 **언제나 남은 시간**이고 무엇이 모자란지는 아래 배너가 말한다.
/// iOS 는 AlarmKit 권한이 없으면 예약 자체가 안 돼 정말 안 울리므로, 그때는 남은 시간이
/// 거짓말이 된다 — `alarmPermissionMissing` 이면 그 사실을 대신 말한다.
///
/// Android `HomeComponents.kt` 의 상태 헤더 미러.
struct NextAlarmHeadline: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let nextAlarm: LocalAlarmRecord?
    let hasAnyAlarm: Bool
    var alarmPermissionMissing: Bool = false

    /// 분이 바뀌는 경계마다 갱신해 화면을 켜둔 채로도 어긋나지 않게 한다.
    @State private var now = Date()

    var body: some View {
        Text(statusText)
            .font(.title2.weight(.bold))
            .foregroundStyle(isWarning ? theme.palette.error : theme.palette.onBackground)
            // 이 헤더는 리스트 밖에 고정돼 있어 높이가 곧 목록에서 뺏는 화면이다.
            // 좁은 화면 + 큰 글꼴에서 세 줄로 번지지 않게 상한을 둔다.
            .lineLimit(2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .task(id: nextAlarm?.fireAtMillis) {
                guard nextAlarm != nil else { return }
                while !Task.isCancelled {
                    // 다음 '분' 경계까지만 잔다 — 60초 고정이면 초가 밀려 표시가 어긋난다.
                    let interval = Date().timeIntervalSince1970
                    let toNextMinute = 60 - interval.truncatingRemainder(dividingBy: 60)
                    try? await Task.sleep(nanoseconds: UInt64(toNextMinute * 1_000_000_000))
                    if Task.isCancelled { return }
                    now = Date()
                }
            }
    }

    private var isWarning: Bool { nextAlarm != nil && alarmPermissionMissing }

    // 반환형이 `LocalizedStringKey` 라서 보간이 든 문장도 카탈로그 키가 된다
    // ("%@ 후에 울려요."). `String` 이면 `Text(변수)` 로 그려져 번역이 죽는다.
    private var statusText: LocalizedStringKey {
        if let nextAlarm {
            if alarmPermissionMissing {
                return "권한이 꺼져 있어 알람이 울리지 않아요."
            }
            let remaining = nextAlarm.nextFireDate.timeIntervalSince(now)
            // ⚠ **'곧 울려요' 를 되살리지 말 것**(2026-08-18 지시). 남은 시간이 1분 미만일
            // 때만 다른 문장이 되면, 같은 자리의 말이 갑자기 바뀌어 눈이 다시 읽어야 한다.
            // 올림이라 1분 미만은 "1분 후에 울려요" 가 된다 — 틀린 말도 아니다.
            return "\(Self.remainingLabel(seconds: remaining)) 후에 울려요."
        }
        return hasAnyAlarm ? "모든 알람이 꺼진 상태입니다." : "알람이 없습니다."
    }

    /// "13시간 40분" / "2일 5시간" — 분 단위 올림, **상위 두 단위만** 노출.
    ///
    /// 여기서 `String(localized:)` 로 **미리** 번역해 둔다 — 위 `statusText` 의
    /// 보간 자리(`%@`)에 들어갈 값이라, 조각째로 넘기면 번역될 기회가 없다.
    static func remainingLabel(seconds: TimeInterval) -> String {
        // ⚠ **안드로이드와 같은 식이어야 한다**(`HomeComponents.kt` 의 `remainingDurationLabel`).
        // 거긴 밀리초에서 올림하고 여기는 초에서 올림한다 — `+59` 후 절삭은 소수 초에서
        // 한 칸 어긋나므로 `ceil` 로 명시한다. 최소 1분(0분이라고 말하지 않는다).
        let totalMinutes = max(Int(ceil(seconds / 60)), 1)
        let days = totalMinutes / (24 * 60)
        let hours = totalMinutes % (24 * 60) / 60
        let minutes = totalMinutes % 60
        if days > 0 {
            return hours > 0
                ? String(localized: "\(days)일 \(hours)시간")
                : String(localized: "\(days)일")
        }
        if hours > 0 {
            return minutes > 0
                ? String(localized: "\(hours)시간 \(minutes)분")
                : String(localized: "\(hours)시간")
        }
        return String(localized: "\(minutes)분")
    }
}

#if DEBUG
#Preview("헤드라인") {
    VStack(alignment: .leading, spacing: 16) {
        NextAlarmHeadline(nextAlarm: nil, hasAnyAlarm: false)
        NextAlarmHeadline(nextAlarm: nil, hasAnyAlarm: true)
    }
    .padding()
    .voiceAlarmPreviewEnvironment()
}
#endif
