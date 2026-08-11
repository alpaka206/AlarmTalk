package com.alarmtalk.app

import android.view.ViewGroup
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.alarmtalk.app.R

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
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
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
                    webViewClient = WebViewClient()
                    loadUrl(url)
                }
            },
        )
    }
}
