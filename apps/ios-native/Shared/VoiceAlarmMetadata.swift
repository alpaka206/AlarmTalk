import Foundation

#if canImport(AlarmKit)
import AlarmKit

/// AlarmKit `AlarmAttributes<Metadata>` 의 메타데이터.
///
/// Phase 2-B4 에서 `playMode` 와 `voiceCacheKey` 를 추가해 LiveActivity / Widget /
/// alarmUpdates 핸들러가 어떤 사운드 전략으로 등록된 알람인지 식별할 수 있게 한다.
/// (Phase 1-B 가 SharedAlarmSnapshot 에 같은 필드를 도입했으므로 양쪽이 정합한다.)
///
/// 신규 필드는 모두 옵셔널이며 기본 생성자는 nil 을 채워 기존 호출처와 호환을 유지한다.
struct VoiceAlarmMetadata: AlarmMetadata, Codable, Hashable, Sendable {
    var localAlarmID: String
    var label: String
    var playMode: String?
    var voiceCacheKey: String?

    init(
        localAlarmID: String,
        label: String,
        playMode: String? = nil,
        voiceCacheKey: String? = nil
    ) {
        self.localAlarmID = localAlarmID
        self.label = label
        self.playMode = playMode
        self.voiceCacheKey = voiceCacheKey
    }

    enum CodingKeys: String, CodingKey {
        case localAlarmID
        case label
        case playMode
        case voiceCacheKey
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.localAlarmID = try c.decode(String.self, forKey: .localAlarmID)
        self.label = try c.decode(String.self, forKey: .label)
        self.playMode = try c.decodeIfPresent(String.self, forKey: .playMode)
        self.voiceCacheKey = try c.decodeIfPresent(String.self, forKey: .voiceCacheKey)
    }
}
#endif
