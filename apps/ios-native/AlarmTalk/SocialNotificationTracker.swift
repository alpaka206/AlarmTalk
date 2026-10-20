import Foundation

import UserNotifications

enum SocialNotificationTracker {
    /// 알림 권한을 한 번 묻는다. 결제 실패 안내(`billing_hold`)는 서버가 alert 로 보내므로 권한이 있어야 보인다.
    static func requestAuthorizationIfNeeded() async {
        // 화면 확인 모드에서는 권한 팝업이 화면을 가린다(시뮬레이터엔 탭할 방법이 없다).
        if UIPreviewSeed.isEnabled { return }
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .notDetermined else { return }
        _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
    }
}
