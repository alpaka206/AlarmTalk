package com.alarmtalk.app

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alarmtalk.app.R

private enum class OssLicenseKind(val displayName: String, val rawRes: Int) {
    APACHE_2_0("Apache License 2.0", R.raw.license_apache_2_0),
    MIT("MIT License", R.raw.license_mit),
    OFL_1_1("SIL Open Font License 1.1", R.raw.license_ofl_1_1),
}

private data class OssLibrary(val name: String, val license: OssLicenseKind)

// 앱이 실제 사용하는 오픈소스 라이브러리(직접 의존성). Google Play SDK(billing·play-services·
// app-update)는 오픈소스가 아니라 여기서 제외한다. build.gradle.kts 의존성을 추가/삭제하면 함께 갱신한다.
//
// ⚠ **코드 의존성만 적는 목록이 아니다 — 번들하는 리소스도 고지 대상이다.**
// Pretendard 는 `res/font/pretendard_*.otf` 로 APK 에 실려 나가는데 2026-08-11 까지
// 이 목록에 없었다(iOS 쪽에는 있었다). 서체·아이콘·사운드 같은 자산도 라이선스가 붙으면
// 여기에 넣는다.
private val OSS_LIBRARIES: List<OssLibrary> = listOf(
    OssLibrary("AndroidX Activity Compose", OssLicenseKind.APACHE_2_0),
    OssLibrary("AndroidX Core KTX", OssLicenseKind.APACHE_2_0),
    OssLibrary("AndroidX Lifecycle", OssLicenseKind.APACHE_2_0),
    OssLibrary("AndroidX Navigation Compose", OssLicenseKind.APACHE_2_0),
    OssLibrary("AndroidX Room", OssLicenseKind.APACHE_2_0),
    OssLibrary("AndroidX Security Crypto", OssLicenseKind.APACHE_2_0),
    OssLibrary("AndroidX WorkManager", OssLicenseKind.APACHE_2_0),
    OssLibrary("Gson", OssLicenseKind.APACHE_2_0),
    OssLibrary("Jetpack Compose Material Icons", OssLicenseKind.APACHE_2_0),
    OssLibrary("Jetpack Compose Material3", OssLicenseKind.APACHE_2_0),
    OssLibrary("Jetpack Compose UI", OssLicenseKind.APACHE_2_0),
    OssLibrary("Kotlin Coroutines", OssLicenseKind.APACHE_2_0),
    OssLibrary("Kotlin Standard Library", OssLicenseKind.APACHE_2_0),
    OssLibrary("OkHttp", OssLicenseKind.APACHE_2_0),
    OssLibrary("Pretendard", OssLicenseKind.OFL_1_1),
    OssLibrary("OkHttp Logging Interceptor", OssLicenseKind.APACHE_2_0),
    OssLibrary("Retrofit", OssLicenseKind.APACHE_2_0),
    OssLibrary("Retrofit Gson Converter", OssLicenseKind.APACHE_2_0),
    OssLibrary("Sentry Android", OssLicenseKind.MIT),
).sortedBy { it.name }

// 오픈소스 라이선스 — 토스식 미니멀 목록(아이콘·셰브론 없음) → 누르면 라이선스 전문 인앱 상세.
@Composable
internal fun OssLicensesScreen(
    contentPadding: PaddingValues,
    onBack: () -> Unit,
) {
    var selected by remember { mutableStateOf<OssLibrary?>(null) }
    // 상세를 보는 중이면 뒤로가기는 목록으로. 목록이면 화면을 벗어난다.
    BackHandler(enabled = selected != null) { selected = null }
    val current = selected

    Column(
        modifier = Modifier
            .fillMaxSize()
            // 탭·설정과 같은 그라데이션 배경 — 하위 전체화면 공통 규격.
            .background(homeGradientBrush())
            .padding(contentPadding),
    ) {
        WakerTopBar(
            // 본문을 열어 둔 상태면 뒤로가기가 목록으로 돌아간다(화면을 나가지 않는다).
            title = current?.name ?: stringResource(R.string.menu_open_source_licenses),
            onBack = { if (current != null) selected = null else onBack() },
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
        )

        if (current == null) {
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(OSS_LIBRARIES, key = { it.name }) { lib ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp)
                            .clickable { selected = lib }
                            .padding(horizontal = 24.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = lib.name,
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                    }
                }
            }
        } else {
            val context = LocalContext.current
            val licenseText = remember(current) {
                context.resources.openRawResource(current.license.rawRes)
                    .bufferedReader().use { reader -> reader.readText() }
            }
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp, vertical = 8.dp),
            ) {
                Text(
                    text = current.license.displayName,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(bottom = 16.dp),
                )
                Text(
                    text = licenseText,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 12.sp,
                    lineHeight = 18.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 32.dp),
                )
            }
        }
    }
}
