import SwiftUI

/// 알람이 쓸 목소리 하나를 고르는 시트.
///
/// 안드로이드 `ui/editor/VoiceAudioCard.kt:525-547` 의 `WakerSelectionSheet`.
///
/// ⚠ **인라인 목록으로 되돌리지 말 것.** 편집기 본문에 목소리를 전부 펼치면, 목소리가
/// 여럿인 사용자에게는 시간·반복보다 목소리 목록이 화면을 더 차지한다. 요약 행 하나가
/// 지금 값을 말하고, 바꿀 때만 시트를 연다.
///
/// ⚠ **행마다 '들어보기' 버튼이 있다.** 행 자체는 '선택', 버튼은 '들어보기' 로 나눈다 —
/// 고르려면 먼저 들어봐야 하는데, iOS 에는 편집기에서 미리 들을 방법이 아예 없었다.
struct VoiceSelectionSheet: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    struct Option: Identifiable, Equatable {
        let id: String
        let name: String
        let detail: String?
        /// 무료 등급에서 고를 수 없는 항목(선택 시 이용권 안내로 보낸다).
        var locked: Bool = false
        /// 들어볼 수 있는 항목인가. '직접 녹음' 은 아직 녹음한 것이 없으므로 **false** —
        /// 눌러도 아무 소리가 안 나는 버튼을 두지 않는다.
        var previewable: Bool = true
    }

    let options: [Option]
    let selectedID: String?
    let playingID: String?
    let preparingID: String?
    let onSelect: (Option) -> Void
    let onPreview: (Option) -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(options.enumerated()), id: \.element.id) { index, option in
                        if index > 0 { AlarmSettingDivider() }
                        row(option)
                    }
                }
                .padding(.horizontal, 4)
                .padding(.vertical, 8)
                .background(
                    theme.palette.surface,
                    in: RoundedRectangle(cornerRadius: theme.shapes.vocaCard, style: .continuous)
                )
                .padding(20)
            }
            .homeGradientBackground()
            .navigationTitle("목소리 고르기")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("닫기") { dismiss() }
                }
            }
        }
    }

    private func row(_ option: Option) -> some View {
        HStack(spacing: 12) {
            Button {
                onSelect(option)
                // 잠긴 항목은 안내만 뜨고 선택되지 않으므로 시트를 닫지 않는다.
                if !option.locked { dismiss() }
            } label: {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(option.name)
                            .font(theme.typography.bodyLarge)
                            .fontWeight(.semibold)
                            .foregroundStyle(theme.palette.onSurface)
                        if option.locked {
                            FeatureLockBadge(size: 18, iconSize: 11)
                        }
                    }
                    if let detail = option.detail, !detail.isEmpty {
                        Text(detail)
                            .font(theme.typography.bodySmall)
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if option.id == selectedID {
                Image(systemName: "checkmark")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(theme.palette.primary)
            }

            if option.previewable {
                Button {
                    onPreview(option)
                } label: {
                    Group {
                        if option.id == preparingID {
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: option.id == playingID ? "stop.fill" : "play.fill")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(theme.palette.primary)
                        }
                    }
                    .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(option.id == playingID ? "정지" : "들어보기")
            } else {
                // 재생 버튼 자리를 비워도 폭을 유지해 다른 행과 제목 끝선이 어긋나지 않는다.
                Color.clear.frame(width: 44, height: 44)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }
}
