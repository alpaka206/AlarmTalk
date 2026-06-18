package com.alarmtalk.app.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Geocoder
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import java.util.Locale
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

data class WeatherLocationFix(
    val latitude: Double,
    val longitude: Double,
    val country: String,
    val city: String,
)

object WeatherLocationProvider {
    fun hasPermission(context: Context): Boolean {
        val fine = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        return fine || coarse
    }

    @SuppressLint("MissingPermission")
    suspend fun resolve(context: Context): WeatherLocationFix? {
        if (!hasPermission(context)) return null
        val client = LocationServices.getFusedLocationProviderClient(context.applicationContext)
        val cancellationSource = CancellationTokenSource()
        val location = suspendCancellableCoroutine<android.location.Location?> { continuation ->
            client.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, cancellationSource.token)
                .addOnSuccessListener { value -> if (continuation.isActive) continuation.resume(value) }
                .addOnFailureListener {
                    if (continuation.isActive) continuation.resume(null)
                }
            continuation.invokeOnCancellation { cancellationSource.cancel() }
        } ?: suspendCancellableCoroutine { continuation ->
            client.lastLocation
                .addOnSuccessListener { value -> if (continuation.isActive) continuation.resume(value) }
                .addOnFailureListener {
                    if (continuation.isActive) continuation.resume(null)
                }
        } ?: return null
        val (country, city) = reverseGeocode(context, location.latitude, location.longitude)
        return WeatherLocationFix(
            latitude = location.latitude,
            longitude = location.longitude,
            country = country,
            city = city,
        )
    }

    private suspend fun reverseGeocode(
        context: Context,
        latitude: Double,
        longitude: Double,
    ): Pair<String, String> {
        val locale = Locale.KOREA
        val geocoder = runCatching { Geocoder(context.applicationContext, locale) }.getOrNull()
            ?: return "" to ""
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            suspendCancellableCoroutine { continuation ->
                // 비동기 콜백은 성공/에러/빈 결과 어느 경로로도 continuation 을 정확히 한 번만
                // 재개해야 한다. resumed 가드가 없으면 onError 미처리로 코루틴이 영영 멈춘다.
                val resumed = java.util.concurrent.atomic.AtomicBoolean(false)
                fun finish(result: Pair<String, String>) {
                    if (resumed.compareAndSet(false, true) && continuation.isActive) {
                        continuation.resume(result)
                    }
                }
                geocoder.getFromLocation(
                    latitude,
                    longitude,
                    1,
                    object : Geocoder.GeocodeListener {
                        override fun onGeocode(addresses: MutableList<android.location.Address>) {
                            val address = addresses.firstOrNull()
                            val country = address?.countryName?.trim().orEmpty()
                            val city = (address?.adminArea ?: address?.locality)?.trim().orEmpty()
                            finish(country to city)
                        }

                        override fun onError(errorMessage: String?) {
                            // 에러 시에도 반드시 재개(null 대용으로 빈 값) — 미재개 시 무한 대기.
                            finish("" to "")
                        }
                    },
                )
            }
        } else {
            @Suppress("DEPRECATION")
            val addresses = runCatching { geocoder.getFromLocation(latitude, longitude, 1) }.getOrNull()
            val address = addresses?.firstOrNull()
            val country = address?.countryName?.trim().orEmpty()
            val city = (address?.adminArea ?: address?.locality)?.trim().orEmpty()
            country to city
        }
    }
}
