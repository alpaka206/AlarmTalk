I have everything I need.

## 구조 요약 (파일:줄 인용)

**빌드 시스템**: XcodeGen (`project.yml`) — `.xcodeproj` 는 커밋 안 됨. `scripts/build-debug.sh` 가 `xcodegen generate` → `xcodebuild ... CODE_SIGNING_ALLOWED=NO`.

**타깃 3개** (`project.yml:33-97`): `AlarmTalk`(앱) / `AlarmTalkWidget`(app-extension, LiveActivity) / `AlarmTalkTests`. `Shared/` 는 앱·위젯 양쪽에 컴파일되고, 앱 전용 코드는 `ALARMTALK_APP` 컴파일 조건으로 분기(`project.yml:60-64`).

- **최소 iOS 26.0**, Swift 6.0, iPhone 전용(`TARGETED_DEVICE_FAMILY: "1"`), `developmentLanguage: ko`
- **SPM 의존성 0개.** 전부 Apple 퍼스트파티 프레임워크(AlarmKit / ActivityKit / AppIntents / StoreKit2 / AVFoundation / AuthenticationServices / BackgroundTasks). 외부 라이브러리가 하나도 없다.

**아키텍처**: TCA 아님, 순수 SwiftUI + `ObservableObject`/`@StateObject` MVVM. Swift 6 strict concurrency 를 실제로 지킨다 — `@MainActor` 격리, `nonisolated` 로 region-based isolation 회피(`AlarmKitViewModel.swift:521-525`), `@unchecked Sendable` 근거 주석(`AlarmTalkAPI.swift:1-6`).

앱 루트(`AlarmTalkApp.swift:12-33`)가 9개 `@StateObject` 를 소유하고 하위로 주입: `LocalAlarmStore` / `AlarmKitViewModel` / `HolidayStore` / `AuthViewModel` / `RemoteAlarmSyncViewModel` / `VoiceStudioViewModel` / `SocialFeatureViewModel` / `AppVersionGate` / `SubscriptionManager`.

**규모**: Swift 158파일 34,263줄 (앱 ~29k, 테스트 5,189, 위젯 231, Shared 271). 최대 파일은 `Views/Editor/AlarmEditorSheet.swift` 1,789줄.

**중요**: 이 사본은 레포에서 제거된 커밋 `9f427c69`(2026-07-28, "chore: 미운영 iOS 앱 제거", 189파일 48,910줄 삭제) 직전 상태와 **CRLF 정규화 후 바이트 동일**하다. 검증한 5개 파일 전부 일치 — 별도로 진행된 포크가 아니라 레포 상태의 정확한 스냅샷이다. 따라서 `git show 9f427c69^:apps/ios-native/...` 로 언제든 복원 가능하며, 이 데스크톱 사본이 유일본은 아니다.

## 실제로 동작하는 것 / 껍데기인 것

껍데기가 거의 없다. `TODO`/`FIXME`/"미구현" 마커를 전수 조사했는데 실제 미구현은 **1건**이고 그마저 오탐이었다.

**완전히 구현된 것:**

| 영역 | 근거 |
|---|---|
| **알람 엔진** | AlarmKit 스케줄/취소/스누즈/복구/타임존 재무장 + 공휴일 skip 하이브리드. 아래 별도 절 |
| **인증** | Apple 로그인(`AuthenticationServices` + nonce, `NonceGenerator.swift`), 이메일+비번 가입/로그인, 6자리 이메일 코드, 비번 재설정. JWT 는 Keychain(`KeychainStore.swift`) |
| **결제** | StoreKit2 완전 구현(`Services/IAP/SubscriptionManager.swift`, 380줄) — `Transaction.updates` 리스너, 복원, entitlement 재계산, 백엔드 `billing/apple/confirm` 동기화. `.storekit` 설정 파일까지 scheme 에 연결(`project.yml:47-51`) |
| **음성 녹음/업로드** | `VoiceRecorder.swift`, `VoiceCloneUploadFlow.swift`(871줄), multipart 업로드, `AudioCropper`, 화자분리 플로우(`SpeakerSeparationFlow.swift`, 824줄) |
| **가족 공유** | `SocialFeatureViewModel.swift`, `MemberManagementView.swift`(466줄) — 그룹 조회/탈퇴/멤버추방/소유권이양/가족 목소리 |
| **위젯** | `AlarmLiveActivity.swift` 222줄 — 잠금화면 + Dynamic Island 전 리전(expanded/compact/minimal), Stop/Snooze 버튼이 실제 AppIntent 에 연결 |
| **오프라인 동기화** | pull/push 분리(`RemoteAlarmPullSync` 392줄 / `RemoteAlarmPushSync`), `syncState` 머신, `BGAppRefreshTask` 15분 주기(`BackgroundSyncTask.swift`) |
| **공휴일** | `KoreanLunarHolidayEngine.swift` 387줄 — 음력 연휴를 **로컬 계산**. 서버 `holiday` API 도 함께 사용(`HolidayStore.swift:346`) |
| **현지화** | `Localizable.xcstrings` 789키가 **en·ja 전부 `translated` 상태**. 미번역 0건 |

