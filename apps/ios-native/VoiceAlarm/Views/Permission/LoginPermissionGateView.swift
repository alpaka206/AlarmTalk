import AVFoundation
import SwiftUI

#if canImport(AlarmKit)
import AlarmKit
#endif

/// 로그인 직후 처음 본 앱을 열었을 때 한 번에 권한을 안내하는 게이트.
///
/// Android `apps/android-native/.../ui/app/LoginPermissionGate.kt:32-106` 의
/// 의도와 동등. iOS 에서 다루는 권한은 두 종류다:
///   1. AlarmKit 권한 — 잠금화면 알람 예약 + ringing 능력. `AlarmManager.shared
///      .authorizationState == .authorized` 인지 확인.
///   2. 마이크 권한 — Voice Studio 녹음/클로닝의 전제. `AVAudioApplication
///      .shared.recordPermission == .granted`.
///
/// 둘 다 부족한 경우 사용자 입장에서 한 번에 안내받게 한다. 한쪽만 부족하면
/// 해당 항목만 강조해 보여준다. X를 누르면 본 시트가 닫히고, 본문 화면은
/// 그대로 노출되되 각 기능 진입 시점에 다시 검사한다.
///
/// 사용법
/// ```swift
/// LoginPermissionGateView {
///     MainTabsView()
/// }
/// ```
/// `content` 가 본 화면이고, gate 가 필요한 경우 본 화면 위로 시트가 떠 안내한다.
struct LoginPermissionGateView<Content: View>: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var alarmKit: AlarmKitViewModel
    @Environment(\.voiceAlarmTheme) private var theme

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
            .sheet(isPresented: $sheetVisible) {
                PermissionGateSheet(
                    snapshot: snapshot,
                    onRequestAlarmKit: requestAlarmAuthorization,
                    onRequestMicrophone: requestMicrophone,
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
        LoginPermissionSnapshot(
            alarmAuthorized: isAlarmAuthorized(alarmKit: alarmKit),
            microphoneGranted: isMicrophoneGranted()
        )
    }

    @MainActor
    private static func isAlarmAuthorized(alarmKit: AlarmKitViewModel) -> Bool {
        #if canImport(AlarmKit)
        alarmKit.refreshAuthorizationState()
        return alarmKit.alarmAuthorized
        #else
        // AlarmKit 미사용 SDK 빌드는 게이트 통과로 간주.
        return true
        #endif
    }

    private static func isMicrophoneGranted() -> Bool {
        if #available(iOS 17.0, *) {
            return AVAudioApplication.shared.recordPermission == .granted
        } else {
            return AVAudioSession.sharedInstance().recordPermission == .granted
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
}

private struct PermissionGateSheet: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let snapshot: LoginPermissionSnapshot
    let onRequestAlarmKit: () -> Void
    let onRequestMicrophone: () -> Void
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
                onTap: onRequestAlarmKit
            )
            PermissionItemRow(
                target: .microphone,
                granted: snapshot.microphoneGranted,
                onTap: onRequestMicrophone
            )
        }
        .padding(18)
    }
}

private struct PermissionItemRow: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let target: PermissionTarget
    let granted: Bool
    let onTap: () -> Void

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
