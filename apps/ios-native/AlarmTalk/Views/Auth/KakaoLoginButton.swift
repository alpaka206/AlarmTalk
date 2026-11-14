import SwiftUI

/// 카카오 로그인 버튼 — 안드로이드 `ui/auth/KakaoLogin.kt` 의 `KakaoLoginButton` 짝.
///
/// 카카오 디자인 가이드대로다: 노랑(#FEE500) 바탕, 검정 말풍선 심볼, 글자는 '카카오 로그인' 하나(검정 85%),
/// 모서리 12(`extraSmall`), 글꼴은 OS 기본. ⚠ 글자를 바꾸지 말 것 — 가이드가 허용하는 글자는 '카카오 로그인'(축약
/// '로그인')뿐이다. 가입 화면에서도 같다.
struct KakaoLoginButton: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let enabled: Bool
    let action: () -> Void

    // 브랜드 색(구글·애플 버튼과 같은 예외) — 테마 팔레트가 아니라 카카오가 정한 값이다.
    private static let container = Color(red: 0xFE / 255.0, green: 0xE5 / 255.0, blue: 0x00 / 255.0)
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
                        .fill(Self.label)
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

/// 카카오 말풍선 심볼. ⚠ 카카오 공식 리소스를 받기 전의 근사 도형이다 — 받으면 그 벡터로 바꾼다(안드로이드
/// `res/drawable/ic_kakao_symbol.xml` 과 같은 좌표다. 24×24 기준).
struct KakaoSymbolShape: Shape {
    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / 24
        let originX = rect.midX - 12 * scale
        let originY = rect.midY - 12 * scale
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: originX + x * scale, y: originY + y * scale)
        }
        var path = Path()
        path.move(to: point(12, 3.6))
        path.addCurve(to: point(2.4, 11.1), control1: point(6.7, 3.6), control2: point(2.4, 6.96))
        path.addCurve(to: point(6.86, 17.44), control1: point(2.4, 13.77), control2: point(4.18, 16.12))
        path.addLine(to: point(5.95, 20.78))
        path.addCurve(to: point(6.45, 21.13), control1: point(5.87, 21.07), control2: point(6.2, 21.3))
        path.addLine(to: point(10.43, 18.5))
        path.addCurve(to: point(12, 18.6), control1: point(10.94, 18.57), control2: point(11.46, 18.6))
        path.addCurve(to: point(21.6, 11.1), control1: point(17.3, 18.6), control2: point(21.6, 15.24))
        path.addCurve(to: point(12, 3.6), control1: point(21.6, 6.96), control2: point(17.3, 3.6))
        path.closeSubpath()
        return path
    }
}