**껍데기/미완:**
- `HolidayStore.swift:393` 의 `syncFromRemote` "placeholder" 주석은 **stale** — 실제로는 `upsertAll` 을 호출하고 `:346` 에서 API 도 부른다. 주석만 낡음.
- `billing/checkout` 은 스스로 deprecated 라 표기(`AlarmTalkAPI.swift:501`) — StoreKit2 로 대체됨. 코드는 남아 있다.
- `Views/Common/PreviewSupport.swift` 는 SwiftUI Preview 용 빈 인스턴스 팩토리(의도된 것).

**한 번도 컴파일된 적 없다.** README 첫 줄이 "source-ready for Xcode on macOS, but it is not built in this Windows workspace". iOS 26 SDK 로 `xcodebuild` 를 돌린 흔적이 없다 — 이게 가장 큰 미검증 리스크다.

## 알람 발사 경로 — 정확히 무엇을 쓰는가

**AlarmKit (iOS 26 신규 프레임워크). UNNotification 아님, 백그라운드 오디오 아님, 푸시 의존 아님.** `UserNotifications` 는 전체 코드베이스에서 딱 한 번, 소셜 알림 추적(`SocialNotificationTracker.swift`)에만 import 된다. README 가 이 원칙을 못박아 뒀다:

> The iOS ring path must not depend on push, APNs, server cron, or network fetch.

**스케줄링** (`AlarmKitViewModel.swift:425-461`):
```swift
let id = UUID()
let schedule = makeSchedule(record)
let resolution = AlarmSoundResolver.resolve(for: record, audioCache: audioCache)
let configuration = makeConfiguration(record:alarmKitID:schedule:resolution:)
_ = try await AlarmManager.shared.schedule(id: id, configuration: configuration)
store.markScheduled(localID: record.id, alarmKitID: id.uuidString)
```

**스케줄 종류 — 하이브리드 3분기** (`AlarmKitViewModel.swift:501-519`):
```swift
if record.isHolidayOffRecurring {
    return .fixed(record.nextFireDate)          // 반복+공휴일off → 앱이 직접 재무장하는 one-shot
}
let time = Alarm.Schedule.Relative.Time(hour: record.hour, minute: record.minute)
let weekdays = record.repeatDaysMask.repeatDays.compactMap(localeWeekday)
let recurrence: Alarm.Schedule.Relative.Recurrence = weekdays.isEmpty
    ? .never                                     // 단발
    : .weekly(weekdays)                          // 반복 → AlarmKit 이 타임존 적응·자동 재무장 소유
return .relative(.init(time: time, repeats: recurrence))
```
공휴일 skip 은 AlarmKit `.weekly` 로 표현이 불가능해서, **그 조합만** `.fixed` one-shot 으로 떨어뜨리고 dismiss/recovery/타임존 경로에서 앱이 다음 회차를 직접 재무장한다. blast radius 를 최소화한 판단이고 근거가 주석에 남아 있다(`:502-512`).

**소리 — 이게 설계의 핵심** (`AlarmSoundResolver.swift`, `AlarmSoundStaging.swift`):

사용자 목소리는 App Group 컨테이너의 `audio-cache/` 에 있어 AlarmKit 이 못 읽는다. 그래서 `Library/Sounds/voice-<safeKey>.<ext>` 로 **복사(필요시 `.caf` 트랜스코드)** 한 뒤 `AlertConfiguration.AlertSound.named(_)` 로 넘긴다. 이러면 **앱이 죽어 있어도, 잠금화면에서도 사용자 목소리가 그대로 울린다.**

