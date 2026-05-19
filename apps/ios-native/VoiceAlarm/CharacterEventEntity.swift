import Foundation

// MARK: - CharacterEventEntity
//
// Android `CharacterEventEntity` (Room) 의 iOS 포팅. JSON 으로 영속화되며
// `CharacterEventStore` 에서 한 번에 메모리로 로드해 큐로 다룬다.
//
// 필드 매핑 (Android → iOS):
//   - event              → eventType        (`CharacterEventType.rawValue`)
//   - clientNonce        → clientNonce      (서버 멱등 키)
//   - localDate          → localDate        (yyyy-MM-dd, 디바이스 로컬 타임존)
//   - sourceAlarmId      → sourceAlarmId    (nil 허용)
//   - state              → syncState        (`CharacterEventSyncState.rawValue`)
//   - createdAtMillis    → createdAtMillis
//   - syncedAtMillis     → syncedAtMillis   (성공 시점 millis, nil 이면 미동기)
//   - lastError          → lastError        (마지막 실패 메시지)
//
// 추가 iOS 전용 필드:
//   - id                  : UUID. 동일 nonce 가 race 로 들어와도 디스크 식별자가 충돌하지 않게.
//   - occurredAtMillis    : 이벤트 발생 시각 (createdAtMillis 와 분리 — 큐 진입 지연 시 의미가 달라짐).
//   - contextJson         : 로컬 디버그/관측용 — 서버에는 전송하지 않는다 (Android `CharacterXpRequest`
//                          도 body 에 context 를 싣지 않음).
//   - attempts            : 재시도 횟수. 백오프/관측 용도.
//   - updatedAtMillis     : 마지막 상태 변경 시점.
struct CharacterEventEntity: Codable, Identifiable, Equatable, Hashable {
    let id: String
    let eventType: String
    let occurredAtMillis: Int64
    let clientNonce: String
    let localDate: String
    let sourceAlarmId: String?
    let contextJson: String?
    var syncState: String
    var attempts: Int
    var lastError: String?
    let createdAtMillis: Int64
    var syncedAtMillis: Int64?
    var updatedAtMillis: Int64

    init(
        id: String,
        eventType: String,
        occurredAtMillis: Int64,
        clientNonce: String,
        localDate: String,
        sourceAlarmId: String?,
        contextJson: String?,
        syncState: String,
        attempts: Int,
        lastError: String?,
        createdAtMillis: Int64,
        syncedAtMillis: Int64?,
        updatedAtMillis: Int64
    ) {
        self.id = id
        self.eventType = eventType
        self.occurredAtMillis = occurredAtMillis
        self.clientNonce = clientNonce
        self.localDate = localDate
        self.sourceAlarmId = sourceAlarmId
        self.contextJson = contextJson
        self.syncState = syncState
        self.attempts = attempts
        self.lastError = lastError
        self.createdAtMillis = createdAtMillis
        self.syncedAtMillis = syncedAtMillis
        self.updatedAtMillis = updatedAtMillis
    }
}

// MARK: - Enums
//
// Android 의 `CharacterEventTypes` / `CharacterEventStates` (string const 객체) 를
// Swift enum 으로 포팅. rawValue 는 서버 contract 와 동일하게 snake_case 유지.

enum CharacterEventType: String, Codable, CaseIterable, Sendable {
    case alarmCompleted = "alarm_completed"
    case alarmSnoozed = "alarm_snoozed"
}

enum CharacterEventSyncState: String, Codable, Sendable {
    case pending
    case synced
    case failed
}
