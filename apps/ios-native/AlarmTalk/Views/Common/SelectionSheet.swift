import SwiftUI

/// **목록에서 하나 고르는 시트**의 공용 껍데기.
///
/// ⚠ **새 선택 시트를 따로 만들지 말 것.** 예전에는 같은 일을 하는 시트가 넷이었고,
/// 선택 표시가 화면마다 달랐다 — 공휴일 국가는 라디오 원(`largecircle.fill.circle`),
/// 언어는 '선택됨' 알약, 「누구를 깨울까요?」는 아무 표시도 없었다. 닫는 법도 갈려서
/// 어떤 시트는 원형 X 버튼이 있고 어떤 시트는 없었다.
///
/// 규칙(안드로이드 `WakerSelectionSheet` 와 같다):
/// - 선택 표시는 **선택된 행에만 체크마크**. 라디오 원·알약을 새로 만들지 않는다.
/// - 닫기는 **시트 드래그와 스크림**에 맡긴다. 별도 X·'닫기' 버튼을 두지 않는다 —
///   고르면 닫히므로 버튼은 취소와 같은 일을 하는 두 번째 액션이 된다
///   (CLAUDE.md 「취소와 같은 일을 하는 버튼을 두 개 두지 않는다」).
/// - 고르는 즉시 `onSelect` 를 부르고 닫는다. 하단 '저장' 버튼을 두지 않는다.
struct SelectionSheet<Item: Identifiable, Label: View>: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    let title: String
    let items: [Item]
    /// 지금 고른 항목의 id. 없으면 체크마크를 아무 데도 안 그린다.
    let selectedID: Item.ID?
    let onSelect: (Item) -> Void
    @ViewBuilder let label: (Item) -> Label

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        if index > 0 { Divider() }
                        Button {
                            onSelect(item)
                            dismiss()
                        } label: {
                            HStack(spacing: 12) {
                                label(item)
                                Spacer(minLength: 0)
                                if item.id == selectedID {
                                    Image(systemName: "checkmark")
                                        .font(.body.weight(.semibold))
                                        .foregroundStyle(theme.palette.primary)
                                }
                            }
                            // 최소 높이는 안드로이드 행과 같은 52 — 큰 글꼴에서는 늘어난다.
                            .frame(minHeight: 52)
                            .padding(.horizontal, 20)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 4)
            }
            .homeGradientBackground()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