```swift
if withinLimit {
    if let bundled = try? AlarmSoundStaging.stage(url: url, key: key) {
        return .bundledNamed(bundled)      // 잠금화면에서도 목소리로 울림
    }
    return .cachedAudio(url, duration)     // staging 실패 → .default + 앱 열렸을 때만 in-app 재생
}
```

**제약과 폴백**: Apple 커스텀 사운드 정책상 **30초 한도**(`AlarmEnums.swift:155` `maxDurationMillis = 30_000`, tolerance 750ms). 초과하거나 트랜스코드가 실패하면 `.cachedAudio` 로 떨어져 OS 는 `.default` 톤만 울리고, 앱이 활성일 때 `AlarmVoicePlayer`(AVAudioPlayer)가 같은 목소리를 겹쳐 재생한다(`AlarmKitViewModel.swift:215-217`). 사용자에게도 정직하게 고지한다(`:612`):
> "\(seconds)초 목소리는 iOS 제한으로 기본 알람음 뒤 앱이 열려 있을 때 재생돼요."

staging 은 30초 초과 파일도 **첫 30초로 캡해 트랜스코드**를 재시도해서 최대한 `.bundledNamed`(잠금화면 재생) 로 승격시킨다(`AlarmSoundStaging.swift:74-95`).

**Stop/Snooze** (`Shared/AlarmIntents.swift`): `LiveActivityIntent` 2종. Snooze 는 `secondaryButtonBehavior: .custom` 으로 두어 OS 자동 재무장을 끄고, 앱이 스누즈 한도(`snoozeRepeatLimit`)를 판정한 뒤 `AlarmManager.shared.countdown(id:)` 또는 `stop(id:)` 를 직접 호출한다. 한도 판정은 **3-state**(`.allow`/`.deny`/`.unknown`) — 잠금화면 콜드부팅으로 store 가 아직 디스크 로드 전이면 `.unknown` 이 되고 **종료가 아니라 다시 울림을 기본값**으로 둔다(`AlarmIntents.swift:117-127`). 이런 엣지케이스 판단이 곳곳에 있다.

**정직하게 인정한 한계** (`AlarmVoicePlayer.swift:15-21`): iOS 에는 알람별 음량 API 가 없어 `voiceVolumePercent`/`alarmVolumePercent` 는 in-app 폴백 재생에만 적용되고 OS 알람 톤에는 못 미친다. Android 는 자체 ringing 을 소유해 가능하지만 iOS 는 동등성을 가질 수 없다고 명시.

## 로컬 DB 스키마

**CoreData·SwiftData·GRDB 전부 아님. 단일 JSON 파일이다.**

`LocalAlarmStore.swift:11-30` — `Documents/voice-alarm-ios-alarms.json`, actor 격리된 `LocalAlarmPersistence` 가 `Codable` 배열을 통째로 읽고 쓴다. 알람 수가 수십 개 규모라 합리적인 선택이고, 마이그레이션 부담이 없다.

`LocalAlarmRecord`(`LocalAlarmRecord.swift:6-62`) 는 주석대로 **Android `AlarmEntity.kt` 와 1:1**:

| 그룹 | 필드 |
|---|---|
| 식별/시각 | `id`(UUID문자열), `label`, `hour`(0-23), `minute`(0-59), `fireAtMillis`(Int64), `repeatDaysMask`(0-0x7f, bit0=일), `holidayOff` |
| 스누즈 | `snoozeEnabled`, `snoozeMinutes`(1-30), `snoozeRepeatLimit`(0/3/5, 0=무제한), `snoozeCount` |
| 재생 | `vibrationPattern`, `playMode`(alarm_only/voice_only/sound_then_voice), `defaultAlarmSoundId`, `alarmSoundUri`, `alarmSoundLabel`, `alarmVolumePercent`(0-100) |
| 오디오 캐시 | `localAudioUri`, `audioCacheKey`(SHA-256 hex), `rawAudioUri` |
| 목소리 | `voiceSource`, `voiceProfileId`, `voiceListenerTitle`, `voiceText`, `voiceCategory`, `voiceLanguage`, `voiceRepeat`, `voiceVolumePercent`, `ttsMessageId` |
| 동적 문구 | `voiceRandomPrompt`, `voiceRandomContext`, `voiceWeatherCountry`, `voiceWeatherCity`, `voiceFortuneGender`, `voiceFortuneBirthDate`, `voiceFortuneBirthTime`, `dynamicVoicePreparedForFireAtMillis` |
| 무료 버킷 회전 | `voiceBucket`, `voiceRotationIndex`, `voiceBucketClipKeys[]` |
| 동기화 | `remoteAlarmId`, `lastSyncedAtMillis`, `syncState`, `origin` |
| 상태 | `enabled`, `state`(runtime), `createdAtMillis`, `updatedAtMillis` |
| **iOS 전용** | `alarmKitID`(AlarmKit `Alarm.id` UUID 를 String 으로) |

