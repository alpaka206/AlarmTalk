package com.alarmtalk.app.sync

import android.content.Context
import android.util.Base64
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.data.AlarmAudioStore
import com.alarmtalk.app.data.HeldVoicePack
import com.alarmtalk.app.data.VOICE_PACK_VOICE_ID_PREFIX
import com.alarmtalk.app.data.VoicePackStore
import com.alarmtalk.app.data.sha256Hex
import com.alarmtalk.app.data.voicePackCacheKey
import com.alarmtalk.app.data.voicePackRemoteIdentity
import com.alarmtalk.app.network.VoicePackApi
import com.alarmtalk.app.network.VoicePackAudioResponse
import com.alarmtalk.app.network.VoicePackClip
import com.alarmtalk.app.network.VoicePackDetailResponse
import com.alarmtalk.app.network.VoicePackListResponse
import com.alarmtalk.app.network.VoicePackSummary
import com.alarmtalk.app.network.WithdrawnVoicePack
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 선다운로드의 팩 칸(`VoicePackDownloader`, `docs/spec/voice-packs.md` §7) — 받은 팩만, 빠진 클립만, 해시가 맞을 때만 받고,
 * 다 있어야 '받음' 이다. 게시가 끝난 팩은 더 받지 않는다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class VoicePackDownloaderTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val voiceId = VOICE_PACK_VOICE_ID_PREFIX + "0000000000aa"
    private val audio = mapOf("c1" to "one".toByteArray(), "c2" to "two".toByteArray())

    private fun clip(id: String, variant: Int) =
        VoicePackClip(clipId = id, category = "cheer", language = "ko", variant = variant, text = id, sha256 = sha256Hex(audio.getValue(id)), sizeBytes = audio.getValue(id).size.toLong(), audioFormat = "mp3")

    private val held = HeldVoicePack(
        packId = "first-pack",
        voiceId = voiceId,
        speakerName = "화자",
        language = "ko",
        contentRevision = 2,
        clips = listOf(clip("c1", 0), clip("c2", 1)),
    )

    private class FakeApi(
        val withdrawn: List<WithdrawnVoicePack> = emptyList(),
        val tamper: Set<String> = emptySet(),
        val revision: Int = 2,
        val audio: Map<String, ByteArray>,
    ) : VoicePackApi {
        val audioCalls = mutableListOf<String>()
        override suspend fun listVoicePacks(authorization: String) = VoicePackListResponse(
            packs = if (withdrawn.isEmpty()) {
                listOf(VoicePackSummary(packId = "first-pack", voiceId = "v", contentRevision = revision, speakerName = "화자"))
            } else {
                emptyList()
            },
            withdrawn = withdrawn,
        )

        override suspend fun getVoicePack(authorization: String, packId: String): VoicePackDetailResponse = error("not used")

        override suspend fun getVoicePackClipAudio(authorization: String, packId: String, clipId: String): VoicePackAudioResponse {
            audioCalls += clipId
            val bytes = if (clipId in tamper) "evil".toByteArray() else audio.getValue(clipId)
            return VoicePackAudioResponse(clipId = clipId, audioBase64 = Base64.encodeToString(bytes, Base64.NO_WRAP), audioFormat = "mp3")
        }
    }

    @After
    fun tearDown() {
        context.getSharedPreferences("voice_packs", Context.MODE_PRIVATE).edit().clear().commit()
        AlarmAudioStore(context).deleteCachedAudioKeys(setOf(voicePackCacheKey("c1"), voicePackCacheKey("c2")))
    }

    @Test
    fun downloadsOnlyHeldPacksAndMarksReadyWhenEveryClipMatches() = runBlocking {
        val store = VoicePackStore(context)
        // 받은 팩이 없으면 아무것도 받지 않는다.
        val idle = FakeApi(audio = audio)
        VoicePackDownloader.run(context, idle, "Bearer t", "user-a")
        assertTrue(idle.audioCalls.isEmpty())

        store.upsert("user-a", held)
        val first = FakeApi(tamper = setOf("c2"), audio = audio)
        VoicePackDownloader.run(context, first, "Bearer t", "user-a")
        val audioStore = AlarmAudioStore(context)
        assertTrue(audioStore.hasCachedAudio(voicePackCacheKey("c1"), voicePackRemoteIdentity("first-pack", "c1", held.clipList[0].sha256)))
        assertFalse("해시가 다른 바이트는 넣지 않는다", audioStore.hasCachedAudio(voicePackCacheKey("c2")))
        assertFalse("하나라도 빠지면 '받음' 이 아니다", store.find("user-a", "first-pack")!!.ready)

        val second = FakeApi(audio = audio)
        VoicePackDownloader.run(context, second, "Bearer t", "user-a")
        assertEquals("이미 받은 클립은 다시 받지 않는다", listOf("c2"), second.audioCalls)
        assertTrue(store.find("user-a", "first-pack")!!.ready)
    }

    @Test
    fun withdrawnPacksAreNotDownloadedAndGetTheirDeadline() = runBlocking {
        val store = VoicePackStore(context)
        store.upsert("user-a", held)
        val api = FakeApi(
            withdrawn = listOf(WithdrawnVoicePack("first-pack", voiceId, "2999-01-01T00:00:00.000Z")),
            audio = audio,
        )
        VoicePackDownloader.run(context, api, "Bearer t", "user-a")
        assertTrue("게시가 끝난 팩은 새로 받지 않는다", api.audioCalls.isEmpty())
        val after = store.find("user-a", "first-pack")!!
        assertTrue("기한 전이라 목록에 남는다", after.withdrawn && !after.retirementDue(System.currentTimeMillis()))
    }
}
