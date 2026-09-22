import Foundation
import os

/// **등록한 목소리가 쓸 수 있게 될 때까지를 하나의 진행률로 보여 준다.**
///
/// 사용자에게는 '서버가 만드는 중' 과 '폰이 받는 중' 이 두 가지 일이 아니라 "알람 음성이
/// 준비되는 중" 하나다. 단계마다 n/21 을 따로 세면 생성이 끝나는 순간 100% 에서 0% 로
/// 되돌아가 **진행이 후퇴한 것처럼** 보인다. 그래서 **생성 0~50%, 다운로드 50~100%** 로
/// 이어 붙인다 — 안드로이드 `CloneVoiceReadiness`·`PrerenderDriveState` 와 같은 규칙이다
/// (`ui/voices/VoiceProfileManagementPanel.kt`).
///
/// ⚠ **세는 것만으로는 만들어지지도, 받아지지도 않는다.** 서버 생성은 5분 크론이 도는데,
/// 앱이 열려 있는 동안에는 `POST voice/{id}/prerender/advance` 로 **직접 밀어** 앞당긴다
/// (안드로이드 `MainViewModel.startPrerenderDrive` 와 같다). 다운로드는 `StockClipPrefetcher`
/// 가 한다 — 여기서는 시작만 시키고 캐시를 세어 진행률만 만든다.
@MainActor
final class ClonePrerenderDrive: ObservableObject {
    private static let logger = Logger(subsystem: "com.alarmtalk.app", category: "ClonePrerender")

    enum Phase: Equatable {
        /// 서버가 클립을 만드는 중(0~50%).
        case generating
        /// 만들기는 끝났고 폰이 받는 중(50~100%).
        case downloading
        case done
        /// 서버 생성이 실패로 표시됐다. 목소리 탭 행의 '다시 시도' 가 되살린다.
        case failed
    }

    @Published private(set) var phase: Phase = .generating
    /// 0~100. 생성과 다운로드를 이어 붙인 **하나의** 값.
    @Published private(set) var percent: Int = 0
    /// 아직 전체 개수를 모른다(첫 조회 전). 막대를 미확정으로 그릴지 정한다.
    @Published private(set) var totalKnown = false

    private let api: AlarmTalkAPI
    private var task: Task<Void, Never>?

    init(api: AlarmTalkAPI = .shared) {
        self.api = api
    }

    /// 생성 0~50 · 다운로드 50~100 을 이어 붙인다.
    ///
    /// ⚠ 다운로드 구간에서 생성 몫은 **꽉 찬 50 으로 고정**한다. 서버가 done 을 준 뒤에도
    /// `generated` 를 다시 세면 그 값이 흔들려 막대가 뒤로 간다.
    /// 순수 계산이라 액터에 묶지 않는다 — 테스트와 행 표시(`VoicePrerenderStatusRow`)가 그냥 부른다.
    nonisolated static func mergedPercent(
        generated: Int,
        generationTotal: Int,
        downloaded: Int,
        downloadTotal: Int,
        phase: Phase
    ) -> Int {
        let generatedPart: Int
        switch phase {
        case .generating:
            generatedPart = generationTotal > 0
                ? min(50, max(0, generated) * 50 / generationTotal)
                : 0
        case .downloading, .done, .failed:
            generatedPart = 50
        }
        let downloadPart: Int
        switch phase {
        case .downloading, .done:
            downloadPart = downloadTotal > 0
                ? min(50, max(0, downloaded) * 50 / downloadTotal)
                : 0
        case .generating, .failed:
            downloadPart = 0
        }
        return min(100, max(0, generatedPart + downloadPart))
    }

    /// 이미 돌고 있으면 아무 일도 하지 않는다(중복 호출 안전).
    ///
    /// ⚠ **'백그라운드에서 계속' 으로 화면을 닫아도 계속 돈다.** 화면이 이 객체를 소유해도
    /// (`@StateObject`) 돌고 있는 `run` 이 자신을 붙잡고 있어 루프가 끊기지 않는다 —
    /// 안드로이드가 `viewModelScope` 에서 도는 것과 같은 결과다. 끊기면 그 문구가 거짓말이 된다.
    func start(
        voiceProfileID: String,
        session: AuthSession?,
        prefetcher: StockClipPrefetcher,
        ownedVoiceProfileIDs: Set<String>
    ) {
        guard task == nil, let token = session?.token else { return }
        task = Task { [weak self] in
            await self?.run(
                voiceProfileID: voiceProfileID,
                token: token,
                session: session,
                prefetcher: prefetcher,
                ownedVoiceProfileIDs: ownedVoiceProfileIDs
            )
            self?.task = nil
        }
    }

