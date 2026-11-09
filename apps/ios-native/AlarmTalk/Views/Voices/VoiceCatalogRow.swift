import SwiftUI

/// 목소리 목록의 한 행 — **내 목소리·기본 목소리를 같은 모양으로** 세운다.
///
/// 안드로이드 `ui/voices/VoiceProfileRowComponents.kt` 의 `VoiceCatalogRow`.
/// 그 주석이 이 컴포넌트가 생긴 이유를 못박는다: 둘 다 "알람에 쓸 수 있는 목소리" 라는
/// 같은 종류인데 예전에는 섹션과 시트로 흩어져 있어서, **무료 사용자에겐 정작 쓸 수 있는
/// 기본 목소리 4개가 시트를 열기 전까진 보이지 않았다.**
///
/// - 행을 누르면: 내 목소리는 관리(이름 수정·삭제), 그 외에는 미리듣기.
///   내 목소리는 손댈 게 있는 유일한 행이라 행 전체를 그 입구로 준다 — 작은 ⋮ 만 과녁으로
///   두면 매번 조준해야 한다.
/// - **듣기 버튼은 어느 행에나 있다.** iOS 는 기본 목소리 시트 안에서만 재생할 수 있었다.
struct VoiceCatalogRow<Below: View>: View {
    @Environment(\.voiceAlarmTheme) private var theme

    let name: String
    var subtitle: String?
    let isPlaying: Bool
    let onPreview: () -> Void
    var enabled: Bool = true
    /// 있으면 ⋮ 버튼이 생기고 행 전체가 이 액션으로 간다(내 목소리 전용).
    var onOpenActions: (() -> Void)?
    @ViewBuilder var below: () -> Below

    /// 행 내용 높이 — 미리듣기 버튼(48pt) 기준. 부가설명이 있든 없든 같게 둬야
    /// 목록이 들쭉날쭉해지지 않는다.
    private static var contentHeight: CGFloat { 48 }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(name)
                        .font(theme.typography.titleMedium)
                        .fontWeight(.semibold)
                        .foregroundStyle(theme.palette.onSurface)
                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(theme.typography.bodyMedium)
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                // 행 전체가 눌리도록 빈 공간에도 히트영역을 준다.
                .contentShape(Rectangle())
                .onTapGesture {
                    guard enabled else { return }
                    (onOpenActions ?? onPreview)()
                }

                if let onOpenActions {
                    Button(action: onOpenActions) {
                        // ⚠ `ellipsis` 는 점이 **가로**(…)다. 안드로이드는 `MoreVert`(⋮) 라 방향이 반대였다.
                        Image(systemName: "ellipsis.vertical")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                            .frame(width: Self.contentHeight, height: Self.contentHeight)
                            // ⚠ 없으면 글리프만 눌린다 — `frame`/`padding` 이 넓힌 자리는 투명해 히트테스트를 건너뛴다.
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(!enabled)
                    .accessibilityLabel("더보기")
                } else {
                    // ⋮ 가 없는 행도 같은 폭을 비워 둔다 — 안 그러면 '듣기' 가 행마다
                    // 좌우로 어긋나 목록이 들쭉날쭉해 보인다.
                    Color.clear.frame(width: Self.contentHeight, height: 1)
                }

                Button(action: onPreview) {
                    // ⚠ **스피커 아이콘이다**(안드로이드 `ic_voice_listen_24`).
                    // 목록 행의 이 버튼은 "이 목소리가 어떤지 들어본다" 는 뜻이라
                    // 재생(▶)보다 스피커가 맞다 — 정지는 실제로 정지다(다시 누르면 처음부터).
                    Image(systemName: isPlaying ? "stop.fill" : "speaker.wave.2.fill")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(theme.palette.primary)
                        .frame(width: Self.contentHeight, height: Self.contentHeight)
                        // ⚠ 없으면 글리프만 눌린다 — `frame`/`padding` 이 넓힌 자리는 투명해 히트테스트를 건너뛴다.
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!enabled)
                .accessibilityLabel(isPlaying ? String(localized: "정지") : String(localized: "듣기"))
            }
            .frame(minHeight: Self.contentHeight)

            below()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .opacity(enabled ? 1 : 0.5)
    }
}

extension VoiceCatalogRow where Below == EmptyView {
    init(
        name: String,
        subtitle: String? = nil,
        isPlaying: Bool,
        enabled: Bool = true,
        onOpenActions: (() -> Void)? = nil,
        onPreview: @escaping () -> Void
    ) {
        self.init(
            name: name,
            subtitle: subtitle,
            isPlaying: isPlaying,
            onPreview: onPreview,
            enabled: enabled,
            onOpenActions: onOpenActions,
            below: { EmptyView() }
        )
    }
}

