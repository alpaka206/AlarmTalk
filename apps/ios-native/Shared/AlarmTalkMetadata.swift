import Foundation

#if canImport(AlarmKit)
import AlarmKit

/// AlarmKit `AlarmAttributes<Metadata>` 의 메타데이터.
///
/// Phase 2-B4 에서 `playMode` 와 `voiceCacheKey` 를 추가해 LiveActivity / Widget /
/// alarmUpdates 핸들러가 어떤 사운드 전략으로 등록된 알람인지 식별할 수 있게 한다.
///
/// GROUP 3 에서 `alarmKitID` 와 `voiceText` 를 추가한다:
///   - `alarmKitID`: LiveActivity 의 Stop/Snooze 버튼이 `Button(intent:)` 로
///     `StopAlarmIntent(alarmID:)` / `SnoozeAlarmIntent(alarmID:)` 를 구성하려면
///     위젯이 AlarmKit UUID 문자열을 알아야 한다. attributes.metadata 는 위젯이
///     읽을 수 있는 유일한 per-alarm 식별 통로다.
///   - `voiceText`: Android RingingActivity 의 인용 보이스 문구 parity. alarm_only
///     모드가 아니고 비어있지 않을 때만 채워, LA 가 ring-moment 정보를 보여 준다.
///
/// 신규 필드는 모두 옵셔널이며 기본 생성자는 nil 을 채워 기존 호출처와 호환을 유지한다.
struct AlarmTalkMetadata: AlarmMetadata, Codable, Hashable, Sendable {
    var localAlarmID: String
    var label: String
    var playMode: String?
    var voiceCacheKey: String?
    /// AlarmKit `Alarm.id` (UUID) 문자열. LiveActivity 가 Stop/Snooze 인텐트를
    /// 구성할 때 사용한다. 기존 레코드(필드 없음)와의 호환을 위해 옵셔널.
    var alarmKitID: String?
    /// 알람 모먼트에 인용할 보이스 문구 (Android RingingActivity parity).
    var voiceText: String?

    init(
        localAlarmID: String,
        label: String,
        playMode: String? = nil,
        voiceCacheKey: String? = nil,
        alarmKitID: String? = nil,
        voiceText: String? = nil
    ) {
        self.localAlarmID = localAlarmID
        self.label = label
        self.playMode = playMode
        self.voiceCacheKey = voiceCacheKey
        self.alarmKitID = alarmKitID
        self.voiceText = voiceText
    }

    enum CodingKeys: String, CodingKey {
        case localAlarmID
        case label
        case playMode
        case voiceCacheKey
        case alarmKitID
        case voiceText
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.localAlarmID = try c.decode(String.self, forKey: .localAlarmID)
        self.label = try c.decode(String.self, forKey: .label)
        self.playMode = try c.decodeIfPresent(String.self, forKey: .playMode)
        self.voiceCacheKey = try c.decodeIfPresent(String.self, forKey: .voiceCacheKey)
        self.alarmKitID = try c.decodeIfPresent(String.self, forKey: .alarmKitID)
        self.voiceText = try c.decodeIfPresent(String.self, forKey: .voiceText)
    }
}
#endif
