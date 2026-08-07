import SwiftUI

/// 비로그인 사용자가 처음 만나는 진입 화면.
///
/// Android `apps/android-native/.../ui/auth/LandingScreen.kt:90-154` 를 1:1 포팅했다.
/// 구성 요소
///   1. AlarmTalk 브랜드 표식(단일 로고 마크)
///   2. 큰 카피 ("좋아하는 목소리로\n깨어나는 알람")
///   3. 알람 미리듣기 카드 — 32-bar 파형 + 재생 버튼. 번들 mp3 가 없을 때는
///      시각 시뮬레이션(5초 동안 progress 가 0→1) 으로 동작한다.
///   4. 하단 진입 버튼 2개 — [로그인] filled / [회원가입] outlined.
///
/// 소셜(Apple) 로그인은 이 화면에 두지 않고 로그인 화면 안에만 노출한다(Android 가
/// Google 을 AuthScreen 안에만 두는 것과 동일). NavigationStack 의 destination 으로
/// `LoginView` 를 push 한다.
struct LandingView: View {
    @Environment(\.voiceAlarmTheme) private var theme

    @State private var navigateToLogin: LoginMode?

    var body: some View {
        SunriseBackdrop {
            // ⚠ **두 덩어리를 위·아래로 벌린다**(안드로이드 `LandingScreen.kt:154-194` 의
            // `Arrangement.SpaceBetween`): 위에는 워드마크만, 아래에 헤드라인+서브카피+
            // 미리듣기 카드를 모은다. 전부 위에 붙여 놓으면 글자가 하늘을 덮어 일출 씬이
            // 배경이 아니라 '글자 뒤 그림' 이 되고, 두 앱이 완전히 다른 화면으로 보인다.
            //
            // 접근성 글꼴 확대·좁은 화면에서 내용이 넘쳐도 '시작하기' 는 아래 고정으로
            // 남도록, CTA 위 영역만 스크롤한다.
            VStack(alignment: .leading, spacing: 0) {
                GeometryReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 0) {
                            Text("AlarmTalk")
                                .font(theme.typography.titleLarge)
                                .fontWeight(.bold)
                                .foregroundStyle(AuthSceneColors.text.opacity(0.94))
                                .padding(.top, 18)

                            Spacer(minLength: 24)

                            VStack(alignment: .leading, spacing: 0) {
                                // 강조는 **가운데 키워드만**, 색만 다르고 굵기는 같다(둘 다 Bold).
                                (Text("좋아하는 ")
                                    + Text("목소리").foregroundColor(AuthSceneColors.accent)
                                    + Text("로\n깨어나는 아침"))
                                    .font(theme.typography.headlineLarge)
                                    .fontWeight(.bold)
                                    .foregroundStyle(AuthSceneColors.text)
                                    .multilineTextAlignment(.leading)

                                Color.clear.frame(height: 10)

                                Text("매일 아침, 그 목소리가 새로운 한마디로 깨워드려요.")
                                    .font(theme.typography.bodyMedium)
                                    .foregroundStyle(AuthSceneColors.textDim)

                                Color.clear.frame(height: 20)

                                VoicePreviewCard()
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        // 화면이 넉넉하면 뷰포트 높이를 채워 위·아래로 벌어지고,
                        // 모자라면 그때만 스크롤이 생긴다(안드로이드 heightIn(min:) 대응).
                        .frame(minHeight: proxy.size.height, alignment: .top)
                    }
                    .scrollBounceBehavior(.basedOnSize)
                }

                Color.clear.frame(height: 18)

                // 안드로이드는 CTA 가 **하나**다(LandingScreen.kt:194-198). 로그인/회원가입
                // 갈래는 로그인 화면 하단 전환 행에서 고른다 — 첫 화면에서 두 개를 물으면
                // 아직 계정이 있는지도 모르는 사람에게 결정을 강요하게 된다.
                GradientCta(title: "시작하기") {
                    navigateToLogin = .login
                }
            }
            .padding(.horizontal, 22)
            .padding(.top, 14)
            .padding(.bottom, 22)
        }
        .navigationBarBackButtonHidden(true)
        .task {
            // DEBUG 전용 — 화면 확인 진입점. 릴리스에서는 authScreen 이 항상 nil.
            switch UIPreviewSeed.authScreen {
            case "login": navigateToLogin = .login
            case "register": navigateToLogin = .register
            default: break
            }
        }
        .navigationDestination(item: $navigateToLogin) { mode in
            LoginView(initialMode: mode)
        }
    }
}

/// 상단 좌측 브랜드 표식 — 단일 로고 마크. Android `WakerBrandHeader:156-166` 의
/// 48dp 로고 이미지(WakerTileShape clip)에 대응한다. iOS 에는 별도 로고 에셋이 없어
/// 그라데이션 브랜드 박스 + 파형 심볼로 동일한 단일 마크를 그린다.
private struct WakerBrandHeader: View {
    @Environment(\.voiceAlarmTheme) private var theme

    var body: some View {
        RoundedRectangle(cornerRadius: theme.shapes.extraSmall, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [theme.palette.primary, theme.palette.secondary],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                Image(systemName: "waveform")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(theme.palette.onPrimary)
            )
            .frame(width: 48, height: 48)
            .accessibilityLabel("AlarmTalk")
    }
}

