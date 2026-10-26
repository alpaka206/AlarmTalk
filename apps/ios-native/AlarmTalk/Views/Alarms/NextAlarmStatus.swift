import SwiftUI

/// **다음 알람 상태**(2026-10-26 v1.3 W06, `docs/spec/alarm-lifecycle.md` 「다음 알람 상태 카드」) — 홈이 다음 알람에 대해 지금
/// 해야 할 일 **하나**를 말한다. 울리는 순간에는 아무것도 부르지 않는다(홈 화면에서만 판정한다).
///
/// 우선순위: 알람 권한 → 기본 목소리를 받는 중 → 날씨 갱신 실패 → 등록 목소리 이용 종료 예정 → 정상. 재동의·탈퇴 대기는 앱 전체를
/// 막는 화면이 따로 있어 다루지 않는다. 안드로이드 짝은 `ui/alarms/NextAlarmStatus.kt` 의 `nextAlarmStatus`.
enum NextAlarmStatus: Equatable {
    case ready
    case permissionMissing
    case voicePreparing
    case weatherStale
    case voiceEnding(Date)

    /// 날씨 테마는 울리기 하루 안쪽이 되면 그 날의 조건을 받아 둔다 — 그 창 안인데 이만큼 오래된 답이면 갱신하지 못한 것이다.
    static let weatherWindow: TimeInterval = 24 * 60 * 60
    static let weatherStaleAfter: TimeInterval = 30 * 60 * 60

    static func resolve(
        alarm: LocalAlarmRecord,
        nextFire: Date,
        alarmAuthorized: Bool,
        defaultVoiceDownloadInProgress: Bool,
        limitedPlanEndsAt: Date?,
        now: Date = Date()
    ) -> NextAlarmStatus {
        guard alarmAuthorized else { return .permissionMissing }
        let speaks = alarm.playModeEnum != .alarmOnly && alarm.voiceSourceEnum != .localAudio
        guard speaks else { return .ready }
        let systemVoice = isSystemVoiceId(alarm.voiceProfileId)
        if systemVoice && defaultVoiceDownloadInProgress { return .voicePreparing }
        let untilFire = nextFire.timeIntervalSince(now)
        if alarm.bucketId == "weather", untilFire >= 0, untilFire <= weatherWindow {
            let resolved = alarm.contextResolvedAtMillis.map { Date(timeIntervalSince1970: Double($0) / 1000) }
            if resolved.map({ nextFire.timeIntervalSince($0) > weatherStaleAfter }) ?? true { return .weatherStale }
        }
        if !systemVoice, alarm.voiceProfileId?.nilIfBlank != nil, let ends = limitedPlanEndsAt, ends <= nextFire {
            return .voiceEnding(ends)
        }
        return .ready
    }
}

struct NextAlarmStatusCard: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let status: NextAlarmStatus
    let voiceName: String?
    let onRequestPermission: () -> Void

    private var iconName: String {
        switch status {
        case .ready: return "checkmark.circle"
        case .permissionMissing: return "exclamationmark.circle"
        case .voicePreparing: return "arrow.down.circle"
        case .weatherStale, .voiceEnding: return "info.circle"
        }
    }

    private var message: String {
        switch status {
        case .ready:
            return String(localized: "다음 알람과 목소리가 준비됐어요.")
        case .permissionMissing:
            // iOS 의 사실 — AlarmKit 권한이 없으면 예약 자체가 안 된다(안드로이드 문구를 베끼지 않는다).
            return String(localized: "알람 권한이 없어 알람이 예약되지 않아요.")
        case .voicePreparing:
            return String(localized: "기본 목소리를 받고 있어요. 받는 동안에도 알람은 울려요.")
        case .weatherStale:
            return String(localized: "날씨를 아직 갱신하지 못했어요. 연결되면 다시 받아요.")
        case .voiceEnding(let ends):
            let day = PersonalPromo.dayLabel(ends.addingTimeInterval(-1))
            return String(localized: "등록한 목소리는 \(day)에 이용이 끝나요. 그 뒤에는 기본 목소리로 울려요.")
        }
    }

    var body: some View {
        Button {
            if status == .permissionMissing { onRequestPermission() }
        } label: {
            HStack(alignment: .center, spacing: 10) {
                Image(systemName: iconName)
                    .font(.system(size: 20))
                    .foregroundStyle(status == .permissionMissing ? theme.palette.error : theme.palette.primary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(voiceName.map { String(localized: "다음 알람 · \(String($0))") } ?? String(localized: "다음 알람"))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                    Text(message)
                        .font(theme.typography.bodyMedium)
                        .foregroundStyle(theme.palette.onSurface)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity)
            .background(theme.palette.surface, in: RoundedRectangle(cornerRadius: theme.shapes.extraSmall, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: theme.shapes.extraSmall, style: .continuous)
                    .stroke(theme.palette.outlineVariant, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(status != .permissionMissing)
    }
}
