package com.alarmtalk.app.data

/** 울림 화면 제목에 쓸 **사용자가 붙인** 라벨. 기본 라벨(세 언어의 '알람')이면 null 이다. */
internal fun customRingingAlarmLabel(stored: String): String? = stored.trim()
    .takeIf { it.isNotBlank() && it !in setOf("알람", "Alarm", "アラーム") }
