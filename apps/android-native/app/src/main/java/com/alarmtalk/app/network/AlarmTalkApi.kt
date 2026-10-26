package com.alarmtalk.app.network

interface AlarmTalkApi :
    AuthApi,
    RemoteAlarmApi,
    VoiceProfileApi,
    TtsApi,
    BillingApi,
    HolidayApi,
    PushApi,
    UsageEventApi,
    BriefingApi,
    VoicePackApi
