package com.alarmtalk.app

import android.app.Activity
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.alarmtalk.app.alarm.RingingService
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.google.android.play.core.appupdate.AppUpdateInfo
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.InstallStateUpdatedListener
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability

/**
 * Google Play In-App Updates 통합(네이티브 OTA 등가물).
 *
 * 서버 /api/app-version 정책 판정을 [MainViewModel] 이 이미 계산해 둔 결과를 그대로 소비한다
 * (버전 비교 중복 구현 금지):
 * - `updateRequired`(min_supported 미달) → **IMMEDIATE**(전면 차단 업데이트)
 * - `updateRecommended`(latest 미달) → **FLEXIBLE**(백그라운드 다운로드 → 앱이 뒤로 갈 때 조용히 설치)
 *
 * 기존 [UpdateRequiredScreen] 강제 게이트는 그대로 유지된다 — In-App Update 를 사용자가
 * 취소했거나 Play 미가용(사이드로드/디버그) 환경에서의 최종 폴백/안전망이다.
 *
 * Play 설치본에서만 실제 트리거되고 debug/사이드로드에선 no-op 이므로, 모든 Play 호출을
 * runCatching/addOnFailureListener 로 감싸 no-op 상황에서도 크래시 없이 조용히 무시한다.
 */
class InAppUpdateManager(
    private val activity: ComponentActivity,
    private val viewModel: MainViewModel,
) : DefaultLifecycleObserver {

    private val appUpdateManager: AppUpdateManager = AppUpdateManagerFactory.create(activity)

    // 업데이트 플로우 결과 처리. FLEXIBLE 이 수락되지 않고 닫히면(취소/실패) 세션 스누즈를
    // 기록해 onResume 재조회가 같은 플로우를 곧바로 다시 띄우지 않게 한다. IMMEDIATE 는
    // 강제 게이트라 재시도 대상. registerForActivityResult 는 activity 가 STARTED 되기 전
    // (=생성자 호출이 일어나는 onCreate 시점)에 등록해야 하므로 필드 초기화에서 등록한다.
    private val updateLauncher: ActivityResultLauncher<IntentSenderRequest> =
        activity.registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
            when (result.resultCode) {
                Activity.RESULT_OK -> Log.i(TAG, "In-app update flow accepted")
                Activity.RESULT_CANCELED -> {
                    Log.i(TAG, "In-app update flow canceled by user")
                    declineFlexibleIfRequested()
                }
                else -> {
                    Log.w(TAG, "In-app update flow failed resultCode=${result.resultCode}")
                    declineFlexibleIfRequested()
                }
            }
        }

    private var flexibleListenerRegistered = false

    // FLEXIBLE 다운로드 진행 상태 리스너. DOWNLOADED 되면 플래그를 세우고, 앱이 이미 뒤에 있으면 곧바로 설치한다
    // (앞에 있으면 뒤로 갈 때 — 아래 [appBackgroundObserver]). 종료 상태에선 즉시 unregister.
    private val installListener = InstallStateUpdatedListener { state ->
        runCatching {
            when (state.installStatus()) {
                InstallStatus.DOWNLOADED -> onFlexibleUpdateDownloaded()
                // 다운로드 단계 취소도 사용자 거절 — 세션 스누즈 없이는 다음 resume 에 재요청된다.
                InstallStatus.CANCELED -> {
                    viewModel.flexibleUpdateDeclined = true
                    unregisterFlexibleListener()
                }
                InstallStatus.INSTALLED,
                InstallStatus.FAILED,
                -> unregisterFlexibleListener()
                else -> {}
            }
        }.onFailure { Log.w(TAG, "In-app update install-state handling failed", it) }
    }

    /**
     * ⚠ 다 받은 업데이트는 **앱이 뒤로 갈 때 조용히 설치한다**(2026-11-16 오너: "자동으로 바뀌면 안돼?").
     * 앞에서 `completeUpdate()` 를 부르면 Play 가 전면 화면을 띄우고 앱을 다시 켜지만, 뒤에서 부르면 화면을 가리지
     * 않고 설치한다(Play In-App Updates 문서). 다음에 열면 새 버전이다 — 그래서 '재시작' 스낵바를 없앴다.
     * 앱 전체가 뒤로 간 것을 본다(`ProcessLifecycleOwner`) — 이 화면만 멈춘 것(울림 화면이 위에 뜬 것)은 아니다.
     * 설치 뒤 알람 예약은 `MY_PACKAGE_REPLACED`(`BootCompletedReceiver`)가 되살린다 — Play 자동 업데이트와 같은 길이다.
     */
    private val appBackgroundObserver = object : DefaultLifecycleObserver {
        override fun onStop(owner: LifecycleOwner) {
            if (viewModel.flexibleUpdateDownloaded) completeFlexibleUpdateQuietly()
        }
    }

    init {
        activity.lifecycle.addObserver(this)
        ProcessLifecycleOwner.get().lifecycle.addObserver(appBackgroundObserver)
    }

    // onResume 마다: 진행 중이던 IMMEDIATE 업데이트를 재개하고, 현재 정책으로 업데이트를 조회한다.
    override fun onResume(owner: LifecycleOwner) {
        checkForUpdates()
    }

    override fun onDestroy(owner: LifecycleOwner) {
        unregisterFlexibleListener()
        ProcessLifecycleOwner.get().lifecycle.removeObserver(appBackgroundObserver)
    }

    /**
     * 업데이트 가용성을 조회해 정책에 맞게 플로우를 시작/재개한다.
     * 서버 정책 로드(checkAppVersion) 직후 AlarmTalkApp 에서도 호출된다 — 콜드스타트에서
     * onResume 시점엔 아직 정책이 로드 전일 수 있기 때문. 중복 호출은 Play 가
     * UPDATE_IN_PROGRESS 로 처리해 무해하다.
     */
    fun checkForUpdates() {
        runCatching {
            appUpdateManager.appUpdateInfo
                .addOnSuccessListener { info -> onAppUpdateInfo(info) }
                .addOnFailureListener { error -> Log.w(TAG, "Failed to query app update info", error) }
        }.onFailure { Log.w(TAG, "In-app update check failed", it) }
    }

    private fun onAppUpdateInfo(info: AppUpdateInfo) {
        runCatching {
            // 프로세스 재시작 등으로 리스너를 놓친 사이 이미 다운로드가 끝난 FLEXIBLE 업데이트 복구.
            if (info.installStatus() == InstallStatus.DOWNLOADED) {
                onFlexibleUpdateDownloaded()
                return
            }
            val forceUpdate = viewModel.updateRequired
            val recommendUpdate = viewModel.updateRecommended
            when (info.updateAvailability()) {
                // 이미 시작된 IMMEDIATE 업데이트를 onResume 진입 시 재개한다.
                UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS -> {
                    if (info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) {
                        startFlow(info, AppUpdateType.IMMEDIATE)
                    }
                }
                UpdateAvailability.UPDATE_AVAILABLE -> {
                    when {
                        forceUpdate && info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE) ->
                            startFlow(info, AppUpdateType.IMMEDIATE)
                        recommendUpdate && !viewModel.flexibleUpdateDeclined &&
                            info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE) ->
                            startFlow(info, AppUpdateType.FLEXIBLE)
                        else -> {}
                    }
                }
                else -> {}
            }
        }.onFailure { Log.w(TAG, "In-app update evaluation failed", it) }
    }

    private fun startFlow(info: AppUpdateInfo, type: Int) {
        runCatching {
            if (type == AppUpdateType.FLEXIBLE) registerFlexibleListener()
            viewModel.flexibleUpdateFlowLaunched = type == AppUpdateType.FLEXIBLE
            appUpdateManager.startUpdateFlowForResult(
                info,
                updateLauncher,
                AppUpdateOptions.newBuilder(type).build(),
            )
        }.onFailure { Log.w(TAG, "Failed to start in-app update flow type=$type", it) }
    }

    private fun declineFlexibleIfRequested() {
        if (viewModel.flexibleUpdateFlowLaunched) {
            viewModel.flexibleUpdateDeclined = true
        }
    }

    private fun onFlexibleUpdateDownloaded() {
        viewModel.flexibleUpdateDownloaded = true
        // 받는 사이 앱이 이미 뒤로 갔으면 뒤로 가는 순간은 지나갔다 — 지금 설치한다.
        val appInForeground = ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
        if (!appInForeground) completeFlexibleUpdateQuietly()
    }

    /**
     * 받아 둔 업데이트를 설치한다(앱이 뒤에 있을 때만 부른다). ⚠ **알람이 울리는(넘겨받는) 중에는 하지 않는다** —
     * 설치가 프로세스를 끝내 울림이 끊긴다. 그때는 플래그를 남겨 다음에 뒤로 갈 때 다시 본다.
     */
    private fun completeFlexibleUpdateQuietly() {
        if (RingingService.ringingOrHandingOffAlarmIds().isNotEmpty()) {
            Log.i(TAG, "In-app update install deferred: an alarm is ringing")
            return
        }
        runCatching {
            appUpdateManager.completeUpdate()
        }.onFailure { Log.w(TAG, "Failed to complete in-app update", it) }
        viewModel.flexibleUpdateDownloaded = false
    }

    private fun registerFlexibleListener() {
        if (flexibleListenerRegistered) return
        runCatching {
            appUpdateManager.registerListener(installListener)
            flexibleListenerRegistered = true
        }.onFailure { Log.w(TAG, "Failed to register in-app update listener", it) }
    }

    private fun unregisterFlexibleListener() {
        if (!flexibleListenerRegistered) return
        runCatching {
            appUpdateManager.unregisterListener(installListener)
        }.onFailure { Log.w(TAG, "Failed to unregister in-app update listener", it) }
        flexibleListenerRegistered = false
    }
}
