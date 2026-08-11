# 목소리와 문구

> **단일 출처.** 구현이 이것과 다르면 구현이 틀린 것이다. → [README](README.md)

## 1. 재생 방식은 **둘뿐**이다

**알람** / **목소리**. '알람 + 목소리' 를 되살리지 말 것.

- 안드로이드에서 그 모드는 톤이 울리고 **해제할 때** 목소리가 한 번 났는데, 알림을 밀어
  없애면 건너뛰었다. 목소리를 들으려면 알람을 꺼야 하는 구조라 발견 자체가 어려웠다.
- iOS 는 AlarmKit 에 넘길 사운드가 1개라 '톤 먼저, 목소리 나중' 이 구조적으로 불가능했다.
- 저장된 옛 값은 **목소리로 읽는다.** 그 모드를 고른 사람은 목소리를 만들어 둔
  사용자다 — 알람음으로 옮기면 애써 만든 목소리를 못 듣게 된다.

**목소리가 왼쪽이고 새 알람의 기본값이다.** 우리는 목소리 알람 앱이다. 읽는 순서와
기본 선택이 어긋나면 무엇이 기본인지 흐려진다.

**고른 쪽 박스만 그린다.** '알람' 이면 목소리 카드가 통째로 없고, '목소리' 면 세부설정의
알람음 행이 없다. 안 고른 쪽 설정을 남겨 두면 만질 수는 있는데 울릴 때 아무 영향이 없는
컨트롤이 된다.

## 2. 기본(시스템) 목소리 제한 — 판정은 **OR**

기본 목소리는 **미리 만들어 둔 클립만** 말할 수 있다. 그래서 문구를 무료 버킷
('날씨+약')으로 제한하는 조건은 플랜과 목소리 종류의 **OR** 다:

```
제한한다 = (무료 등급) || (시스템 목소리를 골랐다)
```

⚠ **`&&` 로 쓰면 유료 사용자가 기본 목소리에 직접 입력 문구를 붙일 수 있다** — 저장은
되는데 그 문구를 말할 방법이 없는 알람이 된다. iOS 가 실제로 `&&` 였다(2026-08-07 수정).

⚠ **한 곳만 고치지 말 것.** 이 플래그는 세 갈래에서 함께 읽힌다:
1. **렌더** — 문구 요약 행을 '무료 테마' 로 그릴지 '문구 선택' 으로 그릴지
2. **상태 강제** — 목소리 소스·랜덤 여부·컨텍스트를 preset 4-값으로 고정
3. **저장 검증** — 저장 직전 유효성

렌더만 맞추면 **보이는 대로 저장되지 않는** 상태가 된다.

⚠ **직접 녹음에는 이 제한을 걸지 않는다.** 녹음본은 그냥 로컬 오디오 재생이라 플랜·목소리
종류와 무관하게 허용된다. 상태 강제가 소스를 TTS 로 되돌리면 **녹음해 둔 것이 지워진다** —
특히 유료 사용자가 기본 목소리를 고른 채 녹음했을 때(선택 목소리 id 는 시스템인데 소스는
녹음) 제한이 걸려 녹음이 날아간다. 제한은 **소스가 TTS 일 때만** 적용한다.

⚠ **안내 문구도 상태마다 다르다.** 무료라서 막힌 것과 기본 목소리라서 막힌 것은 다른
사실이다 — 유료에게 "무료에서는…" 이라고 하면 거짓말이 된다.

## 3. 목소리를 바꿀 때 문구가 사라지면 **묻는다**

시스템 목소리로 바꾸는데 직접 입력 문구가 있으면 확인 모달을 띄운다
("기본 목소리로 바꿀까요?"). 조용히 지우면 '문구가 사라졌다' 가 된다.

판정식은 **`시스템목소리로바꿈 && 직접입력문구있음 && !랜덤 && !버킷`** 이다.
⚠ `!랜덤` 하나만 보면 안 된다 — 버킷이 붙으면 랜덤이 꺼지므로 버킷 알람까지 걸린다.

## 4. 편집기 기본값 = **직전 선택 유지**

새 알람의 목소리·문구 종류·무료 테마는 **하드코딩 기본값이 아니라 그 계정이 마지막에
고른 값**이다. "기본값으로 초기화" 로 되돌리는 변경은 전부 회귀다.

- **기록 시점은 알람 저장 성공 시 한 곳뿐.** 편집기에서 눌러만 보고 취소한 것은
  기억하지 않는다.
- **적용 대상은 새 알람뿐.** 기존 알람을 열 때는 저장된 자기 값만 쓴다.
- **목소리 프리셀렉트는 마지막에 쓴 것이 그룹보다 우선.** 그룹을 먼저 보면 클론을 가진
  사람이 기본 목소리를 골라 저장해도 매번 클론으로 되돌아간다.
