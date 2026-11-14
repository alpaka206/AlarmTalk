import SwiftUI

/// 비로그인 사용자가 처음 만나는 진입 화면.
///
/// Android `apps/android-native/.../ui/auth/LandingScreen.kt:90-154` 를 1:1 포팅했다.
/// 구성 요소
///   1. AlarmTalk 브랜드 표식(단일 로고 마크)
///   2. 큰 카피 ("좋아하는 목소리로\n깨어나는 알람")
///   3. 알람 미리듣기 카드 — 30바 파형 + 재생 버튼. 번들 mp3 가 없으면 버튼이 비활성된다.
///   4. 하단 진입 버튼 하나 — [시작하기].
///
/// 소셜(Apple) 로그인은 이 화면에 두지 않고 로그인 화면 안에만 노출한다(Android 가
/// Google 을 AuthScreen 안에만 두는 것과 동일). NavigationStack 의 destination 으로
/// `LoginView` 를 push 한다.
struct LandingView: View {
    @Environment(\.voiceAlarmTheme) private var theme

    @State private var navigateToLogin: LoginMode?
    /// DEBUG 화면 확인용 — `-UIPreviewAuthScreen consent`.
    @State private var previewConsent = false

    var body: some View {
        SunriseBackdrop {
            // ⚠ **글자는 아래에 모은다**(안드로이드 `ui/auth/LandingScreen.kt` 의 `Arrangement.Bottom`):
            // 헤드라인+서브카피+미리듣기 칩을 아래에 붙이고 하늘은 비운다. 위에 붙여 놓으면 글자가 하늘을
            // 덮어 일출 그림이 배경이 아니라 '글자 뒤 그림' 이 되고, 두 앱이 완전히 다른 화면으로 보인다.
            //
            // 접근성 글꼴 확대·좁은 화면에서 내용이 넘쳐도 '시작하기' 는 아래 고정으로
            // 남도록, CTA 위 영역만 스크롤한다.
            VStack(alignment: .leading, spacing: 0) {
                GeometryReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 0) {
                            // 위의 'AlarmTalk' 워드마크는 없앴다(2026-11-14 오너 — 방금 누르고 들어온 아이콘 이름을
                            // 한 번 더 보여 줄 뿐이다). 남은 덩어리는 아래에 붙여 하늘을 비운다.
                            Spacer(minLength: 24)

                            VStack(alignment: .leading, spacing: 0) {
                                // 강조는 **가운데 키워드만**, 색만 다르고 굵기는 같다(둘 다 Bold).
                                Text("좋아하는 \(Text("auth.landing.voiceKeyword").foregroundColor(AuthSceneColors.accent))로\n깨어나는 아침")
                                    .font(theme.typography.headlineLarge)
                                    .fontWeight(.bold)
                                    .foregroundStyle(AuthSceneColors.text)
                                    .multilineTextAlignment(.leading)

                                Color.clear.frame(height: 10)

                                Text(String(localized: "매일 아침, 그 목소리가 새로운 한마디로 깨워드려요."))
                                    .font(theme.typography.bodyMedium)
                                    .foregroundStyle(AuthSceneColors.textDim)

                                Color.clear.frame(height: 20)

                                LandingVoicePreview()
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
            // 동의 화면은 실제로는 가입/로그인 뒤에만 뜨는데, 그러려면 서버 왕복과
            // '동의 기록이 없는 계정' 이 필요해 화면 확인이 번거로웠다. 여기서 바로 연다.
            case "consent": previewConsent = true
            default: break
            }
        }
        .navigationDestination(item: $navigateToLogin) { mode in
            LoginView(initialMode: mode)
        }
        #if DEBUG
        .navigationDestination(isPresented: $previewConsent) {
            ConsentView(
                busy: false,
                collect: ["age14", "terms", "privacy", "overseas_transfer", "voice_biometric", "marketing"],
                optional: ["voice_biometric", "marketing"],
                isReconsent: false,
                onAgree: { _ in },
                onOpenTerms: {},
                onOpenPrivacy: {}
            )
        }
        #endif
    }
}

/// 로그인 전 미리듣기 한 칸 — 기본 목소리(이름은 화면에 쓰지 않고 VoiceOver 만 읽는다)·그 목소리의 한마디
/// (`res/raw/landing_preview_<목소리>.mp3`, iOS 도 이 폴더를 그대로 싣는다 — `project.yml`)·그 소리의 파형(실제 크기
/// 변화를 30칸으로 줄인 것). 순서는 앱의 기본 목소리 순서(시우·미나·도현·애니 — `SystemVoices.swift`).
/// 안드로이드 `ui/auth/LandingScreen.kt` 의 `LandingVoices` 와 같다.
private struct LandingPreviewVoice {
    let voiceID: String
    let clip: String
    let levels: [CGFloat]

