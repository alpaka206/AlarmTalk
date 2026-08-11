import SwiftUI

/// 오픈소스 라이선스 고지 화면. 안드로이드 `ui/settings/OssLicensesScreen.kt` 대응.
///
/// ⚠ **스토어 고지 요구사항이라 빼면 안 된다.** iOS 에는 이 화면이 통째로 없었다.
///
/// ⚠ **목록은 그 플랫폼이 실제로 번들하는 것만 적는다.** 안드로이드 목록(AndroidX·
/// Retrofit·OkHttp…)을 그대로 베끼면 **쓰지도 않는 소프트웨어를 고지**하는 거짓 문서가
/// 된다. 의존성을 추가하면 여기도 함께 갱신한다.
///
/// **항목이 하나뿐인 건 정상이다**(2026-08-11 전수 확인). 근거:
/// - `project.yml` 에 `packages:` 선언이 없고 `Package.resolved`·`.xcframework` 도 없다.
/// - 전 타깃 `import` 가 전부 Apple 프레임워크다(AlarmKit·StoreKit·WidgetKit …).
/// - 베껴 온 서드파티 소스도 없다(라이선스 헤더 0건).
/// - 번들 자산은 Pretendard 서체 4개 + **우리가 만든** 인사말 음원뿐이다.
///
/// 안드로이드가 19개인 건 그쪽이 실제로 AndroidX·Retrofit·OkHttp·Gson·Sentry 를 싣기
/// 때문이다 — 플랫폼이 다른 것이지 이쪽이 빠뜨린 게 아니다.
struct OssLicensesView: View {
    @Environment(\.voiceAlarmTheme) private var theme

    private struct Library: Identifiable, Hashable {
        let name: String
        let license: License
        var id: String { name }
    }

    /// ⚠ **쓰는 라이선스만 둔다.** Apache 2.0·MIT 케이스가 선언돼 있었지만 **아무 항목도
    /// 쓰지 않았고**, 전문 `.txt` 두 개가 앱 번들에 그냥 실려 나갔다. 의존성을 추가하면
    /// 그때 케이스와 전문을 함께 넣는다(안드로이드 `res/raw/` 에 둘 다 있다).
    private enum License: Hashable {
        case ofl11

        var displayName: String {
            switch self {
            case .ofl11: return "SIL Open Font License 1.1"
            }
        }

        var resourceName: String {
            switch self {
            case .ofl11: return "license_ofl_1_1"
            }
        }
    }

    private static let libraries: [Library] = [
        Library(name: "Pretendard", license: .ofl11),
    ]

    var body: some View {
        List(Self.libraries) { library in
            NavigationLink {
                LicenseTextView(title: library.name, licenseName: library.license.displayName, resourceName: library.license.resourceName)
            } label: {
                Text(library.name)
                    .font(theme.typography.bodyLarge)
                    .foregroundStyle(theme.palette.onSurface)
                    .frame(height: 56 - 22, alignment: .leading)
            }
            .listRowBackground(Color.clear)
        }
        .listStyle(.plain)
        .homeGradientBackground()
        .navigationTitle("오픈소스 라이선스")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct LicenseTextView: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let title: String
    let licenseName: String
    let resourceName: String

    @State private var text: String = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(licenseName)
                    .font(theme.typography.titleMedium)
                    .fontWeight(.semibold)
                    .foregroundStyle(theme.palette.primary)

                Text(text)
                    // 라이선스 전문은 줄바꿈 위치가 원문의 일부라 고정폭으로 그린다.
                    .font(.system(size: 12, design: .monospaced))
                    .lineSpacing(6)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .textSelection(.enabled)
                    .padding(.bottom, 32)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 24)
            .padding(.vertical, 8)
        }
        .homeGradientBackground()
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard text.isEmpty else { return }
            guard
                let url = Bundle.main.url(forResource: resourceName, withExtension: "txt"),
                let loaded = try? String(contentsOf: url, encoding: .utf8)
            else {
                // 번들 누락은 개발 실수다. 빈 화면 대신 그렇다고 말한다.
                text = "라이선스 전문을 불러오지 못했어요."
                return
            }
            text = loaded
        }
    }
}