부가 저장소는 전부 `UserDefaults`/파일: `AudioCacheStore`(683줄, App Group 컨테이너 + 메타데이터 + auto-trim), `KeychainStore`(JWT), `DefaultVoicePreferenceStore`, `AccessSnapshotStore`, `HolidayStore`, `OnboardingCompletionStore`, `ReceivedAlarmBadgeStore`, `UsageGuideStore`.

## API 엔드포인트 목록 (코드에서 뽑은 문자열 그대로)

베이스: `Info.plist` 의 `VOICE_ALARM_API_BASE_URL`, 기본값 `https://api.alarm-talk.com/api` (`AlarmTalkAPI.swift:898-905`, https 스킴 강제).

```
auth/apple                                    auth/me
auth/login                                    auth/logout
auth/register                                 auth/email-code
auth/email-code/verify                        auth/password-reset
auth/password-reset/confirm

alarm                                         alarm/\(id)

voice                                         voice/family
voice/clone                                   voice/upload
voice/diarize                                 voice/\(id)
voice/\(profileId)                            voice/\(profileId)/relationship
voice/uploads/\(uploadId)/separate            voice/uploads/\(uploadId)/speakers
voice/uploads/\(uploadId)/speakers/\(speakerId)

tts/generate                                  tts/messages
tts/messages/\(id)/audio                      tts/stock-clips

user/me                                       user/me/deletion
user/consents                                 user/consents/status
user/search?q=\(escaped)

family/groups/current                         family/groups/\(groupId)/leave
family/groups/\(groupId)/members/\(userId)    family/groups/\(groupId)/transfer-ownership
family/alarms/voice

billing/subscription                          billing/vouchers
billing/vouchers/family-share                 billing/vouchers/family-share/regenerate
billing/apple/confirm                         billing/cancel
billing/change-plan                           billing/redeem
billing/checkout   (자체 deprecated 표기)

code/register
app/version?platform=\(platform)
holiday?country=\(cc)&from=\(from)&to=\(to)
```

**모델**: `AlarmTalkAPIModels.swift` 1,014줄에 요청/응답 타입 집중. `RemoteAlarm` / `RemoteAlarmWriteRequest` / `RemoteAlarmListResponse` / `RemoteAlarmResponse` / `AuthSession` / `AuthUser` / `VoiceProfile` / `FamilyVoiceProfile` / `VoiceSpeakerSegment` / `VoiceUploadSpeakersResponse` / `TtsGenerateRequest` / `TtsGenerateResponse` / `EmptyResponse` 등. `keyDecodingStrategy = .convertFromSnakeCase` 로 백엔드 snake_case 를 자동 매핑(`:21-24`) — shared zod 스키마와 필드명이 그대로 맞는다.

`RemoteAlarmMapper.swift` 가 `RemoteAlarm` ↔ `LocalAlarmRecord` 변환을 전담하고 전용 테스트 412줄이 붙어 있다.

## 테스트

**36파일 / 286개 `func test…` / 5,189줄. 전부 XCTest** (Swift Testing 미사용 — iOS 26 타깃이라 `import Testing` 로 옮길 수 있었을 텐데 안 옮겼다).

로직 레이어를 실제로 덮는다, 스모크 테스트가 아니다:
- `AuthViewModelTests` 684줄 — Apple credential state(revoked/notFound/transferred) 분기까지 mock 으로 검증
- `AlarmEditDraftTests` 512줄, `RemoteAlarmMapperTests` 412줄
- `LocalAlarmStore` 계열 3파일(Copy/Deletion/Recovery)
- `LocalHolidayCalendarLunarTests` — 음력 엔진 검증
- `AlarmSoundResolverTests`, `AlarmVoicePlayerTests`, `AudioCacheStoreTests`, `AlarmIntentsTests`, `SubscriptionManagerTests`, `BackgroundSyncTaskTests`
- `AlarmUserCopyTests` — 사용자 문구 회귀 방지

