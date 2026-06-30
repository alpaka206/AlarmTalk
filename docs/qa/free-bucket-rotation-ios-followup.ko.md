# 무료 버킷 회전 — iOS 후속 작업(Mac 빌드 검증 필요)

무료 플랜 "버킷(기상/약) 선택 → 매 울림 순차 회전" 기능. **백엔드 + Android 는 완료·빌드 검증**됐고
(`feature/free-bucket-rotation`), iOS 는 Windows 환경에서 Xcode 컴파일이 불가해 **데이터 모델 +
동적 갱신 제외까지만** 반영했다. 아래는 Mac 에서 마저 구현·빌드 검증할 항목.

## 이미 반영됨 (iOS)
- `LocalAlarmRecord`: `voiceBucket`, `voiceRotationIndex`, `voiceBucketClipKeys([String])` 필드 +
  Codable(decode/encode/CodingKeys) 추가. Android `AlarmEntity` 의 `bucketId`/`bucketRotationIndex`/
  `bucketClipKeysJson` 와 1:1 대응(iOS 는 배열을 그대로 직렬화).
- `DynamicVoiceRefreshService.isRepeatingDynamicAlarmTalk`: `voiceBucket == nil` 조건 추가 →
  버킷 알람은 동적 TTS 갱신 대상에서 제외(이미 `voiceRandomPrompt`/`stock_` prefix 로도 제외됨).

## 남은 작업 (Mac 에서 구현)

### 1. 에디터 UI — 버킷 칩 (`AlarmEditorSheet+AlarmModeSection.swift`)
- `freeVoiceTier && isSystemVoiceProfile` 분기에서 현재 `StockClipPicker`(개별 문구 선택)를
  **버킷 칩 Row**(기상/약)로 교체. 문구 내용은 비노출.
- 무료에서는 "랜덤 문구 사용" 토글 + 컨텍스트/언어/날씨·운세 블록을 **숨긴다**(Android `VoiceAudioCard`
  의 `if (!freeVoiceTier)` 미러). 무료는 버킷 칩만 노출.
- 사용 가능한 버킷 = `voiceStudio.stockClips` 에서 (선택 보이스 + 앱 로케일 언어) 로 존재하는
  카테고리(greeting 제외)를 노출 순서(`["morning","medication"]`)로. Android `freeBucketsFor` 미러.

### 2. 버킷 선택 다운로드 (`VoiceStudioViewModel.swift`)
- `selectBucket(_ bucket:)` 추가: `stockClips` 를 (voiceProfileId, category=bucket, language=앱로케일)
  로 필터·`variant` 정렬 → 각 클립을 `prepareStockClip` 패턴으로 다운로드·캐시(`stock_<messageId>`,
  이미 캐시면 재사용) → cacheKey 목록 수집. Android `selectBucket` 미러.
- 결과를 draft 에 반영: `voiceBucket`, `voiceBucketClipKeys`, 대표(변형0) 클립을 localAudioUri/
  audioCacheKey/ttsMessageId 로(폴백·저장 검증용), voiceLanguage=앱로케일, voiceRandomPrompt=false.

### 3. 앱 로케일 언어
- Android 와 동일하게 `Locale.current.language.languageCode` → ko/en/ja(그 외 ko). 무료는 이 언어
  클립만 다운로드·재생. (언어 per-alarm 선택은 유료.)

### 4. 저장 플로우 (`AlarmEditDraft.toRecord` + `AlarmEditorSheet` saveFlow)
- `AlarmEditDraft` 에 `voiceBucket`/`voiceBucketClipKeys` 보관 + `toRecord` 가 record 에 기록.
  버킷이 바뀌면 `voiceRotationIndex=0`, 같으면 기존 유지(Android `updateAlarm` 미러).
- saveFlow 가 버킷 알람은 생성(TTS) 없이 대표 클립으로 저장(Android `hasSelectedStockClipAudio` 경로).

### 5. 옵션 (a) — 회전 재생 (핵심)
- iOS 는 AlarmKit 이 백그라운드 알람음을 재생하므로 "매 울림 런타임 회전"이 불가. 대신 **스케줄 시점에
  다음 회전 클립을 알람음(localAudioUri)으로 미리 지정**한다.
- `LocalAlarmStore` 의 dismiss/재스케줄(반복 알람 next fire + `snoozeCount=0` 지점, 대략 250-263 /
  307-320 라인)에서: `voiceBucket != nil && voiceBucketClipKeys.count > 1` 이면
  `voiceRotationIndex = (voiceRotationIndex + 1) % count` 로 올리고, `localAudioUri`/`audioCacheKey` 를
  `voiceBucketClipKeys[newIndex]` 의 캐시 파일로 재지정. (스누즈는 회전 안 함 — 같은 클립 유지.)
- 첫 저장 시 localAudioUri = 변형0(대표). 이후 매 발화(에피소드) 종료 시 다음 변형으로 사전 지정.

### 6. 문자열 (`Localizable.xcstrings`)
- `editor_free_bucket_title`("테마"/"Theme"/"テーマ"), `editor_free_bucket_hint`(회전 안내) 추가.
  Android `values*/strings.xml` 의 동일 키 카피 사용.

## 계약 참고 (백엔드 — 이미 배포 가능)
- `GET /tts/stock-clips` 응답에 `variant:number` 포함, (보이스·카테고리·언어·variant) 정렬.
- 무료 버킷 = morning(8문구) + medication(2문구), ko/en/ja 3언어 사전합성. greeting 만 추가 보존.
- 알람 `POST/PATCH /alarm` 이 `bucket_id` 수용, 조회 응답에 `bucket_id` 노출. 대표 `message_id` 는
  폴백으로 유지.
