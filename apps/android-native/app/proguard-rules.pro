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
