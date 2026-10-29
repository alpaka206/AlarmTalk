package com.alarmtalk.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * **이름 칸은 상한에서 막고, 넘겨 치면 이유를 말한다**(CLAUDE.md 「말없이 자르지 말 것」 — 목소리 이름 50자, 2026-10-29 두 앱 비교).
 * 예전 안드로이드는 50자에서 입력만 막고 아무 말도 하지 않았다.
 */
class BoundedNameInputTest {

    @Test
    fun `넘겨 치면 상한에서 자르고 경고를 켠다`() {
        val (value, tooLong) = boundedNameInput("가".repeat(VoiceNameMaxLength + 3), VoiceNameMaxLength, wasTooLong = false)
        assertEquals(VoiceNameMaxLength, value.length)
        assertTrue(tooLong)
    }

    @Test
    fun `정확히 상한이면 경고를 건드리지 않는다 — IME 가 잘린 값을 되돌려 보낸다`() {
        val exact = "가".repeat(VoiceNameMaxLength)
        assertTrue(boundedNameInput(exact, VoiceNameMaxLength, wasTooLong = true).second)
        assertFalse(boundedNameInput(exact, VoiceNameMaxLength, wasTooLong = false).second)
    }

    @Test
    fun `상한보다 짧아지면 끈다`() {
        assertFalse(boundedNameInput("엄마 목소리", VoiceNameMaxLength, wasTooLong = true).second)
    }

    @Test
    fun `이모지를 반으로 가르지 않는다`() {
        val raw = "가".repeat(VoiceNameMaxLength - 1) + "😀"
        val (value, tooLong) = boundedNameInput(raw, VoiceNameMaxLength, wasTooLong = false)
        assertEquals("가".repeat(VoiceNameMaxLength - 1), value)
        assertTrue(tooLong)
    }
}