    func cancel() {
        task?.cancel()
        task = nil
    }

    /// 전진이 제자리인 회차를 이만큼 연달아 만나면 미는 것을 그만둔다 — 그 뒤는 크론이 잇는다
    /// (안드로이드와 같은 판단). 화면은 그대로 두고 폴링만 계속한다.
    private static let stagnantRoundsBeforeGivingUp = 3

    private func run(
        voiceProfileID: String,
        token: String,
        session: AuthSession?,
        prefetcher: StockClipPrefetcher,
        ownedVoiceProfileIDs: Set<String>
    ) async {
        var generationTotal = 0
        var lastGenerated = -1
        var stagnantRounds = 0
        var driving = true

        // --- 1) 서버 생성(0~50%) ---
        while !Task.isCancelled {
            var generated = 0
            var finished = false

            if driving {
                do {
                    let step = try await api.advanceVoicePrerender(id: voiceProfileID, token: token)
                    generationTotal = step.total
                    generated = step.generated
                    finished = step.done
                    if step.claimStuck == true {
                        // ⚠ **무진전으로 세지 않는다.** 서버가 클레임을 못 놓은 회차라, 리스가
                        //   끝나기 전에는 몇 번을 물어도 같은 개수가 온다(모델 주석 참조).
                        //   말한 만큼 기다렸다가 같은 자리에서 다시 민다.
                        if generationTotal > 0 { totalKnown = true }
                        percent = Self.mergedPercent(
                            generated: generated,
                            generationTotal: generationTotal,
                            downloaded: 0,
                            downloadTotal: 0,
                            phase: .generating
                        )
                        let waitMs = max(1_000, step.retryAfterMs ?? 120_000)
                        try? await Task.sleep(nanoseconds: UInt64(waitMs) * 1_000_000)
                        continue
                    }
                } catch {
                    // 밀다 실패하면 **거기서 끝내지 않는다** — 크론이 계속 만들고 있으므로
                    // 상태만 물어 가며 기다린다.
                    Self.logger.warning("prerender advance failed; falling back to polling")
                    driving = false
                    continue
                }
            } else {
                guard let status = try? await api.voicePrerenderStatus(id: voiceProfileID, token: token) else {
                    try? await Task.sleep(nanoseconds: 3_000_000_000)
                    continue
                }
                generationTotal = status.total
                generated = status.generated
                finished = status.status == "done"
                if status.status == "failed" {
                    phase = .failed
                    return
                }
            }

            if generationTotal > 0 { totalKnown = true }
            phase = .generating
            percent = Self.mergedPercent(
                generated: generated,
                generationTotal: generationTotal,
                downloaded: 0,
                downloadTotal: 0,
                phase: .generating
            )
            if finished { break }

            if generated == lastGenerated {
                stagnantRounds += 1
                if driving, stagnantRounds >= Self.stagnantRoundsBeforeGivingUp {
                    // 더 밀어도 나아가지 않는다(다른 기기가 큐를 쥐었거나 서버가 쉬는 중).
                    driving = false
                }
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            } else {
                stagnantRounds = 0
            }
            lastGenerated = generated
        }
        if Task.isCancelled { return }

        // --- 2) 다운로드(50~100%) ---
        phase = .downloading
        percent = Self.mergedPercent(
            generated: generationTotal,
            generationTotal: generationTotal,
            downloaded: 0,
            downloadTotal: 0,
            phase: .downloading
        )
        // 받는 것은 프리페처가 한다. **이 목소리를 대상에 넣어** 다시 돌린다 —
        // 앱 레벨 프리페처의 `.task(id:)` 는 계정·언어로만 키가 걸려 있어, 이번 세션에 새로
        // 등록한 목소리로는 스스로 다시 돌지 않는다.
        var targets = ownedVoiceProfileIDs
        targets.insert(voiceProfileID)
        prefetcher.start(session: session, ownedVoiceProfileIDs: targets)

        while !Task.isCancelled {
            if let progress = await StockClipPrefetcher.progressOffMain(voiceProfileID: voiceProfileID) {
                totalKnown = true
                percent = Self.mergedPercent(
                    generated: generationTotal,
                    generationTotal: generationTotal,
                    downloaded: progress.done,
                    downloadTotal: progress.total,
                    phase: .downloading
                )
                if progress.done >= progress.total {
                    phase = .done
                    percent = 100
                    return
                }
            }
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            // 매니페스트가 아직 이 목소리를 모르면(방금 만들어졌다) 프리페처가 다시 받아 온다.
            prefetcher.start(session: session, ownedVoiceProfileIDs: targets)
        }
    }
}
