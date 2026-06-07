import SwiftUI

/// 탈퇴 유예(pending_deletion) 상태로 로그인했을 때 표시되는 화면.
/// 30일 유예 안내 + 탈퇴 취소(복구)/로그아웃만 가능하다. 복구해야 앱을 다시 쓸 수 있다.
///
/// Android `AccountPendingDeletionScreen.kt` 의 1:1 포팅.
struct AccountPendingDeletionView: View {
    let busy: Bool
    let onRecover: () -> Void
    let onLogout: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            Image(systemName: "hourglass")
                .font(.system(size: 56, weight: .regular))
                .frame(width: 72, height: 72)
                .foregroundStyle(VoiceAlarmTheme.error)

            Spacer().frame(height: 24)

            Text("회원 탈퇴가 진행 중이에요")
                .font(.title2.weight(.bold))
                .foregroundStyle(VoiceAlarmTheme.text)
                .multilineTextAlignment(.center)

            Spacer().frame(height: 12)

            Text("신청일로부터 30일 뒤에 계정과 데이터가 완전히 삭제돼요.\n그 전에 탈퇴를 취소하면 계정을 그대로 복구할 수 있어요.")
                .font(.body)
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            Spacer().frame(height: 32)

            Button(action: onRecover) {
                Text(busy ? "처리 중…" : "탈퇴 취소하고 계속 사용하기")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity, minHeight: 50)
            }
            .buttonStyle(.borderedProminent)
            .tint(VoiceAlarmTheme.primary)
            .disabled(busy)

            Spacer().frame(height: 12)

            Button(action: onLogout) {
                Text("로그아웃")
                    .fontWeight(.medium)
                    .frame(maxWidth: .infinity, minHeight: 50)
            }
            .buttonStyle(.bordered)
            .tint(VoiceAlarmTheme.primary)
            .disabled(busy)

            Spacer()
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(VoiceAlarmTheme.background)
    }
}

#if DEBUG
#Preview("PendingDeletion (light)") {
    AccountPendingDeletionView(busy: false, onRecover: {}, onLogout: {})
        .voiceAlarmPreviewEnvironment()
}

#Preview("PendingDeletion (dark)") {
    AccountPendingDeletionView(busy: true, onRecover: {}, onLogout: {})
        .preferredColorScheme(.dark)
        .voiceAlarmPreviewEnvironment()
}
#endif
