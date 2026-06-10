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

fun String.asBuildConfigString(): String =
    "\"${replace("\\", "\\\\").replace("\"", "\\\"")}\""

val releaseKeystoreProps = rootProject.file("keystore.properties")
    .takeIf { it.exists() }
    ?.let { propsFile ->
        Properties().apply { propsFile.inputStream().use { load(it) } }
    }

android {
    namespace = "com.alarmtalk.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.alarmtalk.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 9
        versionName = "0.1.2"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    sourceSets["main"].res.srcDir(layout.buildDirectory.dir("generated/res/alarmTone"))

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

    signingConfigs {
        if (releaseKeystoreProps != null) {
            create("release") {
                storeFile = rootProject.file(releaseKeystoreProps.getProperty("storeFile"))
                storePassword = releaseKeystoreProps.getProperty("storePassword")
                keyAlias = releaseKeystoreProps.getProperty("keyAlias")
                keyPassword = releaseKeystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
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
}

tasks.named("preBuild").configure {
    dependsOn(generateAlarmTone)
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
    implementation("androidx.navigation:navigation-compose:2.8.5")
    implementation("androidx.room:room-ktx:2.6.1")
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
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
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
}
