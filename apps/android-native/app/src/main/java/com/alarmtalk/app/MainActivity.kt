package com.alarmtalk.app

import android.content.pm.ActivityInfo
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.viewmodel.compose.viewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        setContent {
            val viewModel: MainViewModel = viewModel()
            VoiceAlarmTheme(themeMode = viewModel.themeMode) {
                VoiceAlarmApp(viewModel = viewModel)
            }
        }
    }
}
