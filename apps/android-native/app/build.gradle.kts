import java.io.DataOutputStream
import java.util.Properties
import kotlin.math.PI
import kotlin.math.sin
import org.gradle.api.DefaultTask
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.TaskAction

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
    // FCM: google-services.json(app/src/{dev,prod}/) 을 읽어 Firebase 초기화 리소스를 생성.
    id("com.google.gms.google-services")
}

abstract class GenerateAlarmToneTask : DefaultTask() {
    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun generate() {
        val rawDir = outputDir.get().asFile.resolve("raw")
        rawDir.mkdirs()

        val sampleRate = 44_100
        val durationSeconds = 2
        val samples = sampleRate * durationSeconds
        val dataSize = samples * 2
        val file = rawDir.resolve("voice_alarm_default.wav")

        DataOutputStream(file.outputStream()).use { out ->
            fun ascii(value: String) = out.write(value.toByteArray(Charsets.US_ASCII))
            fun intLe(value: Int) {
                out.write(value and 0xff)
                out.write(value shr 8 and 0xff)
                out.write(value shr 16 and 0xff)
                out.write(value shr 24 and 0xff)
            }
            fun shortLe(value: Int) {
                out.write(value and 0xff)
                out.write(value shr 8 and 0xff)
            }

            ascii("RIFF")
            intLe(36 + dataSize)
            ascii("WAVE")
            ascii("fmt ")
            intLe(16)
            shortLe(1)
            shortLe(1)
            intLe(sampleRate)
            intLe(sampleRate * 2)
            shortLe(2)
            shortLe(16)
            ascii("data")
            intLe(dataSize)

            for (i in 0 until samples) {
                val envelope = if (i % sampleRate < sampleRate / 2) 1.0 else 0.35
                val wave = sin(2.0 * PI * 880.0 * i / sampleRate)
                val sample = (wave * envelope * Short.MAX_VALUE * 0.45).toInt()
                shortLe(sample)
            }
        }
    }
}

val generateAlarmTone = tasks.register<GenerateAlarmToneTask>("generateAlarmTone") {
    outputDir.set(layout.buildDirectory.dir("generated/res/alarmTone"))
}

// 개인정보 처리방침·이용약관 전문을 앱에 싣는다.
//
// 동의 화면에서 항목을 펼치면 앱 안에서 전문을 그대로 읽을 수 있어야 한다 — 브라우저로
// 내보내면 동의 흐름이 끊기고, 네트워크가 없으면 아예 못 읽는다.
//
// **사본을 만들지 않는다.** 랜딩(apps/landing/lib/legal-docs.ts)이 빌드 시 읽는 것과 같은
// docs/legal/*.md 를 그대로 복사하므로 단일 출처가 유지된다. 문서를 고치면 다음 빌드에
// 자동 반영되고, 앱만 옛 문안을 들고 있는 상태가 생기지 않는다.
val copyLegalDocs = tasks.register<Copy>("copyLegalDocs") {
    from(rootProject.file("../../docs/legal")) {
        include("privacy-policy.ko.md", "terms-of-service.ko.md")
    }
    into(layout.buildDirectory.dir("generated/assets/legal/legal"))
}

fun String.asBuildConfigString(): String =
    "\"${replace("\\", "\\\\").replace("\"", "\\\"")}\""

val releaseKeystoreProps = rootProject.file("keystore.properties")
    .takeIf { it.exists() }
    ?.let { propsFile ->
        Properties().apply { propsFile.inputStream().use { load(it) } }
    }

// dev 플레이버 디버그 서명을 팀 공용 키스토어로 고정한다. 이렇게 해야 어느 PC/CI 에서 빌드해도
// SHA-1 이 동일하게 유지되어 Google 로그인(OAuth Android 클라이언트의 SHA-1 매칭)이 항상 통과한다.
// 파일이 없으면(예: 외부 기여자) 기본 debug.keystore 로 폴백한다.
val devDebugKeystoreProps = rootProject.file("dev-debug-keystore.properties")
    .takeIf { it.exists() }
    ?.let { propsFile ->
        Properties().apply { propsFile.inputStream().use { load(it) } }
    }
    ?.takeIf { rootProject.file(it.getProperty("storeFile") ?: "").exists() }

