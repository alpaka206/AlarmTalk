package com.alarmtalk.app.ads

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.util.Log
import com.alarmtalk.app.BuildConfig
import com.alarmtalk.app.core.AlarmTalkLog
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback
import com.google.android.gms.ads.rewarded.ServerSideVerificationOptions
import com.google.android.ump.ConsentInformation
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/** 보상형 광고를 한 번 띄운 결과. */
internal enum class RewardedAdOutcome {
    /** 끝까지 봤다(SDK 의 보상 신호). 보상은 AdMob 서버가 우리 서버로 따로 알린다 — 여기서 적립하지 않는다. */
    EARNED,

    /** 보상 신호 없이 닫혔다. 서버는 이것만으로 '보상 없음' 을 단정하지 않는다(늦은 확인 콜백은 받는다). */
    DISMISSED,

    /** 불러왔는데 띄우지 못했다. */
    SHOW_FAILED,
}

/**
 * AdMob 보상형 광고(`docs/spec/ad-rewards.md`).
 *
 * ⚠ **앱은 보상을 적립하지 않는다.** 끝까지 봤다는 신호(`EARNED`)는 화면을 이어 가는 데만 쓰고, 보상은 AdMob 서버가
 * 우리 서버의 확인 콜백을 불러 적립한다. 그래서 광고에 [ServerSideVerificationOptions] 의 `userId`(계정 PK)와
 * `customData`(시청 승인 id)를 싣는다 — **둘 다 서버의 승인 세션이 준 값**이다(§3). 없으면 서버는 누구의 어느 승인인지
 * 모른다.
 *
 * 순서는 언제나 세션 발급 → [load] → 서버 시작 승인 → [show] 다(시작 승인은 표시 **직전**이다).
 * 울림 경로에서는 부르지 않는다 — 광고는 사용자가 편집기에서 고른 순간에만 뜬다(스펙 §2).
 */
internal object RewardedAds {
    /** 이 빌드에 보상형 광고 단위가 있는가. 없으면(빈 운영 ID) 광고 제안 자체를 숨긴다. */
    val configured: Boolean get() = BuildConfig.ADMOB_REWARDED_AD_UNIT_ID.isNotBlank()

    /** 서버 세션에 보내는 이 빌드의 광고 단위(전체 id). */
    val adUnitId: String get() = BuildConfig.ADMOB_REWARDED_AD_UNIT_ID

    @Volatile
    private var initialized = false

    /**
     * 동의(UMP)를 거쳐 광고를 불러오고 SSV 옵션을 싣는다. 메인 스레드에서 부른다.
     *
     * ⚠ **광고를 요청하기 전에 동의(UMP)부터 받는다**(코덱스 #925). 유럽 등 규정이 있는 지역은 Google 의 동의 양식을
     * 거쳐야 하고, `canRequestAds()` 가 거짓이면 요청하지 않는다. 규정이 없는 지역에서는 양식이 뜨지 않고 그대로 지난다.
     */
    suspend fun load(activity: Activity, ssvUserId: String, ssvCustomData: String): AdLoadResult<RewardedAd> {
        if (!configured || ssvUserId.isBlank() || ssvCustomData.isBlank()) return AdLoadResult.Failed
        if (!gatherConsent(activity)) return AdLoadResult.ConsentUnavailable
        if (!initialized) {
            initialized = true
            MobileAds.initialize(activity.applicationContext)
        }
        val result = loadAd(activity)
        if (result is AdLoadResult.Loaded) {
            result.ad.setServerSideVerificationOptions(
                ServerSideVerificationOptions.Builder()
                    .setUserId(ssvUserId)
                    .setCustomData(ssvCustomData)
                    .build(),
            )
        }
        return result
    }

