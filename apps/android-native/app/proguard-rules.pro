# Keep Retrofit and Gson model metadata stable under R8.
-keepattributes Signature,InnerClasses,EnclosingMethod,*Annotation*
-keep class com.alarmtalk.app.network.** { *; }
-keep class com.alarmtalk.app.AccessSnapshot { *; }
-keepclassmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}
