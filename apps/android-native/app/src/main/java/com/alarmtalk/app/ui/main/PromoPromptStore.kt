package com.alarmtalk.app

import android.content.Context

/**
 * 웰컴 프로모 코드 안내를 이 계정에 이미 띄웠는지 기록한다.
 *
 * 계정 단위인 이유: 코드 등록은 계정에 붙는 혜택이라, 같은 기기에서 다른 계정으로 들어온
 * 사람에게는 다시 안내해야 한다. 반대로 이미 한 번 본 계정에는 다시 띄우지 않는다 —
 * 첫 실행에는 이미 동의·권한·목소리 준비가 줄지어 있어서, 여기에 반복 노출까지 얹으면
 * 안내가 아니라 조르기가 된다.
 *
 * 재설치하면(allowBackup=false) 초기화돼 다시 한 번 뜬다. 코드를 이미 쓴 사람은 유료
 * 플랜이 되어 노출 조건(무료 플랜)에서 빠지므로 실질적인 중복 노출은 아니다.
 */
internal class PromoPromptStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun hasPrompted(userId: String): Boolean = prefs.getBoolean(key(userId), false)

    fun markPrompted(userId: String) {
        prefs.edit().putBoolean(key(userId), true).apply()
    }

    private fun key(userId: String) = "promo_prompted_$userId"

    private companion object {
        const val PREFS_NAME = "alarmtalk_promo_prompt"
    }
}
