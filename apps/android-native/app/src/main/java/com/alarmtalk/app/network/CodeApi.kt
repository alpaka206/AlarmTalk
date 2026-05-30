package com.alarmtalk.app.network

import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.POST

data class CodeRegisterRequest(
    val code: String,
)

data class CodeRegisterResponse(
    val success: Boolean,
    val type: String? = null,
)

interface CodeApi {
    @POST("code/register")
    suspend fun registerCode(
        @Header("Authorization") authorization: String,
        @Body request: CodeRegisterRequest,
    ): CodeRegisterResponse
}
