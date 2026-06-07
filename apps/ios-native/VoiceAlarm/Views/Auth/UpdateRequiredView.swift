import SwiftUI

/// 설치 버전이 백엔드 최소지원버전 미만일 때 표시되는 차단 화면.
/// 로그인 여부와 무관하게 앱 진입을 막고 스토어 업데이트만 유도한다.
///
/// Android `UpdateRequiredScreen.kt` 의 1:1 포팅.
struct UpdateRequiredView: View {
    let onUpdate: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            Image(systemName: "arrow.down.app")
                .font(.system(size: 56, weight: .regular))
                .frame(width: 72, height: 72)
                .foregroundStyle(VoiceAlarmTheme.primary)

            Spacer().frame(height: 24)

            Text("업데이트가 필요해요")
                .font(.title2.weight(.bold))
                .foregroundStyle(VoiceAlarmTheme.text)
                .multilineTextAlignment(.center)

            Spacer().frame(height: 12)

            Text("원활하고 안전한 이용을 위해\n최신 버전으로 업데이트해 주세요.")
                .font(.body)
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            Spacer().frame(height: 32)

            Button(action: onUpdate) {
                Text("업데이트하기")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity, minHeight: 50)
            }
            .buttonStyle(.borderedProminent)
            .tint(VoiceAlarmTheme.primary)

            Spacer()
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(VoiceAlarmTheme.background)
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
