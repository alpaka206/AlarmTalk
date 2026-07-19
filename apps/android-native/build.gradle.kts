plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
    id("com.google.devtools.ksp") version "2.0.21-1.0.27" apply false
    // FCM(가족 알람 즉시 배달)용 google-services 플러그인. app 모듈에서 apply.
    id("com.google.gms.google-services") version "4.4.2" apply false
}
