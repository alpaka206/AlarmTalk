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

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        private let host: String?

        init(host: String?) { self.host = host }

        /// 문서 안의 외부 링크는 **앱 안에서 열지 않는다.** 인앱 뷰어가 아무 사이트나
        /// 여는 창이 되면, 사용자는 자기가 어디에 있는지 알 수 없게 된다.
        ///
        /// ⚠ **완료 핸들러 형태로 쓰지 말 것 — 그러면 아예 안 불린다.** 예전에는
        /// `decisionHandler:` 를 받는 변형을 썼는데, 최신 SDK 에서 그 요구사항은
        /// `@MainActor` 로 격리돼 있어서 nonisolated 인 `NSObject` 메서드와 **서명이
        /// 어긋났다**. 컴파일러는 "nearly matches optional requirement" 경고만 내고
        /// 넘어가고(선택 요구사항이라 오류가 아니다), WebKit 은 그 메서드를 찾지 못해
        /// **외부 링크가 인앱 뷰어 안에서 그대로 열렸다** — 이 코드가 막으려던 바로 그것이다.
        /// async 변형 + `@MainActor` 는 그 어긋남이 생길 수 없다.
        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction
        ) async -> WKNavigationActionPolicy {
            guard let target = navigationAction.request.url else { return .cancel }
            if navigationAction.navigationType == .linkActivated, target.host != host {
                // 완료 핸들러 오버로드를 **명시**한다 — 인자 하나짜리는 async 로도 풀려서
                // `await` 를 요구하고, 그러면 사파리가 열릴 때까지 정책 결정이 미뤄진다.
                UIApplication.shared.open(target, options: [:], completionHandler: nil)
                return .cancel
            }
            return .allow
        }
    }
}
