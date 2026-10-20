plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
    id("com.google.devtools.ksp") version "2.0.21-1.0.27" apply false
    // FCM(플랜·목소리·계정 신호)용 google-services 플러그인. app 모듈에서 apply.
    id("com.google.gms.google-services") version "4.4.2" apply false
    // Sentry: 릴리스(R8) 빌드의 mapping.txt 를 올려 스택을 되읽는다 — 설정과 이유는 app 모듈의 `sentry { }`.
    // ⚠ **6.x 로 올리지 말 것 — 이 Gradle(8.10.2)에서는 매핑을 못 올린다.** 6.x 는 `Exec.setIgnoreExitValue` 가
    //   `Exec` 를 돌려주는 더 새 Gradle API 로 지어져, 토큰이 있을 때만 만드는 올리기 작업에서
    //   `NoSuchMethodError` 로 빌드가 죽는다(2026-10-11 6.9.0 으로 확인 — 토큰이 없으면 그 작업을 만들지 않아
    //   평소 빌드는 통과하므로 놓치기 쉽다). 5.12.2 는 8.10.2 에 있는 시그니처를 부른다. Gradle 을 올릴 때 함께 본다.
    //   SDK 판은 이 플러그인과 무관하다 — 자동 설치를 꺼 두었고, 심는 `io.sentry.ProguardUuids` 는 앱의
    //   `sentry-android-core:8.43.0` 이 그대로 읽는다.
    id("io.sentry.android.gradle") version "5.12.2" apply false
}
