package com.voicealarm.nativeapp.data

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
        seedDefaultHolidaysIfAvailable(countryCode, regionCode, startDate.year)
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
