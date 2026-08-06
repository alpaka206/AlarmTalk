import SwiftUI

/// **랜딩 전용** 배경 — 일출 바다 씬.
///
/// 안드로이드 `ui/auth/LandingScreen.kt` 의 `SunriseScene` 을 SwiftUI `Canvas` 로 옮긴 것.
///
/// ⚠ **인증 배경은 두 종류다. 섞지 말 것.** 랜딩만 이 일출 씬이고, 로그인·가입·비밀번호
/// 재설정·약관 동의는 [AuthBackdrop] (네이비 그라데이션 + 상단 브랜드 글로우)을 쓴다 —
/// 안드로이드가 그렇게 갈라 뒀다(`AuthScreen.kt:73`). 일출 씬을 폼 화면 뒤에 깔면 태양·
/// 윤슬이 입력 필드를 지나가 글자가 안 읽힌다.
///
/// ⚠ **여기서만 raw hex 를 쓴다.** CLAUDE.md 의 「생 Color 금지」 규약은 문서화된 예외로
/// '랜딩/로그인 브랜드 비주얼' 을 두고 있다. 이 씬은 라이트/다크로 갈리지 않는 **고정
/// 일러스트**다 — 어두운 바다 위 대비로 설계돼서 라이트 팔레트를 얹으면 무너진다.
///
/// 좌표는 전부 화면 크기 비율이다(w/h 기준). 안드로이드와 같은 비율을 써야 두 앱이 같은
/// 그림이 된다 — 고정 pt 로 바꾸지 말 것.
struct SunriseBackdrop<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        ZStack {
            SunriseScene()
                .ignoresSafeArea()
            content()
        }
        // 씬이 어두운 고정 일러스트라 상태바 아이콘은 항상 밝은 쪽이어야 한다.
        .preferredColorScheme(.dark)
    }
}

