import SwiftUI

/// **목소리 준비 페이지** — 생성과 다운로드를 한 퍼센트로 보여 준다.
///
/// 사용자에게는 '서버가 만드는 중' 과 '폰이 받는 중' 이 구분되지 않는다. 그래서 둘을 합친
/// 하나의 값(`ClipReadinessModel.percent`)만 크게 보여 주고, 무엇이 남았는지는 아래 줄에서
/// 말한다. 규약은 docs/spec/voice-and-message.md 「미리 받아 둔다」 절.
///
/// ⚠ **이 화면이 알람 만들기를 막지 않는다.** (알람 설정 관문은 따로 있다 — 기본 목소리를 다
/// 받기 전에는 `MainTabsView.openEditorIfVoicesReady` 가 막는다, 2026-09-17.) 여기서 나가도 알람은 만들 수 있어야 한다 —
/// 새벽에 전파가 나빠 내일 알람을 못 맞추는 일이 있어서는 안 된다. 못 받은 목소리만
/// 고를 수 없을 뿐이다.
struct ClipPreparationView: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var voiceStudio: VoiceStudioViewModel
    /// ⚠ **앱 스코프 객체를 받아 쓴다 — 화면 소유(`@StateObject`)로 만들지 말 것.**
    /// 사용자가 '백그라운드에서 계속' 으로 이 화면을 닫으면 뷰가 사라지는데, 화면이 소유하면
    /// 그때 다운로드 루프가 조용히 죽어 그 문구가 거짓말이 된다.
    @EnvironmentObject private var prefetcher: StockClipPrefetcher
    @StateObject private var readiness = ClipReadinessModel()
    /// 등록 직후 화면 전용 — **그 목소리 하나**의 생성(0~50%) + 다운로드(50~100%)를 이어 붙인
    /// 하나의 진행률. 전체 준비도(`readiness`)는 시스템 목소리까지 함께 세므로, 방금 만든
    /// 목소리가 매니페스트에 아직 없는 동안 100% 로 보인다 — 등록 화면은 그걸 쓰지 않는다.
    @StateObject private var drive = ClonePrerenderDrive()

    /// 닫기(백그라운드에서 계속). nil 이면 닫기 줄을 그리지 않는다.
    var onDismiss: (() -> Void)?

    /// 목소리 등록 직후에는 Android 등록 5단계의 마지막 화면 문법을 쓴다.
    /// 편집기에서 여는 일반 준비 관문은 기존 퍼센트 화면을 유지한다.
    var registrationStyle = false

    /// ⚠ **관문이 막은 그 목소리.** 넘기지 않으면 공유받은 목소리가 대상에서 빠져
    /// "준비됐어요 100%" 만 보이고, 돌아가면 관문이 또 막는다(빠져나갈 수 없는 고리).
    var targetVoiceID: String?

    var body: some View {
        Group {
            if registrationStyle {
                registrationPreparation
            } else {
                standardPreparation
            }
        }
        // 등록 직후에는 **그 목소리 하나**를 끝까지 민다 — 서버 생성을 앞당기고(advance),
        // 끝나면 곧바로 받는다. 세는 것만으로는 만들어지지도 받아지지도 않는다.
        .task(id: registrationStyle ? targetVoiceID : nil) {
            guard registrationStyle, let targetVoiceID else { return }
            drive.start(
                voiceProfileID: targetVoiceID,
                session: auth.session,
                prefetcher: prefetcher,
                ownedVoiceProfileIDs: voiceStudio.ownedVoiceProfileIDs
            )
        }
        // 다 되면 **아무 말 없이** 닫는다 — "다 됐어요" 를 또 띄우지 않는다(2026-09-21 지시).
        //
        // ⚠ **닫기 전에 목록과 매니페스트를 다시 받는다**(2026-09-21 실기기 녹화). 등록은
        //   서버 상태를 두 군데 바꾼다 — 목소리 목록(승격)과 클립 매니페스트(사전렌더). 둘 다
        //   **이 화면이 도는 동안** 바뀌는데 아무도 다시 받지 않아, 돌아간 목소리 탭에는 방금
        //   만든 목소리가 없고(다른 이유로 새로고침될 때까지), 편집기 관문은 옛 매니페스트로
        //   "아직 준비 안 됨" 이라 판정해 **고른 목소리를 되돌렸다**(그때 준비 화면은 서버에서
        //   새로 받아 100% 를 보여 줬다 — 두 화면이 서로 다른 목록을 본 것이다).
        .onChange(of: drive.phase) { _, phase in
            guard registrationStyle, phase == .done else { return }
            Task {
                await voiceStudio.loadStockClips(session: auth.session, force: true)
                await voiceStudio.refresh(session: auth.session, force: true, successMessage: nil)
                onDismiss?()
            }
        }
        .task { if !registrationStyle { await refresh() } }
        // 받는 동안 값이 움직이므로 주기적으로 다시 센다. 캐시 파일 검사라 값싸고,
        // 서버 렌더 상태만 네트워크를 탄다.
        .task {
            guard !registrationStyle else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                if Task.isCancelled { break }
                await refresh()
            }
        }
    }

    private var standardPreparation: some View {
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

                // 소유자를 기다리는 중에는 진행률 자체가 내 목소리들의 것이라 뜻이 없다.
                if !awaitingOwner {
                    ProgressView(value: Double(readiness.percent), total: 100)
                        .tint(theme.palette.primary)
                        .frame(maxWidth: 280)
                }

                Text(statusLine)
                    .font(theme.typography.bodyMedium)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 320)
            }
            .padding(.horizontal, 24)

            Spacer(minLength: 0)

            VStack(spacing: 12) {
                if !readiness.failedVoiceIDs.isEmpty, !awaitingOwner {
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
                    Button(readiness.isReady ? "완료" : "백그라운드에서 계속") {
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
    }

    private var registrationPreparation: some View {
        VStack(spacing: 0) {
            WakerTopBar(title: "목소리 만들기", onBack: nil)
                .padding(.top, 18)
            Spacer(minLength: 0)
            VStack(spacing: 12) {
                Text("이 목소리로 알람 문구를 만들고 있어요")
                    .font(theme.typography.titleMedium)
                    .fontWeight(.semibold)
                    .foregroundStyle(theme.palette.onSurface)
                Text("준비되는 대로 알람에서 쓸 수 있어요.")
                    .font(theme.typography.bodyMedium)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .multilineTextAlignment(.center)
                Spacer().frame(height: 6)
                // 생성과 다운로드를 **하나의 퍼센트**로 말한다(2026-09-21 지시).
                // 숫자가 흔들리지 않게 — 폭이 변하면 시선이 튄다.
                Text("\(drive.percent)%")
                    .font(theme.typography.displaySmall)
                    .foregroundStyle(theme.palette.onSurface)
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .animation(.easeInOut(duration: 0.2), value: drive.percent)
                // ⚠ **막대를 스피너와 번갈아 그리지 말 것**(2026-09-21 지적 "잠깐 깜박"). 예전에는
                //   3초마다 도는 갱신 중에 원형 스피너로 바뀌었는데, 스피너는 제 크기라
                //   막대(280)와 폭이 달라 **화면이 좁아졌다 넓어졌다** 했다. 전체 개수를 아직
                //   모르는 동안에도 같은 자리에 같은 폭의 막대를 둔다.
                ProgressView(value: Double(drive.percent), total: 100)
                    .progressViewStyle(.linear)
                    .tint(theme.palette.primary)
                    .frame(maxWidth: .infinity)
                Spacer().frame(height: 6)
                if let onDismiss {
                    Button("백그라운드에서 계속") { onDismiss() }
                        .buttonStyle(.plain)
                        .font(theme.typography.bodyMedium)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
            }
            .padding(.horizontal, 24)
            Spacer(minLength: 0)
        }
        // ⚠ **폭을 꽉 채운다.** 이게 없으면 자식 중 가로로 늘어나는 것이 하나도 없어(상단바는
        //   뒤로가기가 없으면 제목 폭이다) 화면 전체가 내용 폭으로 줄고, 배경 그라데이션도
        //   그만큼만 칠해져 **좌우가 비어 보인다**(2026-09-21 지적). 일반 준비 화면은 이미
        //   같은 수식자를 쓰고 있었다.
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .homeGradientBackground()
    }

    private var headline: String {
        // ⚠ 소유자를 기다리는 중에 퍼센트를 보여 주지 말 것 — 그 값은 내 목소리들의
        // 진행률이라 100% 가 되고, 사용자는 끝난 줄 알고 돌아갔다가 또 막힌다.
        if awaitingOwner { return "준비 중이에요" }
        return readiness.isReady ? "준비됐어요" : "\(readiness.percent)%"
    }

    /// ⚠ **무엇을 기다리는지 말한다.** 퍼센트만 있으면 멈춘 것처럼 보인다 —
    /// 특히 서버 렌더 구간은 다운로드와 달리 몇 분이 걸릴 수 있다.
    private var statusLine: String {
        if awaitingOwner {
            // 받는 사람이 할 수 있는 일이 없다 — '다시 시도' 도 소유자 큐라 못 누른다.
            return "보낸 사람 쪽에서 이 목소리를 만들고 있어요. 다 되면 알람에서 고를 수 있어요."
        }
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
            ownedVoiceProfileIDs: voiceStudio.ownedVoiceProfileIDs,
            selectedVoiceProfileID: targetVoiceID
        )
        // ⚠ **세는 것만으로는 받아지지 않는다**(Codex #703 P2). `readiness.refresh` 는 서버
        // 상태를 묻고 캐시 파일이 있는지 볼 뿐, **없는 클립을 받지 않는다.** 실제 다운로드는
        // 앱 레벨 프리페처가 하는데 그 `.task(id:)` 는 계정·언어로만 키가 걸려 있어, 이번
        // 세션에 새로 소유하게 된 목소리로는 다시 돌지 않는다 — 그래서 첫 등록이 앱을 껐다
        // 켤 때까지 100% 미만에 갇혔다.
        //
        // `start` 는 `guard task == nil` 이라 3초 폴링마다 불려도 겹쳐 돌지 않고, 이미 받은
        // 것은 내부에서 건너뛴다. 대상은 **소유 목록 + 관문이 막은 그 목소리 하나**다 —
        // 공유받은 목록 전체를 넣으면 「공유받은 목소리는 선다운로드하지 않는다」 규약을
        // 정면으로 어긴다(`docs/spec/voice-and-message.md`).
        if !readiness.isReady {
            var targets = voiceStudio.ownedVoiceProfileIDs
            if let targetVoiceID, !targetVoiceID.isEmpty { targets.insert(targetVoiceID) }
            prefetcher.start(session: auth.session, ownedVoiceProfileIDs: targets)
        } else if let targetVoiceID,
                  !voiceStudio.stockClips.contains(where: { $0.voiceProfileId == targetVoiceID }) {
            // ⚠ **관문과 이 화면이 같은 목록을 보게 맞춘다**(2026-09-21). 이 화면은 서버에서
            //   새로 받아 "준비됐어요" 라고 하는데, 관문(`hasCompleteBucket`)은 앱이 들고 있는
            //   매니페스트를 본다 — 거기 이 목소리의 클립이 하나도 없으면 돌아가자마자 또 막고
            //   고른 목소리를 되돌린다. 여기서 한 번 받아 두면 그 고리가 끊긴다.
            await voiceStudio.loadStockClips(session: auth.session, force: true)
        }
    }

    /// 공유받은 목소리인데 소유자 쪽 생성이 아직인가.
    private var awaitingOwner: Bool {
        guard let targetVoiceID else { return false }
        return readiness.awaitingOwnerVoiceIDs.contains(targetVoiceID)
    }
}
