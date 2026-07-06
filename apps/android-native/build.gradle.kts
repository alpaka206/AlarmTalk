buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        // 오픈소스 라이선스 자동 수집 플러그인. Plugin Portal 에 마커가 없어(Google Maven 전용)
        // plugins DSL 대신 buildscript classpath 로 적용한다(app 모듈에서 apply).
        classpath("com.google.android.gms:oss-licenses-plugin:0.10.6")
    }
}

plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
    id("com.google.devtools.ksp") version "2.0.21-1.0.27" apply false
}
