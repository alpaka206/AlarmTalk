package com.alarmtalk.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * **소스를 직접 읽어** Room 설정의 데이터 손실 위험을 막는다.
 *
 * 백엔드의 `test/no-auto-quiet-windows.test.ts` 와 같은 형태다 — 런타임으로는 재현하기
 * 어렵고(마이그레이션 누락은 **다음 스키마 변경 때**야 터진다) 실패 비용은 되돌릴 수 없는
 * 종류라, 소스에 규약이 지켜졌는지를 본다.
 *
 * 지키는 것 둘:
 *  1. `fallbackToDestructiveMigration()` 이 없다 — 있으면 마이그레이션을 빠뜨린 채
 *     `version` 만 올렸을 때 Room 이 **DB 를 통째로 지운다.** 사용자는 알람이 전부 사라진
 *     것만 보고, 우리 쪽에는 예외도 로그도 남지 않는다.
 *  2. `version = N` 이면 `MIGRATION_1_2` … `MIGRATION_(N-1)_N` 이 **빠짐없이 등록**돼 있다.
 *     하나라도 비면 그 구간을 건너온 기기에서 앱이 켜자마자 죽는다.
 */
class AlarmDatabaseMigrationSafetyTest {

    private val source: String by lazy {
        // 테스트는 app/ 에서 돈다. 모듈 루트 기준 상대 경로.
        val file = File("src/main/java/com/alarmtalk/app/data/AlarmDatabase.kt")
        assertTrue(
            "AlarmDatabase.kt 를 못 찾았다(경로: ${file.absolutePath}). " +
                "파일을 옮겼으면 이 테스트의 경로도 같이 고칠 것.",
            file.exists(),
        )
        file.readText()
    }

    /** 주석에 적힌 낱말까지 걸리지 않게, **실제 호출**만 본다. */
    private val destructiveCall = Regex("""^\s*\.fallbackToDestructiveMigration\(""", RegexOption.MULTILINE)

    @Test
    fun `파괴적 마이그레이션 폴백이 없다`() {
        assertEquals(
            "`.fallbackToDestructiveMigration()` 이 되살아났다. 이게 켜져 있으면 마이그레이션을 " +
                "빠뜨린 채 version 만 올렸을 때 사용자의 알람이 **조용히 전부 삭제**된다. " +
                "죽는 편이 낫다 — 죽는 건 눈에 띄지만 지워진 알람은 되돌릴 수 없다.",
            0,
            destructiveCall.findAll(source).count(),
        )
    }

    @Test
    fun `버전까지의 마이그레이션이 빠짐없이 등록돼 있다`() {
        val version = Regex("""version\s*=\s*(\d+)""").find(source)
            ?.groupValues?.get(1)?.toInt()
            ?: error("@Database 의 version 을 못 읽었다")

        // `addMigrations(...)` 에 **실제로 넘긴** 이름만 센다(정의만 하고 안 넘기면 무효다).
        val registered = Regex("""addMigrations\((.*?)\)""", RegexOption.DOT_MATCHES_ALL)
            .find(source)?.groupValues?.get(1)
            ?: error("addMigrations(...) 를 못 찾았다")

        val missing = (1 until version).filterNot { from ->
            registered.contains("MIGRATION_${from}_${from + 1}")
        }

        assertEquals(
            "version = $version 인데 등록되지 않은 마이그레이션이 있다. 그 구간을 건너온 기기는 " +
                "앱이 켜자마자 죽는다. 빠진 구간: ${missing.map { "$it→${it + 1}" }}",
            emptyList<Int>(),
            missing,
        )
    }
}
