import SwiftUI

/// 화면별 카드 표면 modifier 모음.
///
/// ContentView 1606 줄 분해 과정에서 곳곳에 흩어진 `sectionSurface()` /
/// `settingsCard()` 헬퍼를 한 곳으로 모았다. `View` 확장으로 두면 분리된
/// 화면 파일들이 동일한 표면 스타일을 공유할 수 있다.
///
/// 다크 모드 대응: 정적 `AlarmTalkTheme.*`(라이트 전용) 대신
/// `@Environment(\.voiceAlarmTheme).palette` 토큰을 읽는 `ViewModifier` 로
/// 구현해, `VocaCardSurfaceModifier` 와 동일하게 색 구성표 변화에 자동으로
/// 적응한다.
extension View {
    /// 화면의 주요 콘텐츠 블록을 감싸는 표면 스타일. 패딩·라운드·테두리를 모두 포함.
    func sectionSurface() -> some View {
        modifier(SectionSurfaceModifier())
    }

    /// 설정 화면 전용 카드 — title 이 있을 경우 라벨을 위에 띄운다.
    func settingsCard(title: String?) -> some View {
        modifier(SettingsCardModifier(title: title))
    }
}

// MARK: - Modifiers

private struct SectionSurfaceModifier: ViewModifier {
    @Environment(\.voiceAlarmTheme) private var theme

    func body(content: Content) -> some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.palette.surface)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(theme.palette.surfaceVariant, lineWidth: 1)
            )
    }
}

private struct SettingsCardModifier: ViewModifier {
    @Environment(\.voiceAlarmTheme) private var theme
    let title: String?

    func body(content: Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .padding(.leading, 4)
            }
            content
                .background(theme.palette.surface)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(theme.palette.surfaceVariant, lineWidth: 1)
                )
        }
    }
}
