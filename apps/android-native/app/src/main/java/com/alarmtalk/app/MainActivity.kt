package com.alarmtalk.app

import android.content.pm.ActivityInfo
import android.os.Bundle
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
        // 화면 캡처는 막지 않는다.
        //
        // 예전에는 FLAG_SECURE 로 prod 만 막았다(2026-06-22 사전 감사의 'Android FLAG_SECURE
        // 없음' 항목). 그런데 그건 일반 하드닝 체크리스트지 이 앱 데이터가 그만큼 민감하다는
        // 판단은 아니었다 — 이 화면에 있는 건 이메일·생년월일 정도고 은행 수준이 아니다.
        //
        // 반면 잃는 것이 분명했다: **본인이 본인 화면을 찍는 것**까지 막혀, 알람을 자랑하거나
        // "안 울렸어요" 문의에 화면을 붙일 수가 없었다. 화면 녹화·최근 앱 썸네일까지 함께
        // 막히는 것도 그 대가다. 그래서 걷어낸다(2026-08-04 확정).
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
