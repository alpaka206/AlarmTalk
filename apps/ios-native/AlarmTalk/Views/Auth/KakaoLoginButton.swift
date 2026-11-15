import SwiftUI

/// 카카오 로그인 버튼 — 안드로이드 `ui/auth/KakaoLogin.kt` 의 `KakaoLoginButton` 짝.
///
/// 카카오 디자인 가이드대로다: 노랑(#FEE500) 바탕, 검정(#000000) 공식 말풍선 심볼, 글자는 '카카오 로그인' 하나(검정 85%),
/// 모서리 12(`extraSmall`), 글꼴은 OS 기본. ⚠ 글자를 바꾸지 말 것 — 가이드가 허용하는 글자는 '카카오 로그인'(축약
/// '로그인')뿐이다. 가입 화면에서도 같다.
struct KakaoLoginButton: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let enabled: Bool
    let action: () -> Void

    // 브랜드 색(구글·애플 버튼과 같은 예외) — 테마 팔레트가 아니라 카카오가 정한 값이다. ⚠ 공식 리소스 이미지는 심볼·글자를
    // #191919 로 칠해 두었지만 직접 만드는 버튼의 기준은 가이드 문서다(심볼 #000000, 글자 #000000 85%).
    private static let container = Color(red: 0xFE / 255.0, green: 0xE5 / 255.0, blue: 0x00 / 255.0)
    private static let symbol = Color.black
    private static let label = Color.black.opacity(0.85)

    var body: some View {
        Button(action: action) {
            ZStack {
                Text("카카오 로그인")
                    .font(.system(.body, weight: .medium))
                    .foregroundStyle(Self.label)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .padding(.horizontal, 40)
                HStack {
                    KakaoSymbolShape()
                        .fill(Self.symbol)
                        .frame(width: 20, height: 20)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 16)
            }
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(Self.container, in: RoundedRectangle(cornerRadius: theme.shapes.extraSmall, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .opacity(enabled ? 1 : 0.38)
        .disabled(!enabled)
    }
}

/// 카카오 말풍선 심볼 — 카카오 공식 리소스(developers.kakao.com 「디자인 리소스 다운로드 · 카카오 로그인」의 Kakao Login.zip,
/// `SVG/kakao_login_light.svg`, 2026-08 판)의 경로를 그대로 옮겼다(원점만 옮겨 22×21 상자). 형태·비율·색을 바꾸지 말 것 —
/// 가이드가 금한다. 안드로이드 `res/drawable/ic_kakao_symbol.xml` 과 같은 경로다.
struct KakaoSymbolShape: Shape {
    func path(in rect: CGRect) -> Path {
        // 비율을 지키며(`min`) 가운데에 놓는다.
        let scale = min(rect.width / 22, rect.height / 21)
        let originX = rect.midX - 11 * scale
        let originY = rect.midY - 10.5 * scale
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: originX + x * scale, y: originY + y * scale)
        }
        var path = Path()
        path.move(to: point(11.0014, 0.0000))
        path.addCurve(to: point(0.0000, 8.9825), control1: point(4.9241, 0.0000), control2: point(0.0000, 4.0219))
        path.addCurve(to: point(5.1057, 16.5656), control1: point(0.0000, 12.1711), control2: point(2.0368, 14.9728))
        path.addLine(to: point(4.0681, 20.5677))
        path.addCurve(to: point(4.1424, 20.9033), control1: point(4.0295, 20.6871), control2: point(4.0598, 20.8151))
        path.addCurve(to: point(4.3653, 21.0000), control1: point(4.2029, 20.9659), control2: point(4.2855, 21.0000))
        path.addCurve(to: point(4.5607, 20.9289), control1: point(4.4341, 21.0000), control2: point(4.5029, 20.9772))
        path.addLine(to: point(9.0196, 17.8171))
        path.addCurve(to: point(10.9986, 17.9622), control1: point(9.6610, 17.9110), control2: point(10.3215, 17.9622))
        path.addCurve(to: point(22.0000, 8.9797), control1: point(17.0732, 17.9622), control2: point(22.0000, 13.9403))
        path.addCurve(to: point(11.0014, 0.0000), control1: point(22.0000, 4.0191), control2: point(17.0759, 0.0000))
        path.closeSubpath()
        return path
    }
}
