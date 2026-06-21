import AVFoundation
import SwiftUI

#if canImport(AlarmKit)
import AlarmKit
#endif

/// 권한 상태 스냅샷과 선택적 안내 시트.
///
/// iOS 권한 프롬프트는 로그인 직후 자동으로 띄우지 않고, 홈/알람/목소리
/// 기능 진입 시점에 요청한다. 이 파일의 스냅샷 타입은 해당 진입점들이
/// 권한 상태를 읽을 때 공유한다. iOS 에서 다루는 권한은 두 종류다:
///   1. AlarmKit 권한 — 잠금화면 알람 예약 + ringing 능력. `AlarmManager.shared
///      .authorizationState == .authorized` 인지 확인.
///   2. 마이크 권한 — Voice Studio 녹음/클로닝의 전제. `AVAudioApplication
///      .shared.recordPermission == .granted`.
struct LoginPermissionGateView<Content: View>: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var alarmKit: AlarmKitViewModel
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.scenePhase) private var scenePhase

    @State private var snapshot = LoginPermissionSnapshot.unknown
    @State private var sheetVisible = false
    /// 같은 토큰에 대해 한 번만 자동 노출 — 사용자가 닫으면 그 세션 동안 다시 띄우지 않음.
    @State private var handledTokenForAutoShow: String?

    let content: () -> Content

    init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }

    var body: some View {
        content()
            .task(id: auth.session?.token) {
                await refreshSnapshot()
                handleAutoShow()
            }
            .onChange(of: snapshot) { _, new in
                if new.allGranted {
                    sheetVisible = false
                }
            }
            .onChange(of: scenePhase) { _, newPhase in
                // 사용자가 설정 앱에서 권한을 켜고 돌아오면 스냅샷을 새로 읽어,
                // 모두 허용됐다면 게이트가 자동으로 닫히도록 한다 (Android ON_RESUME refresh parity).
                guard newPhase == .active else { return }
                Task { await refreshSnapshot() }
            }
            .sheet(isPresented: $sheetVisible) {
                PermissionGateSheet(
                    snapshot: snapshot,
                    onRequestAlarmKit: requestAlarmAuthorization,
                    onRequestMicrophone: requestMicrophone,
                    onOpenSettings: { openAppSettings() },
                    onClose: { sheetVisible = false }
                )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
            }
    }

    // MARK: - Snapshot + side effects

    private func refreshSnapshot() async {
        snapshot = LoginPermissionSnapshot.current(alarmKit: alarmKit)
    }

    private func handleAutoShow() {
        guard let token = auth.session?.token else {
            handledTokenForAutoShow = nil
            sheetVisible = false
            return
        }
        if handledTokenForAutoShow == token { return }
        handledTokenForAutoShow = token
        if !snapshot.allGranted {
            sheetVisible = true
        }
    }

    private func requestAlarmAuthorization() {
        Task {
            await alarmKit.requestAuthorization()
            await refreshSnapshot()
        }
    }

    private func requestMicrophone() {
        if #available(iOS 17.0, *) {
            AVAudioApplication.requestRecordPermission { _ in
                Task { @MainActor in await self.refreshSnapshot() }
            }
        } else {
            AVAudioSession.sharedInstance().requestRecordPermission { _ in
                Task { @MainActor in await self.refreshSnapshot() }
            }
        }
    }
}

/// 권한 상태 스냅샷. AlarmKit + 마이크 두 권한만 다룬다 (Android 의 exact alarm,
/// full-screen intent 는 iOS 에서 AlarmKit 권한이 한 번에 흡수).
struct LoginPermissionSnapshot: Equatable {
    var alarmAuthorized: Bool
    var microphoneGranted: Bool
    /// 권한이 `.denied`/`.restricted` 로 굳어 in-app 재프롬프트가 막힌 상태.
    /// true 면 해당 항목의 CTA 를 설정 앱 이동으로 바꾼다 (`.notDetermined` 은 false).
    var alarmRecoveryNeeded: Bool = false
    var microphoneRecoveryNeeded: Bool = false

    var allGranted: Bool { alarmAuthorized && microphoneGranted }

