package com.alarmtalk.app.network

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * **에러 코드 → 문구 표**에서 로그인 갈래만 고정한다.
 *
 * 표 전체를 훑지 않는 이유는 CLAUDE.md 가 "모든 코드에 문구를 둘 필요는 없다" 고
 * 정해 두었기 때문이다 — 비어 있는 것이 정상인 코드가 많다. 여기서는 **비어 있으면
 * 안 되는** 것만 못 박는다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "ko")
class ApiErrorMessagesTest {

    private val context: Context = ApplicationProvider.getApplicationContext()

    /**
     * 로그인 바디에서 이메일만 형식에 안 맞을 때 서버가 내려주는 코드
     * (`packages/backend/src/routes/auth.ts` 의 `isEmailOnlyValidationFailure` 갈래).
     * 표에 없으면 폴백이 "로그인에 실패했어요" 로 뭉뚱그려, 사용자는 멀쩡한 비밀번호를
     * 계속 다시 친다.
     */
    @Test
    fun 이메일_형식_오류에는_문구가_있다() {
        val message = apiErrorMessage(context, "AUTH_EMAIL_INVALID")

        assertNotNull("AUTH_EMAIL_INVALID 에 문구가 없다", message)
        assertEquals(context.getString(R.string.auth_error_email_invalid), message)
    }

    /**
     * ⚠ 자격증명 불일치와 **같은 말을 하면 안 된다.** 이메일 형식 오류는 비밀번호가
     * 맞는지 서버가 보지도 않은 상태라, "이메일 또는 비밀번호" 라고 하면 사용자가
     * 비밀번호부터 다시 친다.
     */
    @Test
    fun 이메일_형식_오류와_자격증명_불일치는_다른_말을_한다() {
        assertNotEquals(
            apiErrorMessage(context, "AUTH_INVALID_CREDENTIALS"),
            apiErrorMessage(context, "AUTH_EMAIL_INVALID"),
        )
    }
}
