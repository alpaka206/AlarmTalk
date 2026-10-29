package com.alarmtalk.app.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 닉네임을 지운 뒤에도 **예전 키로 저장한 폰 안 음성을 다시 찾는다**(`LegacyNicknameKeyStore`, 2026-10-29). 처음 본 닉네임을
 * 얼려 두고, 서버가 닉네임을 더 싣지 않게 돼도 그 값을 쓴다 — 키가 바뀌면 직전 문구로 저장할 때 한도가 한 번 더 깎인다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LegacyNicknameKeyStoreTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @After
    fun clear() {
        context.getSharedPreferences("legacy_nickname_cache_key", Context.MODE_PRIVATE).edit().clear().commit()
    }

    @Test
    fun 처음_본_닉네임을_얼리고_세션에서_사라져도_그_값을_쓴다() {
        val store = LegacyNicknameKeyStore(context)
        assertEquals("규원", store.titleFor("u1", " 규원 "))
        assertEquals("서버가 이름을 더 싣지 않아도 얼린 값", "규원", store.titleFor("u1", null))
        assertEquals("다른 이름이 와도 바꾸지 않는다", "규원", store.titleFor("u1", "다른 이름"))
    }

    @Test
    fun 닉네임이_없는_계정은_빈_값으로_얼어_키에_아무것도_넣지_않는다() {
        val store = LegacyNicknameKeyStore(context)
        assertNull(store.titleFor("u2", ""))
        assertNull("나중에 이름이 생겨도 키는 그대로다", store.titleFor("u2", "새 이름"))
    }
}
