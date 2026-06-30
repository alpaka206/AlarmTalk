package com.alarmtalk.app

import android.content.pm.ActivityInfo
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.viewmodel.compose.viewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
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
            val viewModel: MainViewModel = viewModel()
            AlarmTalkTheme(themeMode = viewModel.themeMode) {
                AlarmTalkApp(viewModel = viewModel)
            }
        }
    }
}
