import SwiftUI

/// **목소리 준비 페이지** — 생성과 다운로드를 한 퍼센트로 보여 준다.
///
/// 사용자에게는 '서버가 만드는 중' 과 '폰이 받는 중' 이 구분되지 않는다. 그래서 둘을 합친
/// 하나의 값(`ClipReadinessModel.percent`)만 크게 보여 주고, 무엇이 남았는지는 아래 줄에서
/// 말한다. 규약은 docs/spec/voice-and-message.md 「미리 받아 둔다」 절.
///
/// ⚠ **이 화면이 알람 만들기를 막지 않는다.** (알람 설정 관문은 따로 있다 — 그 알람의 목소리를 다
/// 받기 전에는 `MainTabsView.openEditorIfVoiceReady` 가 막는다, 2026-10-26.) 여기서 나가도 알람은 만들 수 있어야 한다 —
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

    /// 다 받아 **저절로 닫힐 때** 부른다(편집기 준비 화면). 있으면 `onDismiss` 대신 이것을 부른다 — 띄운 쪽이 닫으면서 고른
    /// 목소리를 이어서 붙인다(2026-11-15 오너: "고른 목소리도 바로 붙게"). 손으로 닫을 때는 `onDismiss` 다.
    var onReady: (() -> Void)? = nil

    /// 목소리 등록 직후에는 Android 등록 5단계의 마지막 화면 문법을 쓴다.
    /// 편집기에서 여는 일반 준비 관문은 기존 퍼센트 화면을 유지한다.
    var registrationStyle = false

    /// ⚠ **관문이 막은 그 목소리.** 이 화면은 서버에서 새로 받은 매니페스트로 다 받았다고 보는데,
    /// 관문은 앱이 들고 있는 매니페스트를 본다 — 거기에도 이 목소리의 클립이 실릴 때까지 끝내지 않는다
    /// (`pollingCanStop` 의 `targetClipsLoaded`). 안 넘기면 돌아가자마자 관문이 또 막는다.
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
                await voiceStudio.refresh(session: auth.session, force: true)
                onDismiss?()
            }
        }
        // 편집기 관문에서 연 화면도 다 받으면 **저절로 닫는다** — '준비됐어요'·'완료' 를 따로 보여 주지 않는다(2026-11-15 오너:
        // "목소리 받기 · 준비됨 / 이거 없이 다 되면 자동으로 닫히도록"). 닫는 시점은 `preparationSettled` 다 — 다 받았고 관문이
        // 보는 매니페스트에도 그 목소리가 실렸을 때. '다 받음' 만 보고 닫으면 관문이 옛 목록으로 또 막는다(아래 `refresh`).
        // 고른 목소리는 지금처럼 적용하지 않은 채다(안드로이드 편집기 `preparationVoiceId` 와 같다).
        .onChange(of: preparationSettled) { _, settled in
            guard !registrationStyle, settled else { return }
            if let onReady { onReady() } else { onDismiss?() }
        }
        .task { if !registrationStyle { await refresh() } }
        // 받는 동안 값이 움직이므로 주기적으로 다시 센다. 한 번에 매니페스트·렌더 상태를 서버에
        // 묻는다(`ClipReadinessModel.refresh`).
        // ⚠ **준비가 끝나면 멈춘다**(2026-09-29 효율 감사 M1 — iOS). 예전에는 끝낼 조건이 없어,
        //   "준비됐어요" 를 띄운 채 화면을 닫을 때까지 3초마다 매니페스트(약 168KB)와 렌더 상태를
        //   다시 받았다. 멈추는 조건은 `pollingCanStop` 하나다 — **실패로는 멈추지 않는다**
        //   (서버 생성 실패·소유자 대기는 계속 묻는다 — 크론이 이어 만들거나 '다시 시도' 뒤에
        //   풀리는 것을 이 화면이 알아야 한다, 2026-09-08).
        .task {
            guard !registrationStyle else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                if Task.isCancelled || preparationSettled { break }
                await refresh()
            }
        }
    }

    /// 편집기 준비 창의 **내용** — 카드(모서리 28 · surface)와 어두운 스크림은 아래 `ClipPreparationDialog` 가 그린다. 퍼센트 → 막대 → 무엇을 기다리는지 → (실패면 '다시 시도하기') → 닫기가 한 덩어리로 카드 가운데에
    /// 선다 — 닫기는 상태 줄 바로 아래다. 안드로이드 `ui/voices/ClipPreparationScreen.kt` 의 `ClipPreparationScreen` 과 같은
    /// 구성·값이다(편집기의 `Dialog` 안에 그린다).
    private var standardPreparation: some View {
        VStack(spacing: 0) {
            Text(headline)
                // 36 · 굵기 400 — M3 displaySmall 그대로(안드로이드와 같다). 앱 토큰 `displaySmall` 은 SemiBold 라 쓰지 않는다.
                .font(.pretendard(.regular, size: 36, relativeTo: .largeTitle))
                .foregroundStyle(theme.palette.onSurface)
                // 숫자가 흔들리지 않게 — 퍼센트가 오르내릴 때 폭이 변하면 시선이 튄다.
                .monospacedDigit()
                .contentTransition(.numericText())
                .animation(.easeInOut(duration: 0.2), value: shownPercent)

            // 폭은 최대 280, 두께 4, 끝이 둥글고 트랙은 surfaceVariant — 안드로이드 `LinearProgressIndicator` 와 같다(끝 점 없음).
            PreparationProgressBar(fraction: Double(shownPercent) / 100, thickness: 4)
                .frame(maxWidth: 280)
                .padding(.top, 16)

            Text(statusLine)
                .font(theme.typography.bodyMedium)
                .foregroundStyle(theme.palette.onSurfaceVariant)
                .multilineTextAlignment(.center)
                .padding(.top, 16)

            if !shownFailedVoiceIDs.isEmpty {
                // 서버가 만들다 실패한 목소리 — 다시 큐에 올린다. 다운로드 실패는
                // 선다운로드가 다음 회차에 부족분만 다시 받으므로 버튼이 필요 없다.
                Button(String(localized: "다시 시도하기")) {
                    Task {
                        await readiness.retryFailedRenders(session: auth.session)
                        await refresh()
                    }
                }
                .buttonStyle(PreparationRetryButtonStyle())
                .padding(.top, 24)
            }

            if let onDismiss {
                // 실패해서 '다시 시도하기' 가 떠 있으면 **'닫기'** 다 — 뒤에서 이어지는 일이 없는데 '백그라운드에서 계속' 이라고
                // 하면 거짓말이다(2026-11-22 오너). 나가는 길은 남긴다. 글자는 흐린 글자색이다(두 앱 같다 — 2026-11-22).
                Button {
                    onDismiss()
                } label: {
                    Text(shownFailedVoiceIDs.isEmpty ? String(localized: "백그라운드에서 계속") : String(localized: "닫기"))
                        .font(theme.typography.labelLarge)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 40)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.top, 12)
            }
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// ⚠ **등록 폼 골격(상단바 + 본문 + 하단 행)을 쓰지 않는다**(2026-09-29 지시).
    ///  - 상단바 제목 '목소리 만들기' 를 두지 않는다 — 뒤로가기도 없는 자리라 제목만 떠 있었다.
    ///  - 제목·안내·퍼센트·막대 블록은 화면 **한가운데**(가로·세로)다. 위아래를 아래 버튼 줄만큼
    ///    **똑같이** 비워, 정확히 가운데에 두면서도 글자가 커졌을 때 버튼과 겹치지 않게 한다.
    ///  - '백그라운드에서 계속' 은 화면 **맨 아래**(홈 인디케이터 위)다.
    /// 안드로이드 `ui/voices/VoiceProfileManagementPanel.kt` 의 `VoiceClipPreparationStep` 과 같은 배치다.
    private var registrationPreparation: some View {
        VStack(spacing: 12) {
            Text(String(localized: "이 목소리로 알람 문구를 만들고 있어요"))
                .font(theme.typography.titleMedium)
                .fontWeight(.semibold)
                .foregroundStyle(theme.palette.onSurface)
                .multilineTextAlignment(.center)
            Text(String(localized: "준비되는 대로 알람에서 쓸 수 있어요."))
                .font(theme.typography.bodyMedium)
                .foregroundStyle(theme.palette.onSurfaceVariant)
                .multilineTextAlignment(.center)
            Spacer().frame(height: 6)
            // 생성과 다운로드를 **하나의 퍼센트**로 말한다(2026-09-21 지시).
            // 28 SemiBold(headlineMedium) — 안드로이드 `VoiceClipPreparationStep` 과 같다.
            // 숫자가 흔들리지 않게 — 폭이 변하면 시선이 튄다.
            Text("\(drive.percent)%")
                .font(theme.typography.headlineMedium)
                .foregroundStyle(theme.palette.onSurface)
                .monospacedDigit()
                .contentTransition(.numericText())
                .animation(.easeInOut(duration: 0.2), value: drive.percent)
            // 막대는 폭 78% · 두께 8 · surfaceVariant 트랙(안드로이드와 같다). 전체 개수를 아직 모르면(서버 첫 응답 전) **흐르는
            // 막대**다 — 0% 에 멈춘 막대는 멈춘 것처럼 보인다.
            // ⚠ **막대를 스피너와 번갈아 그리지 말 것**(2026-09-21 지적 "잠깐 깜박"). 예전에는
            //   3초마다 도는 갱신 중에 원형 스피너로 바뀌었는데, 스피너는 제 크기라
            //   막대와 폭이 달라 **화면이 좁아졌다 넓어졌다** 했다. 흐르는 막대도 같은 자리·같은 폭이다.
            GeometryReader { geo in
                Group {
                    if drive.totalKnown {
                        PreparationProgressBar(fraction: Double(drive.percent) / 100, thickness: 8)
                    } else {
                        PreparationIndeterminateBar(thickness: 8)
                    }
                }
                .frame(width: geo.size.width * 0.78)
                .frame(maxWidth: .infinity)
            }
            .frame(height: 8)
        }
        .padding(.horizontal, 24)
        // 아래 버튼 줄만큼 **위아래를 똑같이** 비운다 — 블록은 정확히 가운데에 있고,
        // 글자가 커져도 버튼 자리를 침범하지 않는다.
        .padding(.vertical, onDismiss == nil ? 0 : Self.bottomActionReserve)
        // ⚠ **폭을 꽉 채운다.** 이게 없으면 자식 중 가로로 늘어나는 것이 하나도 없어 화면
        //   전체가 내용 폭으로 줄고, 배경 그라데이션도 그만큼만 칠해져 **좌우가 비어
        //   보인다**(2026-09-21 지적). 높이도 채워야 블록이 세로 가운데에 선다.
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // 안전 영역 안의 맨 아래 — 홈 인디케이터를 피한다(오버레이는 안전 영역을 따른다).
        .overlay(alignment: .bottom) {
            if let onDismiss {
                Button {
                    onDismiss()
                } label: {
                    // 글자 버튼(labelLarge · 흐린 글자색) — 안드로이드 `VoiceClipPreparationStep` 의 `TextButton`.
                    Text(String(localized: "백그라운드에서 계속"))
                        .font(theme.typography.labelLarge)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                        .padding(.horizontal, 12)
                        .frame(minHeight: Self.bottomActionHeight)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.top, Self.bottomActionTopGap)
                .padding(.bottom, Self.bottomActionBottomGap)
            }
        }
        .homeGradientBackground()
    }

    /// 등록 준비 화면 아래 버튼 줄의 치수. 블록을 가운데에 두는 여백이 이 합을 쓴다.
    private static let bottomActionTopGap: CGFloat = 10
    private static let bottomActionHeight: CGFloat = 44
    private static let bottomActionBottomGap: CGFloat = 12
    private static var bottomActionReserve: CGFloat {
        bottomActionTopGap + bottomActionHeight + bottomActionBottomGap
    }

    /// 언제나 퍼센트다 — 다 받으면 화면이 저절로 닫히므로 '준비됐어요' 를 그리지 않는다(위 `onChange(of: preparationSettled)`).
    private var headline: String {
        "\(shownPercent)%"
    }

    /// 화면이 그리는 목소리 — 관문이 막은 그 목소리가 있으면 **그 하나만**(`shownVoices`).
    private var shownReadiness: [ClipReadiness.VoiceProgress] {
        Self.shownVoices(readiness.voices, targetVoiceID: targetVoiceID)
    }
    private var shownPercent: Int { ClipReadiness.percent(shownReadiness) }
    private var shownIsReady: Bool { ClipReadiness.isReady(shownReadiness) }
    private var shownFailedVoiceIDs: [String] { shownReadiness.filter { $0.renderFailed }.map { $0.voiceProfileID } }

    /// ⚠ **편집기가 막은 목소리 하나만 센다**(안드로이드 `shownPreparationReadiness`, 코덱스 #952). 전부를 세면 고른 목소리를
    /// 다 받아도 다른 목소리 때문에 100% 에 닿지 못하고, 다른 목소리의 생성 실패로 '다시 시도' 가 뜨며, 폴링도 멈추지 않는다.
    /// 그 목소리가 아직 목록에 없으면(첫 회차 전) 전부를 그린다.
    nonisolated static func shownVoices(
        _ voices: [ClipReadiness.VoiceProgress],
        targetVoiceID: String?
    ) -> [ClipReadiness.VoiceProgress] {
        guard let id = targetVoiceID, !id.isEmpty else { return voices }
        let target = voices.filter { $0.voiceProfileID == id }
        return target.isEmpty ? voices : target
    }

    /// ⚠ **무엇을 기다리는지 말한다.** 퍼센트만 있으면 멈춘 것처럼 보인다 —
    /// 특히 서버 렌더 구간은 다운로드와 달리 몇 분이 걸릴 수 있다.
    private var statusLine: String {
        if !shownFailedVoiceIDs.isEmpty {
            return String(localized: "목소리를 만들다 실패했어요. 다시 시도해 주세요.")
        }
        if shownReadiness.contains(where: { $0.isRendering }) {
            return String(localized: "목소리를 만들고 있어요. 몇 분 걸릴 수 있어요.")
        }
        return String(localized: "목소리를 받고 있어요. 앱을 닫아도 계속 받아요.")
    }

    /// 3초 폴링을 멈춰도 되는가 — 다 받았고(`isReady`), 관문이 보는 매니페스트에도 막힌 그 목소리가
    /// 실렸다(아래 `refresh` 의 맞추기 — 그게 실패했으면 다음 회차가 다시 맞춘다). 서버 생성 실패는
    /// `isReady` 가 거짓이라 계속 묻는다(의도).
    nonisolated static func pollingCanStop(isReady: Bool, targetClipsLoaded: Bool) -> Bool {
        isReady && targetClipsLoaded
    }

    private var preparationSettled: Bool {
        Self.pollingCanStop(
            isReady: shownIsReady,
            targetClipsLoaded: targetVoiceID.flatMap { $0.isEmpty ? nil : $0 }.map { id in
                voiceStudio.stockClips.contains(where: { $0.voiceProfileId == id })
            } ?? true
        )
    }

    private func refresh() async {
        // 준비도는 서버에서 **지금** 받은 매니페스트로 센다 — 그걸 보고 부족분을 받게 할 때
        // 프리페처가 그보다 먼저 출발한 목록(신선도 창)으로 받으면 새로 생긴 클립을 놓친다.
        let askedAt = Date()
        await readiness.refresh(
            session: auth.session,
            ownedVoiceProfileIDs: voiceStudio.ownedVoiceProfileIDs
        )
        // ⚠ **세는 것만으로는 받아지지 않는다**(Codex #703 P2). `readiness.refresh` 는 서버
        // 상태를 묻고 캐시 파일이 있는지 볼 뿐, **없는 클립을 받지 않는다.** 실제 다운로드는
        // 앱 레벨 프리페처가 하는데 그 `.task(id:)` 는 계정·언어로만 키가 걸려 있어, 이번
        // 세션에 새로 소유하게 된 목소리로는 다시 돌지 않는다 — 그래서 첫 등록이 앱을 껐다
        // 켤 때까지 100% 미만에 갇혔다.
        //
        // `start` 는 `guard task == nil` 이라 3초 폴링마다 불려도 겹쳐 돌지 않고, 이미 받은
        // 것은 내부에서 건너뛴다.
        if !shownIsReady {
            prefetcher.start(
                session: auth.session,
                ownedVoiceProfileIDs: voiceStudio.ownedVoiceProfileIDs,
                manifestDepartedAfter: askedAt
            )
        } else if let targetVoiceID,
                  !voiceStudio.stockClips.contains(where: { $0.voiceProfileId == targetVoiceID }) {
            // ⚠ **관문과 이 화면이 같은 목록을 보게 맞춘다**(2026-09-21). 이 화면은 서버에서
            //   새로 받아 다 받았다고 보는데, 관문(`hasCompleteBucket`)은 앱이 들고 있는
            //   매니페스트를 본다 — 거기 이 목소리의 클립이 하나도 없으면 돌아가자마자 또 막고
            //   고른 목소리를 되돌린다. 여기서 한 번 받아 두면 그 고리가 끊긴다.
            await voiceStudio.loadStockClips(session: auth.session, force: true)
        }
    }
}

