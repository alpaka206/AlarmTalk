package com.alarmtalk.app

import android.content.Intent
import android.net.Uri
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView

// 약관/개인정보 처리방침 인앱 뷰어 — 원본은 랜딩 사이트라 문서 개정 시 앱 업데이트가 필요 없다.
@Composable
internal fun LegalDocumentScreen(
    contentPadding: PaddingValues,
    title: String,
    url: String,
    onBack: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            // 탭·설정과 같은 그라데이션 배경 — 하위 전체화면 공통 규격.
            .background(homeGradientBrush())
            .padding(contentPadding),
    ) {
        WakerTopBar(
            title = title,
            onBack = onBack,
            modifier = Modifier.padding(top = 12.dp),
        )
        AndroidView(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            factory = { ctx ->
                WebView(ctx).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                    settings.javaScriptEnabled = true
                    webViewClient = LegalDocumentWebViewClient(documentHost = Uri.parse(url).host)
                    loadUrl(url)
                }
            },
        )
    }
}

/**
 * 문서 안의 **다른 사이트 링크는 앱 안에서 열지 않는다** — 기기의 브라우저(메일 주소면 메일 앱)로 보낸다(2026-11-22 두 앱
 * 통일 — iOS `LegalDocumentView` 의 `decidePolicyFor`). 인앱 뷰어가 아무 사이트나 여는 창이 되면 사용자는 자기가 어디에
 * 있는지 알 수 없다. 같은 사이트 안의 이동(약관 ↔ 처리방침)과 서버 리다이렉트는 그대로 이 뷰어에서 연다.
 */
private class LegalDocumentWebViewClient(private val documentHost: String?) : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val target = request.url
        if (!request.isForMainFrame || request.isRedirect || target.host == documentHost) return false
        // 열 앱이 없으면(드문 기기) 아무 일도 하지 않는다 — 뷰어 안에서 열지는 않는다.
        runCatching { view.context.startActivity(Intent(Intent.ACTION_VIEW, target)) }
        return true
    }
}
