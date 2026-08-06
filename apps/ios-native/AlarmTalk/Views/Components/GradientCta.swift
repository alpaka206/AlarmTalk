import SwiftUI

/// 인증 화면군의 **주 버튼** — 브랜드 가로 그라데이션 알약.
///
/// 안드로이드 `ui/auth/LandingScreen.kt:569-596` 의 `GradientCta`. 랜딩('시작하기')·
/// 로그인/가입·약관 동의·비밀번호 재설정 네 화면이 같은 버튼을 쓴다.
///
/// ⚠ **`.borderedProminent` 로 되돌리지 말 것.** 인증 배경은 고정 다크라 테마 primary
/// (라이트 #175FB0 / 다크 #A6D2FF)를 tint 로 쓰면 두 앱이 완전히 다른 버튼이 된다 —
/// 안드로이드는 언제나 파랑→하늘 그라데이션이다.
struct GradientCta: View {
    @Environment(\.voiceAlarmTheme) private var theme

    let title: String
    var enabled: Bool = true
    var loading: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Text(title)
                    .font(theme.typography.titleMedium)
                    .fontWeight(.bold)
                    .foregroundStyle(.white)
                    .opacity(loading ? 0 : 1)

                if loading {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(.white)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 56)
        }
        .buttonStyle(.plain)
        .background(
            LinearGradient(
                colors: [AuthSceneColors.ctaStart, AuthSceneColors.ctaEnd],
                startPoint: .leading, endPoint: .trailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous))
        // 안드로이드는 비활성일 때 버튼 전체 alpha 0.45 — 회색으로 바꾸지 않는다.
        .opacity(enabled && !loading ? 1 : 0.45)
        .disabled(!enabled || loading)
    }
}

/// 인증 화면군의 **보조 버튼**(이메일 인증, 코드 확인) — 씬 위 외곽선 버튼.
/// 안드로이드 `AuthScreen.kt:132-138` `authOutlinedButtonColors`/`authOutlinedButtonBorder`.
struct AuthOutlinedButton: View {
    @Environment(\.voiceAlarmTheme) private var theme

    let title: String
    var enabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(theme.typography.labelLarge)
                // 비활성일 때도 흰 계열을 유지한다 — 회색으로 떨어뜨리면 남색 배경에 묻힌다.
                .foregroundStyle(enabled ? AuthSceneColors.text : Color.white.opacity(0x59 / 255.0))
                .frame(maxWidth: .infinity, minHeight: 54)
        }
        .buttonStyle(.plain)
        .overlay(
            RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                .stroke(enabled ? AuthSceneColors.line : AuthSceneColors.lineSoft, lineWidth: 1)
        )
        .disabled(!enabled)
    }
}