    var displayName: String { systemVoiceDisplayName(id: voiceID, fallback: "") }

    static let all: [LandingPreviewVoice] = [
        LandingPreviewVoice(
            voiceID: systemVoiceIDPrefix + "000000000101", clip: "landing_preview_siwoo",
            levels: [
                0.80, 0.68, 0.67, 0.17, 0.12, 0.49, 0.77, 0.67, 0.51, 0.50, 0.71, 0.65, 0.64, 0.52, 0.30,
                0.13, 0.12, 0.43, 0.63, 0.50, 0.72, 0.35, 0.46, 0.61, 0.70, 0.34, 0.12, 0.65, 0.71, 0.20,
            ]
        ),
        LandingPreviewVoice(
            voiceID: systemVoiceIDPrefix + "000000000102", clip: "landing_preview_mina",
            levels: [
                0.40, 0.64, 0.38, 0.51, 0.80, 0.45, 0.53, 0.39, 0.13, 0.56, 0.72, 0.61, 0.53, 0.67, 0.42,
                0.15, 0.14, 0.53, 0.42, 0.39, 0.44, 0.61, 0.21, 0.57, 0.55, 0.40, 0.49, 0.54, 0.39, 0.21,
            ]
        ),
        LandingPreviewVoice(
            voiceID: systemVoiceIDPrefix + "000000000103", clip: "landing_preview_dohyun",
            levels: [
                0.52, 0.55, 0.57, 0.40, 0.12, 0.12, 0.67, 0.65, 0.52, 0.61, 0.52, 0.39, 0.45, 0.53, 0.49,
                0.23, 0.12, 0.51, 0.60, 0.63, 0.53, 0.47, 0.43, 0.12, 0.17, 0.80, 0.71, 0.70, 0.57, 0.13,
            ]
        ),
        LandingPreviewVoice(
            voiceID: systemVoiceIDPrefix + "000000000104", clip: "landing_preview_narin",
            levels: [
                0.43, 0.75, 0.79, 0.23, 0.35, 0.75, 0.80, 0.24, 0.13, 0.32, 0.57, 0.44, 0.31, 0.61, 0.29,
                0.26, 0.12, 0.12, 0.28, 0.39, 0.43, 0.21, 0.23, 0.56, 0.30, 0.17, 0.12, 0.33, 0.37, 0.21,
            ]
        ),
    ]
}

/// 로그인 전 미리듣기 — 상자 하나에서 기본 목소리 4종을 차례로 들려준다(2026-11-14 오너, 11-09 의 '미나 3문장
/// 하나만' 을 대신한다). 안드로이드 `ui/auth/LandingScreen.kt` 의 `LandingVoicePreview`.
///
/// - 처음엔 가족(할아버지) 샘플 하나와 그 3문장 자막이었다. 실제로는 연인이나 좋아하는 사람 같은 목소리를 찾는
///   사람이 많아, 목소리마다 다른 한마디(날씨·응원·안부·기상)를 들려준다. **글자는 쓰지 않는다** — 문장도 목소리
///   이름도. 보이는 것은 재생 표시·그 소리의 파형·몇 번째인지 알려 주는 점뿐이다. 상자는 둔다 — 없으면 다른 글자와
///   구분이 안 된다.
/// - **누르면 지금 목소리부터 차례로 이어서 튼다.** 끝까지 들으면 다음 목소리로 넘어가고, 마지막 뒤에는 멈추고
///   처음으로 돌아간다. 다시 누르면 일시정지, 또 누르면 그 자리에서 잇는다.
/// - **옆으로 밀면 목소리를 바꾼다**(왼쪽 = 다음, 끝에서 처음으로 돈다). 트는 중이면 바꾼 목소리를 곧바로 튼다.
///   무작위로 돌리지 않는다 — 같은 목소리가 연달아 나오고, 밀어서 고르는 순서와 어긋난다.
/// - VoiceOver 는 상자 하나를 '미리듣기'(트는 중이면 '일시정지')로 읽고 '<이름> 목소리, n/4' 를 붙이며, 위아래로
///   쓸어 목소리를 바꾼다(adjustable).
private struct LandingVoicePreview: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @StateObject private var preview = LandingPreviewController()
    @GestureState private var pressed = false