/// 목소리 섹션 — **제목은 카드 밖**, 내용만 한 장의 카드.
///
/// 안드로이드 `VoiceCatalogSectionHeader` 미러. 섹션 하나가 한 장의 카드고 행 사이는
/// 구분선이다 — 행마다 카드를 두면 목록이 계단처럼 보인다.
///
/// ⚠ **접지 않는다**(2026-11-09 오너 — 접기 표시와 기능 삭제). 목소리는 계정당 하나 + 기본 넷이라 접어서 아낄 자리가 없고,
/// 접힌 채로 두면 쓸 수 있는 목소리가 가려진다. 안드로이드 짝 `VoiceCatalogSectionHeader`.
struct VoiceSectionCard<Content: View>: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let title: String
    var trailing: AnyView?
    /// 내용이 하나도 없으면 **카드(배경·테두리)를 그리지 않는다.** 헤더는 남긴다 —
    /// '내 목소리' 헤더의 '추가' 가 목소리 등록으로 가는 **유일한 진입점**이라
    /// 헤더까지 감추면 만들 길이 사라진다.
    var hasContent: Bool = true
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                Text(title)
                    .font(theme.typography.titleSmall)
                    .fontWeight(.bold)
                    .foregroundStyle(theme.palette.onSurface)
                    .accessibilityAddTraits(.isHeader)

                Spacer(minLength: 8)
                trailing
            }
            .frame(minHeight: 40)

            if hasContent {
                VStack(alignment: .leading, spacing: 0) {
                    content()
                }
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    theme.palette.surface,
                    in: RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                        .stroke(theme.palette.outlineVariant, lineWidth: 1)
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// 사전렌더(알람 음성 준비) 진행 표시. 안드로이드 `VoiceProfileRowComponents.kt` 의 `VoiceProfileRow`.
///
/// ⚠ **실패도 '준비 중' 으로 그린다**(2026-11-09 오너) — 실패를 보이지 않고 목소리 탭이 스스로 다시 건다(`VoiceAutoRetry`).
///
/// ⚠ **iOS 에는 이게 아예 없었다.** 유료 클론을 등록하면 21개 클립이 서버에서 렌더되는
/// 동안 알람에 쓸 수 없는데, 화면에는 아무 표시도 없어 "만들었는데 안 쓰인다" 로 보였다.
struct VoicePrerenderStatusRow: View {
    @Environment(\.voiceAlarmTheme) private var theme

    let status: VoicePrerenderStatus
    /// 이 목소리의 클립을 **몇 개 중 몇 개 받았는가**. 생성이 끝난 뒤의 몫(50~100%)이다.
    var downloadProgress: (done: Int, total: Int)?

    /// 생성 0~50% + 다운로드 50~100% = **하나의 진행률**(`ClonePrerenderDrive.mergedPercent`).
    ///
    /// ⚠ **생성만 세지 말 것**(2026-09-21 정정). 예전에는 `generated/total` 을 그대로 100%
    /// 로 썼고 `done` 이 되면 행이 통째로 사라졌다 — 실제로는 그때부터 **받는 중**인데
    /// 화면에는 아무 표시가 없었다. 안드로이드는 처음부터 둘을 이어 붙인다.
    private var percent: Int {
        ClonePrerenderDrive.mergedPercent(
            generated: status.generated,
            generationTotal: status.total,
            downloaded: downloadProgress?.done ?? 0,
            downloadTotal: downloadProgress?.total ?? 0,
            phase: status.status == "done" ? .downloading : .generating
        )
    }

    /// 아직 말할 것이 있는가 — 생성 중이거나, 생성은 끝났는데 덜 받았을 때.
    private var isPreparing: Bool {
        if status.status == "failed" { return true }
        if status.status == "done" {
            guard let progress = downloadProgress else { return false }
            return progress.done < progress.total
        }
        return status.status == "pending" && status.total > 0
    }

    var body: some View {
        switch status.status {
        case _ where isPreparing:
            HStack(spacing: 8) {
                ProgressView(value: Double(percent), total: 100)
                    .progressViewStyle(.linear)
                    .tint(theme.palette.primary)
                    .frame(maxWidth: 120)
                Text("알람 음성 준비 중 \(percent)%")
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                Spacer(minLength: 0)
            }
        default:
            // 다 받았거나("done" + 빠진 클립 없음), 큐 행이 없거나("none"), **아직 전체 개수를
            // 모르는 pending** 은 아무것도 그리지 않는다.
            // ⚠ 모르는 값을 catch-all 로 받아 진행률을 그리면 "준비 중 0%" 가 영영 남는다 —
            // 서버는 큐 행이 없을 때 `none` 을 돌려주는데 폴링은 그걸 pending 으로 치지
            // 않아 곧바로 멈추기 때문이다(안드로이드 Codex #673 P2 와 같은 함정).
            EmptyView()
        }
    }
}

/// **실패를 보이지 않고 다시 건다**(2026-11-09 오너: "생성에 실패했어요·말투 분석에 실패했어요를 하지 말고 실패했으면 그냥 생성되고
/// 재시도해야지"). 사전렌더가 `failed`(서버 cron 이 5번 시도하고 멈춤)거나 말투 분석이 `failed` 면 목소리 탭이 재시도 라우트를
/// **스스로** 부른다 — 한 목소리에 **앱 실행당 한 번**. 사전렌더 재시도는 cron 이 다시 5번을 시도하게 하고, 말투 분석은 실패해도
/// 클립이 기본 말투로 만들어지므로 막는 것이 없다. 안드로이드 짝 `VoiceAutoRetry`(`ui/voices/VoiceProfileRowComponents.kt`).
@MainActor
enum VoiceAutoRetry {
    private static var prerender: Set<String> = []
    private static var speechStyle: Set<String> = []

    /// 이번 실행에서 이 목소리의 사전렌더를 처음 다시 거는가(그렇다면 표시를 남긴다).
    static func claimPrerender(_ voiceID: String) -> Bool { prerender.insert(voiceID).inserted }

    /// 이번 실행에서 이 목소리의 말투 분석을 처음 다시 거는가.
    static func claimSpeechStyle(_ voiceID: String) -> Bool { speechStyle.insert(voiceID).inserted }
}
