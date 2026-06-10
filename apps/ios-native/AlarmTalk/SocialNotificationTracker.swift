import Foundation

#if canImport(UserNotifications)
import UserNotifications
#endif

struct SocialNotificationRequest: Equatable {
    var noteID: String
    var title: String
    var body: String
}

struct SocialNotificationRefreshPlan: Equatable {
    var requests: [SocialNotificationRequest]
    var nextSeenNoteIDs: [String]
}

enum SocialNotificationTracker {
    private static let maxSeenNoteIDs = 200
    private static let maxNotificationsPerRefresh = 3
    private static let prefsPrefix = "voice_alarm_social_notifications_seen_note_ids"

    static func requestAuthorizationIfNeeded() async {
        #if canImport(UserNotifications)
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .notDetermined else { return }
        _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        #endif
    }

    static func notifyNewNotes(
        notes: [ReceivedNote],
        userID: String,
        allowInitialNotify: Bool = false
    ) async {
        let normalizedUserID = userID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedUserID.isEmpty else { return }

        let defaults = UserDefaults.standard
        let key = seenNoteIDsKey(userID: normalizedUserID)
        let plan = refreshPlan(
            notes: notes,
            seenNoteIDs: defaults.stringArray(forKey: key) ?? [],
            allowInitialNotify: allowInitialNotify
        )
        defaults.set(plan.nextSeenNoteIDs, forKey: key)
        guard !plan.requests.isEmpty else { return }

        #if canImport(UserNotifications)
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        guard canPostNotifications(status: settings.authorizationStatus) else { return }

        for request in plan.requests {
            let content = UNMutableNotificationContent()
            content.title = request.title
            content.body = request.body
            content.sound = .default
            content.threadIdentifier = "voice_alarm_messages"
            let notification = UNNotificationRequest(
                identifier: "voice-alarm-message-\(request.noteID)",
                content: content,
                trigger: nil
            )
            try? await center.add(notification)
        }
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

    static func refreshPlan(
        notes: [ReceivedNote],
        seenNoteIDs: [String],
        allowInitialNotify: Bool
    ) -> SocialNotificationRefreshPlan {
        let seenSet = Set(seenNoteIDs)
        let shouldNotify = allowInitialNotify || !seenSet.isEmpty
        let requests = shouldNotify
            ? notes
                .filter { isUnread($0) && !seenSet.contains($0.id) }
                .prefix(maxNotificationsPerRefresh)
                .map(notificationRequest)
            : []
        let nextSeen = (seenNoteIDs + notes.map(\.id))
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .deduplicatedPreservingOrder()
            .suffix(maxSeenNoteIDs)

        return SocialNotificationRefreshPlan(
            requests: Array(requests),
            nextSeenNoteIDs: Array(nextSeen)
        )
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

    private static func seenNoteIDsKey(userID: String) -> String {
        "\(prefsPrefix)_\(userID)"
    }

    private static func isUnread(_ note: ReceivedNote) -> Bool {
        let readAt = note.readAt?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return readAt.isEmpty
    }

    private static func notificationRequest(for note: ReceivedNote) -> SocialNotificationRequest {
        let sender = (note.senderName ?? note.senderEmail ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let text = note.text.trimmingCharacters(in: .whitespacesAndNewlines)
        return SocialNotificationRequest(
            noteID: note.id,
            title: sender.isEmpty ? "새 메시지" : sender,
            // Android `SocialNotificationFactory.kt:27` 과 동일 문구(마침표 없음).
            body: text.isEmpty ? "새 메시지가 도착했어요" : String(text.prefix(80))
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

private extension Array where Element == String {
    func deduplicatedPreservingOrder() -> [String] {
        var seen: Set<String> = []
        var result: [String] = []
        for value in self where !seen.contains(value) {
            seen.insert(value)
            result.append(value)
        }
        return result
    }
}
