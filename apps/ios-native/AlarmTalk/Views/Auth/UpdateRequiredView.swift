import SwiftUI
import UIKit

/// 설치 버전이 백엔드 최소지원버전 미만일 때 표시되는 차단 화면.
/// 로그인 여부와 무관하게 앱 진입을 막고 스토어 업데이트만 유도한다.
///
/// Android `UpdateRequiredScreen.kt` 의 1:1 포팅.
struct UpdateRequiredView: View {
    let onUpdate: () -> Void

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

            Image(systemName: "arrow.down.app")
                .font(.system(size: 56, weight: .regular))
                .frame(width: 72, height: 72)
                .foregroundStyle(AlarmTalkTheme.primary)

            Spacer().frame(height: 24)

            Text("업데이트가 필요해요")
                .font(.title2.weight(.bold))
                .foregroundStyle(AlarmTalkTheme.text)
                .multilineTextAlignment(.center)

            Spacer().frame(height: 12)

            Text("이 버전은 더 이상 쓸 수 없어요.\n최신 버전으로 업데이트해 주세요.")
                .font(.body)
                .foregroundStyle(AlarmTalkTheme.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            Spacer().frame(height: 32)

            Button(action: onUpdate) {
                Text("업데이트하기")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity, minHeight: 50)
            }
            .buttonStyle(.borderedProminent)
            .tint(AlarmTalkTheme.primary)

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
#Preview("UpdateRequired (light)") {
    UpdateRequiredView(onUpdate: {})
        .voiceAlarmPreviewEnvironment()
}

#Preview("UpdateRequired (dark)") {
    UpdateRequiredView(onUpdate: {})
        .preferredColorScheme(.dark)
        .voiceAlarmPreviewEnvironment()
}
#endif
