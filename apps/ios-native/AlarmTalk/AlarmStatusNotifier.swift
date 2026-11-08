import Foundation
import UserNotifications

/// 예약하지 못해 **꺼 둔** 알람을 알린다(2026-11-09 오너 — "off 되도록 하고 알림을 띄우는 게 맞지 않아?").
///
/// 부르는 곳은 예약 복구(`AlarmKitViewModel.recoverScheduledAlarms`) 한 길목이다 — 예약 호출이 실패했거나, 1회성 알람의 시각이
/// 지나 다시 걸 수 없을 때. 행은 꺼지고 "알람 예약에 실패했어요." 가 붙는다(`AlarmRow`). 이 알림은 앱 밖에서도 알게 하려는
/// 것이다. 한 회차에 여럿이면 하나로 묶는다(같은 식별자로 덮는다). 알림 권한이 없으면 조용히 건너뛴다 — 행 표시는 남는다.
/// 안드로이드 짝은 `AlarmStatusNotifications`(`alarm/AlarmStatusNotifications.kt`).
enum AlarmStatusNotifier {
    static let identifier = "alarm-status-turned-off"

    static func notifyTurnedOff(_ records: [LocalAlarmRecord]) async {
        guard !records.isEmpty, !UIPreviewSeed.isEnabled else { return }
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
        let content = UNMutableNotificationContent()
        content.title = String(localized: "알람 예약에 실패했어요")
        if records.count == 1, let record = records.first {
            content.body = String(localized: "\(String(timeLabel(record))) 알람을 꺼 두었어요. 눌러서 다시 켜 주세요.")
        } else {
            content.body = String(localized: "알람 \(Int(records.count))개를 꺼 두었어요. 눌러서 다시 켜 주세요.")
        }
        content.sound = .default
        try? await center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
    }

    /// "오전 6:30" — 기기의 12/24시간 설정과 언어를 따른다(목록 행과 같은 결).
    private static func timeLabel(_ record: LocalAlarmRecord) -> String {
        var components = DateComponents()
        components.hour = record.hour
        components.minute = record.minute
        let date = Calendar.current.date(from: components) ?? Date()
        return date.formatted(date: .omitted, time: .shortened)
    }
}