    /** 동의 정보를 갱신하고, 필요하면 양식을 띄운 뒤 광고를 요청해도 되는지 답한다. */
    private suspend fun gatherConsent(activity: Activity): Boolean {
        val info = refreshConsentInfo(activity)
        suspendCancellableCoroutine { cont ->
            UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity) { error ->
                if (error != null) Log.w(AlarmTalkLog.TAG, "RewardedAds consent form error=${error.errorCode}")
                if (cont.isActive) cont.resume(Unit)
            }
        }
        // 갱신에 실패해도 지난번에 받은 동의가 남아 있으면 요청할 수 있다 — 판정은 이 값 하나다.
        return info.canRequestAds()
    }

    /** 이번 실행의 동의 정보를 받는다. 실패해도 저장된 정보를 그대로 돌려준다. */
    suspend fun refreshConsentInfo(activity: Activity): ConsentInformation {
        val info = UserMessagingPlatform.getConsentInformation(activity)
        suspendCancellableCoroutine { cont ->
            info.requestConsentInfoUpdate(
                activity,
                ConsentRequestParameters.Builder().build(),
                { if (cont.isActive) cont.resume(Unit) },
                { error ->
                    Log.w(AlarmTalkLog.TAG, "RewardedAds consent update error=${error.errorCode}")
                    if (cont.isActive) cont.resume(Unit)
                },
            )
        }
        return info
    }

    /**
     * 광고 개인정보 선택을 다시 열 자리가 필요한가 — 규정이 있는 지역에서 Google 이 요구한다. 동의 내역 화면이 이 값이
     * 참일 때만 '광고 개인정보 설정' 행을 그린다. 광고 단위가 없는 빌드는 광고를 요청하지 않으므로 거짓이다.
     */
    suspend fun privacyOptionsRequired(activity: Activity): Boolean =
        configured &&
            refreshConsentInfo(activity).privacyOptionsRequirementStatus ==
            ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED

    /** Google 의 광고 개인정보 선택 양식을 띄운다. */
    fun showPrivacyOptions(activity: Activity) {
        UserMessagingPlatform.showPrivacyOptionsForm(activity) { error ->
            if (error != null) Log.w(AlarmTalkLog.TAG, "RewardedAds privacy options error=${error.errorCode}")
        }
    }

    private suspend fun loadAd(activity: Activity): AdLoadResult<RewardedAd> = suspendCancellableCoroutine { cont ->
        RewardedAd.load(
            activity,
            BuildConfig.ADMOB_REWARDED_AD_UNIT_ID,
            AdRequest.Builder().build(),
            object : RewardedAdLoadCallback() {
                override fun onAdLoaded(ad: RewardedAd) {
                    if (cont.isActive) cont.resume(AdLoadResult.Loaded(ad))
                }

                override fun onAdFailedToLoad(error: LoadAdError) {
                    // 재고 없음(코드 3)은 흔하다 — 경보가 아니라 기록만 남긴다.
                    Log.w(AlarmTalkLog.TAG, "RewardedAds load failed code=${error.code}")
                    if (cont.isActive) {
                        cont.resume(
                            if (error.code == AdRequest.ERROR_CODE_NO_FILL) AdLoadResult.NoFill else AdLoadResult.Failed,
                        )
                    }
                }
            },
        )
    }

    /**
     * 불러온 광고를 띄운다. 서버의 시작 승인을 받은 **뒤에만** 부른다. [onShown] 은 광고가 **실제로 화면에 뜬 순간** 한 번
     * 부른다 — 표시 실패는 부르지 않는다.
     */
    suspend fun show(activity: Activity, ad: RewardedAd, onShown: () -> Unit = {}): RewardedAdOutcome =
        suspendCancellableCoroutine { cont ->
            var earned = false
            ad.fullScreenContentCallback = object : FullScreenContentCallback() {
                override fun onAdShowedFullScreenContent() = onShown()

                override fun onAdDismissedFullScreenContent() {
                    if (cont.isActive) cont.resume(if (earned) RewardedAdOutcome.EARNED else RewardedAdOutcome.DISMISSED)
                }

                override fun onAdFailedToShowFullScreenContent(error: AdError) {
                    Log.w(AlarmTalkLog.TAG, "RewardedAds show failed code=${error.code}")
                    if (cont.isActive) cont.resume(RewardedAdOutcome.SHOW_FAILED)
                }
            }
            ad.show(activity) { earned = true }
        }
}

/** Compose 의 `LocalContext` 는 감싼 컨텍스트일 수 있다 — 광고를 띄울 액티비티를 찾는다. */
internal tailrec fun Context.findHostActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findHostActivity()
    else -> null
}