/// 파형·윤슬이 움직이는 일출 씬. 유일한 애니메이션 항은 `phase` 다.
struct SunriseScene: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if reduceMotion {
            // 모션을 줄인 사용자에게는 정지 프레임으로 그린다(그림 자체는 그대로).
            Canvas { context, size in Self.draw(in: &context, size: size, phase: 0) }
        } else {
            TimelineView(.animation) { timeline in
                let t = timeline.date.timeIntervalSinceReferenceDate
                Canvas { context, size in
                    // 안드로이드는 6초 주기 무한 회전(0..2π). 같은 속도로 맞춘다.
                    Self.draw(in: &context, size: size, phase: t.truncatingRemainder(dividingBy: 6) / 6 * 2 * .pi)
                }
            }
        }
    }

    // MARK: - 색 (안드로이드 LandingScene 과 동일 값)

    private static let sky: [(CGFloat, Color)] = [
        (0.00, Color.hex(0x2C4B86)),
        (0.50, Color.hex(0x6D89B8)),
        (0.80, Color.hex(0xC2A78F)),
        (1.00, Color.hex(0xF0BC83)),
    ]
    private static let sunGlow = Color.hex(0xFFD494)
    private static let sunCore = Color.hex(0xFFF8E6)
    private static let seaTop = Color.hex(0x547199)
    private static let seaMid = Color.hex(0x23406C)
    private static let seaBottom = Color.hex(0x0A1730)
    private static let reflection = Color.hex(0xFFE0AA)
    private static let waveBack = Color.hex(0x2B4A78)
    private static let waveMid = Color.hex(0x16305A)
    private static let waveFront = Color.hex(0x0B1A36)
    private static let crest = Color.hex(0x7F9CC4)
    private static let bird = Color.hex(0x13233F)

    private static let horizonFrac: CGFloat = 0.52

    // MARK: - 드로잉

    static func draw(in context: inout GraphicsContext, size: CGSize, phase: Double) {
        let w = size.width, h = size.height
        let horizonY = h * horizonFrac
        let sunCenter = CGPoint(x: w * 0.68, y: horizonY - h * 0.11)
        let sunRadius = w * 0.105

        drawSky(&context, w: w, horizonY: horizonY)
        drawSunGlow(&context, w: w, horizonY: horizonY, sunCenter: sunCenter, sunRadius: sunRadius)
        drawBirds(&context, w: w, h: h, horizonY: horizonY)
        drawSea(&context, w: w, h: h, horizonY: horizonY)
        drawHorizonLight(&context, w: w, horizonY: horizonY, sunCenter: sunCenter)
        drawShimmer(&context, w: w, h: h, horizonY: horizonY, sunCenter: sunCenter, sunRadius: sunRadius, phase: phase)
        drawWaves(&context, w: w, h: h, horizonY: horizonY, phase: phase)
        drawScrim(&context, w: w, h: h)
    }

    private static func drawSky(_ c: inout GraphicsContext, w: CGFloat, horizonY: CGFloat) {
        c.fill(
            Path(CGRect(x: 0, y: 0, width: w, height: horizonY)),
            with: .linearGradient(
                Gradient(stops: sky.map { .init(color: $0.1, location: $0.0) }),
                startPoint: .zero,
                endPoint: CGPoint(x: 0, y: horizonY)
            )
        )
    }

    private static func drawSunGlow(
        _ c: inout GraphicsContext, w: CGFloat, horizonY: CGFloat,
        sunCenter: CGPoint, sunRadius: CGFloat
    ) {
        // 대기 글로우 — 세로로 0.30 배 눌러 납작한 타원으로.
        c.drawLayer { layer in
            layer.translateBy(x: 0, y: horizonY)
            layer.scaleBy(x: 1, y: 0.30)
            layer.translateBy(x: 0, y: -horizonY)
            let r = w * 0.52
            layer.fill(
                Path(ellipseIn: CGRect(x: sunCenter.x - r, y: horizonY - r, width: r * 2, height: r * 2)),
                with: .radialGradient(
                    Gradient(stops: [
                        .init(color: sunGlow.opacity(0.42), location: 0),
                        .init(color: sunGlow.opacity(0.12), location: 0.6),
                        .init(color: sunGlow.opacity(0), location: 1),
                    ]),
                    center: CGPoint(x: sunCenter.x, y: horizonY),
                    startRadius: 0, endRadius: r
                )
            )
        }
        // 태양 국소 글로우
        let gr = sunRadius * 2.4
        c.fill(
            Path(ellipseIn: CGRect(x: sunCenter.x - gr, y: sunCenter.y - gr, width: gr * 2, height: gr * 2)),
            with: .radialGradient(
                Gradient(stops: [
                    .init(color: sunGlow.opacity(0.50), location: 0),
                    .init(color: sunGlow.opacity(0.14), location: 0.55),
                    .init(color: sunGlow.opacity(0), location: 1),
                ]),
                center: sunCenter, startRadius: 0, endRadius: gr
            )
        )
        // 태양 원반
        c.fill(
            Path(ellipseIn: CGRect(
                x: sunCenter.x - sunRadius, y: sunCenter.y - sunRadius,
                width: sunRadius * 2, height: sunRadius * 2
            )),
            with: .radialGradient(
                Gradient(stops: [
                    .init(color: Color.hex(0xFFFDF4), location: 0),
                    .init(color: sunCore, location: 0.45),
                    .init(color: Color.hex(0xFFE2AC), location: 0.85),
                    .init(color: sunGlow.opacity(0.75), location: 1),
                ]),
                center: sunCenter, startRadius: 0, endRadius: sunRadius
            )
        )
    }

    /// 갈매기 3마리 — 태양 반대편 하늘에. 정지(애니메이션 없음).
    private static func drawBirds(_ c: inout GraphicsContext, w: CGFloat, h: CGFloat, horizonY: CGFloat) {
        let birdX = w * 0.32
        let specs: [(CGPoint, CGFloat)] = [
            (CGPoint(x: birdX, y: horizonY - h * 0.16), w * 0.024),
            (CGPoint(x: birdX + w * 0.13, y: horizonY - h * 0.21), w * 0.017),
            (CGPoint(x: birdX - w * 0.08, y: horizonY - h * 0.24), w * 0.012),
        ]
        for (center, s) in specs {
            var p = Path()
            p.move(to: CGPoint(x: center.x - s, y: center.y + s * 0.30))
            p.addQuadCurve(
                to: center,
                control: CGPoint(x: center.x - s * 0.5, y: center.y - s * 0.55)
            )
            p.addQuadCurve(
                to: CGPoint(x: center.x + s, y: center.y + s * 0.30),
                control: CGPoint(x: center.x + s * 0.5, y: center.y - s * 0.55)
            )
            c.stroke(p, with: .color(bird.opacity(0.75)), style: StrokeStyle(lineWidth: s * 0.14, lineCap: .round))
        }
    }

    private static func drawSea(_ c: inout GraphicsContext, w: CGFloat, h: CGFloat, horizonY: CGFloat) {
        c.fill(
            Path(CGRect(x: 0, y: horizonY, width: w, height: h - horizonY)),
            with: .linearGradient(
                Gradient(stops: [
                    .init(color: seaTop, location: 0),
                    .init(color: seaMid, location: 0.32),
                    .init(color: seaBottom, location: 1),
                ]),
                startPoint: CGPoint(x: 0, y: horizonY),
                endPoint: CGPoint(x: 0, y: h)
            )
        )
    }

    private static func drawHorizonLight(
        _ c: inout GraphicsContext, w: CGFloat, horizonY: CGFloat, sunCenter: CGPoint
    ) {
        var line = Path()
        line.move(to: CGPoint(x: 0, y: horizonY))
        line.addLine(to: CGPoint(x: w, y: horizonY))
        c.stroke(
            line,
            with: .linearGradient(
                Gradient(stops: [
                    .init(color: reflection.opacity(0), location: 0),
                    .init(color: reflection.opacity(0.9), location: 0.5),
                    .init(color: reflection.opacity(0), location: 1),
                ]),
                startPoint: CGPoint(x: sunCenter.x - w * 0.34, y: horizonY),
                endPoint: CGPoint(x: sunCenter.x + w * 0.34, y: horizonY)
            ),
            lineWidth: 2
        )
    }

    /// 윤슬 — 반사 기둥 + 반짝이 18줄. `phase` 가 흔들림과 폭을 만든다.
    private static func drawShimmer(
        _ c: inout GraphicsContext, w: CGFloat, h: CGFloat, horizonY: CGFloat,
        sunCenter: CGPoint, sunRadius: CGFloat, phase: Double
    ) {
        c.drawLayer { layer in
            layer.clip(to: Path(CGRect(x: 0, y: horizonY, width: w, height: h - horizonY)))
            // 반사 기둥 — 가로로 0.26 배 눌러 좁은 기둥으로.
            layer.drawLayer { pillar in
                pillar.translateBy(x: sunCenter.x, y: 0)
                pillar.scaleBy(x: 0.26, y: 1)
                pillar.translateBy(x: -sunCenter.x, y: 0)
                let depth = (h - horizonY) * 0.52
                pillar.fill(
                    Path(ellipseIn: CGRect(
                        x: sunCenter.x - depth, y: horizonY - depth,
                        width: depth * 2, height: depth * 2
                    )),
                    with: .radialGradient(
                        Gradient(stops: [
                            .init(color: reflection.opacity(0.30), location: 0),
                            .init(color: reflection.opacity(0.10), location: 0.6),
                            .init(color: reflection.opacity(0), location: 1),
                        ]),
                        center: CGPoint(x: sunCenter.x, y: horizonY),
                        startRadius: 0, endRadius: depth
                    )
                )
            }

            let glitterDepth = (h - horizonY) * 0.46
            let rowStep = glitterDepth / 18
            for i in 0..<18 {
                let t = CGFloat(i) / 17
                let y = horizonY + rowStep * (CGFloat(i) + 0.55)
                let spread = sunRadius * (0.30 + t * 1.5)
                let alpha = 0.62 * pow(1 - t, 2) + 0.05
                let wobble = CGFloat(sin(phase + Double(i) * 1.9)) * spread * 0.20
                let segW = spread * (0.66 + 0.26 * CGFloat(sin(phase * 2 + Double(i) * 2.6)))
                let segH = (1.6 + 1.2 * (1 - t))
                guard segW > 0, segH > 0 else { continue }

                layer.fill(
                    Path(roundedRect: CGRect(
                        x: sunCenter.x - segW / 2 + wobble, y: y - segH / 2,
                        width: segW, height: segH
                    ), cornerRadius: segH / 2),
                    with: .color(reflection.opacity(alpha))
                )

                // 짝수 줄에만 좌우 잔조각.
                guard i % 2 == 0 else { continue }
                let sideW = segW * 0.28
                guard sideW > 0 else { continue }
                layer.fill(
                    Path(roundedRect: CGRect(
                        x: sunCenter.x + spread * 0.70 + wobble * 0.6, y: y - segH / 2,
                        width: sideW, height: segH
                    ), cornerRadius: segH / 2),
                    with: .color(reflection.opacity(alpha * 0.5))
                )
                layer.fill(
                    Path(roundedRect: CGRect(
                        x: sunCenter.x - spread * 0.70 - sideW - wobble * 0.6, y: y - segH / 2,
                        width: sideW, height: segH
                    ), cornerRadius: segH / 2),
                    with: .color(reflection.opacity(alpha * 0.4))
                )
            }
        }
    }

    /// 파도 실루엣 3겹 — 뒤에서 앞으로 진폭이 커지고 위상이 어긋난다.
    private static func drawWaves(
        _ c: inout GraphicsContext, w: CGFloat, h: CGFloat, horizonY: CGFloat, phase: Double
    ) {
        let sea = h - horizonY
        let layers: [(CGFloat, CGFloat, Double, Color, Color?)] = [
            (horizonY + sea * 0.26, h * 0.014, phase, waveBack.opacity(0.9), crest.opacity(0.35)),
            (horizonY + sea * 0.46, h * 0.018, phase + 1.6, waveMid, crest.opacity(0.20)),
            (horizonY + sea * 0.68, h * 0.022, phase + 3.4, waveFront, nil),
        ]
        for (baseY, amp, ph, color, crestColor) in layers {
            let seg = w / 4
            var top = Path()
            top.move(to: CGPoint(x: 0, y: baseY + amp * CGFloat(sin(ph))))
            for i in 0..<4 {
                let cx = CGFloat(i) * seg + seg / 2
                let cy = baseY + amp * CGFloat(sin(ph + (Double(i) + 0.5) * 1.8)) - amp * 0.8
                let ex = CGFloat(i + 1) * seg
                let ey = baseY + amp * CGFloat(sin(ph + Double(i + 1) * 1.8))
                top.addQuadCurve(to: CGPoint(x: ex, y: ey), control: CGPoint(x: cx, y: cy))
            }
            var filled = top
            filled.addLine(to: CGPoint(x: w, y: h))
            filled.addLine(to: CGPoint(x: 0, y: h))
            filled.closeSubpath()
            c.fill(filled, with: .color(color))
            if let crestColor {
                c.stroke(top, with: .color(crestColor), style: StrokeStyle(lineWidth: 1.4, lineCap: .round))
            }
        }
    }

    /// 하단 스크림 — 글자 가독성을 위해 마지막에 얹는다.
    private static func drawScrim(_ c: inout GraphicsContext, w: CGFloat, h: CGFloat) {
        let top = h * 0.56
        c.fill(
            Path(CGRect(x: 0, y: top, width: w, height: h - top)),
            with: .linearGradient(
                Gradient(stops: [
                    .init(color: seaBottom.opacity(0), location: 0),
                    .init(color: seaBottom.opacity(0.55), location: 0.55),
                    .init(color: seaBottom.opacity(0.96), location: 1),
                ]),
                startPoint: CGPoint(x: 0, y: top),
                endPoint: CGPoint(x: 0, y: h)
            )
        )
    }
}