- 이어받는 것은 **선택 값 하나**뿐이다. 회전 인덱스·클립 키는 알람별 상태라 따라가지 않는다.

### 무엇을 기억하고, 무엇을 건드리지 않는가

기억하는 축은 **셋이고 서로 섞이지 않는다**:

| 저장 키 | 무엇 | 언제 |
| --- | --- | --- |
| `last_message_context_<userId>` | 생성형 문구 종류 | 랜덤 문구로 저장했을 때 |
| `last_manual_text_<userId>` | 직접 입력 문구 | 직접 입력으로 저장했을 때 |
| `last_free_bucket_<userId>` | 무료 테마(버킷) | 스톡 클립으로 저장했을 때 |

⚠ **문구 개념이 없는 알람은 기록을 건드리지 않는다.** 알람 전용·녹음/파일 알람은
문구가 nil 인데, 가드 없이 내려가면 **직전에 기억해 둔 직접 입력 문구를 지운다.**
알람음 알람 하나 저장했다고 취향이 사라지면 안 된다.

⚠ **스톡 클립은 '직접 입력' 이 아니다.** 스톡은 고정 음원이라 `voiceRandomPrompt=false`
로 저장되는데, 그것만 보고 직접입력으로 떨어뜨리면 **서버 스톡 클립의 문장**이
'내가 친 문구' 로 기억된다 — 다음 새 알람이 직접 입력으로 열리고 테마는 매번 초기화된다.

상세(저장 키 이름, 버킷 판정식, 직접 입력 문구 기억)는 `CLAUDE.md`
「알람 편집기 기본값 = 직전 선택 유지」 절에 있다.

## 5. 무료 버킷은 **울릴 때마다 다음 클립으로 넘어간다**

테마 하나에 클립이 여럿이고, 알람이 울릴 때마다 순서대로 넘어간다. 같은 테마라도
매일 다른 문구를 듣는 것이 이 기능의 요점이다.

| | 규칙 |
| --- | --- |
| 무엇을 저장하나 | 그 테마의 **클립 키 전부** + 다음에 쓸 자리 |
| 언제 전진하나 | 알람이 **끝났을 때**(정지·알럿 사라짐 — 어느 경로든) |
| 돌리지 않는 테마 | **날씨·운세** — 순서가 아니라 **조건**으로 고른다(비 오는 날엔 비 문구) |
| 그 클립이 없으면 | 받아진 것 중 하나로 대체 — 소리가 없는 것보다 순서가 어긋나는 편이 낫다 |

⚠ **iOS 는 울린 뒤 알람을 다시 예약해야 한다.** AlarmKit 은 사운드 파일을 **예약 시점에**
받아 가므로, 인덱스만 올리고 다시 예약하지 않으면 OS 는 지난 회차의 파일을 그대로 울린다.
안드로이드는 울릴 때 직접 파일을 고르므로 그 단계가 없다.

⚠ **예약할 때 돌리지 말 것.** 재예약은 시간대 변경·복구로도 일어난다 — 거기서 돌리면
울리지도 않았는데 문구가 건너뛴다.

⚠ iOS 는 2026-08-08 전까지 **회전이 아예 없었다**(`clips.first` 하나만 묶었다). 그런데
주석 두 곳은 "울릴 때마다 순차 회전한다" 고 적혀 있었다 — 코드가 아니라 주석이 기능을
광고하고 있었다.

### 미리 받아 둔다

울릴 시각에 네트워크가 없으면 그 회차가 조용히 비므로, 로그인 직후 받아 둔다.

- 받는 대상 = 기본 목소리 × **기기 언어 하나** × 무료 버킷 카테고리(weather, medication)
- 언어를 하나로 좁힌다 — 앱은 한 번에 한 언어만 쓰고, 언어를 바꾸면 다시 돌아 채운다
- greeting 은 앱에 내장돼 있어 받지 않는다
- 운세·사랑은 유료 클론 전용이라 기본 목소리로는 쓸 수 없다
- 한 클립이 실패해도 나머지는 계속 받는다 — 회전은 남은 것만으로도 돈다.
  **전부 실패했을 때만** 실패로 본다.

⚠ 이 화면은 **고르는 화면이 아니라 받는 화면**이다. "기본 목소리를 골라보세요" 같은
피커로 되돌리지 말 것 — 목소리는 **알람 편집기에서** 고른다.

## 6. 무료로 내려가면 — **알람은 잠그고, 목소리는 3일 뒤 지운다**

축이 **둘**이다. 섞어 읽으면 반드시 사고가 난다.

