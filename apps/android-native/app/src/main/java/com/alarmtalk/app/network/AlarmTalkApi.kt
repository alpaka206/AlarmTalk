package com.alarmtalk.app.network

interface AlarmTalkApi :
    AuthApi,
    VoiceProfileApi,
    TtsApi,
    BillingApi,
    HolidayApi,
    PushApi,
    UsageEventApi,
    AdRewardApi
