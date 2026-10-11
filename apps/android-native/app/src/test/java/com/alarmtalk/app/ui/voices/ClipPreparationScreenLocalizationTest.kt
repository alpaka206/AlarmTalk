package com.alarmtalk.app.ui.voices

import android.content.Context
import android.content.res.Configuration
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.R
import java.util.Locale
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ClipPreparationScreenLocalizationTest {
    @Test
    fun `영어 일본어에서 모든 준비 상태와 재시도 버튼을 번역한다`() {
        val base = ApplicationProvider.getApplicationContext<Context>()
        val keys = listOf(R.string.voices_clip_prep_waiting, R.string.voices_clip_prep_ready,
            R.string.voices_clip_prep_owner_wait, R.string.voices_clip_prep_ready_body,
            R.string.voices_clip_prep_failed_body, R.string.voices_clip_prep_rendering_body,
            R.string.voices_clip_prep_downloading_body, R.string.voices_clip_prep_retry)
        for (language in listOf("en", "ja")) {
            val config = Configuration(base.resources.configuration).apply { setLocale(Locale.forLanguageTag(language)) }
            val context = base.createConfigurationContext(config)
            for (key in keys) {
                val text = context.getString(key)
                assertTrue(text.isNotBlank())
                assertFalse("$language: $text", text.any { it in '가'..'힣' })
            }
        }
    }
}
