import SwiftUI

/// 목소리 목록의 한 행 — **내 목소리·공유받은 목소리·기본 목소리를 같은 모양으로** 세운다.
///
/// 안드로이드 `ui/voices/VoiceProfileRowComponents.kt:341-424` 의 `VoiceCatalogRow`.
/// 그 주석이 이 컴포넌트가 생긴 이유를 못박는다: 셋 다 "알람에 쓸 수 있는 목소리" 라는
/// 같은 종류인데 예전에는 섹션과 시트로 흩어져 있어서, **무료 사용자에겐 정작 쓸 수 있는
/// 기본 목소리 4개가 시트를 열기 전까진 보이지 않았다.**
///
/// - 행을 누르면: 내 목소리는 관리(이름 수정·공유·삭제), 그 외에는 미리듣기.
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
                }
                .buttonStyle(.plain)
                .disabled(!enabled)
                .accessibilityLabel(isPlaying ? "정지" : "듣기")
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
/// ⚠ **제목을 카드 안으로 되돌리지 말 것.** 안드로이드는 제목이 카드 위에 떠 있고,
/// 눌러서 **접을 수 있다**(목소리가 많아졌을 때 스스로 접는 선택지). 제목을 카드에 넣으면
/// 누를 자리가 카드 안이 되어 '행을 누른 것' 과 구분되지 않는다.
///
/// ⚠ **처음에는 펼쳐진 상태다.** 접기는 사용자가 고르는 것이지 기본이 아니다 — 기본을
/// 접힘으로 두면 목소리를 찾으려고 매번 펼쳐야 한다.
struct VoiceSectionCard<Content: View>: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let title: String
    var trailing: AnyView?
    @ViewBuilder var content: () -> Content

    @State private var expanded = true

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                Button {
                    withAnimation(.snappy(duration: 0.22)) { expanded.toggle() }
                } label: {
                    HStack(spacing: 2) {
                        Text(title)
                            .font(theme.typography.titleSmall)
                            .fontWeight(.bold)
                            .foregroundStyle(theme.palette.onSurface)
                        // 펼침 ⌄ / 접힘 › — 회전으로 상태가 이어져 보이게 한다(안드로이드와 같다).
                        Image(systemName: "chevron.down")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                            .rotationEffect(.degrees(expanded ? 0 : -90))
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("\(title) 섹션"))
                .accessibilityHint(Text(expanded ? "접기" : "펼치기"))

                Spacer(minLength: 8)
                trailing
            }
            .frame(minHeight: 40)

            if expanded {
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

/// 사전렌더(알람 음성 준비) 진행·실패 표시. 안드로이드 `VoiceProfileRowComponents.kt:484-508`.
///
/// ⚠ **iOS 에는 이게 아예 없었다.** 유료 클론을 등록하면 21개 클립이 서버에서 렌더되는
/// 동안 알람에 쓸 수 없는데, 화면에는 아무 표시도 없어 "만들었는데 안 쓰인다" 로 보였다.
/// 말투 분석이 실패했을 때의 안내 + 재시도.
///
/// ⚠ **이 행이 없으면 사용자는 실패한 줄도 모른다.** 분석이 실패한 목소리는 말투 없이
/// 밋밋하게 읽는데, 화면에는 아무 표시가 없었다. 서버에는 재시도 라우트가 있는데도
/// 부를 방법이 앱에 없었다. 안드로이드 `ui/voices/VoiceProfileRowComponents.kt` 의
/// `voicesr_speech_style_failed` / `voicesr_speech_style_retry` 행과 같은 모양이다.
struct VoiceSpeechStyleFailedRow: View {
    @Environment(\.voiceAlarmTheme) private var theme

    let retrying: Bool
    let onRetry: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Text("말투 분석에 실패했어요")
                .font(theme.typography.bodySmall)
                .foregroundStyle(theme.palette.error)
            Button("다시 분석", action: onRetry)
                .font(theme.typography.bodySmall.weight(.semibold))
                .buttonStyle(.plain)
                .foregroundStyle(theme.palette.primary)
                .disabled(retrying)
            Spacer(minLength: 0)
        }
    }
}

struct VoicePrerenderStatusRow: View {
    @Environment(\.voiceAlarmTheme) private var theme

    let status: VoicePrerenderStatus
    let retrying: Bool
    let onRetry: () -> Void

    /// 생성 0~100%. 안드로이드와 같은 계산(전체 대비 생성 개수).
    private var percent: Int {
        guard status.total > 0 else { return 0 }
        return min(100, max(0, Int((Double(status.generated) / Double(status.total)) * 100)))
    }

    var body: some View {
        switch status.status {
        case "failed":
            HStack(spacing: 8) {
                Text("알람 음성 생성에 실패했어요")
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.error)
                Button("다시 시도", action: onRetry)
                    .font(theme.typography.bodySmall.weight(.semibold))
                    .buttonStyle(.plain)
                    .foregroundStyle(theme.palette.primary)
                    .disabled(retrying)
                Spacer(minLength: 0)
            }
        case "pending" where status.total > 0:
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
            // "done"·"none" 과 **아직 전체 개수를 모르는 pending** 은 아무것도 그리지 않는다.
            // ⚠ 모르는 값을 catch-all 로 받아 진행률을 그리면 "준비 중 0%" 가 영영 남는다 —
            // 서버는 큐 행이 없을 때 `none` 을 돌려주는데 폴링은 그걸 pending 으로 치지
            // 않아 곧바로 멈추기 때문이다(안드로이드 Codex #673 P2 와 같은 함정).
            EmptyView()
        }
    }
}
