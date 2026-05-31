package com.alarmtalk.app

import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlatformAndLabelUtilsTest {
    @Test
    fun formatNoteCreatedAtShowsDateAndLocalTimeFromIsoTimestamp() {
        val label = formatNoteCreatedAt(
            isoString = "2026-05-20T02:50:00Z",
            zoneId = ZoneId.of("Asia/Seoul"),
        )

        assertEquals("2026-05-20 11:50", label)
    }

    @Test
    fun formatNoteCreatedAtTreatsSqliteTimestampAsUtc() {
        val label = formatNoteCreatedAt(
            isoString = "2026-05-20 02:50:00",
            zoneId = ZoneId.of("Asia/Seoul"),
        )

        assertEquals("2026-05-20 11:50", label)
    }

    @Test
    fun formatNoteCreatedAtReturnsNullForBlankTimestamp() {
        assertNull(formatNoteCreatedAt(" "))
    }
}
