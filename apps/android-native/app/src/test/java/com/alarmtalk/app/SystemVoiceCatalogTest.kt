package com.alarmtalk.app

import com.alarmtalk.app.data.bundledSystemVoiceProfiles
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SystemVoiceCatalogTest {
    @Test
    fun bundledCatalogContainsTheFourReadySystemVoices() {
        val voices = bundledSystemVoiceProfiles()

        assertEquals(listOf("101", "102", "103", "104"), voices.map { it.id.takeLast(3) })
        assertEquals(listOf("아담", "미나", "하준", "소은"), voices.map { it.name })
        assertTrue(voices.all { it.status == "ready" && it.isSystem == true })
    }

    @Test
    fun lastUsedVoiceWinsBeforeGroupFallbacks() {
        assertEquals(
            "system",
            preferredInitialVoiceProfileId(
                lastUsedVoiceId = "system",
                ownVoiceIds = listOf("own"),
                familyVoiceIds = listOf("family"),
                systemVoiceIds = listOf("system"),
                profileLoadFinished = false,
            ),
        )
        assertEquals(
            "own",
            preferredInitialVoiceProfileId(
                lastUsedVoiceId = "missing",
                ownVoiceIds = listOf("own"),
                familyVoiceIds = listOf("family"),
                systemVoiceIds = listOf("system"),
                profileLoadFinished = true,
            ),
        )
    }

    @Test
    fun waitsForSavedCloneBeforeFallingBackToSystemVoice() {
        assertEquals(
            null,
            preferredInitialVoiceProfileId(
                lastUsedVoiceId = "saved-clone",
                ownVoiceIds = emptyList(),
                familyVoiceIds = emptyList(),
                systemVoiceIds = listOf("system"),
                profileLoadFinished = false,
            ),
        )
        assertEquals(
            "saved-clone",
            preferredInitialVoiceProfileId(
                lastUsedVoiceId = "saved-clone",
                ownVoiceIds = listOf("saved-clone"),
                familyVoiceIds = emptyList(),
                systemVoiceIds = listOf("system"),
                profileLoadFinished = true,
            ),
        )
    }
}
