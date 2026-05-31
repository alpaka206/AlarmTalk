package com.alarmtalk.app.network

interface VoiceAlarmApi :
    AuthApi,
    RemoteAlarmApi,
    VoiceProfileApi,
    TtsApi,
    FamilyApi,
    CodeApi,
    CharacterApi,
    BillingApi,
    NotesApi
