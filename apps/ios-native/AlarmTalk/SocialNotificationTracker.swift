import Foundation

#if canImport(UserNotifications)
import UserNotifications
#endif

struct SocialNotificationRequest: Equatable {
    var noteID: String
    var title: String
    var body: String
}

enum SocialNotificationTracker {
    static func requestAuthorizationIfNeeded() async {
        #if canImport(UserNotifications)
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .notDetermined else { return }
        _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        #endif
    }

    static func notifyReceivedAlarm(alarmID: String, title: String, time: String) async {
        let request = receivedAlarmRequest(alarmID: alarmID, title: title, time: time)
        #if canImport(UserNotifications)
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        guard canPostNotifications(status: settings.authorizationStatus) else { return }

        let content = UNMutableNotificationContent()
        content.title = request.title
        content.body = request.body
        content.sound = .default
        content.threadIdentifier = "voice_alarm_received_alarms"
        let notification = UNNotificationRequest(
            identifier: "voice-alarm-received-alarm-\(request.noteID)",
            content: content,
            trigger: nil
        )
        try? await center.add(notification)
        #endif
    }

    static func receivedAlarmRequest(alarmID: String, title: String, time: String) -> SocialNotificationRequest {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedTime = time.trimmingCharacters(in: .whitespacesAndNewlines)
        return SocialNotificationRequest(
            noteID: alarmID,
            title: trimmedTitle.isEmpty ? "상대가 보낸 알람" : trimmedTitle,
            // Android `SocialNotificationFactory.kt:35` 과 동일 문구(마침표 없음).
            body: trimmedTime.isEmpty ? "상대가 내 알람을 설정했어요" : "\(trimmedTime)에 울려요"
        )
    }

    #if canImport(UserNotifications)
    private static func canPostNotifications(status: UNAuthorizationStatus) -> Bool {
        switch status {
        case .authorized, .provisional, .ephemeral:
            return true
        case .denied, .notDetermined:
            return false
        @unknown default:
            return false
        }
    }
    #endif
}
