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
    /// 알람 시각(0…23 / 0…59). Live Activity 가 **시각을 가장 크게** 보여주기 위해
    /// 필요하다 — 안드로이드 울림 화면이 104sp 시계를 첫 요소로 두는 것과 같은 이유다.
    /// 잠결에 보는 화면이라 "지금 울리는 중" 보다 "오전 7:30" 이 먼저 읽혀야 한다.
    var hour: Int?
    var minute: Int?

    init(
        localAlarmID: String,
        label: String,
        playMode: String? = nil,
        voiceCacheKey: String? = nil,
        alarmKitID: String? = nil,
        voiceText: String? = nil,
        hour: Int? = nil,
        minute: Int? = nil
    ) {
        self.localAlarmID = localAlarmID
        self.label = label
        self.playMode = playMode
        self.voiceCacheKey = voiceCacheKey
        self.alarmKitID = alarmKitID
        self.voiceText = voiceText
        self.hour = hour
        self.minute = minute
    }

    /// "오전 7:30" — 없으면 nil(옛 레코드 호환).
    var clockLabel: String? {
        guard let hour, let minute, (0...23).contains(hour), (0...59).contains(minute) else { return nil }
        let h12 = hour % 12 == 0 ? 12 : hour % 12
        return String(format: "%@ %d:%02d", hour < 12 ? "오전" : "오후", h12, minute)
    }

    /// ⚠ **새 필드를 여기 빠뜨리면 조용히 사라진다.** `CodingKeys` 를 손으로 적는 순간
    /// `encode(to:)` 도 이 목록으로 합성되므로, 목록에 없는 저장 프로퍼티는 **쓰이지도
    /// 읽히지도 않는다.** 옵셔널이라 컴파일도 그대로 통과한다(`var x: Int?` 는 기본값 nil).
    /// 실제로 `hour`·`minute` 가 그렇게 빠져 있었고, 이 값은 앱에서 인코딩돼 **위젯 프로세스**
    /// 에서 디코딩되므로 Live Activity 가 늘 nil 을 받아 **큰 시계가 한 번도 안 그려졌다**
    /// (안드로이드 `RingingActivity` 의 104sp 시계 대응. 2026-09-08 실기기 지적).
    enum CodingKeys: String, CodingKey {
        case localAlarmID
        case label
        case playMode
        case voiceCacheKey
        case alarmKitID
        case voiceText
        case hour
        case minute
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.localAlarmID = try c.decode(String.self, forKey: .localAlarmID)
        self.label = try c.decode(String.self, forKey: .label)
        self.playMode = try c.decodeIfPresent(String.self, forKey: .playMode)
        self.voiceCacheKey = try c.decodeIfPresent(String.self, forKey: .voiceCacheKey)
        self.alarmKitID = try c.decodeIfPresent(String.self, forKey: .alarmKitID)
        self.voiceText = try c.decodeIfPresent(String.self, forKey: .voiceText)
        // 옛 레코드에는 없다 — 그때는 `clockLabel` 이 nil 이라 LA 가 모드 라벨로 폴백한다.
        self.hour = try c.decodeIfPresent(Int.self, forKey: .hour)
        self.minute = try c.decodeIfPresent(Int.self, forKey: .minute)
    }
}
#endif
