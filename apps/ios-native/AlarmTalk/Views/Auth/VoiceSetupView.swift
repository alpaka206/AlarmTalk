import SwiftUI

/// 로그인 직후 **무료 버킷 클립을 받는** 화면.
///
/// 안드로이드 `ui/onboarding/VoiceOnboardingScreen.kt` 미러 — 문구까지 같다.
///
/// ⚠ **"기본 목소리를 골라보세요" 피커로 되돌리지 말 것(2026-08-06).** 예전 iOS 는 여기서
/// 시스템 목소리 4개를 펼쳐 하나를 고르게 하고 호칭까지 물었는데, 안드로이드에는 그런
/// 단계가 없다 — 목소리는 **알람 편집기에서** 고르고(직전 선택이 기억된다), 호칭은 목소리
/// **등록** 플로우에만 있다. 이 파일의 옛 주석도 "Android VoiceOnboardingScreen.kt 미러"
/// 라고 적혀 있었지만 실제로는 전혀 다른 화면이었다 — **주석의 미러 주장을 믿지 말 것.**
///
/// ⚠ **여기서 갇히면 앱을 아예 못 쓴다.** 그래서 탈출구를 **처음부터** 보여주고,
/// 문구는 **다운로드가 살아 있는지**로 가른다(실패 여부가 아니다). 받는 중이면
/// '백그라운드에서 계속'(화면만 닫으므로 실제로 계속 받는다), 끝난 상태면 '나중에 받기'.
struct VoiceSetupView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @Environment(\.voiceAlarmTheme) private var theme

    /// 다운로드가 끝나 화면을 닫는다. **건너뛴 것과 구분한다**(아래 `onSkip` 참조).
    var onComplete: (() -> Void)?
    /// 사용자가 **직접** '나중에 받기' 를 눌렀다. 이때만 '안 받겠다' 를 기억한다 —
    /// 다 받은 사람에게까지 그 플래그를 세우면, 나중에 캐시가 비어도 이 화면이
    /// 다시 뜨지 않는다(2026-08-11 확인: iOS 가 그 상태였다).
    var onSkip: (() -> Void)?

    @StateObject private var prefetcher = StockClipPrefetcher()

    private var failed: Bool { prefetcher.state == .failed }

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                Text(failed ? "목소리를 받지 못했어요" : "알람에 쓸 목소리를 받고 있어요")
                    .font(theme.typography.headlineSmall)
                    .fontWeight(.bold)
                    .foregroundStyle(theme.palette.onSurface)
                    .multilineTextAlignment(.center)

                Spacer().frame(height: 28)

                if failed {
                    Text("잠시 뒤 다시 시도해 주세요.")
                        .font(theme.typography.bodyMedium)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                        .multilineTextAlignment(.center)
                } else {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(theme.palette.primary)
                        .scaleEffect(1.2)
                    Spacer().frame(height: 16)
                    Text(progressLabel)
                        .font(theme.typography.bodyMedium)
                        .foregroundStyle(theme.palette.onSurface)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.horizontal, 24)

            VStack(spacing: 0) {
                if failed {
                    GradientCta(title: "다시 시도") {
                        prefetcher.cancel()
                        prefetcher.start(session: auth.session)
                    }
                }
                // ⚠ **처음부터 보여준다 — 지연을 되돌리지 말 것**(2026-08-20).
                // 예전에는 6초를 기다린 뒤에야 띄웠다(안드로이드는 12초였다). 의도는 "몇 초면
                // 끝날 일에 선택지를 내밀지 않는다" 였는데, 실제로는 버튼이 **중간에 불쑥
                // 나타나** 오히려 이상해 보이고, 그동안은 빠져나갈 길이 아예 없었다.
                // 이 버튼은 다운로드를 취소하지 않으므로(화면만 닫는다) 숨길 이유가 없다.
                // ⚠ **첫 프레임의 `.idle` 을 '끝난 것' 으로 읽지 말 것**(Codex #701 P2).
                // `.task` 가 `start()` 를 부르기 전 한 프레임은 `.idle` 인데, 버튼이 이제
                // 처음부터 보이므로 그 틈에 누를 수 있다. 그때 '나중에 받기' 로 뜨면
                // `skipVoiceSetup()` 이 **영구히 '안 받겠다'** 를 기록하고 게이트를 닫는다 —
                // 정상 다운로드 경로인데도. 곧 시작될 상태이므로 '계속' 쪽으로 읽는다.
                Button(prefetcher.state == .finished || failed ? "나중에 받기" : "백그라운드에서 계속") {
                    onSkip?()
                }
                .font(theme.typography.bodyMedium)
                .foregroundStyle(theme.palette.onSurfaceVariant)
                .padding(.top, failed ? 12 : 0)
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .homeGradientBackground()
        .task {
            prefetcher.start(session: auth.session)
        }
        .onChange(of: prefetcher.state) { _, new in
            if new == .finished { onComplete?() }
        }
    }

    private var progressLabel: String {
        // 44 분의 몇 인지는 사용자에게 의미 없는 숫자다(무료 버킷 문구 수 × 언어 수).
        // 얼마나 남았는지만 알면 되므로 퍼센트로 환산해 보여준다.
        if case let .running(done, total) = prefetcher.state, total > 0 {
            return "\(done * 100 / total)%"
        }
        return "목소리를 받는 중이에요…"
    }
}