| 무엇을 | 어떻게 |
| --- | --- |
| **알람 행** | **지우지 않는다.** 시각·반복·문구·목소리 선택 전부 보존 |
| 재생 방식 | 원래 값을 `preLockPlayMode` 에 보관하고 `alarm_only` 로 내린다 |
| 예약 | 사운드온리로 **다시 예약한다** — 안 하면 잠근 게 아니라 조용히 안 울리는 알람이 된다 |
| 기기 음원 캐시 | 지우지 않는다 |
| **서버 목소리 데이터** | **유예 3일 뒤 영구 삭제**(`PAID_VOICE_RETENTION_DAYS`) — 목소리 프로필·업로드 원본·생성 음성·ElevenLabs 클론·R2 객체 |
| 유예 **안에** 유료 복귀 | 삭제를 취소하고(`hasActivePaidEntitlement` 재확인 → `clearPaidVoiceRetention`) `preLockPlayMode` 로 되돌린다 |
| 유예 **뒤** 유료 복귀 | 알람 행은 복원되지만 **말할 목소리가 없다** — 다시 등록해야 한다 |

⚠ **알람 행 삭제는 되돌릴 수 없다.** iOS 가 실제로 행과 음원을 함께 지우고 있었다 —
재결제해도 돌아오지 않았다. 알람 앱에서 "내일 아침 알람이 없어졌다" 는 가장 무거운
실패다(2026-08-07 수정). **이 문장은 알람 행에 대한 것이다** — 목소리 데이터는 위 표대로
의도적으로 지운다.

⚠ **"다시 등록하면 복구돼요" 라고만 쓰지 말 것.** 유예가 지나면 거짓이 된다. 사용자에게
말할 때는 **기한과 결과를 함께** 말한다("3일 안에 …, 지나면 영구 삭제돼요").
구현: `downgrade_notice_free_message`·`msg_gb_free_plan_voice_alarms_locked`(안드),
`RootView` 강등 모달·`SocialFeatureViewModel`(iOS).

⚠ **예고는 눈에 보여야 한다.** 강등 신호(`family_alarm`·`voice_access_revoked`·
`plan_changed`)는 전부 **무음 데이터 푸시**라 앱을 열어야만 안다. 삭제는 되돌릴 수 없고
3일 안에 앱을 한 번도 안 여는 사람이 정확히 잃는 쪽이라, 예고만은 표시용 푸시를 보낸다
(`sendVoiceDeletionWarningPush` ← `notifyVoiceDeletionScheduled`, 커밋 뒤 호출).

### 받은(가족) 알람은 **다른 축**이다

받은 알람의 목소리는 **접근권**(공유가 살아 있는가)이 정한다. **받는 사람의 플랜으로
다스리지 않는다.**

- 공유가 끊기면 서버가 받은 알람까지 `sound-only` 로 걷어낸다(`paid-voice-cleanup.ts`,
  `is_received` 포함) → pull sync 로 양 앱에 내려온다.
- 그래서 잠금(`lockPaidAlarmTalks` / `paidAlarmTalks`)은 **`origin == LOCAL_OWNED` 만** 본다.

⚠ **플랜 축을 받은 알람에 걸면 결제 보류(유예)에서 오발한다.** `resolvePlanAfterSuspend` 는
그룹·공유를 살려 둔 채 `users.plan` 만 회수하므로, 카드가 잠깐 실패한 사이 파트너가 보낸
알람의 목소리가 잠긴다. 게다가 해제는 **받는 사람이 유료가 될 때만** 돌아 영구히 남을 수
있다(2026-08-11 안드로이드에서 제거).

애초에 "무료인데 받은 알람이 있다" 는 상태는 셋뿐이다 — 받으려면 그룹 멤버여야 하고
(`assertSameGroup`) 멤버는 그룹 플랜을 물려받는다(`propagateGroupMemberPlans`):
① 결제 보류(유예) ② 그룹 이탈 ③ 소유자 해지. **②③ 은 서버가 이미 강등**하므로,
플랜 축을 떼면 ①(지켜야 할 유예)이 판정을 따로 만들지 않아도 지켜진다.

⚠ **두 번 잠가도 원래 값을 잃지 않아야 한다.** `preLockPlayMode` 가 이미 있으면 덮어쓰지
않는다 — 덮어쓰면 두 번째 잠금이 `alarm_only` 를 '원래 값' 으로 적어 복원이 불가능해진다.

⚠ **소유자를 확인한다.** 같은 기기에서 계정을 바꾸면 앞 계정 알람까지 잠글 수 있다.
소유자가 안 적힌 옛 행은 이 계정 것으로 본다.

⚠ **문구를 '삭제했어요' 로 쓰지 말 것.** 지우지 않았고, 알람은 알람음으로 계속 울린다.

## 7. 의도된 플랫폼 차이