**단, 한 번도 실행된 적이 없다.** `project.yml:65-67` 이 `xcodebuild -scheme AlarmTalk test` 로 돌게 scheme 에 등록해 뒀지만 Mac 이 없어 검증 안 됨. 286개가 지금 몇 개나 통과할지는 미지수다.

## 되살리기 관점의 강점과 부채

### 강점

1. **AlarmKit 을 제대로 쓴 코드는 시장에 거의 없다.** iOS 26 전용 신규 프레임워크라 레퍼런스가 부족한데, 이 코드는 `.fixed`/`.relative(.weekly)`/`.relative(.never)` 3분기 하이브리드, `secondaryButtonBehavior: .custom` 으로 스누즈 한도 직접 소유, `alarmUpdates` 스트림으로 stopped/alerting 전이 감지까지 다 만져 놨다. **이 지식을 다시 쌓는 비용이 이 자산의 진짜 가치다.**

2. **`Library/Sounds` staging 트릭이 제품의 핵심 난제를 푼다.** "사용자 목소리로 알람이 울린다" 는 iOS 에서 가장 어려운 부분인데, 잠금화면·앱 종료 상태에서도 동작하는 경로를 찾아 놨다(30초 한도 안에서). 이걸 모르고 다시 시작하면 UNNotificationSound 나 백그라운드 오디오로 헤매다 실패한다.

3. **동시성 버그를 이미 한 번 잡았다.** `rearmInFlight` guard(`AlarmKitViewModel.swift:35-42`)는 두 `@MainActor` 경로가 `await` 지점에서 인터리브돼 `.fixed` 알람이 중복 스케줄되고 다음 회차가 이중 발화하는 실제 버그를 막는 코드다. "PR3 FIX" 같은 태그로 **왜 이 코드가 있는지**가 남아 있어, 무심코 지웠다가 재현되는 사고를 예방한다.

4. **의존성 0개.** SPM 패키지가 하나도 없어 공급망·버전 충돌·유지보수 부채가 없다. 되살릴 때 `pod install` 지옥이 없다.

5. **현지화 789키 en·ja 100% 완료.** 이것만 외주 주면 수백만 원 규모다.

6. **Android 와의 parity 가 코드에 명시돼 있다.** 주석이 `Android AlarmRepository.snooze()`, `RingingService.kt:141-197`, `AlarmEntity.kt:7-45` 처럼 **대응 파일·줄번호**를 짚는다. Android 를 고칠 때 iOS 에서 뭘 같이 봐야 하는지 추적 가능하다.

7. **위생 상태가 좋다.** 전체에서 `try!`/`as!`/`fatalError` 총 **2건**(하나는 `SecRandomCopyBytes` 실패라는 정당한 케이스), `print()` 디버그 잔재 **0건**, 주석 밀도 12-22%. 주석이 "무엇을" 이 아니라 "왜" 를 적는다.

8. **제약을 정직하게 문서화한다.** LiveActivity 파일이 "HONEST CONSTRAINT: AlarmKit 가 시스템 ALERT UI 를 소유한다 ... Android RingingActivity 같은 풀스크린 ring 화면을 흉내 내지 않고" 라고 적고, 음량 API 부재도 명시한다. 나중에 "왜 Android 처럼 안 되지?" 로 낭비할 시간을 아껴 준다.

### 부채 / 리스크

1. **컴파일 검증 0회 — 가장 큰 리스크.** 34k 줄이 Mac 에서 한 번도 빌드된 적 없다. Swift 6 strict concurrency 는 컴파일 에러가 가장 까다로운 축이라, `nonisolated`/`sending`/`@unchecked Sendable` 을 아무리 신경 써 써도 실제 컴파일에서 수십~수백 건 터질 수 있다. **첫 그린 빌드까지 며칠은 잡아야 한다.**

