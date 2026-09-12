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
                // ⚠ **웹으로 떨어뜨리지 말 것 — 그러면 이 화면의 존재 이유가 사라진다**
                //   (코덱스 #732). 동의 기록에 실리는 버전은 빌드 시점의
                //   `LegalPolicy.bundledVersion` 인데, 여기서 랜딩 문서를 띄우면 **보여 준
                //   것과 기록한 버전이 다시 갈라진다** — 바로 그걸 막으려고 번들에 실었다.
                //   게다가 오프라인이면 웹은 빈 화면이라, 사용자는 아무것도 못 본 채
                //   "문서를 봤다" 는 기록만 남는다.
                //
                //   그래서 **닫힌 실패**로 둔다. 번들 읽기 실패는 빌드 사고이고
                //   (회귀 테스트 `BundledLegalDocumentTests` 가 CI 에서 잡는다), 실제로
                //   그런 빌드가 나갔다면 사용자가 할 수 있는 일은 업데이트뿐이다.
                unavailable
            }
        }
        .navigationTitle(document.title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var unavailable: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.largeTitle)
                .foregroundStyle(theme.palette.error)
            Text("문서를 불러오지 못했어요")
                .font(theme.typography.titleSmall)
                .foregroundStyle(theme.palette.onSurface)
            Text("앱을 최신 버전으로 업데이트한 뒤 다시 시도해 주세요.")
                .font(theme.typography.bodySmall)
                .foregroundStyle(theme.palette.onSurfaceVariant)
                .multilineTextAlignment(.center)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

extension BundledLegalDocument: Identifiable {
    var id: String { rawValue }
}