android {
    namespace = "com.alarmtalk.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.alarmtalk.app"
        minSdk = 26
        targetSdk = 36
        // 릴리스마다 수동으로 versionCode +1, versionName 갱신. (Play 는 업로드마다 더 큰
        // versionCode 를 요구 — 이전 업로드값보다 반드시 크게.) 1.1.3 = 18, 1.2.0 = 20.
        versionCode = 20
        versionName = "1.2.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // 지원 로케일을 한국어(기본)·영어·일본어로 선언한다. 기기 언어가 en/ja 면
        // values-en/values-ja 가, 그 외에는 기본 values(한국어)가 적용된다.
        resourceConfigurations += listOf("ko", "en", "ja")
    }

    sourceSets["main"].res.srcDir(layout.buildDirectory.dir("generated/res/alarmTone"))
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/assets/legal"))

    buildFeatures {
        compose = true
        buildConfig = true
    }

    val alarmTalkDevApiBaseUrl = providers.gradleProperty("alarmTalkDevApiBaseUrl")
        .orElse("https://api-dev.alarm-talk.com/api/")
        .get()
    val alarmTalkProdApiBaseUrl = providers.gradleProperty("alarmTalkProdApiBaseUrl")
        .orElse("https://api.alarm-talk.com/api/")
        .get()
    val alarmTalkDevGoogleWebClientId = providers.gradleProperty("alarmTalkDevGoogleWebClientId")
        .orElse("")
        .get()
    val alarmTalkProdGoogleWebClientId = providers.gradleProperty("alarmTalkProdGoogleWebClientId")
        .orElse("")
        .get()
    val alarmTalkDevSentryDsn = providers.gradleProperty("alarmTalkDevSentryDsn")
        .orElse("")
        .get()
    val alarmTalkProdSentryDsn = providers.gradleProperty("alarmTalkProdSentryDsn")
        .orElse("")
        .get()

    signingConfigs {
        if (releaseKeystoreProps != null) {
            create("release") {
                storeFile = rootProject.file(releaseKeystoreProps.getProperty("storeFile"))
                storePassword = releaseKeystoreProps.getProperty("storePassword")
                keyAlias = releaseKeystoreProps.getProperty("keyAlias")
                keyPassword = releaseKeystoreProps.getProperty("keyPassword")
            }
        }
        if (devDebugKeystoreProps != null) {
            create("devDebug") {
                storeFile = rootProject.file(devDebugKeystoreProps.getProperty("storeFile"))
                storePassword = devDebugKeystoreProps.getProperty("storePassword")
                keyAlias = devDebugKeystoreProps.getProperty("keyAlias")
                keyPassword = devDebugKeystoreProps.getProperty("keyPassword")
            }
        }
    }

    flavorDimensions += "environment"
    productFlavors {
        create("dev") {
            dimension = "environment"
            applicationIdSuffix = ".dev"
            buildConfigField("String", "VOICE_ALARM_API_BASE_URL", alarmTalkDevApiBaseUrl.asBuildConfigString())
            buildConfigField(
                "String",
                "VOICE_ALARM_GOOGLE_WEB_CLIENT_ID",
                alarmTalkDevGoogleWebClientId.asBuildConfigString(),
            )
            buildConfigField(
                "String",
                "VOICE_ALARM_SENTRY_DSN",
                alarmTalkDevSentryDsn.asBuildConfigString(),
            )
            buildConfigField(
                "String",
                "VOICE_ALARM_SENTRY_ENVIRONMENT",
                "development".asBuildConfigString(),
            )
        }
        create("prod") {
            dimension = "environment"
            buildConfigField("String", "VOICE_ALARM_API_BASE_URL", alarmTalkProdApiBaseUrl.asBuildConfigString())
            buildConfigField(
                "String",
                "VOICE_ALARM_GOOGLE_WEB_CLIENT_ID",
                alarmTalkProdGoogleWebClientId.asBuildConfigString(),
            )
            buildConfigField(
                "String",
                "VOICE_ALARM_SENTRY_DSN",
                alarmTalkProdSentryDsn.asBuildConfigString(),
            )
            buildConfigField(
                "String",
                "VOICE_ALARM_SENTRY_ENVIRONMENT",
                "production".asBuildConfigString(),
            )
        }
    }

    buildTypes {
        debug {
            // 디버그 빌드를 공용 키스토어로 고정 서명 → 어느 PC/CI 에서 빌드해도 SHA-1 동일.
            // (Google 로그인은 패키지명 + SHA-1 매칭이라 dev OAuth 클라이언트에 등록된
            // 8E:05:92… 와 항상 일치해야 통과.) 파일이 없으면 기본 debug.keystore 폴백.
            if (devDebugKeystoreProps != null) {
                signingConfig = signingConfigs.getByName("devDebug")
            }
        }
        release {
            if (releaseKeystoreProps != null) {
                signingConfig = signingConfigs.getByName("release")
            }
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            ndk {
                debugSymbolLevel = "SYMBOL_TABLE"
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    testOptions {
        unitTests {
            // Robolectric 단위 테스트가 앱 리소스(strings.xml 등)에 접근할 수 있도록 한다.
            isIncludeAndroidResources = true
        }
    }
}

tasks.named("preBuild").configure {
    dependsOn(generateAlarmTone)
    dependsOn(copyLegalDocs)
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")

    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    // 앱 프로세스 포그라운드 복귀 감지(ProcessLifecycleOwner) — 복귀 시 원격 알람 즉시 pull.
    implementation("androidx.lifecycle:lifecycle-process:2.8.7")
    // FCM(가족 알람 즉시 배달) — 앱이 백그라운드/종료여도 data push 로 즉시 pull. BoM 으로 버전 통일.
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("androidx.navigation:navigation-compose:2.8.5")
    implementation("androidx.room:room-ktx:2.6.1")
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("com.android.billingclient:billing-ktx:8.0.0")
    // Google Play In-App Updates(신 Play SDK). Play 설치본에서만 실제 트리거되고
    // debug/사이드로드에선 no-op(콜백에서 예외 방어). 구 com.google.android.play:core 미사용.
    implementation("com.google.android.play:app-update:2.1.0")
    implementation("com.google.android.play:app-update-ktx:2.1.0")
    implementation("com.google.android.gms:play-services-auth:21.2.0")
    implementation("com.google.android.gms:play-services-location:21.3.0")
    implementation("io.sentry:sentry-android-core:8.43.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.squareup.retrofit2:retrofit:2.11.0")

    ksp("androidx.room:room-compiler:2.6.1")

    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")

    testImplementation("junit:junit:4.13.2")
    // Context/리소스가 필요한 라벨 함수의 단위 테스트용(앱 기본 로케일 = 한국어 리소스 로드).
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.test:core-ktx:1.6.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
}