/// 편집기에서 여는 준비 창 — 어두운 스크림 위 **가운데 카드**(모서리 28 · surface)에 `ClipPreparationView` 를 그린다. 안드로이드
/// 편집기의 `Dialog` + `Surface(WakerDialogShape)`(`ui/editor/AlarmEditorScreen.kt` 의 `preparationVoiceId`)와 같은 모양이다 —
/// 예전 iOS 는 아래에서 올라오는 시스템 시트였다. 바깥(스크림)을 누르면 닫힌다(안드로이드 `onDismissRequest`).
///
/// ⚠ 시스템 `.sheet`·`fullScreenCover` 가 아니라 **띄우는 화면 위에 얹는다** — 목소리 고르기 시트가 닫히는 그 순간에 열리는 일이
/// 많아(`AlarmEditorSheet.selectVoiceOption`), 프레젠테이션 둘이 겹치지 않게 한다.
struct ClipPreparationDialog: ViewModifier {
    @Environment(\.voiceAlarmTheme) private var theme

    /// 준비할 목소리. nil 이면 창이 없다.
    let voiceID: String?
    /// 손으로 닫는다('백그라운드에서 계속'·'닫기'·바깥 탭).
    let onDismiss: () -> Void
    /// 다 받아 저절로 닫힌다(`ClipPreparationView.onReady`).
    let onReady: () -> Void