    /// 어떤 권한이 가장 먼저 부족한지 — UI 강조용.
    var firstMissing: PermissionTarget? {
        if !alarmAuthorized { return .alarmKit }
        if !microphoneGranted { return .microphone }
        return nil
    }

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

enum PermissionTarget: String, Hashable {
    case alarmKit
    case microphone

    var title: String {
        switch self {
        case .alarmKit: return "알람 권한"
        case .microphone: return "마이크 권한"
        }
    }

    var description: String {
        switch self {
        case .alarmKit:
            return "잠금 화면에서도 정확한 시간에 알람을 울리려면 알람 권한이 필요해요."
        case .microphone:
            return "내 목소리를 녹음해 클로닝하거나 미리듣기를 하려면 마이크 권한이 필요해요."
        }
    }

    var systemImage: String {
        switch self {
        case .alarmKit: return "alarm.waves.left.and.right"
        case .microphone: return "mic.fill"
        }
    }

    var ctaLabel: String { "허용하기" }

    /// 거부/제한으로 굳어 재프롬프트가 막힌 경우의 CTA — 설정 앱으로 이동.
    var settingsCtaLabel: String { "설정 열기" }
}

private struct PermissionGateSheet: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let snapshot: LoginPermissionSnapshot
    let onRequestAlarmKit: () -> Void
    let onRequestMicrophone: () -> Void
    let onOpenSettings: () -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("알람 권한을 허용해 주세요")
                        .font(theme.typography.titleLarge)
                        .foregroundStyle(theme.palette.onSurface)
                    Text("정확한 시간에 알람을 울리고 잠금 화면에서 바로 열려면 아래 권한이 필요해요.")
                        .font(theme.typography.bodyMedium)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }

                Spacer()

                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.headline)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                        .frame(width: 32, height: 32)
                        .background(theme.palette.surfaceVariant, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("닫기"))
            }

            PermissionItemRow(
                target: .alarmKit,
                granted: snapshot.alarmAuthorized,
                recoveryNeeded: snapshot.alarmRecoveryNeeded,
                onTap: onRequestAlarmKit,
                onOpenSettings: onOpenSettings
            )
            PermissionItemRow(
                target: .microphone,
                granted: snapshot.microphoneGranted,
                recoveryNeeded: snapshot.microphoneRecoveryNeeded,
                onTap: onRequestMicrophone,
                onOpenSettings: onOpenSettings
            )
        }
        .padding(18)
    }
}

private struct PermissionItemRow: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let target: PermissionTarget
    let granted: Bool
    let recoveryNeeded: Bool
    let onTap: () -> Void
    let onOpenSettings: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(theme.palette.primaryContainer)
                Image(systemName: target.systemImage)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(theme.palette.onPrimaryContainer)
            }
            .frame(width: 38, height: 38)

            VStack(alignment: .leading, spacing: 2) {
                Text(target.title)
                    .font(theme.typography.bodyMedium.weight(.semibold))
                    .foregroundStyle(theme.palette.onSurface)
                Text(target.description)
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
            }

            Spacer()

            if granted {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(theme.palette.primary)
                    .font(.system(size: 22, weight: .semibold))
                    .accessibilityLabel("허용됨")
            } else if recoveryNeeded {
                // 거부/제한으로 굳어 in-app 재요청이 막힘 — 설정 앱으로 보낸다.
                Button(target.settingsCtaLabel, action: onOpenSettings)
                    .buttonStyle(.borderedProminent)
                    .tint(theme.palette.primary)
                    .foregroundStyle(theme.palette.onPrimary)
            } else {
                Button(target.ctaLabel, action: onTap)
                    .buttonStyle(.borderedProminent)
                    .tint(theme.palette.primary)
                    .foregroundStyle(theme.palette.onPrimary)
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(theme.palette.surfaceVariant)
        )
    }
}

#if DEBUG
#Preview("LoginPermissionGateView (light)") {
    LoginPermissionGateView {
        Color.gray.opacity(0.1)
            .overlay(Text("Main content").font(.title))
    }
    .voiceAlarmPreviewEnvironment()
}
#endif
