package com.alarmtalk.app.network

interface AlarmTalkApi :
    AuthApi,
    RemoteAlarmApi,
    VoiceProfileApi,
    TtsApi,
    FamilyApi,
    CodeApi,
    BillingApi,
    HolidayApi
