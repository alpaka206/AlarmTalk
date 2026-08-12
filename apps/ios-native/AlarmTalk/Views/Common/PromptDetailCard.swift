import SwiftUI

/// 문구 화면 **아래**에 붙는 상세 카드 — 이미 등록한 값과 '변경하기'.
///
/// ⚠ **이 카드가 값을 바꾸는 유일한 길이다.** 목록 행을 다시 눌러도 모달이 뜨지 않는다
/// (「이미 등록한 정보는 다시 묻지 않는다」 규약). 이 액션을 지우면 등록한 값을 영영 못 바꾼다.
///
/// 유료 문구 화면(`MessageSettingsPane`)과 무료·기본목소리 문구 화면
/// (`FreeBucketSettingsPane`)이 **같이 쓴다** — 두 벌로 만들지 말 것.
struct PromptDetailCard: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let title: String
    let value: String
    let onChange: () -> Void

    var body: some View {
        EditorCard {
            VStack(alignment: .leading, spacing: 8) {
                Text(title)
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                HStack(alignment: .top, spacing: 12) {
                    Text(value)
                        .font(theme.typography.bodyLarge)
                        .foregroundStyle(theme.palette.onSurface)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    // ⚠ 이 액션을 지우면 등록한 값을 영영 못 바꾼다.
                    Button("변경하기", action: onChange)
                        .font(theme.typography.bodyMedium.weight(.semibold))
                        .buttonStyle(.plain)
                        .foregroundStyle(theme.palette.primary)
                }
            }
            .padding(.vertical, 12)
        }
    }
}
