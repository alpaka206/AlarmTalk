package com.voicealarm.nativeapp.network

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