/// 목소리 미리듣기 카드 — 안드로이드 `LandingScreen.kt:454-537` `VoicePreviewCard`.
///
/// ⚠ **씬 위에 얹히는 글라스 카드다.** 테마 `surface` 로 칠하면 라이트 기기에서 흰 카드가
/// 일출 하늘을 가린다. 안드로이드는 반투명 흰색(`GlassFill`/`GlassBorder`)뿐이다.
///
/// 내용은 **실제로 재생되는 대사 3줄**이다. '내일 아침 / 07:30' 은 안드로이드에 없던
/// 문구였고, 무엇보다 이 카드의 요점(어떤 목소리가 무슨 말을 해 주는지)을 못 보여준다.
private struct VoicePreviewCard: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @StateObject private var preview = LandingPreviewController()

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            Button {
                preview.toggle()
            } label: {
                Image(systemName: preview.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(AuthSceneColors.accent)
                    .frame(width: 48, height: 48)
                    .background(Capsule().fill(AuthSceneColors.accent.opacity(0.18)))
                    .overlay(Capsule().stroke(AuthSceneColors.accent.opacity(0.45), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(!preview.hasAudio)
            .accessibilityLabel(preview.isPlaying ? "미리듣기 일시정지" : "목소리 미리듣기")

            VStack(alignment: .leading, spacing: 8) {
                Text("할아버지, 좋은 아침이에요\n오늘은 비가 온대요\n나가실 때 우산 꼭 챙기세요")
                    .font(theme.typography.bodyMedium)
                    .fontWeight(.medium)
                    .foregroundStyle(AuthSceneColors.text)
                    .fixedSize(horizontal: false, vertical: true)

                MiniWaveform(progress: preview.progress)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                .fill(AuthSceneColors.glassFill)
        )
        .overlay(
            RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                .stroke(AuthSceneColors.glassBorder, lineWidth: 1)
        )
    }
}

/// 30바 미니 파형. 재생된 만큼 왼쪽부터 accent 로 채워진다.
/// 안드로이드 `LandingScreen.kt:539-567` `MiniWaveform` 의 levels 를 그대로 옮겼다.
private struct MiniWaveform: View {
    let progress: Double

    private static let levels: [CGFloat] = [
        0.18, 0.30, 0.22, 0.46, 0.28, 0.58, 0.36, 0.68, 0.44, 0.60,
        0.32, 0.52, 0.40, 0.72, 0.48, 0.62, 0.34, 0.54, 0.26, 0.44,
        0.30, 0.50, 0.22, 0.38, 0.28, 0.46, 0.20, 0.34, 0.16, 0.26,
    ]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(Self.levels.enumerated()), id: \.offset) { index, level in
                let barProgress = Double(index) / Double(Self.levels.count - 1)
                let played = progress > 0 && barProgress <= progress
                Capsule()
                    .fill(played ? AuthSceneColors.accent : Color.white.opacity(0.30))
                    .frame(width: 1.5, height: 4 + level * 20)
                if index < Self.levels.count - 1 { Spacer(minLength: 0) }
            }
        }
        .frame(height: 26)
    }
}

// ⚠ **`LandingWaveformBar`(32칸 파형)를 되살리지 말 것**(2026-08-07 삭제).
// 선언만 있고 그리는 곳이 없었다. 안드로이드 랜딩도 파형을 쓰지 않는다.

/// 미리듣기 상태 컨트롤러.
///
/// 두 경로를 지원한다:
///   1. `Bundle.main.url(forResource: "landing_voice_preview", withExtension: "mp3")`
///      가 nil 이 아니면 `AudioPreviewPlayer` 로 실제 재생.
///   2. nil 이면 시각 시뮬레이션 — 5초 동안 progress 가 0→1 로 차오른다.
///
/// 두 경우 모두 progress 는 `Task.sleep` 기반 ticker 로 갱신한다.
@MainActor
/// 랜딩 미리듣기 재생 상태.
///
/// ⚠ **소리 없이 진행바만 채우는 '시뮬레이션' 을 되살리지 말 것.** 예전에는 번들에 mp3 가
/// 없어서 5초짜리 가짜 진행바를 돌렸다 — 버튼을 눌러도 아무 소리가 안 나는데 화면은
/// 재생 중처럼 보여, 이 카드가 보여줘야 할 단 하나(목소리가 어떤지)를 정반대로 전했다.
/// 이제 `AlarmTalk/Resources/landing_voice_preview.mp3` 가 번들에 있고, 그래도 못 찾으면
/// [hasAudio] 가 `false` 라 버튼이 **비활성**된다.
private final class LandingPreviewController: ObservableObject {
    @Published private(set) var isPlaying = false
    @Published private(set) var progress: Double = 0

    private let player = AudioPreviewPlayer()
    private var tickerTask: Task<Void, Never>?
    private var started = false

    private let bundledURL = Bundle.main.url(forResource: "landing_voice_preview", withExtension: "mp3")

    var hasAudio: Bool { bundledURL != nil }

    func toggle() {
        guard let url = bundledURL else { return }
        if isPlaying {
            player.pause()
            isPlaying = false
            tickerTask?.cancel()
            tickerTask = nil
            return
        }
        if started, player.resume() {
            isPlaying = true
        } else {
            player.onFinish = { [weak self] in
                Task { @MainActor in
                    self?.isPlaying = false
                    self?.progress = 0
                    self?.started = false
                }
            }
            guard (try? player.play(url: url)) != nil else { return }
            started = true
            isPlaying = true
        }
        startTicker()
    }

    private func startTicker() {
        tickerTask?.cancel()
        tickerTask = Task { @MainActor [weak self] in
            // 안드로이드도 80ms 마다 currentPosition 을 읽는다(LandingScreen.kt:471-477).
            while !Task.isCancelled {
                guard let self, self.isPlaying else { return }
                self.progress = self.player.playbackProgress
                try? await Task.sleep(nanoseconds: 80_000_000)
            }
        }
    }
}

#if DEBUG
#Preview("LandingView (light)") {
    NavigationStack {
        LandingView()
    }
    .voiceAlarmPreviewEnvironment()
}

#Preview("LandingView (dark)") {
    NavigationStack {
        LandingView()
    }
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}
#endif
