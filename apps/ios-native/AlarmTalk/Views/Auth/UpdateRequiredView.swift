import SwiftUI

/// 설치 버전이 백엔드 최소지원버전 미만일 때 표시되는 차단 화면.
/// 로그인 여부와 무관하게 앱 진입을 막고 스토어 업데이트만 유도한다.
///
/// Android `UpdateRequiredScreen.kt` 의 1:1 포팅.
struct UpdateRequiredView: View {
    let onUpdate: () -> Void

    var body: some View {
        BlockingScreen(
            systemImage: "arrow.down.app",
            tint: AlarmTalkTheme.primary,
            title: "업데이트가 필요해요",
            message: "이 버전은 더 이상 쓸 수 없어요.\n최신 버전으로 업데이트해 주세요."
        ) {
            Button(action: onUpdate) {
                Text("업데이트하기")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity, minHeight: 50)
            }
            .buttonStyle(.borderedProminent)
            .tint(AlarmTalkTheme.primary)
        }
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
