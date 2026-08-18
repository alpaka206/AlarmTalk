import SwiftUI

/// **목소리 준비 페이지** — 생성과 다운로드를 한 퍼센트로 보여 준다.
///
/// 사용자에게는 '서버가 만드는 중' 과 '폰이 받는 중' 이 구분되지 않는다. 그래서 둘을 합친
/// 하나의 값(`ClipReadinessModel.percent`)만 크게 보여 주고, 무엇이 남았는지는 아래 줄에서
/// 말한다. 규약은 docs/spec/voice-and-message.md 「미리 받아 둔다」 절.
///
/// ⚠ **이 화면이 알람 만들기를 막지 않는다.** 여기서 나가도 알람은 만들 수 있어야 한다 —
/// 새벽에 전파가 나빠 내일 알람을 못 맞추는 일이 있어서는 안 된다. 못 받은 목소리만
/// 고를 수 없을 뿐이다.
struct ClipPreparationView: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var voiceStudio: VoiceStudioViewModel
    @StateObject private var readiness = ClipReadinessModel()

    /// 닫기(백그라운드에서 계속 받기). nil 이면 닫기 줄을 그리지 않는다.
    var onDismiss: (() -> Void)?

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)

            VStack(spacing: 16) {
                Text(headline)
                    .font(theme.typography.displaySmall)
                    .foregroundStyle(theme.palette.onSurface)
                    // 숫자가 흔들리지 않게 — 퍼센트가 오르내릴 때 폭이 변하면 시선이 튄다.
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .animation(.easeInOut(duration: 0.2), value: readiness.percent)

                ProgressView(value: Double(readiness.percent), total: 100)
                    .tint(theme.palette.primary)
                    .frame(maxWidth: 280)

                Text(statusLine)
                    .font(theme.typography.bodyMedium)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 320)
            }
            .padding(.horizontal, 24)

            Spacer(minLength: 0)

            VStack(spacing: 12) {
                if !readiness.failedVoiceIDs.isEmpty {
                    // 서버가 만들다 실패한 목소리 — 다시 큐에 올린다. 다운로드 실패는
                    // 선다운로드가 다음 회차에 부족분만 다시 받으므로 버튼이 필요 없다.
                    Button("다시 시도하기") {
                        Task {
                            await readiness.retryFailedRenders(session: auth.session)
                            await refresh()
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(theme.palette.primary)
                }

                if let onDismiss {
                    Button(readiness.isReady ? "완료" : "백그라운드에서 계속 받기") {
                        onDismiss()
                    }
                    .font(theme.typography.bodyMedium)
                    .foregroundStyle(
                        readiness.isReady ? theme.palette.primary : theme.palette.onSurfaceVariant
                    )
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.palette.surface)
        .task { await refresh() }
        // 받는 동안 값이 움직이므로 주기적으로 다시 센다. 캐시 파일 검사라 값싸고,
        // 서버 렌더 상태만 네트워크를 탄다.
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                if Task.isCancelled { break }
                await refresh()
            }
        }
    }

    private var headline: String {
        readiness.isReady ? "준비됐어요" : "\(readiness.percent)%"
    }

    /// ⚠ **무엇을 기다리는지 말한다.** 퍼센트만 있으면 멈춘 것처럼 보인다 —
    /// 특히 서버 렌더 구간은 다운로드와 달리 몇 분이 걸릴 수 있다.
    private var statusLine: String {
        if readiness.isReady {
            return "이제 오프라인에서도 목소리로 울려요."
        }
        if !readiness.failedVoiceIDs.isEmpty {
            return "목소리를 만들다 실패했어요. 다시 시도해 주세요."
        }
        if readiness.voices.contains(where: { $0.isRendering }) {
            return "목소리를 만들고 있어요. 몇 분 걸릴 수 있어요."
        }
        return "목소리를 받고 있어요. 앱을 닫아도 계속 받아요."
    }

    private func refresh() async {
        await readiness.refresh(
            session: auth.session,
            ownedVoiceProfileIDs: voiceStudio.ownedVoiceProfileIDs
        )
    }
}
