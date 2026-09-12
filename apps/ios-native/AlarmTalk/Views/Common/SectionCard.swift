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
            .clipShape(RoundedRectangle(cornerRadius: theme.shapes.medium, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: theme.shapes.medium, style: .continuous)
                    .stroke(theme.palette.outlineVariant, lineWidth: 1)
            )
    }
}

/// 설정 카드 — **제목이 카드 안에 들어간다.**
///
/// 안드로이드 `ui/settings/SettingsScreenComponents.kt:60-83` 의 `SettingsCard` 대응.
/// 그 주석이 이 컴포넌트의 존재 이유를 말한다: "화면마다 카드/행 간격이 달라 보이던
/// 문제의 단일 출처".
///
/// ⚠ **제목을 카드 밖으로 빼지 말 것.** 예전 iOS 는 카드 위에 작은 회색 라벨을 띄웠는데,
/// 그러면 카드가 무엇에 대한 것인지가 카드와 분리돼 스크롤 중에 짝이 어긋나 보인다.
/// 모서리 8·테두리 `surfaceVariant` 도 토큰 위반이었다(18 / `outlineVariant`).
private struct SettingsCardModifier: ViewModifier {
    @Environment(\.voiceAlarmTheme) private var theme
    let title: String?

    func body(content: Content) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let title {
                Text(title)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(theme.palette.onSurface)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
            }
            content
        }
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.palette.surface)
        .clipShape(RoundedRectangle(cornerRadius: theme.shapes.medium, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: theme.shapes.medium, style: .continuous)
                .stroke(theme.palette.outlineVariant, lineWidth: 1)
        )
    }
}
