import Foundation

/// 본 메인 탭 4개 외에 시트로 띄우는 보조 화면들의 식별자.
///
/// ContentView 안에 `private enum` 으로 묶여 있던 것을 internal 로 끌어올린다.
/// MainTabsView, Settings 화면, Home 의 빠른 가기 카드 모두에서 참조한다.
enum AuxiliaryScreen: String, Identifiable {
    case people
    case growth
    case billing

    var id: String { rawValue }

    var title: String {
        switch self {
        case .people: return "코드 등록"
        case .growth: return "캐릭터"
        case .billing: return "이용권"
        }
    }
}

/// 알람 편집 시트의 입력 식별자.
///
/// `.sheet(item:)` 패턴으로 시트를 띄우기 위해 식별 가능한 wrapper 가 필요하다.
/// `editingAlarmID == nil` 이면 새 알람, 값이 있으면 기존 알람 수정.
struct AlarmEditorTarget: Identifiable, Equatable {
    let id: String
    let editingAlarmID: String?

    /// 새 알람용 target. id 는 매번 새 값이라 sheet 가 항상 새로 뜬다.
    static func create() -> AlarmEditorTarget {
        AlarmEditorTarget(id: UUID().uuidString, editingAlarmID: nil)
    }

    /// 기존 알람 수정용 target. id 는 알람 id 를 그대로 써서 같은 알람 재오픈 시
    /// 시트가 다시 띄워지지 않게 한다.
    static func edit(_ alarmID: String) -> AlarmEditorTarget {
        AlarmEditorTarget(id: "edit-\(alarmID)", editingAlarmID: alarmID)
    }
}

/// 본 앱의 4개 메인 탭 enum.
///
/// ContentView 안의 `private enum NativeTab` 을 그대로 옮긴 것. internal 가시성으로
/// 끌어올려 BottomNavBar 와 MainTabsView 에서 공유한다.
enum NativeTab: String, CaseIterable, Identifiable {
    case home
    case voices
    case alarms
    case messages

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: return "홈"
        case .voices: return "음성"
        case .alarms: return "알람"
        case .messages: return "메시지"
        }
    }

    var navigationTitle: String {
        switch self {
        case .home: return "Naro"
        default: return title
        }
    }

    var systemImage: String {
        switch self {
        case .home: return "house"
        case .voices: return "mic"
        case .alarms: return "alarm"
        case .messages: return "message"
        }
    }
}