    func body(content: Content) -> some View {
        content.overlay {
            // 나타나고 사라지는 것만 서서히 — 애니메이션은 이 겹 안에만 건다(띄운 화면의 다른 변화까지 움직이지 않게).
            ZStack {
                if let voiceID {
                    dialog(voiceID: voiceID)
                }
            }
            .animation(.easeOut(duration: 0.2), value: voiceID != nil)
        }
    }

    private func dialog(voiceID: String) -> some View {
        ZStack {
            AlarmTalkTheme.scrim
                .contentShape(Rectangle())
                .onTapGesture { onDismiss() }
                .accessibilityHidden(true)
            ClipPreparationView(
                onDismiss: onDismiss,
                onReady: onReady,
                targetVoiceID: voiceID
            )
            // 카드 안 위아래 32 · 좌우 24(좌우는 준비 화면이 갖는다), 화면 가장자리에서 좌우 24 · 위아래 72(안드로이드 대화창 폭·
            // 높이에 맞춘 값).
            .padding(.vertical, 32)
            .background(
                theme.palette.surface,
                in: RoundedRectangle(cornerRadius: theme.shapes.extraLarge, style: .continuous)
            )
            // 넓은 화면(아이패드)에서는 대화창 폭에서 멈춘다 — 안드로이드 대화창도 큰 화면에서 폭이 정해져 있다.
            .frame(maxWidth: 560)
            .padding(.horizontal, 24)
            .padding(.vertical, 72)
            .accessibilityAddTraits(.isModal)
        }
        .ignoresSafeArea()
        .transition(.opacity)
    }
}

