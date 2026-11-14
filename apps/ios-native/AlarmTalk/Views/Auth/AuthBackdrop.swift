import SwiftUI

/// **랜딩 전용** 배경 — 바다 위 일출 그림 한 장(`LandingBackground` 이미지).
///
/// 2026-11-14 오너: 코드로 그리던 일출 장면(갈매기가 선 세 개였다)을 그림으로 바꿨다. 안드로이드
/// `ui/auth/LandingScreen.kt` 의 `LandingScreen` 과 같은 그림이다(`res/drawable-nodpi/landing_background.webp`).
/// 예전 장면은 `TimelineView`·`Canvas` 로 그렸고, 그 클로저의 격리 때문에 1.2.13 iPad 에서 죽었다(Sentry
/// ALARMTALK-IOS-4) — 그 그리기 코드는 이제 없다.
///
/// ⚠ **인증 배경은 두 종류다. 섞지 말 것.** 랜딩만 이 그림이고, 로그인·가입·비밀번호 재설정·약관 동의는
/// [AuthBackdrop] (네이비 그라데이션 + 상단 브랜드 글로우)을 쓴다 — 안드로이드가 그렇게 갈라 뒀다(`AuthScreen.kt`).
/// 그림을 폼 화면 뒤에 깔면 해·물빛이 입력 칸을 지나가 글자가 안 읽힌다.
///
/// 화면 비율이 달라도 꽉 채우고 가운데를 기준으로 남는 쪽을 자른다(`scaledToFill`) — 해·갈매기는 그림 가로
/// 가운데 70% 안에 있다.
struct SunriseBackdrop<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        ZStack {
            GeometryReader { proxy in
                Image("LandingBackground")
                    .resizable()
                    .scaledToFill()
                    .frame(width: proxy.size.width, height: proxy.size.height)
                    .clipped()
            }
            .ignoresSafeArea()
            .accessibilityHidden(true)
            content()
        }
        // 그림이 어두운 고정 일러스트라 상태바 아이콘은 항상 밝은 쪽이어야 한다.
        .preferredColorScheme(.dark)
    }
}

/// 씬 위에 얹는 글자 색 — 안드로이드 `TextOnScene` / `BrandAccentOnScene` 과 같은 값.
/// 씬이 고정 일러스트라 이 둘도 테마로 갈리지 않는다.
/// 인증 화면군 전용 고정 색 토큰. 안드로이드 `AuthScreen.kt:58-68` · `LandingScreen.kt:119-129`.
///
/// ⚠ **여기만 `MaterialTheme.colorScheme` 대응 없이 고정값이다.** CLAUDE.md 의 문서화된
/// 예외('랜딩/로그인 브랜드 비주얼') — 배경이 라이트/다크와 무관하게 항상 어두우므로
/// 테마 색을 쓰면 라이트 기기에서 흰 글자가 흰 배경색으로 바뀌어 안 보인다.
enum AuthSceneColors {
    /// `TextOnScene` — 씬 위 본문/제목.
    static let text = Color.hex(0xF8FAFF)
    /// `TextOnSceneDim` — 서브카피(원본은 알파 0xC8).
    static let textDim = Color.hex(0xE8EEFA).opacity(0xC8 / 255.0)
    /// `BrandAccentOnScene` — 강조 키워드·재생 표시.
    static let accent = Color.hex(0xA6D2FF)

    /// `AuthLine` / `AuthLineSoft` — 입력 밑줄·구분선.
    static let line = Color.white.opacity(0x3D / 255.0)
    static let lineSoft = Color.white.opacity(0x29 / 255.0)
    /// `AuthFieldGlass` — 입력 필드 채움.
    static let fieldGlass = Color.white.opacity(0x14 / 255.0)
    /// `AuthTextMuted` — 보조 설명.
    static let textMuted = Color.white.opacity(0x99 / 255.0)

    /// `AuthErrorText` / `AuthNoticeText` — 이 화면은 고정 다크라 테마 error/primary 대신
    /// 밝은 고정색을 쓴다. **성공 안내를 오류색으로 그리지 말 것**(iOS 가 그러고 있었다).
    static let error = Color.hex(0xFFB4AB)
    static let notice = Color.hex(0xA8C8FF)

    /// `GlassFill` / `GlassBorder` — 씬 위 글라스 카드.
    static let glassFill = Color.white.opacity(0x21 / 255.0)
    static let glassBorder = Color.white.opacity(0x2E / 255.0)

    /// `BrandCtaStart` → `BrandCtaEnd` — 인증 4개 화면이 공유하는 주 버튼 그라데이션.
    static let ctaStart = Color.hex(0x3D74FF)
    static let ctaEnd = Color.hex(0x45B4F5)

    fileprivate static let sceneTop = Color.hex(0x1A2A52)
    fileprivate static let sceneMid = Color.hex(0x0E1938)
    fileprivate static let sceneBottom = Color.hex(0x070C1D)
}

/// 인증 폼 화면(로그인·가입·비밀번호 재설정·약관 동의) 공통 배경 —
/// 은은한 네이비 그라데이션 + 상단 브랜드 글로우. 안드로이드 `AuthScreen.kt:70-100`.
struct AuthBackdrop<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        ZStack {
            LinearGradient(
                stops: [
                    .init(color: AuthSceneColors.sceneTop, location: 0),
                    .init(color: AuthSceneColors.sceneMid, location: 0.55),
                    .init(color: AuthSceneColors.sceneBottom, location: 1),
                ],
                startPoint: .top, endPoint: .bottom
            )
            .ignoresSafeArea()

            // 상단 절반에만 브랜드 빛이 옅게 스며든다 — 밋밋함만 걷어내는 정도.
            // Compose radialGradient 의 기본 반지름은 그리는 박스의 min(가로,세로)/2 다.
            GeometryReader { proxy in
                let glowHeight = proxy.size.height * 0.5
                RadialGradient(
                    gradient: Gradient(colors: [AuthSceneColors.accent.opacity(0.13), .clear]),
                    center: .center,
                    startRadius: 0,
                    endRadius: min(proxy.size.width, glowHeight) / 2
                )
                .frame(width: proxy.size.width, height: glowHeight)
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)

            content()
        }
        .preferredColorScheme(.dark)
    }
}

#if DEBUG
#Preview("일출 씬") {
    SunriseBackdrop {
        VStack(alignment: .leading, spacing: 10) {
            Spacer()
            Text("좋아하는 \(Text("목소리").foregroundColor(AuthSceneColors.accent))로\n깨어나는 아침")
                .font(.system(size: 32, weight: .bold))
                .foregroundStyle(AuthSceneColors.text)
            Text("매일 아침, 그 목소리가 새로운 한마디로 깨워드려요.")
                .foregroundStyle(AuthSceneColors.textDim)
            Spacer().frame(height: 40)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(22)
    }
}
#endif
