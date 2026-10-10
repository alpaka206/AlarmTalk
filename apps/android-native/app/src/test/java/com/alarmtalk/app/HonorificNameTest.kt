package com.alarmtalk.app

import android.content.Context
import android.content.res.Configuration
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.alarm.SocialNotificationFactory
import com.alarmtalk.app.data.honoredPersonName
import com.alarmtalk.app.network.FamilyGroupMember
import com.alarmtalk.app.network.FamilyVoiceProfile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Locale

/**
 * 존칭은 한 곳(`honoredPersonName`)에서 한 번만 붙인다 — `docs/spec/localization.md` §3.
 * 예전에는 알림 제목이 님만 보고 さん 을 다시 붙였고(「田中さんさん」), 일본어 완료·공유 문장 틀에
 * さん 이 박혀 있어 이름이 さん 으로 끝나거나 대체 이름(メンバー)이면 겹치거나 엉뚱하게 붙었다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class HonorificNameTest {
    private fun context(language: String): Context {
        val base = ApplicationProvider.getApplicationContext<Context>()
        val configuration = Configuration(base.resources.configuration)
        configuration.setLocale(Locale.forLanguageTag(language))
        return base.createConfigurationContext(configuration)
    }

    @Test
    fun `존칭은 이름 끝이 님이나 さん 이면 더 붙이지 않는다`() {
        val ja = context("ja")
        assertEquals("田中さん", honoredPersonName(ja, "田中"))
        assertEquals("田中さん", honoredPersonName(ja, "田中さん"))
        assertEquals("민수님", honoredPersonName(ja, "민수님"))
        assertEquals("민수님", honoredPersonName(context("ko"), "민수"))
        assertEquals("민수님", honoredPersonName(context("ko"), "민수님"))
        assertEquals("Alex", honoredPersonName(context("en"), "Alex"))
    }

    @Test
    fun `받은 알람 알림 제목은 일본어 이름에 さん 을 겹쳐 붙이지 않는다`() {
        val ja = context("ja")
        assertEquals("田中さんがアラームを送りました。", SocialNotificationFactory.receivedAlarmNotificationTitle(ja, "田中さん"))
        assertEquals("田中さんがアラームを送りました。", SocialNotificationFactory.receivedAlarmNotificationTitle(ja, "田中"))
        assertEquals("相手がアラームを送りました。", SocialNotificationFactory.receivedAlarmNotificationTitle(ja, "  "))
        assertEquals("민수님이 알람을 보냈어요.", SocialNotificationFactory.receivedAlarmNotificationTitle(context("ko"), "민수"))
        assertEquals("Alex sent you an alarm.", SocialNotificationFactory.receivedAlarmNotificationTitle(context("en"), "Alex"))
    }

    @Test
    fun `가족 알람 완료 문구는 존칭을 한 번만 붙이고 이름을 모르면 상대라고 말한다`() {
        val ja = context("ja")
        assertEquals("田中さんにアラームを設定しました。", familyAlarmCompletionMessage(ja, "田中さん"))
        assertEquals("田中さんにアラームを設定しました。", familyAlarmCompletionMessage(ja, "田中"))
        assertEquals("민수님에게 알람을 설정했어요", familyAlarmCompletionMessage(context("ko"), "민수"))
        assertEquals("민수님에게 알람을 설정했어요", familyAlarmCompletionMessage(context("ko"), "민수님"))
        assertEquals("Set an alarm for Alex.", familyAlarmCompletionMessage(context("en"), "Alex"))
        // 이름이 없는 멤버 — 화면용 대체 이름(メンバー)이나 이메일에 さん 을 붙여 문장에 넣지 않는다.
        val unnamed = FamilyGroupMember(id = "m", userId = "u", role = "member", joinedAt = "2026-01-01")
        val emailOnly = unnamed.copy(email = "user@example.com")
        for (member in listOf(unnamed, emailOnly)) {
            assertNull(familyMemberNameOrNull(member))
            assertEquals("相手にアラームを設定しました。", familyAlarmCompletionMessage(ja, familyMemberNameOrNull(member)))
            assertEquals("상대에게 알람을 설정했어요", familyAlarmCompletionMessage(context("ko"), familyMemberNameOrNull(member)))
        }
        // 목록·저장 버튼은 누구인지 가려야 하므로 이메일·대체 이름을 계속 쓴다.
        assertEquals("user@example.com", familyMemberLabel(ja, emailOnly))
        assertEquals("メンバー", familyMemberLabel(ja, unnamed))
        assertEquals("田中", familyMemberNameOrNull(unnamed.copy(name = " 田中 ", email = "user@example.com")))
    }

    @Test
    fun `공유받은 목소리의 주인 이름에도 존칭을 한 번만 붙인다`() {
        val ja = context("ja")
        assertEquals("田中さんから共有された声", sharedVoiceDetail(ja, FamilyVoiceProfile(id = "v", name = "声", ownerName = "田中さん")))
        assertEquals("田中さんから共有された声", sharedVoiceDetail(ja, FamilyVoiceProfile(id = "v", name = "声", ownerName = "田中")))
        assertEquals("민수님에게 공유받은 목소리", sharedVoiceDetail(context("ko"), FamilyVoiceProfile(id = "v", name = "목소리", ownerName = "민수님")))
        assertEquals("Voice shared by Alex", sharedVoiceDetail(context("en"), FamilyVoiceProfile(id = "v", name = "Voice", ownerName = "Alex")))
        assertEquals(
            "田中さんから共有された声",
            ja.getString(R.string.voicesr_shared_from_owner, honoredPersonName(ja, "田中さん")),
        )
    }
}
