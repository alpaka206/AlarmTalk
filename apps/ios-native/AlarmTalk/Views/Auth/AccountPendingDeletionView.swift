import SwiftUI
import UIKit

/// 탈퇴 유예(pending_deletion) 상태로 로그인했을 때 표시되는 화면.
/// 30일 유예 안내 + 탈퇴 취소(복구)/로그아웃만 가능하다. 복구해야 앱을 다시 쓸 수 있다.
///
/// Android `AccountPendingDeletionScreen.kt` 의 1:1 포팅.
struct AccountPendingDeletionView: View {
    let busy: Bool
    let onRecover: () -> Void
    let onLogout: () -> Void

    /// ⚠ **ScrollView 를 빼지 말 것.** 이 화면의 탈출구는 아래 버튼 하나뿐이라, 큰
    /// 글꼴(손쉬운 사용의 더 큰 텍스트)에서 내용이 화면을 넘치면 버튼이 밖으로 나가
    /// **누를 방법이 사라진다** — 탈퇴를 되돌리려던 사용자가 30일 뒤 계정·알람·목소리를
    /// 잃고, 강제 업데이트 화면에서는 앱이 벽돌이 된다.
    /// 안드로이드도 같은 이유로 `verticalScroll` 을 둔다.
    /// ScrollView 안의 VStack 이 화면을 가득 채우도록. 내용이 짧으면 가운데 정렬을
    /// 유지하고, 넘치면 스크롤된다.
    private var scrollMinHeight: CGFloat {
        UIScreen.main.bounds.height * 0.7
    }

    var body: some View {
        ScrollView {
          VStack(spacing: 0) {
            Spacer()

            Image(systemName: "hourglass")
                .font(.system(size: 56, weight: .regular))
                .frame(width: 72, height: 72)
                .foregroundStyle(AlarmTalkTheme.error)

            Spacer().frame(height: 24)

            Text("회원 탈퇴가 진행 중이에요")
                .font(.title2.weight(.bold))
                .foregroundStyle(AlarmTalkTheme.text)
                .multilineTextAlignment(.center)

            Spacer().frame(height: 12)

            Text("신청일로부터 30일 뒤에 계정과 데이터가 완전히 삭제돼요.\n그 전에 탈퇴를 취소하면 계정을 그대로 복구할 수 있어요.")
                .font(.body)
                .foregroundStyle(AlarmTalkTheme.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            Spacer().frame(height: 32)

            Button(action: onRecover) {
                Text(busy ? "처리 중…" : "탈퇴 취소하고 계속 사용하기")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity, minHeight: 50)
            }
            .buttonStyle(.borderedProminent)
            .tint(AlarmTalkTheme.primary)
            .disabled(busy)

            Spacer().frame(height: 12)

            Button(action: onLogout) {
                Text("로그아웃")
                    .fontWeight(.medium)
                    .frame(maxWidth: .infinity, minHeight: 50)
            }
            .buttonStyle(.bordered)
            .tint(AlarmTalkTheme.primary)
            .disabled(busy)

            Spacer()
          }
          .padding(.horizontal, 32)
          // 내용이 짧을 때도 Spacer 가 위아래로 벌어지도록 최소 높이를 준다.
          .frame(maxWidth: .infinity, minHeight: scrollMinHeight)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AlarmTalkTheme.background)
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