/// 씬 위에 얹는 글자 색 — 안드로이드 `TextOnScene` / `BrandAccentOnScene` 과 같은 값.
/// 씬이 고정 일러스트라 이 둘도 테마로 갈리지 않는다.
/// 인증 화면군 전용 고정 색 토큰. 안드로이드 `AuthScreen.kt:61-71` · `LandingScreen.kt:119-129`.
///
/// ⚠ **여기만 `MaterialTheme.colorScheme` 대응 없이 고정값이다.** CLAUDE.md 의 문서화된
/// 예외('랜딩/로그인 브랜드 비주얼') — 배경이 라이트/다크와 무관하게 항상 어두우므로
/// 테마 색을 쓰면 라이트 기기에서 흰 글자가 흰 배경색으로 바뀌어 안 보인다.
enum AuthSceneColors {
    /// `TextOnScene` — 씬 위 본문/제목.
    static let text = Color.hex(0xF8FAFF)
    /// `TextOnSceneDim` — 서브카피(원본은 알파 0xC8).
    static let textDim = Color.hex(0xE8EEFA).opacity(0xC8 / 255.0)
    /// `BrandAccentOnScene` — 강조 키워드·재생버튼·파형.
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
/// 은은한 네이비 그라데이션 + 상단 브랜드 글로우. 안드로이드 `AuthScreen.kt:73-103`.
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
            Text("AlarmTalk")
                .font(.title2.weight(.bold))
                .foregroundStyle(AuthSceneColors.text.opacity(0.94))
            Spacer()
            (Text("좋아하는 ")
                + Text("목소리").foregroundColor(AuthSceneColors.accent)
                + Text("로\n깨어나는 아침"))
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
