import SwiftUI

/// 설치 버전이 백엔드 최소지원버전 미만일 때(또는 이 빌드로는 동의를 정직하게 받을 수 없을 때) 표시되는 차단 화면.
/// 로그인 여부와 무관하게 앱 진입을 막고 스토어 업데이트만 유도한다.
///
/// 2026-11-15 다시 그렸다(오너) — 로그인 화면과 같은 밤하늘 배경(`AuthBackdrop`)에 유리 원 아이콘·제목·안내를 가운데 두고,
/// 버튼은 아래에 고정한 `GradientCta` 다. 예전에는 다른 차단 화면과 같은 `BlockingScreen` 이라 앱의 첫 화면들과 결이 달랐다.
/// 안내는 **업데이트해도 알람과 목소리가 그대로 남는다**고 말한다 — 막힌 사람이 가장 먼저 걱정하는 것이다.
/// 안드로이드 짝 `ui/app/UpdateRequiredScreen.kt`.
struct UpdateRequiredView: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let onUpdate: () -> Void

    var body: some View {
        AuthBackdrop {
            VStack(spacing: 0) {
                // ⚠ **버튼을 스크롤 밖 아래에 고정한다.** 이 화면의 탈출구는 그 버튼 하나뿐이라, 큰 글자에서 내용이 넘쳐도
                //   버튼은 늘 보여야 한다 — 밀려 나가면 앱이 벽돌이 된다. 넘치는 것은 위의 안내뿐이고 그건 스크롤한다.
                GeometryReader { proxy in
                    ScrollView {
                        VStack(spacing: 0) {
                            Image(systemName: "arrow.down.app")
                                .font(.system(size: 34, weight: .semibold))
                                .foregroundStyle(AuthSceneColors.accent)
                                .frame(width: 88, height: 88)
                                .background(AuthSceneColors.glassFill, in: Circle())
                                .overlay(Circle().stroke(AuthSceneColors.glassBorder, lineWidth: 1))
                                .accessibilityHidden(true)
                            Text("업데이트가 필요해요")
                                .font(theme.typography.headlineSmall)
                                .fontWeight(.bold)
                                .foregroundStyle(AuthSceneColors.text)
                                .multilineTextAlignment(.center)
                                .padding(.top, 24)
                            Text("새 버전에서만 쓸 수 있어요.\n업데이트해도 알람과 목소리는 그대로 남아요.")
                                .font(theme.typography.bodyLarge)
                                .foregroundStyle(AuthSceneColors.textDim)
                                .multilineTextAlignment(.center)
                                .padding(.top, 10)
                        }
                        .padding(.horizontal, 24)
                        // 짧을 때는 남는 높이의 가운데에 둔다.
                        .frame(maxWidth: .infinity, minHeight: proxy.size.height)
                    }
                    .scrollBounceBehavior(.basedOnSize)
                }
                GradientCta(title: "업데이트하기", action: onUpdate)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 16)
            }
        }
    }
}

#if DEBUG
#Preview("UpdateRequired") {
    UpdateRequiredView(onUpdate: {})
        .voiceAlarmPreviewEnvironment()
}
#endif
