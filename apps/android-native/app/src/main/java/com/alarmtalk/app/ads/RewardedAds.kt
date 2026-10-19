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
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/** 보상형 광고를 한 번 띄운 결과. */
internal enum class RewardedAdOutcome {
    /** 끝까지 봤다. 보상은 AdMob 서버가 우리 서버로 따로 알린다 — 여기서 적립하지 않는다. */
    EARNED,

    /** 보상 전에 닫았다. */
    DISMISSED,

    /** 광고를 불러오지 못했다(재고 없음·네트워크). */
    LOAD_FAILED,

    /** 불러왔는데 띄우지 못했다. */
    SHOW_FAILED,
}

/**
 * AdMob 보상형 광고(`docs/spec/ad-rewards.md`).
 *
 * ⚠ **앱은 보상을 적립하지 않는다.** 끝까지 봤다는 신호(`EARNED`)는 화면을 이어 가는 데만 쓰고, 보상은 AdMob 서버가
 * 우리 서버의 확인 콜백을 불러 적립한다. 그래서 광고에 [ServerSideVerificationOptions] 의 `userId` 로 **서버가 준
 * 계정 PK** 를 싣는다 — 그게 없으면 서버는 누구의 보상인지 모른다.
 *
 * 울림 경로에서는 부르지 않는다 — 광고는 사용자가 편집기에서 고른 순간에만 뜬다(스펙 §2).
 */
internal object RewardedAds {
    /** 이 빌드에 보상형 광고 단위가 있는가. 없으면 광고 버튼을 그리지 않는다. */
    val configured: Boolean get() = BuildConfig.ADMOB_REWARDED_AD_UNIT_ID.isNotBlank()

    @Volatile
    private var initialized = false

    /** 불러와서 곧바로 띄운다. 메인 스레드에서 부른다. */
    suspend fun loadAndShow(activity: Activity, serverUserId: String): RewardedAdOutcome {
        if (!configured || serverUserId.isBlank()) return RewardedAdOutcome.LOAD_FAILED
        if (!initialized) {
            initialized = true
            MobileAds.initialize(activity.applicationContext)
        }
        val ad = load(activity) ?: return RewardedAdOutcome.LOAD_FAILED
        ad.setServerSideVerificationOptions(
            ServerSideVerificationOptions.Builder().setUserId(serverUserId).build(),
        )
        return show(activity, ad)
    }

    private suspend fun load(activity: Activity): RewardedAd? = suspendCancellableCoroutine { cont ->
        RewardedAd.load(
            activity,
            BuildConfig.ADMOB_REWARDED_AD_UNIT_ID,
            AdRequest.Builder().build(),
            object : RewardedAdLoadCallback() {
                override fun onAdLoaded(ad: RewardedAd) {
                    if (cont.isActive) cont.resume(ad)
                }

                override fun onAdFailedToLoad(error: LoadAdError) {
                    // 재고 없음(코드 3)은 흔하다 — 경보가 아니라 기록만 남긴다.
                    Log.w(AlarmTalkLog.TAG, "RewardedAds load failed code=${error.code}")
                    if (cont.isActive) cont.resume(null)
                }
            },
        )
    }

    private suspend fun show(activity: Activity, ad: RewardedAd): RewardedAdOutcome =
        suspendCancellableCoroutine { cont ->
            var earned = false
            ad.fullScreenContentCallback = object : FullScreenContentCallback() {
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
