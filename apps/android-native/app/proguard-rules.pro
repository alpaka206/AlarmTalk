# Keep Retrofit and Gson model metadata stable under R8.
-keepattributes Signature,InnerClasses,EnclosingMethod,*Annotation*
-keep class com.alarmtalk.app.network.** { *; }
-keep class com.alarmtalk.app.AccessSnapshot { *; }
# 무료 잠금 보관본 — Room 컬럼(preLockVoiceJson)에 Gson JSON 으로 남아 앱 업데이트를 건너서 읽힌다.
# 필드 키는 @SerializedName 으로도 고정돼 있다(DefaultVoiceFallback.kt 주석).
-keep class com.alarmtalk.app.data.LockedPaidVoice { *; }
-keepclassmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}

# 예외 타입의 **이름만** 남긴다(멤버는 그대로 줄인다) — Sentry 이슈 제목과 브레드크럼의
# `exception` 값이 읽히게. 매핑을 Sentry 에 올리지 않으므로 R8 이 바꾼 이름이 그대로 실렸다:
# `b5.o`(retrofit2.HttpException)·`c: 8:`·`B: stream was reset`·`e0: Job was cancelled` 처럼
# 무엇이 실패했는지 제목으로는 알 수 없었다(2026-10-11, docs/spec/error-codes.md §3 「앱의 묶음 키」).
# 예외 이름이 바뀌므로 기존 이슈는 한 번 새로 묶인다 — R8 이 릴리스마다 이름을 다시 지어
# 원래도 그랬다. 이 규칙 뒤로는 릴리스가 바뀌어도 예외 타입의 이름이 같다.
# (API 실패의 포장 `network/ReportedApiFailure` 는 위 `network.**` keep 이 이미 지킨다.)
-keepnames class * extends java.lang.Throwable