    var body: some View {
        let voices = LandingPreviewVoice.all
        let current = voices[preview.index]
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: preview.isPlaying ? "pause.fill" : "play.fill")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(AuthSceneColors.accent)
                .frame(width: 44, height: 44)
                .background(Capsule().fill(AuthSceneColors.accent.opacity(0.18)))
                .overlay(Capsule().stroke(AuthSceneColors.accent.opacity(0.45), lineWidth: 1))

            ZStack {
                MiniWaveform(levels: current.levels, progress: preview.progress)
                    .id(preview.index)
                    .transition(waveformTransition)
            }
            .frame(maxWidth: .infinity)
            .clipped()

            HStack(spacing: 5) {
                ForEach(voices.indices, id: \.self) { dot in
                    Circle()
                        .fill(dot == preview.index ? AuthSceneColors.accent : Color.white.opacity(0.30))
                        .frame(width: 6, height: 6)
                }
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                .fill(AuthSceneColors.glassFill)
        )
        .overlay(
            RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                .stroke(AuthSceneColors.glassBorder, lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous))
        // 상자 전체가 누르는 자리다. 미는 손짓이 따로 붙어 있어 `Button` 대신 탭 + 누름 상태로 만든다
        // (`PressFeedback.swift` 의 `pressScale` 주석 — 스와이프와 싸우지 않게).
        .pressScale(pressed)
        .onTapGesture { preview.toggle() }
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .updating($pressed) { value, state, _ in
                    state = abs(value.translation.width) < 10 && abs(value.translation.height) < 10
                }
        )
        .simultaneousGesture(
            DragGesture(minimumDistance: 16)
                .onEnded { value in
                    // 세로로 민 것은 화면 스크롤에 맡긴다 — 가로로 충분히 민 것만 목소리를 바꾼다.
                    guard abs(value.translation.width) > abs(value.translation.height),
                          abs(value.translation.width) > 36 else { return }
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.22)) {
                        preview.step(value.translation.width < 0 ? 1 : -1)
                    }
                }
        )
        .disabled(!preview.hasAudio)
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(preview.isPlaying ? String(localized: "일시정지") : String(localized: "미리듣기"))
        .accessibilityValue(String(localized: "\(current.displayName) 목소리, \(preview.index + 1)/\(voices.count)"))
        .accessibilityAction { preview.toggle() }
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: preview.step(1)
            case .decrement: preview.step(-1)
            @unknown default: break
            }
        }
        // 안드로이드의 사용자 지정 동작(다음·이전 목소리)과 같은 이름으로도 고를 수 있게 한다.
        .accessibilityAction(named: Text(String(localized: "다음 목소리"))) { preview.step(1) }
        .accessibilityAction(named: Text(String(localized: "이전 목소리"))) { preview.step(-1) }
        // 화면을 떠나면 멈춘다 — 안드로이드는 상자가 콤포지션에서 빠질 때 플레이어를 놓는다(`DisposableEffect`).
        .onDisappear { preview.stop() }
    }

    /// 민 방향으로 밀려 들어오고 나간다. 퇴장이 더 빠르다(CLAUDE.md 「동작 원칙」). '동작 줄이기' 면 겹쳐 바뀌기만.
    private var waveformTransition: AnyTransition {
        if reduceMotion { return .opacity }
        let forward = preview.direction >= 0
        return .asymmetric(
            insertion: .move(edge: forward ? .trailing : .leading).combined(with: .opacity),
            removal: .move(edge: forward ? .leading : .trailing).combined(with: .opacity)
                .animation(.easeIn(duration: 0.16))
        )
    }
}

