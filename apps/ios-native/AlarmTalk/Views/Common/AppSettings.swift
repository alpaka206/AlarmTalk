import UIKit

/// 앱의 iOS 설정 화면(권한 토글이 있는 곳)을 연다.
///
/// 권한이 `.denied`/`.restricted` 로 굳으면 in-app 프롬프트는 더 이상 시스템
/// 다이얼로그를 띄우지 못한다 (iOS 는 거부 후 재요청을 막음). 이때 유일한 복구
/// 경로는 설정 앱이며, Android 의 `Context.openAppDetailsSettings()`
/// (`Settings.ACTION_APPLICATION_DETAILS_SETTINGS`) 와 동일한 역할을 한다.
@MainActor
func openAppSettings() {
    guard let url = URL(string: UIApplication.openSettingsURLString),
          UIApplication.shared.canOpenURL(url) else { return }
    UIApplication.shared.open(url)
}
