import Foundation
import SwiftUI

/// 본 메인 탭 3개 외에 시트로 띄우는 보조 화면들의 식별자.
///
/// ContentView 안에 `private enum` 으로 묶여 있던 것을 internal 로 끌어올린다.
/// MainTabsView, Settings 화면, Home 의 빠른 가기 카드 모두에서 참조한다.
enum AuxiliaryScreen: String, Identifiable, Hashable {
    case people
    case members
    case billing

    var id: String { rawValue }

    // 반환형이 `LocalizedStringKey` 여야 세 리터럴이 카탈로그 키로 잡힌다
    // (`String` 이면 `Text(변수)` 로 그려져 번역이 죽는다 — `GradientCta.title` 주석).
    var title: LocalizedStringKey {
        switch self {
        case .people: return "코드 등록"
        case .members: return "공유 이용권"
        case .billing: return "이용권"
        }
    }
}

/// 알람 편집 시트의 입력 식별자.
///
/// `.sheet(item:)` 패턴으로 시트를 띄우기 위해 식별 가능한 wrapper 가 필요하다.
/// `editingAlarmID == nil` 이면 새 알람, 값이 있으면 기존 알람 수정.
struct AlarmEditorTarget: Identifiable, Equatable, Hashable {
    let id: String
    let editingAlarmID: String?
    let familyAlarmMode: Bool
    /// 「누구를 깨울까요?」 에서 **고른 사람**. 편집기는 이 값을 그대로 쓴다.
    ///
    /// ⚠ **버리지 말 것.** 예전에는 시트가 `onSelectRecipient: { _ in }` 로 인자를
    /// 버렸고, 편집기는 `familyRecipients.first` 로 폴백해 **항상 첫 번째 구성원**에게
    /// 알람이 갔다. 구성원이 둘 이상이면 엉뚱한 사람이 깨어난다(2026-08-07 수정).
    /// 안드로이드는 `startCreateAlarm(familyTargetMode:targetUserId:)` 로 id 를 나른다.
    let recipientUserID: String?

    /// 새 알람용 target. id 는 매번 새 값이라 sheet 가 항상 새로 뜬다.
    static func create(familyAlarmMode: Bool = false) -> AlarmEditorTarget {
        AlarmEditorTarget(
            id: "\(familyAlarmMode ? "family" : "create")-\(UUID().uuidString)",
            editingAlarmID: nil,
            familyAlarmMode: familyAlarmMode,
            recipientUserID: nil
        )
    }

    /// 상대에게 보내는 가족/커플 알람 생성용 target. **고른 사람을 반드시 넘긴다.**
    static func createFamily(recipientUserID: String?) -> AlarmEditorTarget {
        AlarmEditorTarget(
            id: "family-\(UUID().uuidString)",
            editingAlarmID: nil,
            familyAlarmMode: true,
            recipientUserID: recipientUserID
        )
    }

    /// 기존 알람 수정용 target. id 는 알람 id 를 그대로 써서 같은 알람 재오픈 시
    /// 시트가 다시 띄워지지 않게 한다.
    static func edit(_ alarmID: String) -> AlarmEditorTarget {
        AlarmEditorTarget(
            id: "edit-\(alarmID)",
            editingAlarmID: alarmID,
            familyAlarmMode: false,
            recipientUserID: nil
        )
    }
}

/// 본 앱의 3개 메인 탭 enum.
///
/// ContentView 안의 `private enum NativeTab` 을 그대로 옮긴 것. internal 가시성으로
/// 끌어올려 BottomNavBar 와 MainTabsView 에서 공유한다.
/// ⚠ **탭 구성과 순서는 안드로이드와 같아야 한다** — 알람 / 목소리 / 더보기.
/// 예전 iOS 에는 안드로이드에 없는 '홈' 탭이 첫 자리에 있고 '더보기' 가 없었다.
/// 안드로이드의 첫 탭은 알람 목록 자체이고, 그 위에 남은 시간 헤드라인이 붙는다.
enum NativeTab: String, CaseIterable, Identifiable {
    case alarms
    case voices
    case menu

    var id: String { rawValue }

    // 반환형이 `LocalizedStringKey` 여야 세 리터럴이 카탈로그 키로 잡힌다 —
    // `String` 이면 하단 탭이 `Text(변수)` 로 그려져 en/ja 기기에서 한국어가 그대로 뜬다.
    var title: LocalizedStringKey {
        switch self {
        case .alarms: return "알람"
        case .voices: return "목소리"
        case .menu: return "더보기"
        }
    }

    var navigationTitle: LocalizedStringKey { title }

    var systemImage: String {
        switch self {
        case .alarms: return "alarm"
        case .voices: return "mic"
        case .menu: return "line.3.horizontal"
        }
    }

    /// 선택됐을 때의 채워진 아이콘. 안드로이드 `Icons.Filled.*` 미러.
    var selectedSystemImage: String {
        switch self {
        case .alarms: return "alarm.fill"
        case .voices: return "mic.fill"
        case .menu: return "line.3.horizontal"
        }
    }
}
