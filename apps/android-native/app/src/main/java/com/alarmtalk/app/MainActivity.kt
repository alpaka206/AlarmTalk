package com.alarmtalk.app

import android.content.pm.ActivityInfo
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels

class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by viewModels()

    // Google Play In-App Updates 매니저. registerForActivityResult 를 STARTED 이전(onCreate)에
    // 등록해야 하므로 액티비티에 두고, 서버 정책(강제/권장) 판정 결과를 소비한다.
    private lateinit var inAppUpdateManager: InAppUpdateManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // SDK 35 는 Android 15+ 에서 엣지투엣지가 기본 강제다. enableEdgeToEdge() 로 하위 버전
        // (예: Android 13)에서도 동일하게 투명 시스템 바 + 콘텐츠 뒤 그리기를 적용해, 지원중단된
        // window.statusBarColor/navigationBarColor 없이 일관된 화면을 만든다. 인셋은 앱 전역
        // Scaffold(contentPadding)가 소비하고, 바 아이콘 명암은 AlarmTalkTheme 이 제어한다.
        enableEdgeToEdge()
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        inAppUpdateManager = InAppUpdateManager(this, viewModel)
        // 민감정보 보호(보안 감사 대응): 이 액티비티는 이메일·운세 생년월일 등 PII 와
        // 보이스 클론 녹음 UI 를 호스팅한다. FLAG_SECURE 로 스크린샷·화면 녹화·최근 앱
        // 썸네일에 내용이 노출되지 않게 한다.
        // 단, dev flavor 에서는 QA·디버깅 중 화면 캡처가 필요하므로 풀어둔다(prod 는 유지).
        if (BuildConfig.FLAVOR != "dev") {
            window.setFlags(
                WindowManager.LayoutParams.FLAG_SECURE,
                WindowManager.LayoutParams.FLAG_SECURE,
            )
        }
        setContent {
            AlarmTalkTheme(themeMode = viewModel.themeMode) {
                AlarmTalkApp(
                    viewModel = viewModel,
                    onCheckInAppUpdate = inAppUpdateManager::checkForUpdates,
                    onCompleteInAppUpdate = inAppUpdateManager::completeFlexibleUpdate,
                )
            }
        }
    }
}
