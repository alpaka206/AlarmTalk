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
///
/// ⚠ **`NavigationStack` + '닫기' 툴바로 되돌리지 말 것**(2026-08-10 지적 "다른 곳처럼 해,
/// 닫기 버튼 꼭 필요할까?"). 이 시트만 상단바에 가운데 작은 제목과 '닫기' 를 달고 있어
/// 다른 선택 시트(`SelectionSheet` — 좌측 정렬 큰 제목, 버튼 없음)와 달라 보였다.
/// 닫는 법은 **스크림 탭과 아래로 끌기**에 맡긴다 — 고르면 어차피 닫히므로 '닫기' 는
/// 취소와 같은 일을 하는 두 번째 액션이다(CLAUDE.md 「취소와 같은 일을 하는 버튼을 두
/// 개 두지 않는다」).
struct VoiceSelectionSheet: View {
    @Environment(\.voiceAlarmTheme) private var theme

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
    /// 시트를 닫는다. 바텀시트가 `fullScreenCover` 위에 직접 그려지므로 `dismiss` 대신
    /// 호출부의 플래그를 내린다(`SelectionSheet` 를 쓰는 다른 시트와 같은 방식).
    let onClose: () -> Void

    var body: some View {
        // 껍데기(배경·모서리·드래그 핸들)는 `BottomSheetHost` 가 그린다.
        // 안쪽 구성은 `SelectionSheet` 와 같은 규칙 — 좌측 정렬 22pt Bold 제목 + 행 목록.
        VStack(alignment: .leading, spacing: BottomSheetTitle.titleToContentSpacing) {
            BottomSheetTitle(text: "목소리 고르기")

            SheetScrollingContent {
                // ⚠ **`LazyVStack` 으로 되돌리지 말 것.** 게으른 스택은 제안된 높이를 그대로 먹어서
                // `ViewThatFits` 가 "안 들어간다" 고 판단한다 — 짧은 목록도 늘 스크롤 갈래로 떨어진다.
                // 이 목록들은 많아야 열 몇 행이라 게으를 이유도 없다.
                VStack(spacing: 0) {
                    ForEach(Array(options.enumerated()), id: \.element.id) { index, option in
                        if index > 0 { Divider() }
                        row(option)
                    }
                }
            }
        }
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func row(_ option: Option) -> some View {
        HStack(spacing: 12) {
            Button {
                onSelect(option)
                // 잠긴 항목은 안내만 뜨고 선택되지 않으므로 시트를 닫지 않는다.
                if !option.locked { onClose() }
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
                            // 목소리 목록과 같은 아이콘을 쓴다(위 `VoiceCatalogRow` 주석 참조).
                            Image(systemName: option.id == playingID ? "stop.fill" : "speaker.wave.2.fill")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(theme.palette.primary)
                        }
                    }
                    .frame(width: 44, height: 44)
                    // ⚠ 없으면 글리프만 눌린다 — `frame`/`padding` 이 넓힌 자리는 투명해 히트테스트를 건너뛴다.
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(option.id == playingID ? "정지" : "들어보기")
            } else {
                // 재생 버튼 자리를 비워도 폭을 유지해 다른 행과 제목 끝선이 어긋나지 않는다.
                Color.clear.frame(width: 44, height: 44)
            }
        }
        // ⚠ **`SelectionSheet` 의 행 규격과 같게 둔다**(가로 20 · 세로 10 · 최소 높이 56 =
        // 안드로이드 `WakerSheetOptionRow`). 패딩을 먼저, 그다음 최소 높이 — 순서를
        // 뒤집으면 56 + 20 = 76 이 되어 다른 시트보다 행이 20 이나 높아진다.
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
        .frame(minHeight: 56)
    }
}
