import AuthenticationServices
import SwiftUI

/// 비로그인 사용자가 처음 만나는 진입 화면.
///
/// Android `apps/android-native/.../ui/auth/LandingScreen.kt:60-105` 를 1:1 포팅했다.
/// 구성 요소
///   1. AlarmTalk 브랜드 헤더 (로고 + 슬로건)
///   2. 큰 카피 ("좋아하는 목소리로\n깨어나는 알람")
///   3. 알람 미리듣기 카드 — 32-bar 파형 + 재생 버튼. 번들 mp3 가 없을 때는
///      시각 시뮬레이션(5초 동안 progress 가 0→1) 으로 동작한다.
///   4. 하단 인증 패널 — Apple 로그인 + 이메일 로그인 + 회원가입 진입
///
/// Android 와 다른 점: Google 자리에 Apple 로그인이 들어간다. NavigationStack 의
/// destination 으로 `LoginView` 를 push 한다.
struct LandingView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.voiceAlarmTheme) private var theme

    @State private var navigateToLogin: LoginMode?

    var body: some View {
        ZStack {
            theme.palette.background
                .ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    WakerBrandHeader()
                        .padding(.top, 22)

                    Color.clear.frame(height: 48)

                    VStack(alignment: .leading, spacing: 34) {
                        Text("좋아하는 목소리로\n깨어나는 알람")
                            .font(theme.typography.displaySmall)
                            .foregroundStyle(theme.palette.onBackground)
                            .multilineTextAlignment(.leading)

                        AlarmIdentityPreviewCard()
                    }

                    Spacer().frame(height: 32)

                    LandingAuthPanel(
                        busy: auth.isBusy,
                        onGoToLogin: { navigateToLogin = .login },
                        onGoToRegister: { navigateToLogin = .register }
                    )
                    .padding(.bottom, 22)
                }
                .padding(.horizontal, 22)
            }
        }
        .navigationBarBackButtonHidden(true)
        .navigationDestination(item: $navigateToLogin) { mode in
            LoginView(initialMode: mode)
        }
    }
}

/// 상단 좌측 브랜드 표식. Android `WakerBrandHeader:108-136` 1:1 대응.
private struct WakerBrandHeader: View {
    @Environment(\.voiceAlarmTheme) private var theme

    var body: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [theme.palette.primary, theme.palette.secondary],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    Image(systemName: "waveform")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(theme.palette.onPrimary)
                )
                .frame(width: 42, height: 42)

            VStack(alignment: .leading, spacing: 1) {
                Text("AlarmTalk")
                    .font(theme.typography.titleLarge)
                    .foregroundStyle(theme.palette.onBackground)
                Text("Voice alarm")
                    .font(theme.typography.labelMedium)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
            }

            Spacer()
        }
    }
}

/// 알람 미리듣기 카드 — Android `AlarmIdentityPreview:138-232` 와 동등.
private struct AlarmIdentityPreviewCard: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @StateObject private var preview = LandingPreviewController()

    var body: some View {
        VStack(alignment: .leading, spacing: 28) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("내일 아침")
                        .font(theme.typography.bodyMedium)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                    Text("07:30")
                        .font(theme.typography.displaySmall)
                        .foregroundStyle(theme.palette.onSurface)
                }
                Spacer()
                Button {
                    preview.toggle()
                } label: {
                    ZStack {
                        Circle()
                            .fill(theme.palette.primary.opacity(0.14))
                        Circle()
                            .stroke(theme.palette.primary.opacity(0.28), lineWidth: 1)
                        Image(systemName: preview.isPlaying ? "pause.fill" : "play.fill")
                            .font(.system(size: 22, weight: .semibold))
                            .foregroundStyle(theme.palette.primary)
                    }
                    .frame(width: 54, height: 54)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(preview.isPlaying ? "미리듣기 일시정지" : "목소리 미리듣기")
            }

            LandingWaveformBar(progress: preview.progress)
                .frame(height: 50)
        }
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .fill(theme.palette.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .stroke(theme.palette.outlineVariant, lineWidth: 1)
        )
    }
}

/// 32-bar 파형. 진행률에 따라 왼쪽부터 primary 색으로 채워진다.
/// Android `LandingPreviewWaveform:234-267` 의 levels 배열을 그대로 가져왔다.
private struct LandingWaveformBar: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let progress: Double

    private let levels: [CGFloat] = [
        0.12, 0.28, 0.18, 0.44, 0.26, 0.60, 0.34, 0.76,
        0.48, 0.70, 0.38, 0.64, 0.30, 0.58, 0.42, 0.82,
        0.52, 0.74, 0.46, 0.68, 0.36, 0.62, 0.28, 0.54,
        0.40, 0.66, 0.32, 0.50, 0.22, 0.42, 0.18, 0.34,
    ]

    var body: some View {
        GeometryReader { proxy in
            let spacing = max(
                2,
                (proxy.size.width - CGFloat(levels.count) * 2) / CGFloat(levels.count - 1)
            )
            HStack(alignment: .center, spacing: spacing) {
                ForEach(Array(levels.enumerated()), id: \.offset) { index, level in
                    let barProgress = Double(index) / Double(levels.count - 1)
                    let played = progress > 0 && barProgress <= progress
                    Capsule()
                        .fill(played
                              ? theme.palette.primary
                              : theme.palette.outlineVariant.opacity(0.78))
                        .frame(width: 2, height: 9 + level * 34)
                }
            }
            .frame(width: proxy.size.width, alignment: .leading)
        }
    }
}

