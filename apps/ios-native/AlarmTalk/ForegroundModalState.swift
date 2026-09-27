import SwiftUI
import UIKit

/// **시스템 권한 팝업이 떠 있거나 곧 뜰 수 있는가** — 우리 안내 알럿이 그 위·아래에 겹치지
/// 않게 하려고 둔다(`docs/spec/gates-and-overlays.md` 「개인 플랜 종료 안내」).
///
/// 왜 장면 상태(`scenePhase`)만으로는 모자라나: 팝업이 **뜬 뒤에는** 장면이 비활성이 되어
/// 알 수 있지만, 요청을 보낸 뒤 팝업이 뜨기까지의 틈에는 여전히 활성이다. 메인 탭은
/// 차단 게이트가 풀리는 **바로 그 순간** 알림 권한을 묻는데(`MainTabsView`), 같은 순간
/// 종료 안내도 판정되므로 둘이 함께 떴다(신규 가입·재설치에서 결정적으로 재현되는 순서다).
///
/// 규칙: 권한을 묻는 호출은 `track` 으로 감싼다. 판정은 `isPending` 하나다.
@MainActor
final class SystemPermissionPrompts: ObservableObject {
    static let shared = SystemPermissionPrompts()

    /// 지금 응답을 기다리는 권한 요청 수.
    @Published private(set) var inFlight = 0
    /// 메인 탭의 첫 알림 권한 확인이 끝났는가. 끝나기 전에는 팝업이 **곧** 뜰 수 있다.
    /// 이미 답한 사용자는 설정 조회만 하고 곧바로 끝난다.
    @Published private(set) var notificationRequestSettled = false

    /// 권한 요청이 떠 있거나 곧 뜰 수 있다 — 안내를 미룬다.
    var isPending: Bool { inFlight > 0 || !notificationRequestSettled }

    /// 권한 요청 하나를 감싼다. 끝나면(허용·거부·실패 모두) 세던 것을 내린다.
    func track<T>(_ body: () async throws -> T) async rethrows -> T {
        inFlight += 1
        defer { inFlight -= 1 }
        return try await body()
    }

    func markNotificationRequestSettled() {
        guard !notificationRequestSettled else { return }
        notificationRequestSettled = true
    }
}

/// 창에 **다른 모달**이 떠 있는지 UIKit 에 묻는다.
///
/// SwiftUI 는 이미 무언가를 띄운 화면 위에 루트의 `.alert` 를 올리지 못한다 — 경고 한 줄만
/// 남기고 **조용히 건너뛴다.** 그러면 상태는 '떠 있음' 인데 화면에는 없어, 그 상태가 다른
/// 안내까지 막는다(2026-09-27 리뷰). 시트·전체 화면 커버(우리 바텀시트 포함 —
/// `bottomSheet`·`redeemCodeSheet` 는 `fullScreenCover` 다)·알럿·확인 대화상자는 전부
/// 모달 표시라 여기 잡힌다.
@MainActor
enum ModalPresentationProbe {
    /// 무엇이든 떠 있는가.
    static var isPresentingModal: Bool {
        guard let root = rootViewController() else { return false }
        return firstPresented(from: root) != nil
    }

    /// 떠 있는 것 중에 알럿이 있는가 — 방금 띄운 안내가 **실제로 보이는지** 확인할 때 쓴다.
    static var isShowingAlert: Bool {
        guard let root = rootViewController() else { return false }
        var current = firstPresented(from: root)
        while let presented = current {
            if presented is UIAlertController { return true }
            current = presented.presentedViewController
        }
        return false
    }

    private static func rootViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let windows = scenes.flatMap(\.windows)
        let window = windows.first(where: \.isKeyWindow) ?? windows.first
        return window?.rootViewController
    }

    /// 표시 문맥이 루트가 아닌 자식에 걸려 있을 수도 있어 자식까지 훑는다.
    private static func firstPresented(from controller: UIViewController) -> UIViewController? {
        if let presented = controller.presentedViewController { return presented }
        for child in controller.children {
            if let presented = firstPresented(from: child) { return presented }
        }
        return nil
    }
}
