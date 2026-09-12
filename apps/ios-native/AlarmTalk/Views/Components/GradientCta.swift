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

    // ⚠ **`String` 으로 되돌리지 말 것 — 번역이 죽는다.**
    // SwiftUI 는 `Text("리터럴")` 만 String Catalog 키로 잡고, `Text(변수)` 는
    // 로컬라이즈하지 않는다. 라벨을 `String` 으로 받으면 호출부가 리터럴을 줘도
    // 여기서 변수가 되어 카탈로그를 못 탄다 — 실제로 en 기기 로그인 화면이
    // 제목·부제만 영어고 **버튼은 '로그인' 인 채**였다(2026-08-10 시뮬레이터 확인).
    let title: LocalizedStringKey
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
            // ⚠ **없으면 '로그인' 글자만 눌린다**(2026-08-18 실기기 지적). 채움
            // (`.background`)은 **Button 바깥**에 붙어 있어 히트테스트에 안 잡히고,
            // 라벨 안에서 색이 있는 건 `Text` 뿐이라 좌우 여백이 통째로 죽는다.
            // 폭·높이를 `frame` 으로 넓히는 버튼은 **전부** 이 줄이 필요하다.
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(
            LinearGradient(
                colors: [AuthSceneColors.ctaStart, AuthSceneColors.ctaEnd],
                startPoint: .leading, endPoint: .trailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous))
        // 안드로이드와 같은 값으로 버튼 전체를 흐린다 — 회색으로 바꾸지 않는다.
        // ⚠ 0.45 로 되돌리지 말 것(2026-08-17): 채움과 흰 글자가 **같이** 흐려져
        // 대비가 3.4:1 까지 떨어졌다. 0.6 이면 비활성으로 읽히면서 글자는 남는다.
        .opacity(enabled && !loading ? 1 : 0.6)
        .disabled(!enabled || loading)
    }
}

/// 인증 화면군의 **보조 버튼**(이메일 인증, 코드 확인) — 씬 위 외곽선 버튼.
/// 안드로이드 `AuthScreen.kt:132-138` `authOutlinedButtonColors`/`authOutlinedButtonBorder`.
struct AuthOutlinedButton: View {
    @Environment(\.voiceAlarmTheme) private var theme

    // 라벨은 `LocalizedStringKey` — 이유는 위 `GradientCta.title` 주석 참조.
    let title: LocalizedStringKey
    var enabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(theme.typography.labelLarge)
                // 비활성일 때도 흰 계열을 유지한다 — 회색으로 떨어뜨리면 남색 배경에 묻힌다.
                // ⚠ 35%(0x59)는 대비 3.15:1 이라 읽기 어려웠다 — 55%(0x8C)로 올린다
                // (2026-08-17). 안드로이드 `authOutlinedButtonColors` 도 같은 값이다.
                .foregroundStyle(enabled ? AuthSceneColors.text : Color.white.opacity(0x8C / 255.0))
                .frame(maxWidth: .infinity, minHeight: 54)
                // 채움이 없고 테두리만 있는 버튼이라 **속이 통째로 비어 있다** — 없으면
                // 글자만 눌린다(위 `GradientCta` 와 같은 이유).
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(
            RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                .stroke(enabled ? AuthSceneColors.line : AuthSceneColors.lineSoft, lineWidth: 1)
        )
        .disabled(!enabled)
    }
}
