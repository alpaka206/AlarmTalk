import SwiftUI

/// 알람 권한 요청 + 현재 권한 상태 라벨 카드.
///
/// ContentView 의 `alarmPermissionSection` 을 옮긴 것. 알람 탭과 설정 탭
/// 두 곳에서 동일하게 사용한다.
struct AlarmPermissionSection: View {
    @EnvironmentObject private var alarmKit: AlarmKitViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("알람 권한")
                    .font(.headline)
                Spacer()
                PermissionPill(text: alarmKit.authorizationLabel)
            }
            // 필 라벨은 **상태**("거부됨")만 말한다. 상태는 무엇을 잃는지 알려 주지 않으므로
            // 권한이 없는 동안에는 **결과**를 함께 띄운다 (AlarmKitViewModel.alarmDeniedConsequence
            // 주석 참조 — iOS 는 정말 안 울린다).
            if !alarmKit.alarmAuthorized {
                Text(AlarmKitViewModel.alarmDeniedConsequence)
                    .font(.footnote)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
            }
            // 요청 결과 메시지는 결과 문구와 겹치지 않을 때만 덧붙인다.
            if let message = alarmKit.statusMessage,
               !message.contains(AlarmKitViewModel.alarmDeniedConsequence) {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
            }
            if alarmKit.permissionRecoveryNeeded {
                // 권한이 거부/제한으로 굳으면 in-app 재요청 프롬프트가 더 이상 뜨지 않는다.
                // 유일한 복구 경로인 설정 앱으로 보낸다 (Android openAppDetailsSettings parity).
                Button {
                    openAppSettings()
                } label: {
                    Label("설정에서 권한 켜기", systemImage: "gearshape.fill")
                }
                .buttonStyle(.borderedProminent)
                .tint(AlarmTalkTheme.primary)
                .foregroundStyle(AlarmTalkTheme.text)
            } else {
                Button {
                    Task { await alarmKit.requestAuthorization() }
                } label: {
                    Label("알람 권한 허용", systemImage: "alarm.fill")
                }
                .buttonStyle(.borderedProminent)
                .tint(AlarmTalkTheme.primary)
                .foregroundStyle(AlarmTalkTheme.text)
            }
        }
        .sectionSurface()
    }
}

#if DEBUG
#Preview("AlarmPermissionSection (light)") {
    AlarmPermissionSection()
        .padding()
        .voiceAlarmPreviewEnvironment()
}

#Preview("AlarmPermissionSection (dark)") {
    AlarmPermissionSection()
        .padding()
        .preferredColorScheme(.dark)
        .voiceAlarmPreviewEnvironment()
}
#endif
