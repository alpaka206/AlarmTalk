package com.alarmtalk.app.network

import com.alarmtalk.app.data.HolidayDate
import java.time.LocalDate
import retrofit2.http.GET
import retrofit2.http.Query

/**
 * GET /holiday — 인증 불필요 다국가 공휴일. 응답 계약:
 *   { holidays: [{ date, name, type, substitute?, source? }] }  (date 오름차순)
 * type 은 public|bank|school|optional|observance — 실제 쉬는 날만 원하면 호출자가
 * type == "public" 으로 필터한다(백엔드 routes/holiday.ts 와 동일 계약).
 */
data class HolidayResponse(
    val holidays: List<HolidayDto> = emptyList(),
)

data class HolidayDto(
    val date: String,
    val name: String,
    val type: String? = null,
    val substitute: Boolean? = null,
    val source: String? = null,
)

interface HolidayApi {
    @GET("holiday")
    suspend fun getHolidays(
        @Query("country") country: String,
        @Query("from") from: String,
        @Query("to") to: String,
        @Query("lang") lang: String? = null,
    ): HolidayResponse
}

/**
 * type == "public" 인 항목만 추려 [HolidayDate] 로 변환한다. 날짜 파싱 실패 항목은 건너뛴다.
 */
fun HolidayResponse.toPublicHolidayDates(): List<HolidayDate> =
    holidays
        .filter { it.type == "public" }
        .mapNotNull { dto ->
            val parsed = runCatching { LocalDate.parse(dto.date) }.getOrNull() ?: return@mapNotNull null
            HolidayDate(date = parsed, name = dto.name)
        }
