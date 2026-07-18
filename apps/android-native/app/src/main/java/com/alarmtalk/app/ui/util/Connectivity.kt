package com.alarmtalk.app

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

/**
 * 인터넷 연결 여부를 상태로 노출한다. 연결이 바뀌면 리컴포지션이 일어나므로
 * "오프라인이라 못 불러왔어요" 같은 안내가 연결 복구 즉시 사라지고, 이 상태를
 * LaunchedEffect 키로 쓰면 복구 시 자동 재시도도 걸 수 있다.
 */
@Composable
internal fun rememberIsOnline(): State<Boolean> {
    val context = LocalContext.current.applicationContext
    val manager = remember(context) {
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
    }
    val isOnline = remember {
        mutableStateOf(manager?.currentlyOnline() ?: true)
    }
    DisposableEffect(manager) {
        if (manager == null) return@DisposableEffect onDispose {}
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                isOnline.value = true
            }

            override fun onLost(network: Network) {
                isOnline.value = manager.currentlyOnline()
            }
        }
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        runCatching { manager.registerNetworkCallback(request, callback) }
        onDispose {
            runCatching { manager.unregisterNetworkCallback(callback) }
        }
    }
    return isOnline
}

private fun ConnectivityManager.currentlyOnline(): Boolean =
    getNetworkCapabilities(activeNetwork)
        ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
