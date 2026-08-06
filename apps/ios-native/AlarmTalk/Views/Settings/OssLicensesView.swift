import SwiftUI

/// 오픈소스 라이선스 고지 화면. 안드로이드 `ui/settings/OssLicensesScreen.kt` 대응.
///
/// ⚠ **스토어 고지 요구사항이라 빼면 안 된다.** iOS 에는 이 화면이 통째로 없었다.
///
/// ⚠ **목록은 그 플랫폼이 실제로 번들하는 것만 적는다.** 안드로이드 목록(AndroidX·
/// Retrofit·OkHttp…)을 그대로 베끼면 **쓰지도 않는 소프트웨어를 고지**하는 거짓 문서가
/// 된다. iOS 타깃은 서드파티 SPM 패키지가 하나도 없고(Apple 프레임워크만 쓴다),
/// 번들되는 오픈소스는 Pretendard 서체뿐이다. 의존성을 추가하면 여기도 함께 갱신한다.
struct OssLicensesView: View {
    @Environment(\.voiceAlarmTheme) private var theme

    private struct Library: Identifiable, Hashable {
        let name: String
        let license: License
        var id: String { name }
    }

    private enum License: Hashable {
        case ofl11
        case apache2
        case mit

        var displayName: String {
            switch self {
            case .ofl11: return "SIL Open Font License 1.1"
            case .apache2: return "Apache License 2.0"
            case .mit: return "MIT License"
            }
        }

        var resourceName: String {
            switch self {
            case .ofl11: return "license_ofl_1_1"
            case .apache2: return "license_apache_2_0"
            case .mit: return "license_mit"
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
