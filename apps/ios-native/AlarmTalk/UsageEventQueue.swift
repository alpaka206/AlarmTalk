import Foundation

/// 남기는 사건의 종류. **서버 화이트리스트와 같은 값**이어야 한다
/// (`packages/shared/src/schemas/usage-event.ts`) — 모르는 값은 서버가 배치째 거절한다.
enum UsageEventType: String, Codable {
    case alarmCreated = "alarm_created"
    case alarmUpdated = "alarm_updated"
    case alarmDeleted = "alarm_deleted"
    case alarmRang = "alarm_rang"
    case alarmDismissed = "alarm_dismissed"
    case alarmSnoozed = "alarm_snoozed"
    /// 직접 입력 문구를 알람에 붙였다 = 그 오디오가 이 기기에서 '사용중'이 됐다.
    case manualMessageAttached = "manual_message_attached"
    /// 그 문구를 쓰는 알람이 이 기기에서 모두 사라져 오디오를 지웠다 = '비사용중'.
    case manualMessageReleased = "manual_message_released"
    case voiceCreated = "voice_created"
    case voiceDeleted = "voice_deleted"
}

/// 아직 못 보낸 사용 기록 한 건.
///
/// ⚠ **개인 텍스트를 담지 않는다.** 문구 원문은 이미 알람에 있고, 여기 사본을 만들면
/// 목소리 삭제·동의 철회 때 지워야 할 곳이 하나 더 늘어난다 — 식별자만 담는다.
struct QueuedUsageEvent: Codable, Identifiable, Equatable {
    /// 기기가 만드는 UUID. **서버 PK 와 같은 값**이라 재전송해도 겹치지 않는다(멱등).
    let id: String
    let type: UsageEventType
    /// 기기에서 **일어난** 시각. 며칠 늦게 보내도 이 값이 진실이다.
    let occurredAt: Date
    var alarmID: String?
    var voiceProfileID: String?
    var messageID: String?
    var detail: String?
    /// 어느 계정에서 남겼는가. 계정이 바뀌면 남은 큐를 새 주인 이름으로 보내지 않는다.
    var userID: String?
}

/// 사용 기록을 **파일에 쌓아 두는** 큐. 보내는 일은 `UsageEventUploader` 가 한다.
///
/// ⚠ **울릴 때 네트워크를 부르지 않는다**(CLAUDE.md 「Real alarm」). 알람 경로는 로컬·
/// 오프라인이 원칙이라, 울림은 여기 적기만 하고 전송은 그 뒤 아무 때나 한다.
///
/// ⚠ **기록 실패가 본업을 막지 않는다.** 알람을 만들고 지우고 울리는 것이 본업이고 기록은
/// 곁다리다 — 모든 경로가 실패를 삼키고 로그만 남긴다. 안드로이드 `UsageEventRecorder` 와
/// 같은 규칙이다.
final class UsageEventQueue: @unchecked Sendable {
    static let shared = UsageEventQueue()

    /// 큐 상한. 넘치면 **가장 오래된 것부터** 버린다 — 기록은 있으면 좋은 것이지 알람의
    /// 조건이 아니라, 몇 달치가 밀려 저장소를 먹는 것보다 오래된 몇 건을 잃는 편이 낫다.
    private let limit = 2000

    private let fileURL: URL
    /// 파일 접근을 직렬화한다. 기록은 아무 스레드에서나 들어온다(울림 서비스·편집기·동기화).
    private let queue = DispatchQueue(label: "com.alarmtalk.usage-events")

    init(fileURL: URL? = nil) {
        if let fileURL {
            self.fileURL = fileURL
        } else {
            let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            self.fileURL = directory.appendingPathComponent("usage-events.json")
        }
    }

    /// 사건 하나를 적는다. **부르는 쪽을 기다리게 하지 않는다.**
    func record(
        _ type: UsageEventType,
        alarmID: String? = nil,
        voiceProfileID: String? = nil,
        messageID: String? = nil,
        detail: String? = nil,
        userID: String? = nil,
        occurredAt: Date = Date()
    ) {
        let event = QueuedUsageEvent(
            id: UUID().uuidString,
            type: type,
            occurredAt: occurredAt,
            alarmID: alarmID,
            voiceProfileID: voiceProfileID,
            messageID: messageID,
            detail: detail.map { String($0.prefix(120)) },
            userID: userID
        )
        queue.async { [weak self] in
            guard let self else { return }
            var events = self.loadLocked()
            events.append(event)
            if events.count > self.limit {
                events.removeFirst(events.count - self.limit)
            }
            self.saveLocked(events)
        }
    }

    /// 보낼 것들을 오래된 순으로 꺼낸다(지우지는 않는다 — 성공한 뒤에 [remove] 를 부른다).
    func oldest(userID: String, limit: Int) -> [QueuedUsageEvent] {
        queue.sync {
            loadLocked()
                .filter { $0.userID == nil || $0.userID == userID }
                .sorted { $0.occurredAt < $1.occurredAt }
                .prefix(limit)
                .map { $0 }
        }
    }

    /// 서버가 받은 것만 지운다. 실패한 배치는 남아 다음 기회에 그대로 다시 간다.
    func remove(ids: Set<String>) {
        queue.async { [weak self] in
            guard let self else { return }
            self.saveLocked(self.loadLocked().filter { !ids.contains($0.id) })
        }
    }

    var count: Int { queue.sync { loadLocked().count } }

    // MARK: - 파일

    private func loadLocked() -> [QueuedUsageEvent] {
        guard let data = try? Data(contentsOf: fileURL) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return (try? decoder.decode([QueuedUsageEvent].self, from: data)) ?? []
    }

    private func saveLocked(_ events: [QueuedUsageEvent]) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(events) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }
}