| 항목 | 안드로이드 | iOS | 이유 |
| --- | --- | --- | --- |
| 알람 음량 슬라이더 | 있다 | **없다** | AlarmKit 이 OS 톤을 소유해 제어 불가 |
| 오디오 스테이징 | 필요 없음 | `.caf`(LPCM) 로 직접 쓴다 | AlarmKit 은 `AlertSound.named(_)` 파일만 울린다 |

⚠ iOS 오디오 스테이징을 `AVAssetExportSession` 으로 하지 말 것 —
`AVAssetExportPresetAppleM4A` 는 `.caf` 를 못 내므로 staging 이 **항상** 실패하고,
잠금화면·앱 종료 상태에서 목소리가 아예 안 울린다. `AVAssetReader`→`AVAssetWriter` 로
CAF 를 직접 쓰고 `AVChannelLayoutKey` 를 반드시 넣는다(없으면 파일은 생기는데 열리지 않는다).

## 구현 지도

| 규칙 | Android | iOS | 백엔드 |
| --- | --- | --- | --- |
| 재생 방식 2택 | `PlayModeCard` (`ui/editor/AlarmEditorControls.kt`) | `VoicePlayModePicker` | `wake_mode` (`voice_only` / `sound_then_voice`) |
| 옛 값 정규화 | `AlarmPlayModes.normalize` | `AlarmPlayMode.decode` | — |
| 기본목소리 제한(OR) | `restrictToWeatherMedication` (`ui/editor/AlarmEditorScreen.kt`) | `restrictToWeatherMedication` (`Views/Editor/AlarmEditorSheet.swift`) | `tts.ts` 무료 등급 게이트 |
| 상태 강제 | `LaunchedEffect(restrictToWeatherMedication, …)` | `coerceFreeVoiceTierConstraints` | — |
| 목소리 전환 경고 | `pendingVoiceSwitch` (`ui/editor/VoiceAudioCard.kt`) | `pendingVoiceSwitch` (`AlarmEditorSheet.swift`) | — |
| 직전 선택 저장 | `DefaultVoicePreferenceStore` / `DynamicPromptPreferenceStore` | `DefaultVoicePreferenceStore` | — |
| 버킷 클립 선다운로드 | `sync/StockClipPrefetchWorker.kt` | `StockClipPrefetcher.swift` | `GET /tts/stock-clips`, `GET /tts/messages/:id/audio` |
| 클립 회전 | `AlarmRepository.advancedBucketRotationIndex` / `resolveBucketClipSelection` | `LocalAlarmStore.advancedBucketRotationIndex` + `AlarmSoundResolver.rotatedBucketClipKey` + `AlarmAppContext.rescheduleForNextBucketClip` | — |
| 회전 상태 영속 | `AlarmEntity.bucketClipKeysJson` / `bucketRotationIndex` | `LocalAlarmRecord.bucketClipKeys` / `bucketRotationIndex` | — |
| 오디오 캐시 키 | `stock_<messageId>` | `AudioCacheStore.stockCacheKey` (같은 규칙) | — |
| 무료 전환 잠금 | `AlarmRepository.lockPaidAlarmTalks` / `unlockPaidAlarmTalks` | `SocialFeatureViewModel.applyFreePlanVoiceLock` / `restorePaidVoiceAlarms` | `users.plan`, `resolvePlanAfterSuspend` |
| 목소리 데이터 3일 유예 | `AlarmRepository.lockPaidAlarmTalks`(행만) | `SocialFeatureViewModel.applyFreePlanVoiceLock`(행만) | `PAID_VOICE_RETENTION_DAYS` · `schedulePaidVoiceRetention` · `clearPaidVoiceRetention` |
| 유예 만료 삭제 | — | — | `sweepPaidVoiceRetention` → `deleteSensitiveVoiceDataForUser`(삭제 직전 `hasActivePaidEntitlement` 재확인) |
| 삭제 예고 푸시 | `fcm/AlarmTalkMessagingService.kt` | `PushNotificationCoordinator` | `notifyVoiceDeletionScheduled` → `sendVoiceDeletionWarningPush` |
| 받은 알람은 접근권 축 | `lockPaidAlarmTalks` 의 `origin == LOCAL_OWNED` | `LocalAlarmStore.paidAlarmTalks` 의 `.localOwned` | `paid-voice-cleanup.ts`(`is_received` 까지 sound-only) |

## 검증 방법

목소리가 **실제로 나오는지**는 실기기에서만 확인된다. 특히:
- raw API 로 만든 알람은 `voice_profile_id`·`message_id`·`bucket_id` 가 비어 있어
  톤만 울린다 — 그건 정상이다. **앱 UI 로 만든 알람**으로 검증해야 한다.
- 무료 등급은 버킷 클립 선다운로드가 끝난 뒤여야 오프라인에서도 소리가 난다.
