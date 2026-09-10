import SwiftUI

/// 앱에 실린 법무 문서 전문 뷰어. **동의 화면 전용**이다 — 설정의 뷰어는 랜딩 웹을 띄운다
/// (`LegalDocumentView`). 이유는 `BundledLegalDocument` 주석 참조.
struct BundledLegalDocumentView: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let document: BundledLegalDocument

    var body: some View {
        Group {
            if let markdown = document.markdown() {
                ScrollView {
                    Text(renderLegalMarkdown(markdown))
                        .font(theme.typography.bodyMedium)
                        .foregroundStyle(theme.palette.onSurface)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(20)
                }
            } else {
                // ⚠ 번들에서 못 읽는 상황은 빌드 사고다. 그래도 **동의를 막지는 않는다** —
                //   랜딩 웹으로 떨어뜨려 최소한 읽을 수는 있게 한다.
                LegalDocumentView(title: document.title, url: document.fallbackURL)
            }
        }
        .navigationTitle(document.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

extension BundledLegalDocument: Identifiable {
    var id: String { rawValue }

    /// 번들에서 못 읽을 때만 쓰는 폴백. 정상 경로에서는 절대 쓰이지 않는다.
    var fallbackURL: URL {
        switch self {
        case .privacy: return URL(string: "https://alarm-talk.com/ko/privacy")!
        case .terms: return URL(string: "https://alarm-talk.com/ko/terms")!
        }
    }
}
