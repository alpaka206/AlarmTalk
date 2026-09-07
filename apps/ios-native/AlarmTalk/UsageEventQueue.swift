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

    /// 지금 로그인한 계정. **기록기가 스스로 채운다 — 부르는 쪽에 맡기지 않는다.**
    /// 호출부마다 넘기게 하면 언젠가 빠뜨리고, 빠진 행은 계정이 비어 있어 **다음에
    /// 로그인한 사람의 기록으로** 올라간다(서버는 토큰의 주인으로 적는다 — 되돌릴 수 없다).
    /// 안드로이드 `UsageEventRecorder(currentUserId)` 와 같은 자리다.
    private let currentUserID: @Sendable () -> String?

    init(
        fileURL: URL? = nil,
        currentUserID: @escaping @Sendable () -> String? = { KeychainStore.readSession()?.user.id }
    ) {
        self.currentUserID = currentUserID
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
        occurredAt: Date = Date(),
        /// **파일에 적힌 뒤**에 부른다(실패하면 부르지 않는다). 큐 스레드에서 온다.
        ///
        /// 이 큐는 무엇을 위한 신호인지 모른다 — "이 배치가 디스크에 남았다" 만 알린다.
        /// 부르는 쪽이 그 사실에 무엇을 매다는지는 그쪽 사정이다(iOS 울림 표시 등).
        onPersisted: (@Sendable () -> Void)? = nil
    ) {
        let trimmedDetail = detail.map { String($0.prefix(120)) }
        // 계정은 **적는 순간**에 정한다 — 파일 쓰기가 실제로 도는 시점이 아니라.
        // 큐 안에서 읽으면 그 틈에 로그아웃·로그인이 끼어들 때 A 의 사건이 B 의 이름으로
        // 저장된다(서버는 토큰의 주인으로 적으므로 되돌릴 수 없다).
        // `userID` 는 **덮어쓰기용**이다 — 편집기처럼 메모리에 든 세션이 더 정확한 자리
        // (Keychain 쓰기가 실패해도 세션은 살아 있다)만 넘긴다. `??` 라 그 자리는
        // 키체인을 읽지도 않는다.
        //
        // ⚠ **계정을 모르면 적지 않는다.** 비워 두면 다음에 로그인한 사람의 기록으로
        // 올라간다 — 서버는 토큰의 주인으로 적고(배치에 계정이 실리지 않는다) `user_id` 는
        // NOT NULL 이라, 주인 없는 사건은 **어차피 올바르게 올릴 방법이 없다.**
        // 잃는 것은 로그아웃 구간(자동 401 로 세션만 잃은 구간 포함)의 사건 몇 건이다.
        guard let resolvedUserID = (userID ?? currentUserID())?.nilIfBlank else { return }
        queue.async { [weak self] in
            guard let self else { return }
            let event = QueuedUsageEvent(
                id: UUID().uuidString,
                type: type,
                occurredAt: occurredAt,
                alarmID: alarmID,
                voiceProfileID: voiceProfileID,
                messageID: messageID,
                detail: trimmedDetail,
                userID: resolvedUserID
            )
            var events = self.loadLocked()
            events.append(event)
            if events.count > self.limit {
                events.removeFirst(events.count - self.limit)
            }
            guard self.saveLocked(events) else { return }
            onPersisted?()
        }
    }

    /// 보낼 것들을 오래된 순으로 꺼낸다(지우지는 않는다 — 성공한 뒤에 [remove] 를 부른다).
    func oldest(userID: String, limit: Int) -> [QueuedUsageEvent] {
        queue.sync {
            loadLocked()
                // 주인 없는 행은 보내지 않는다 — 이제 그런 행을 만들지도 않는다(위 `record`).
                // 남아 있다면 옛 빌드가 남긴 것이고, 그걸 지금 사람에게 붙이면 안 된다.
                .filter { $0.userID == userID }
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

    /// @return 실제로 파일에 남았으면 true. **실패를 삼키지 않는다** — 못 남긴 것을 남긴
    /// 것으로 알리면(위 `onPersisted`) 적히지 않은 울림을 적힌 것으로 오인해 삼킨다.
    @discardableResult
    private func saveLocked(_ events: [QueuedUsageEvent]) -> Bool {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(events) else { return false }
        do {
            try data.write(to: fileURL, options: .atomic)
            return true
        } catch {
            return false
        }
    }
}