/// 준비 화면의 진행 막대 — 끝이 둥글고 트랙은 surfaceVariant, 채움은 강조색이다. 안드로이드 `LinearProgressIndicator`
/// (`strokeCap = Round` · `trackColor = surfaceVariant` · 틈·끝 점 없음)와 같은 모양이다. 시스템 `ProgressView` 는 두께·트랙색을
/// 정할 수 없어 직접 그린다.
private struct PreparationProgressBar: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let fraction: Double
    let thickness: CGFloat

    var body: some View {
        GeometryReader { geo in
            let clamped = min(max(fraction, 0), 1)
            ZStack(alignment: .leading) {
                Capsule().fill(theme.palette.surfaceVariant)
                Capsule()
                    .fill(theme.palette.primary)
                    .frame(width: geo.size.width * clamped)
            }
        }
        .frame(height: thickness)
        // 안드로이드 `tween(550, FastOutSlowInEasing)` 과 같은 박자로 채운다.
        .animation(.timingCurve(0.4, 0, 0.2, 1, duration: 0.55), value: fraction)
        .accessibilityElement()
        .accessibilityValue(Text(verbatim: "\(Int((min(max(fraction, 0), 1) * 100).rounded()))%"))
    }
}

/// 전체 양을 아직 모를 때의 **흐르는 막대** — 강조색 조각이 트랙 위를 왼쪽에서 오른쪽으로 계속 흘러간다(안드로이드 인디터미넌트
/// `LinearProgressIndicator` 의 결). 크기·투명도가 아니라 조각 자리만 움직여 배치에 끼지 않는다.
private struct PreparationIndeterminateBar: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let thickness: CGFloat
    @State private var flowing = false

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let segment = width * 0.4
            Capsule()
                .fill(theme.palette.surfaceVariant)
                .overlay(alignment: .leading) {
                    Capsule()
                        .fill(theme.palette.primary)
                        .frame(width: segment)
                        .offset(x: flowing ? width : -segment)
                }
                .clipShape(Capsule())
        }
        .frame(height: thickness)
        .onAppear {
            withAnimation(.linear(duration: 1.4).repeatForever(autoreverses: false)) {
                flowing = true
            }
        }
        .accessibilityHidden(true)
    }
}

/// '다시 시도하기' — 안드로이드 M3 `Button` 과 같은 채움 캡슐(높이 40 · 좌우 24 · labelLarge · primary 위 onPrimary).
private struct PreparationRetryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        PreparationRetryButtonBody(label: configuration.label, isPressed: configuration.isPressed)
    }
}

private struct PreparationRetryButtonBody: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let label: ButtonStyleConfiguration.Label
    let isPressed: Bool

    var body: some View {
        label
            .font(theme.typography.labelLarge)
            .foregroundStyle(theme.palette.onPrimary)
            .padding(.horizontal, 24)
            .frame(minHeight: 40)
            .background(theme.palette.primary, in: Capsule())
            .opacity(isPressed ? 0.8 : 1)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
    }
}
