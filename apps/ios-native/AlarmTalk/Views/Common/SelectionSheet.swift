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
        // ⚠ **제목은 `NavigationStack` + 인라인 타이틀이 아니라 왼쪽 정렬 큰 제목이다.**
        // 안드로이드 `WakerSelectionSheet` 는 드래그 핸들 아래에 좌측 정렬 `titleLarge`
        // (22, Bold)를 두고 상단바가 없다. 여기에 네비게이션 바를 두면 가운데 작은 제목 +
        // 시트 배경 위 바 재질이 겹쳐 **같은 시트가 두 앱에서 전혀 다르게** 보인다.
        VStack(alignment: .leading, spacing: 14) {
            Text(title)
                // 안드로이드 titleLarge = 22 Bold.
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(theme.palette.onSurface)
                .padding(.horizontal, 20)
                // ⚠ **위 여백을 4 로 줄이지 말 것 — 드래그 핸들과 붙어 제목이 잘려 보인다.**
                // 시스템 드래그 인디케이터가 시트 맨 위에 그려지는데, 4 만 두면 그 바로
                // 아래에 22pt 굵은 제목이 닿는다(2026-08-10 지적 "모달 위에 여백이 없어
                // 잘리려고 한다"). 안드로이드는 핸들이 위 12 + 아래 10 을 갖고 그 뒤에
                // 제목이 온다 — 같은 간격이 되도록 18 을 준다.
                .padding(.top, 18)

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
                            // ⚠ 최소 높이 **56** — 안드로이드 `WakerSheetOptionRow` 의
                            // `heightIn(min = 56.dp)` 와 같은 값이다. 예전 주석은 "안드로이드
                            // 행과 같은 52" 라고 적었는데 **안드로이드는 52였던 적이 없다.**
                            // 큰 글꼴에서는 이보다 늘어난다.
                            .padding(.horizontal, 20)
                            // ⚠ **패딩을 먼저, 그다음 최소 높이.** 안드로이드
                            // `WakerSheetOptionRow` 는 `heightIn(min = 56.dp)` 안에
                            // `padding(vertical = 10.dp)` 를 **포함**한다. 순서를 뒤집으면
                            // 56 + 20 = 76 이 되어 행이 안드로이드보다 20 이나 높아진다.
                            .padding(.vertical, 10)
                            // ⚠ 안드로이드 `WakerSheetOptionRow` 의 최소 높이(56)는 **패딩을 포함**한다.
                            .frame(minHeight: 56)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .measuredSheetContent()
            }
        }
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.palette.surface)
        // 드래그 핸들은 시스템이 그린다(안드로이드는 `WakerSheetDragHandle` 로 직접 그린다).
        .presentationDragIndicator(.visible)
        // ⚠ 높이는 **실측**이다 — 상수를 더하지 말 것(`FittedSheetHeight` 주석).
        .fittedSheetHeight()
    }
}