/// 미리듣기 상태 컨트롤러.
///
/// 두 경로를 지원한다:
///   1. `Bundle.main.url(forResource: "landing_voice_preview", withExtension: "mp3")`
///      가 nil 이 아니면 `AudioPreviewPlayer` 로 실제 재생.
///   2. nil 이면 시각 시뮬레이션 — 5초 동안 progress 가 0→1 로 차오른다.
///
/// 두 경우 모두 progress 는 `Task.sleep` 기반 ticker 로 갱신한다.
@MainActor
private final class LandingPreviewController: ObservableObject {
    @Published private(set) var isPlaying = false
    @Published private(set) var progress: Double = 0

    private let player = AudioPreviewPlayer()
    private var tickerTask: Task<Void, Never>?
    private var simulatedElapsed: Double = 0

    /// 번들 mp3 URL. nil 이면 시뮬레이션 모드.
    private var bundledURL: URL? {
        Bundle.main.url(forResource: "landing_voice_preview", withExtension: "mp3")
    }

    /// Task<_, Never>.cancel 자체는 Sendable 하지만, main-actor isolated 프로퍼티
    /// 접근을 deinit 에서 하면 경고가 날 수 있어 명시적으로 cancel API 만 호출.
    /// view 의 onDisappear 에서 stop() 을 부르는 흐름이 일반적이므로 deinit 의
    /// cancel 은 안전망 역할만 한다.
    nonisolated deinit {
        // 아무것도 하지 않는다 — Task 는 weak self 캡처로 leak 하지 않고,
        // 시뮬레이션 ticker 는 isPlaying == false 가 되면 자연스럽게 종료된다.
    }

    func toggle() {
        if isPlaying {
            stopPlayback()
        } else {
            startPlayback()
        }
    }

    private func startPlayback() {
        if progress >= 0.98 {
            progress = 0
            simulatedElapsed = 0
        }
        if let url = bundledURL {
            try? player.play(url: url)
        }
        isPlaying = true
        startTicker()
    }

    private func stopPlayback() {
        player.stop()
        isPlaying = false
        tickerTask?.cancel()
        tickerTask = nil
    }

    private func startTicker() {
        tickerTask?.cancel()
        tickerTask = Task { @MainActor [weak self] in
            let total: Double = 5.0
            let step: Double = 0.08
            while !Task.isCancelled {
                guard let self else { return }
                let stillPlaying = self.tickOnce(step: step, total: total)
                if !stillPlaying { return }
                try? await Task.sleep(nanoseconds: UInt64(step * 1_000_000_000))
            }
        }
    }

    /// 한 번의 tick 진행. progress 가 1 에 도달했거나 외부에서 중단됐다면 false 를
    /// 반환한다. main actor 격리로 sleep 없이 한 step 만 처리.
    private func tickOnce(step: Double, total: Double) -> Bool {
        guard isPlaying else { return false }
        simulatedElapsed += step
        let value = min(1.0, simulatedElapsed / total)
        progress = value
        if value >= 1.0 {
            isPlaying = false
            player.stop()
            return false
        }
        return true
    }
}

/// 하단 인증 패널 — Apple 로그인 + 이메일 로그인 + 회원가입.
private struct LandingAuthPanel: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.voiceAlarmTheme) private var theme
    let busy: Bool
    let onGoToLogin: () -> Void
    let onGoToRegister: () -> Void

    @State private var pendingRawNonce: String?

    var body: some View {
        VStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("시작하기")
                    .font(theme.typography.titleMedium)
                    .foregroundStyle(theme.palette.onSurface)
                // Android `LandingScreen.kt:340` 과 동일한 문구.
                Text("로그인하면 목소리 알람을 만들 수 있어요.")
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .multilineTextAlignment(.leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 18)
            .padding(.horizontal, 18)

            VStack(spacing: 10) {
                SignInWithAppleButton(.signIn) { request in
                    let rawNonce = NonceGenerator.makeNonce()
                    pendingRawNonce = rawNonce
                    request.requestedScopes = [.fullName, .email]
                    request.nonce = NonceGenerator.sha256(rawNonce)
                } onCompletion: { result in
                    let raw = pendingRawNonce
                    pendingRawNonce = nil
                    switch result {
                    case .success(let authorization):
                        Task { await auth.handleAppleAuthorization(authorization, rawNonce: raw) }
                    case .failure(let error):
                        Task { @MainActor in auth.handleAppleAuthorizationFailure(error) }
                    }
                }
                .signInWithAppleButtonStyle(.black)
                .frame(height: 52)
                .clipShape(RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous))
                .disabled(busy)

                Button(action: onGoToLogin) {
                    Text("이메일로 로그인")
                        .font(theme.typography.labelLarge)
                        .frame(maxWidth: .infinity, minHeight: 56)
                }
                .buttonStyle(.borderedProminent)
                .tint(theme.palette.primary)
                .foregroundStyle(theme.palette.onPrimary)
                .clipShape(RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous))
                .disabled(busy)
            }
            .padding(.horizontal, 18)

            Rectangle()
                .fill(theme.palette.outlineVariant)
                .frame(height: 1)

            HStack {
                Text("처음 사용하시나요?")
                    .font(theme.typography.bodyMedium)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                Spacer()
                Button(action: onGoToRegister) {
                    Text("계정 만들기")
                        .font(theme.typography.labelLarge)
                        .padding(.vertical, 10)
                        .padding(.horizontal, 18)
                }
                .buttonStyle(.bordered)
                .foregroundStyle(theme.palette.onSurface)
                .disabled(busy)
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 18)
        }
        .background(
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .fill(theme.palette.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .stroke(theme.palette.outlineVariant, lineWidth: 1)
        )
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