2. **iOS 26.0 최소 버전이 시장을 자른다.** AlarmKit 이 iOS 26 전용이라 우회 불가다. 구형 기기 사용자를 포기하거나, iOS 25 이하용 열화 경로(UNNotification 기반, 커스텀 사운드 30초, 스누즈 제약)를 따로 만들어야 한다 — 후자는 지금 코드에 **없다**.

3. **30초 목소리 한도가 제품 제약으로 굳는다.** Android 는 `RingingService` 로 임의 길이를 재생하지만 iOS 는 30초 초과 시 "앱이 열려 있을 때만" 으로 열화한다. 이건 코드 문제가 아니라 플랫폼 문제라 되살려도 안 사라진다. 무료 버킷 클립·TTS 문구가 30초 안에 들어가는지 확인 필요.

4. **백엔드 계약이 6개월 가까이 표류했다.** 2026-07-21 스냅샷 이후 `develop`/`main` 에 들어간 백엔드 변경(받은-알람 소유권 #675, 탈퇴자 목소리 회수 #676 등)이 반영돼 있지 않다. `RemoteAlarmMapper` 와 `AlarmTalkAPIModels` 를 현행 `packages/shared` zod 스키마와 대조하는 작업이 필요하다. 다만 snake_case 자동 매핑이라 필드 추가는 대체로 무해하고, **삭제·의미 변경만** 찾으면 된다.

5. **1,789줄짜리 `AlarmEditorSheet.swift`.** Android 쪽 편집기도 큰 파일이라 대칭이긴 하지만, 남이 이어받아 고치기엔 부담이다. `+AlarmModeSection` 으로 한 번 쪼갠 흔적은 있다.

6. **CLAUDE.md 의 최근 규약이 반영 안 됨.** 「알람 편집기 기본값 = 직전 선택 유지」, 「1회성 오버레이는 확인이 끝난 뒤에만 판단」, 「모달 = `IosAlertDialog` 하나」 같은 규칙은 iOS 제거 이후 Android 에서 확립된 것들이다. iOS 에 `DefaultVoicePreferenceStore` 는 있지만 `DynamicPromptPreferenceStore`(문구 종류·무료 테마 기억)는 없다. parity 재작업이 필요하다.

7. **stale 주석이 이미 생기기 시작했다.** `HolidayStore.swift:393` 의 "placeholder ... 구현은 미룬다" 는 실제로 구현된 뒤에도 안 지워졌다. 규모 대비 적은 편이지만, 주석을 신뢰해서 읽는 코드베이스라 이런 게 쌓이면 강점이 부채로 뒤집힌다.

8. **테스트가 XCTest 에 묶여 있다.** 동작에는 문제 없지만 iOS 26 시대에 Swift Testing 으로 옮기는 건 별도 작업이다. 우선순위는 낮다.

### 판정

**되살릴 값어치가 있다.** 이 코드의 가치는 줄 수(34k)가 아니라 **AlarmKit 으로 커스텀 목소리 알람을 울리는 경로를 실제로 찾아냈다는 것**에 있고, 그 지식은 문서화된 주석 형태로 코드에 박혀 있다. 처음부터 다시 쓰면 같은 벽에 같은 순서로 부딪히게 된다.

다만 **"복원하면 바로 돌아가는 앱" 이 아니라 "Mac 앞에 앉아 컴파일 에러를 며칠 잡아야 하는 완성도 높은 초고"** 로 취급해야 한다. 재개 순서를 제안하면:

1. Mac + Xcode(iOS 26 SDK) 확보 → `xcodegen generate` → 첫 빌드. **여기서 실제 상태가 판명된다.** 이 관문을 통과하기 전엔 나머지 추정이 전부 무의미하다.
2. `xcodebuild test` 로 286개 중 몇 개가 사는지 확인 — 로직 레이어 건강 진단이 공짜로 나온다.
3. 백엔드 계약 대조(`AlarmTalkAPIModels` ↔ 현행 `packages/shared`), 삭제·의미변경 필드만.
4. CLAUDE.md 신규 규약 parity 재적용.
5. 실기기 알람 검증 — 특히 `Library/Sounds` staging 이 잠금화면에서 실제로 목소리를 울리는지. **이 가정이 깨지면 제품 전제가 흔들린다.**

복원 경로는 데스크톱 사본이 아니라 `git show 9f427c69^:apps/ios-native/...` 또는 `git revert 9f427c69` 를 쓰는 게 낫다 — 내용이 동일하고 이력이 붙어 온다.