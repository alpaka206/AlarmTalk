package com.voicealarm.nativeapp.location

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
                geocoder.getFromLocation(latitude, longitude, 1) { addresses ->
                    val address = addresses.firstOrNull()
                    val country = address?.countryName?.trim().orEmpty()
                    val city = (address?.adminArea ?: address?.locality)?.trim().orEmpty()
                    if (continuation.isActive) continuation.resume(country to city)
                }
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
