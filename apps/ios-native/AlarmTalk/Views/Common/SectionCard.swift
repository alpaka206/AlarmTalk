import SwiftUI

/// 화면별 카드 표면 modifier 모음.
///
/// `View` 확장으로 두면 분리된 화면 파일들이 동일한 표면 스타일을 공유할 수 있다.
///
/// 다크 모드 대응: `@Environment(\.voiceAlarmTheme).palette` 토큰을 읽는 `ViewModifier` 로
/// 구현해 색 구성표 변화에 자동으로 적응한다.
extension View {
    /// 설정 화면 전용 카드 — title 이 있을 경우 라벨을 위에 띄운다.
    func settingsCard(title: String?) -> some View {
        modifier(SettingsCardModifier(title: title))
    }

    /// 설정 카드의 **겉모양만**(표면·반경 18·테두리) — 안쪽 여백은 부르는 쪽이 정한다. 더보기의 프로필 카드처럼
    /// 카드 하나가 곧 행 하나인 자리가 쓴다(안드로이드 `MenuTabPanel` 의 프로필 `Surface` — 안쪽 여백 16).
    func settingsSurface() -> some View {
        modifier(SettingsSurfaceModifier())
    }
}

// MARK: - Modifiers

/// 설정 카드 — **제목이 카드 안에 들어간다.**
///
/// 안드로이드 `ui/settings/SettingsScreenComponents.kt` 의 `SettingsCard` 대응.
/// 그 주석이 이 컴포넌트의 존재 이유를 말한다: "화면마다 카드/행 간격이 달라 보이던
/// 문제의 단일 출처".
///
/// ⚠ **제목을 카드 밖으로 빼지 말 것.** 예전 iOS 는 카드 위에 작은 회색 라벨을 띄웠는데,
/// 그러면 카드가 무엇에 대한 것인지가 카드와 분리돼 스크롤 중에 짝이 어긋나 보인다.
/// 모서리 8·테두리 `surfaceVariant` 도 토큰 위반이었다(18 / `outlineVariant`).
///
/// 값은 안드로이드 `SettingsCard` 그대로다 — 카드 안쪽 여백 **8**(사방), 제목은 titleSmall Bold 에 좌우 12·위아래 8.
/// 행도 좌우 12 라(`SettingsValueButton`) 제목과 행 글자가 같은 시작선(카드 끝에서 20)에 선다.
/// 테두리는 `outlineVariant` 다 — 안드로이드 `SettingsCard` 가 `wakerCardBorder` 가 아니라 그 색을 쓴다.
private struct SettingsCardModifier: ViewModifier {
    @Environment(\.voiceAlarmTheme) private var theme
    let title: String?

    func body(content: Content) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let title {
                Text(title)
                    .font(theme.typography.titleSmall)
                    .fontWeight(.bold)
                    .foregroundStyle(theme.palette.onSurface)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
            }
            content
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .settingsSurface()
    }
}

private struct SettingsSurfaceModifier: ViewModifier {
    @Environment(\.voiceAlarmTheme) private var theme

    func body(content: Content) -> some View {
        content
            .background(theme.palette.surface)
            .clipShape(RoundedRectangle(cornerRadius: theme.shapes.medium, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: theme.shapes.medium, style: .continuous)
                    .stroke(theme.palette.outlineVariant, lineWidth: 1)
            )
    }
}
