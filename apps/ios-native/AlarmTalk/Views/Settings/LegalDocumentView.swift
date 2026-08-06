import SwiftUI
import WebKit

/// 약관·개인정보 처리방침 **인앱 뷰어**. 안드로이드 `ui/settings/LegalDocumentScreen.kt` 대응.
///
/// ⚠ **외부 브라우저로 내보내지 말 것.** iOS 는 `openURL` 로 Safari 를 띄우고 있었는데,
/// 그러면 동의 화면에서 약관을 확인하러 나갔다가 앱으로 못 돌아온다(입력하던 값도 함께
/// 사라진다). 안드로이드는 인앱 WebView 로 띄운다.
///
/// 원본은 랜딩 사이트라 문서를 개정해도 앱 업데이트가 필요 없다.
struct LegalDocumentView: View {
    let title: String
    let url: URL

    var body: some View {
        LegalWebView(url: url)
            .homeGradientBackground()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
    }
}

private struct LegalWebView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // 문서 페이지라 앱과 쿠키·저장소를 공유할 이유가 없다.
        configuration.websiteDataStore = .nonPersistent()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        // 그라데이션 배경이 로딩 중에 비치도록 웹뷰 자체는 투명하게 둔다.
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // URL 이 바뀌는 경우만 다시 읽는다 — 매 렌더마다 load 하면 스크롤이 위로 튄다.
        guard webView.url != url, !webView.isLoading else { return }
        webView.load(URLRequest(url: url))
    }

    func makeCoordinator() -> Coordinator { Coordinator(host: url.host) }

    final class Coordinator: NSObject, WKNavigationDelegate {
        private let host: String?

        init(host: String?) { self.host = host }

        /// 문서 안의 외부 링크는 **앱 안에서 열지 않는다.** 인앱 뷰어가 아무 사이트나
        /// 여는 창이 되면, 사용자는 자기가 어디에 있는지 알 수 없게 된다.
        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let target = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }
            if navigationAction.navigationType == .linkActivated, target.host != host {
                UIApplication.shared.open(target)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
    }
}
