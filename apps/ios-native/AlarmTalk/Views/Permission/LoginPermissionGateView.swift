import AVFoundation
import SwiftUI

#if canImport(AlarmKit)
import AlarmKit
#endif

/// 권한 상태 스냅샷. AlarmKit + 마이크 두 권한만 다룬다 (Android 의 exact alarm,
/// full-screen intent 는 iOS 에서 AlarmKit 권한이 한 번에 흡수).
///
/// iOS 권한 프롬프트는 로그인 직후 자동으로 띄우지 않고, 홈/알람/목소리
/// 기능 진입 시점에 요청한다. 이 스냅샷은 해당 진입점들(HomeView 등)이
/// 권한 상태를 읽을 때 공유한다.
struct LoginPermissionSnapshot: Equatable {
    var alarmAuthorized: Bool
    var microphoneGranted: Bool
    /// 권한이 `.denied`/`.restricted` 로 굳어 in-app 재프롬프트가 막힌 상태.
    /// true 면 해당 항목의 CTA 를 설정 앱 이동으로 바꾼다 (`.notDetermined` 은 false).
    var alarmRecoveryNeeded: Bool = false
    var microphoneRecoveryNeeded: Bool = false

    var allGranted: Bool { alarmAuthorized && microphoneGranted }

    static let unknown = LoginPermissionSnapshot(
        alarmAuthorized: false,
        microphoneGranted: false
    )

    @MainActor
    static func current(alarmKit: AlarmKitViewModel) -> LoginPermissionSnapshot {
        #if canImport(AlarmKit)
        // 단일 refresh 로 authorized + recoveryNeeded 를 함께 읽는다.
        alarmKit.refreshAuthorizationState()
        let alarmAuthorized = alarmKit.alarmAuthorized
        let alarmRecoveryNeeded = alarmKit.permissionRecoveryNeeded
        #else
        // AlarmKit 미사용 SDK 빌드는 게이트 통과로 간주.
        let alarmAuthorized = true
        let alarmRecoveryNeeded = false
        #endif
        return LoginPermissionSnapshot(
            alarmAuthorized: alarmAuthorized,
            microphoneGranted: isMicrophoneGranted(),
            alarmRecoveryNeeded: alarmRecoveryNeeded,
            microphoneRecoveryNeeded: isMicrophoneRecoveryNeeded()
        )
    }

    private static func isMicrophoneGranted() -> Bool {
        if #available(iOS 17.0, *) {
            return AVAudioApplication.shared.recordPermission == .granted
        } else {
            return AVAudioSession.sharedInstance().recordPermission == .granted
        }
    }

    /// 마이크가 `.denied` 로 굳었는지 — `.undetermined` 은 일반 요청으로 회복 가능하므로 false.
    private static func isMicrophoneRecoveryNeeded() -> Bool {
        if #available(iOS 17.0, *) {
            return AVAudioApplication.shared.recordPermission == .denied
        } else {
            return AVAudioSession.sharedInstance().recordPermission == .denied
        }
    }
}
