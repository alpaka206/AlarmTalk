package com.alarmtalk.app.data

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Query
import androidx.room.Upsert
import java.time.LocalDate

@Entity(
    tableName = "holiday_dates",
    primaryKeys = ["countryCode", "regionCode", "epochDay"],
)
data class HolidayEntity(
    val countryCode: String,
    val regionCode: String,
    val epochDay: Long,
    val localDate: String,
    val name: String,
    val source: String,
    val updatedAtMillis: Long,
)

@Dao
interface HolidayDao {
    @Query(
        """
        SELECT * FROM holiday_dates
        WHERE countryCode = :countryCode
          AND regionCode IN ('', :regionCode)
          AND epochDay BETWEEN :startEpochDay AND :endEpochDay
        """,
    )
    suspend fun getBetween(
        countryCode: String,
        regionCode: String,
        startEpochDay: Long,
        endEpochDay: Long,
    ): List<HolidayEntity>

    @Query(
        """
        SELECT * FROM holiday_dates
        WHERE countryCode = :countryCode
          AND regionCode IN ('', :regionCode)
          AND epochDay >= :startEpochDay
        ORDER BY epochDay ASC
        LIMIT :limit
        """,
    )
    suspend fun getUpcoming(
        countryCode: String,
        regionCode: String,
        startEpochDay: Long,
        limit: Int,
    ): List<HolidayEntity>

    @Upsert
    suspend fun upsertAll(holidays: List<HolidayEntity>)
}

class HolidayCalendarStore(
    private val holidayDao: HolidayDao,
) {
    suspend fun holidayPredicate(
        countryCode: String = DEFAULT_COUNTRY_CODE,
        regionCode: String = "",
        startDate: LocalDate,
        daysAhead: Long = DEFAULT_LOOKAHEAD_DAYS,
    ): (LocalDate) -> Boolean {
        // currentYear..currentYear+2 까지 시드 (lookahead 가 연말을 넘겨도 다음다음 해 시드가 닿도록).
        for (year in startDate.year..(startDate.year + 2)) {
            seedDefaultHolidaysIfAvailable(countryCode, regionCode, year)
        }
        seedDefaultHolidaysIfAvailable(countryCode, regionCode, startDate.plusDays(daysAhead).year)
        val endDate = startDate.plusDays(daysAhead)
        val cachedDates = holidayDao.getBetween(
            countryCode = countryCode,
            regionCode = regionCode,
            startEpochDay = startDate.toEpochDay(),
            endEpochDay = endDate.toEpochDay(),
        ).mapTo(mutableSetOf()) { LocalDate.ofEpochDay(it.epochDay) }

        return { date ->
            date in cachedDates || LocalHolidayCalendar.isHoliday(countryCode, date)
        }
    }

    /**
     * 토글 아래 "다가오는 공휴일" 목록 표시용. [holidayPredicate] 와 같은 방식으로
     * 시드 연도(올해·내년)를 보장한 뒤, 시작일 이후 가장 가까운 [count] 개를 돌려준다.
     * 비-KR 국가는 시드가 없으므로 [syncFromRemote] 로 채워진 서버 행에 의존한다.
     */
    suspend fun upcomingHolidays(
        countryCode: String = DEFAULT_COUNTRY_CODE,
        regionCode: String = "",
        from: LocalDate,
        count: Int = 5,
    ): List<HolidayDate> {
        for (year in from.year..(from.year + 1)) {
            seedDefaultHolidaysIfAvailable(countryCode, regionCode, year)
        }
        return holidayDao.getUpcoming(
            countryCode = countryCode,
            regionCode = regionCode,
            startEpochDay = from.toEpochDay(),
            limit = count,
        ).map { entity ->
            HolidayDate(
                date = LocalDate.ofEpochDay(entity.epochDay),
                name = entity.name,
            )
        }
    }

    /** 서버(/holiday)에서 받은 공휴일을 로컬 캐시에 병합한다. */
    suspend fun syncFromRemote(
        countryCode: String,
        regionCode: String = "",
        holidays: List<HolidayDate>,
    ) {
        upsertHolidays(
            countryCode = countryCode,
            regionCode = regionCode,
            holidays = holidays,
            source = SERVER_SYNC_SOURCE,
        )
    }

    suspend fun upsertHolidays(
        countryCode: String,
        regionCode: String = "",
        holidays: List<HolidayDate>,
        source: String,
        nowMillis: Long = System.currentTimeMillis(),
    ) {
        holidayDao.upsertAll(
            holidays.map { holiday ->
                HolidayEntity(
                    countryCode = countryCode,
                    regionCode = regionCode,
                    epochDay = holiday.date.toEpochDay(),
                    localDate = holiday.date.toString(),
                    name = holiday.name,
                    source = source,
                    updatedAtMillis = nowMillis,
                )
            },
        )
    }

    companion object {
        const val DEFAULT_COUNTRY_CODE = "KR"
        private const val DEFAULT_LOOKAHEAD_DAYS = 370L
        private const val SEED_SOURCE = "bundled_seed"
        private const val SERVER_SYNC_SOURCE = "server_sync"
    }

    private suspend fun seedDefaultHolidaysIfAvailable(
        countryCode: String,
        regionCode: String,
        year: Int,
    ) {
        val seedHolidays = HolidaySeedData.holidays(countryCode, year)
        if (seedHolidays.isNotEmpty()) {
            upsertHolidays(
                countryCode = countryCode,
                regionCode = regionCode,
                holidays = seedHolidays,
                source = SEED_SOURCE,
            )
        }
    }
}

data class HolidayDate(
    val date: LocalDate,
    val name: String,
)
