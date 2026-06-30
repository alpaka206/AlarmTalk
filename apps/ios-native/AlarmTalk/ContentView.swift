import SwiftUI

/// 최상위 진입점. 본 파일은 Phase 3-C1 분해 후 단순 래퍼로 축약됐다.
///
/// 실제 화면 구성은 `Views/Root/RootView.swift` 와 그 하위 트리가 담당한다.
/// `AlarmTalkApp` 이 `ContentView()` 를 호출하던 외부 인터페이스 호환을 위해
/// 이름만 유지한다.
///
/// 분해 매핑:
/// - 라우팅 분기: `Views/Root/RootView.swift`
/// - 4개 탭 라우터/시트 호스트: `Views/Root/MainTabsView.swift`
/// - 바텀 네비: `Views/Root/BottomNavBar.swift`
/// - 홈 화면: `Views/Home/HomeView.swift`, `NextAlarmHeroCard.swift`,
///   `QuickStartGrid.swift`
/// - 알람 화면: `Views/Alarms/AlarmsListView.swift`, `AlarmRow.swift`,
///   `AlarmPermissionSection.swift`
/// - 음성 화면: `Views/Voices/VoicesPanelView.swift`, `VoiceProfilePicker.swift`
/// - 메시지 화면: `Views/Messages/MessagesView.swift`, `VoiceMessagePanel.swift`
/// - 설정 화면: `Views/Settings/SettingsView.swift`, `SettingsRow.swift`,
///   `AccountPanel.swift`, `PeoplePanel.swift`, `BillingPanel.swift`
/// - 알람 편집 시트: `Views/Editor/AlarmEditorSheet.swift`
/// - 보조 시트 호스트: `Views/Auxiliary/AuxiliarySheetHost.swift`
/// - 라우팅 모델: `Views/Auxiliary/AuxiliaryScreen.swift` (NativeTab/AuxiliaryScreen/AlarmEditorTarget)
/// - 공통 헬퍼: `Views/Common/SectionCard.swift`, `EmptyStatePlaceholder.swift`,
///   `ChipStyle.swift`, `HelperFormatters.swift`
struct ContentView: View {
    var body: some View {
        RootView()
    }
}