/// 30칸 미니 파형. 들은 만큼 왼쪽부터 accent 로 채워진다.
private struct MiniWaveform: View {
    let levels: [CGFloat]
    let progress: Double

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(levels.enumerated()), id: \.offset) { bar, level in
                let played = progress > 0 && Double(bar) / Double(levels.count - 1) <= progress
                Capsule()
                    .fill(played ? AuthSceneColors.accent : Color.white.opacity(0.30))
                    .frame(width: 1.5, height: 4 + level * 20)
                if bar < levels.count - 1 { Spacer(minLength: 0) }
            }
        }
        .frame(height: 26)
    }
}

/// 랜딩 미리듣기 재생 상태 — 한 번에 하나만, 지금 목소리부터 차례로 튼다.
///
/// ⚠ **소리 없이 재생 중처럼만 보이는 '시뮬레이션' 을 되살리지 말 것.** 예전에는 번들에 mp3 가 없어서 5초짜리
/// 가짜 진행바를 돌렸다 — 버튼을 눌러도 아무 소리가 안 나는데 화면은 재생 중처럼 보였다. 파일을 하나도 못 찾으면
/// [hasAudio] 가 `false` 라 상자가 **비활성**되고, 못 찾은 칸은 건너뛴다.
@MainActor
private final class LandingPreviewController: ObservableObject {
    @Published private(set) var index = 0
    @Published private(set) var isPlaying = false
    @Published private(set) var progress: Double = 0
    /// 마지막으로 넘어간 방향(+1 다음 / -1 이전) — 파형이 밀려 들어오는 쪽.
    @Published private(set) var direction = 1

    private let player = AudioPreviewPlayer()
    private var tickerTask: Task<Void, Never>?
    /// 일시정지해 둔 칸 — 같은 칸을 다시 누르면 처음부터가 아니라 그 자리에서 잇는다.
    private var pausedIndex: Int?
    private let urls: [URL?] = LandingPreviewVoice.all.map {
        Bundle.main.url(forResource: $0.clip, withExtension: "mp3")
    }

    var hasAudio: Bool { urls.contains { $0 != nil } }

    func toggle() {
        if isPlaying {
            player.pause()
            isPlaying = false
            pausedIndex = index
            tickerTask?.cancel()
            return
        }
        if pausedIndex == index, player.resume() {
            isPlaying = true
            startTicker()
            return
        }
        play(index)
    }

    func stop() {
        player.stop()
        isPlaying = false
        pausedIndex = nil
        progress = 0
        tickerTask?.cancel()
    }

    func step(_ delta: Int) {
        let count = urls.count
        direction = delta >= 0 ? 1 : -1
        let next = ((index + delta) % count + count) % count
        let wasPlaying = isPlaying
        stop()
        index = next
        if wasPlaying { play(next) }
    }

    private func play(_ target: Int) {
        guard let url = urls[target] else {
            // 파일이 없는 칸은 건너뛴다 — 다음 칸이 있으면 거기서 잇는다.
            if target < urls.count - 1 { direction = 1; index = target + 1; play(target + 1) } else { stop() }
            return
        }
        // 끝까지 들으면 다음 칸으로 — 그 사이 다른 칸으로 옮겼으면 건드리지 않는다.
        player.onFinish = { [weak self] in
            Task { @MainActor in self?.finished(target) }
        }
        guard (try? player.play(url: url)) != nil else {
            stop()
            return
        }
        index = target
        pausedIndex = nil
        isPlaying = true
        startTicker()
    }

    private func finished(_ target: Int) {
        guard isPlaying, index == target else { return }
        progress = 0
        if target < urls.count - 1 {
            withAnimation(.easeOut(duration: 0.22)) {
                direction = 1
                index = target + 1
            }
            play(target + 1)
        } else {
            stop()
            withAnimation(.easeOut(duration: 0.22)) {
                direction = -1
                index = 0
            }
        }
    }

    private func startTicker() {
        tickerTask?.cancel()
        tickerTask = Task { @MainActor [weak self] in
            // 안드로이드도 80ms 마다 위치를 읽는다(`ui/auth/LandingScreen.kt` 의 `LandingVoicePreview`).
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
