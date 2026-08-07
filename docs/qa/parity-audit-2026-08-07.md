# 전수 대조 결과 — 2026-08-07

안드로이드를 원본으로 삼아 iOS·백엔드를 6축(울림 / 목소리저장 / 게이트 / 모달 / 죽은코드 /
화면전환)으로 대조하고, 각 발견을 **독립 에이전트가 반증 시도**해 살아남은 것만 남겼다.
확인 35건(반증되어 버린 것은 제외).

> **이 파일은 작업 목록이다.** 고칠 때마다 상태를 갱신하고, 규칙이 확정되면
> [`docs/spec/`](../spec/README.md) 으로 옮긴다. 여기 남은 것은 아직 안 고친 것이다.

| 상태 | 뜻 |
| --- | --- |
| ☐ | 미착수 |
| ☑ | 고침 (커밋됨) |
| ⊘ | 의도된 차이로 판정 — 스펙에 기록함 |


## P1 (5건)

### ☐ [modals] 「알람 받지 않을 시간」 모달이 서버 계약을 어긴다 — 구간 8개 허용(서버 상한 2), 요일도 개별 선택(서버는 프리셋만)

**안드로이드**: apps/android-native/.../ui/settings/SettingsScreenComponents.kt:250 `private const val QUIET_WINDOW_MAX = 2` 이고 236-241 에서 `drafts.size < QUIET_WINDOW_MAX` 로 추가를 막는다. 요일은 같은 파일 355-377 — `QUIET_DAY_PRESETS`(평일/주말/매일) FilterChip 3택 단일 선택이고 `onSelectDays(preset.days)` 로 프리셋 집합만 넘긴다.

**iOS**: apps/ios-native/AlarmTalk/Views/Settings/FamilyAlarmQuietTimeDialog.swift:20 `private static let maxWindows = 8`(주석은 Android 를 인용하지만 근거 경로 `SettingsScreen.kt:387-559` 는 존재하지 않는 스테일 참조). 요일은 같은 파일 36줄 `onToggleDay` + 134-143 `toggleDay()` 로 요일 하나씩 켜고 끈다. 서버: packages/backend/src/lib/family-alarm-settings.ts:7 `MAX_QUIET_WINDOWS = 2`, 99줄 `raw.length > MAX_QUIET_WINDOWS → return null` → routes/user.ts:109-115 에서 400. 요일은 같은 파일 23-32 `coerceToPresetDays` 가 평일/주말/매일로 말없이 확장한다.

**사용자 영향**: 구간을 3개 이상 추가해 저장하면 PATCH /user/me 가 400 으로 떨어져 아무것도 저장되지 않는다(입력한 시간 전부 날아감). 요일을 월·수·금만 골라 저장하면 서버가 조용히 '평일 전체' 로 바꿔 저장하므로 화·목에도 가족 알람이 막히고, 다시 열면 평일 전체가 되어 있다.

**고칠 방향**: `maxWindows` 를 2 로 내리고 요일 UI 를 평일/주말/매일 3택 세그먼트로 바꾼다(Set 개별 토글이 아니라 프리셋 집합 대입). 스테일 주석의 경로도 `SettingsScreenComponents.kt:250-315` 로 고친다.

<details><summary>반증 검증 결과</summary>

반증 실패 — 코드로 전부 확인됨. (1) 안드로이드 원본: SettingsScreenComponents.kt:150 `private const val QUIET_WINDOW_MAX = 2`(주장의 :250 은 앵커 오기, 실제 150), 231·239 `drafts.size < QUIET_WINDOW_MAX` 로 추가 차단; 143-148 `QUIET_DAY_PRESETS`(평일/주말/매일) + 361 `FilterChip(selected = draft.days == preset.days, onClick = { onSelectDays(preset.days) })` 로 프리셋 3택만 — 355-358 주석도 "개별 요일 지정은 없앰". (2) iOS 위반: FamilyAlarmQuietTimeDialog.swift:20 `maxWindows = 8`, 49·58 에서 8개까지 추가 허용; 268-282 `ForEach(0..<7)` 개별 요일 토글 + 135 `toggleDay` insert/remove. 파일 5줄의 근거 `SettingsScreen.kt:387-559` 는 실재하지 않는다(그 파일은 271줄, 다이얼로그는 SettingsScreenComponents.kt) — 스테일 참조 확인. (3) 서버 계약: family-alarm-settings.ts:7 `MAX_QUIET_WINDOWS = 2`, 99 `raw.length > MAX_QUIET_WINDOWS → return null` → routes/user.ts:109-116 `INVALID_QUIET_WINDOWS` 400 을 DB 업데이트 **전에** 반환하므로 PATCH 전체(allowFamilyAlarms 포함)가 무산; 111 `windows.push({ days: coerceToPresetDays(days), ... })` + 23-32 로 비프리셋 요일을 말없이 확장(월·수·금 → 평일 전체)해 저장하고 isBlockedByFamilyAlarmQuietTime 이 그 값을 쓴다. (4) 다른 경로가 막지 않음 — AuthViewModel.swift:684-694 `normalizedQuietWindows` 는 `.prefix(8)`(2 클램프 없음), AlarmTalkAPIModels.swift:286 도 `prefix(8)`. 오히려 악화 요인 발견: 400 은 failStatus → statusMessage 로 가는데 `auth.statusMessage` 를 렌더하는 곳은 LoginView.swift:136 / PasswordResetView.swift:70 뿐이고, MemberManagementView.swift:167-180 은 confirm 즉시 시트를 닫아(`showFamilyAlarmDialog = false`) **실패가 사용자에게 전혀 표시되지 않는다**(lastNetworkError 도 이 경로에서 안 채워지고 어느 뷰도 그리지 않음). 즉 3개 이상 저장 시 조용히 아무것도 저장되지 않고 사용자는 저장된 줄 안다. 추가로 AlarmTalkTests/AuthViewModelTests.swift:390-413 이 비프리셋 `days: [1, 3]` 전송을 "Android compatible" 로 단언해 틀린 값을 고정하고 있다. (5) CLAUDE.md 예외 아님 — AlarmKit 제약도 플랫폼 표준 알럿도 아니고 서버 계약 위반이다. 심각도: 과장 아님. 요일 개별 토글은 iOS 의 기본 조작 경로라 비프리셋 선택이 예외가 아닌 기본값에 가깝고(조용한 요일 확장 → 의도치 않은 화·목 차단), 구간 3개 경로는 무증상 저장 실패다. P1 유지.

</details>

### ☑ [screens-flow] ＋FAB 가 "누구를 깨울까요?" 시트를 건너뛴다 — 알람이 하나라도 있으면 가족 알람을 만들 길이 사라진다

**안드로이드**: apps/android-native/.../ui/app/AlarmTalkApp.kt:646-652 `requestCreateAlarm()` 이 `canCreateFamilyAlarm` 이면 `alarmTargetSheetVisible = true`, 아니면 `startCreateAlarm(false)`. 이 함수 하나를 **두 진입점이 모두** 탄다 — FAB(:862-871 `onClick = ::requestCreateAlarm`)와 빈 상태 히어로 카드(AlarmListScreen.kt:259-262 → `onCreateAlarm` = 같은 함수). 게다가 `startCreateAlarm`(:635-645)이 `permissions.alarmReady` 를 먼저 확인하고, 부족하면 게이트를 띄운 뒤 허용되면 편집기로 이어 준다.

**iOS**: apps/ios-native/AlarmTalk/Views/Root/MainTabsView.swift:66-83 — ＋FAB 는 `editorTarget = AlarmEditorTarget(id:…, editingAlarmID: nil, familyAlarmMode: false)` 로 **편집기를 곧바로** 연다. 시트도 권한 확인도 없다. 반면 Views/Alarms/AlarmsListView.swift:212-213·256-287 의 빈 상태 카드만 `openCreateAlarm()` → 권한 확인 → `presentCreateEntry()` → `wakeTargetSheetOpen = true` 를 탄다. 그런데 빈 상태 카드는 `store.alarms.isEmpty` 일 때만 그려지고(AlarmsListView.swift:119-121) FAB 는 `!store.alarms.isEmpty` 일 때만 뜬다(MainTabsView.swift:66) — 두 진입점은 **상호 배타적**이다.

**사용자 영향**: 알람을 하나라도 만든 순간부터 '누구를 깨울까요?' 시트에 닿는 경로가 앱에서 사라진다. 커플/가족 이용권을 산 사용자가 상대에게 알람을 보낼 방법이 없다(알람을 전부 지우기 전에는). 덤으로 FAB 경로는 AlarmKit 권한 사전 확인도 건너뛰어, 편집기에서 시각·목소리를 다 정하고 저장을 눌러서야 '알람 권한이 필요해요' 를 만난다.

**고칠 방향**: MainTabsView 의 FAB `onClick` 을 AlarmsListView 의 `openCreateAlarm()` 과 같은 경로로 합친다. 안드로이드처럼 진입 함수를 하나로 두고(권한 확인 → 구성원 있으면 시트 → 없으면 편집기) FAB·빈 상태 카드가 모두 그걸 부르게 한다. AlarmsListView 가 시트를 소유하고 있으므로, FAB 를 AlarmsListView 안(overlay)으로 옮기거나 부모가 호출할 수 있는 콜백을 preference/binding 으로 올려 준다.

<details><summary>반증 검증 결과</summary>

반증 실패 — 코드로 그대로 확인된다.

【인용 줄 전부 실재·주장대로】
- 안드로이드: AlarmTalkApp.kt:631-633 `canCreateFamilyAlarm`, :635-645 `startCreateAlarm`(먼저 `permissions.alarmReady` 확인 → 부족하면 `pendingCreateAlarmAfterPermission` 에 담고 게이트, 허용 후 이어서 편집기), :646-651 `requestCreateAlarm`(자격 있으면 `alarmTargetSheetVisible = true`, 아니면 `startCreateAlarm(false)`). 두 진입점이 모두 이 함수를 탄다 — FAB `AlarmTalkApp.kt:863 onClick = ::requestCreateAlarm`, 히어로 카드 `AlarmTalkApp.kt:1071 onCreateAlarm = ::requestCreateAlarm` → `ui/alarms/AlarmListScreen.kt:261 EmptyAlarmHeroCard(onCreateAlarm = onCreateAlarm)`.
- iOS FAB: MainTabsView.swift:66-68 — `if selectedTab == .alarms && !store.alarms.isEmpty && !alarmSelectionActive` 안에서 `editorTarget = AlarmEditorTarget(id: UUID().uuidString, editingAlarmID: nil, familyAlarmMode: false)` 로 **편집기를 곧바로** 연다. `.create()` 팩토리조차 안 쓰고, 시트 호출도 권한 호출도 없다.
- iOS 빈 상태 카드: AlarmsListView.swift:213 `Task { await openCreateAlarm() }` → :257-276 `openCreateAlarm()`(AlarmKit 권한 확인·요청·굳은 거부 시 설정 이동) → :281-286 `presentCreateEntry()` → `familyRecipients.isEmpty` 아니면 :285 `wakeTargetSheetOpen = true` → :75-85 `WakeTargetSheet`, `onSelectRecipient` 에서 :84 `openEditor(.createFamily())`.
- 상호 배타 확인: FAB 는 `!store.alarms.isEmpty`(MainTabsView.swift:66), 빈 카드는 `if store.alarms.isEmpty { emptyAlarmCard }`(AlarmsListView.swift:119-120). 두 진입점이 동시에 존재할 수 없다.

【놓친 경로 없음 — 전수 grep】
`.swift` 전체에서 `wakeTargetSheetOpen`·`presentCreateEntry` 는 AlarmsListView.swift(:16, :75-85, :281-286)에만 있다. `AlarmEditorTarget.createFamily()`(Views/Auxiliary/AuxiliaryScreen.swift:42-44)의 호출처는 AlarmsListView.swift:84 **한 곳뿐**이다. `openEditor`/`editorTarget =` 전 호출처도 확인 — AlarmsListView.swift:80/84/139/283(+프리뷰 360/370)와 MainTabsView.swift:68/89(89는 `UIPreviewSeed.opensEditor` DEBUG 전용)/146 뿐. 편집기 안의 수신자 피커도 `if target.familyAlarmMode`(AlarmEditorSheet.swift:193-203) 로 막혀 있어, familyAlarmMode:false 로 열린 시트에서 상대 알람으로 전환할 길이 없다. 즉 알람이 1개라도 있으면 '누구를 깨울까요?' 시트에 닿는 경로가 앱에 존재하지 않는다.

【예외 아님】 AlarmKit 제약도 플랫폼 표준도 아니다. WakeTargetSheet.swift 는 이미 구현돼 있고 동작한다 — 단지 도달 불가일 뿐이라 CLAUDE.md 「iOS 는 안드로이드를 원본으로 삼는다」의 "다르면 iOS 가 틀린 것" 에 정면으로 걸린다.

【심각도 — 주장의 부차 논점은 과장】 "저장을 눌러서야 권한을 만난다" 는 사실이나, AlarmEditorSheet.swift:1403-1420 이 **TTS 생성보다 먼저** `refreshAuthorizationState()`/`requestAuthorization()` 을 돌리고 굳은 거부면 복구 안내 알럿을 띄운다(주석이 명시적으로 "결국 저장되지 않을 알람 때문에 목소리 생성 한도만 깎인다" 를 막는다고 적음). 한도 차감도 막다른 길도 없고, 편집기 왕복 낭비에 그친다. 따라서 P1 근거는 두 번째 논점이 아니라 **유료(커플/가족) 기능의 완전 도달 불가** 하나다.

【덤으로 발견한 추가 갈래 차이(주장에 없음)】 iOS `presentCreateEntry` 의 게이트는 `familyRecipients.isEmpty`(AlarmsListView.swift:282) 뿐인데, 안드로이드 `canCreateFamilyAlarm` 은 `hasCoupleOrFamilyAccess(subscriptionResponse, familyGroup)` 도 함께 본다(AlarmTalkApp.kt:631-633). iOS 는 저장 시점 `familyAlarmLocked`(AlarmEditorSheet.swift:1432-1438)로만 걸러서, 이용권 없는 사용자가 시트와 가족 편집기까지 들어간 뒤에야 "이용권이 필요해요" 를 만난다.

</details>

### ☐ [screens-flow] `consentUnsupported` 게이트가 iOS 에 없다 — 서버가 새 문서 버전을 요구하면 동의 화면에 갇힌다

**안드로이드**: apps/android-native/.../ui/app/AlarmTalkApp.kt:692-693 `blockingGateActive = updateRequired || consentUnsupported || pendingDeletion`, :876-890 — `updateRequired || consentUnsupported` 이면 `UpdateRequiredScreen` 으로 보낸다("둘 다 사용자가 할 수 있는 일이 업데이트뿐이라 같은 화면으로"). 설정 출처는 MainViewModelAuthActions.kt:699 `consentUnsupported = true`.

**iOS**: apps/ios-native/AlarmTalk/AuthViewModel.swift:842-859 `handleConsentVersionMismatch` 가 `consentUnsupported = true` 를 세우지만, **이 값을 읽는 뷰가 하나도 없다**(`grep -rn consentUnsupported AlarmTalk` → AuthViewModel.swift 이외 0건). Views/Root/RootView.swift:39-103 의 게이트 체인(updateRequired → 인증 → pendingDeletion → consentStatusChecked → showConsentScreen → voiceSetup)에도, :169-171 `blockingGateActive` 에도 빠져 있다. 게다가 AuthViewModel.swift:909-911 은 그 분기에서 `statusMessage` 없이 `return` 한다.

**사용자 영향**: 약관이 개정돼 서버가 새 `document_version` 을 요구하면(`POST /user/consents` 409), iOS 사용자는 동의 화면에서 '동의하고 시작하기' 를 눌러도 **아무 일도 일어나지 않는다.** 오류 문구도 업데이트 안내도 없고, 동의 화면 뒤로는 갈 수 없어 앱 전체가 잠긴다. 안드로이드는 같은 상황에서 업데이트 화면으로 보낸다.

**고칠 방향**: RootView 게이트 체인 맨 앞을 `versionGate.updateRequired || auth.consentUnsupported` 로 바꿔 `UpdateRequiredView` 를 띄우고, `blockingGateActive` 에도 같은 항을 넣는다(안드로이드 :692·:878 과 1:1).

<details><summary>반증 검증 결과</summary>

반증 실패 — 주장이 코드로 확인된다.

[1] iOS 게이트 부재 확인
- apps/ios-native/AlarmTalk/AuthViewModel.swift:154-155 `@Published private(set) var consentUnsupported = false`, :858 `consentUnsupported = true`.
- 소스 디렉터리(apps/ios-native/AlarmTalk, apps/android-native/app/src, packages) 전체 grep 결과 iOS 쪽 hit 는 위 3곳(154/155/858)뿐. 이 값을 읽는 뷰·수정자·게이트가 0건.
- Views/Root/RootView.swift:38-103 게이트 체인 = versionGate.updateRequired → !auth.isAuthenticated → auth.pendingDeletion → !auth.consentStatusChecked → auth.showConsentScreen → voiceSetupDone. consentUnsupported 없음.
- RootView.swift:169-171 `blockingGateActive = versionGate.updateRequired || !auth.isAuthenticated || auth.pendingDeletion || auth.showConsentScreen` — 역시 없음.

[2] 인용 줄번호는 1~2줄 어긋나지만 실체는 동일
- handleConsentVersionMismatch 는 843-860(주장 842-859). 침묵 return 은 :858-859(`consentUnsupported = true; return true`)이고 호출부는 :912 `if handleConsentVersionMismatch(error) { return }`. 주장이 든 909-911 은 실제로는 성공 경로의 marketing 토글 블록이라 위치 인용만 빗나갔고, "그 분기에서 statusMessage 없이 return" 이라는 내용은 그대로 참.

[3] 다른 경로가 처리하지 않음 (오히려 주장보다 나쁨)
- serverPolicyVersionHint 는 AuthViewModel.swift:789 에서 status.policyVersion 으로 실제 채워진다 → '서버가 앞선' 경우 :854 조건이 거짓이라 반드시 :858 로 떨어진다(우발적 폴백이 아님).
- showConsentScreen(:110-112 `needsConsent || consentNeedsCollection || !consentCollect.isEmpty`)은 성공 경로(:898-901)에서만 비워진다 → 실패 후 화면이 영구히 남는다.
- Views/Auth/ConsentView.swift(304줄)는 error/status 파라미터가 없고 `auth` 를 전혀 참조하지 않는다 → 형제 분기의 :855 statusMessage 조차 화면에 안 뜬다. CTA(:160-171)는 busy 동안 "처리 중…" 만 깜빡이고 끝. 이 화면에 로그아웃 등 탈출구 없음.
- 앱 레벨 alert 없음(RootView/AlarmTalkApp.swift 에 statusMessage 바인딩 없음; Views 전체 grep 상 auth.statusMessage 를 읽는 건 LoginView.swift:136, PasswordResetView.swift:70 뿐).
- AppVersionGate.swift:34-37 `updateRequired = appVersionCode >= 1 && appVersionCode < policy.minSupportedVersion` — 앱 버전코드만 본다. 정책 문서 버전으로는 절대 켜지지 않는다.
- 백엔드 packages/backend/src/routes/user.ts:356-367 은 document_version != CURRENT_POLICY_VERSION 이면 무조건 409 POLICY_VERSION_MISMATCH → 재동의뿐 아니라 구버전 빌드의 신규 가입 제출도 전부 걸린다(도달 경로가 이례적이지 않다).

[4] 안드로이드 근거 검증(모두 사실)
- AlarmTalkApp.kt:693 `viewModel.updateRequired || viewModel.consentUnsupported || viewModel.pendingDeletion`
- AlarmTalkApp.kt:878-890 `if (updateRequired || consentUnsupported) { GateBackGuard(); UpdateRequiredScreen(... 스토어 URL) ; return@Scaffold }` (주석 "둘 다 사용자가 할 수 있는 일이 업데이트뿐이라 같은 화면으로")
- MainViewModelAuthActions.kt:692-701 handleConsentVersionMismatch → :699 `consentUnsupported = true`. 형제 분기의 message 는 AlarmTalkApp.kt:86/321 스낵바로 실제 노출된다(iOS 는 그 대응도 없음).

[5] 예외 해당 없음 / 심각도 타당
- AlarmKit 제약과 무관하고, 플랫폼 표준 예외도 아니다 — iOS 에 이미 UpdateRequiredView.swift 가 있고 RootView.swift:39-43 에서 같은 방식으로 쓰고 있다. 즉 재사용만 하면 되는데 연결이 빠졌다.
- 결과: 서버 CURRENT_POLICY_VERSION 이 앞선 순간, 구버전 iOS 사용자는 동의 화면에서 CTA 를 눌러도 오류 문구·업데이트 안내 없이 아무 일도 안 일어나고 앱 전체가 잠긴다. 침묵 + 전면 잠금 + 인앱 복구 경로 없음 → P1 유지.

부수 관찰(주장에 없던 것): AuthViewModel.swift:845-848 은 `status == 409` 만으로도 버전 오류로 판정해 안드로이드(MainViewModelAuthActions.kt:692, 코드 문자열만 매칭)보다 넓다. 현재 이 라우트의 409 는 정책 불일치뿐이라 실害는 없지만, 향후 409 가 추가되면 같은 침묵 잠금으로 빨려 들어간다.

</details>

### ☑ [screens-flow] 무료 전환 시 iOS 는 목소리 알람을 **삭제**한다 — 안드로이드는 사운드온리로 잠그고 행에 안내를 남긴다

**안드로이드**: apps/android-native/.../ui/main/MainViewModelBillingActions.kt:528-548 — 주석이 정책을 못 박는다: "무료 전환 시 유료 목소리/알람 데이터를 삭제하지 않고, 기존 유료 목소리 알람을 사운드온리로 '잠근다'(preLockPlayMode 에 원래 모드 보관). 다시 유료가 되면 그대로 복원한다"(`lockPaidAlarmTalks` / `restorePaidVoiceAlarmsIfLocked`). 목록에서는 행이 남고 ControlsAndPermissions.kt:583-595 `alarmRowNotice` 가 '무료 요금제로 기본 알람 전환' 안내를 정보색으로 붙이며, AlarmListScreen.kt:292-297 이 그때 목소리 이름을 감춘다.

**iOS**: apps/ios-native/AlarmTalk/SocialFeatureViewModel.swift:416-432 `applyFreePlanVoiceLock` — `alarmStore.paidAlarmTalks()` 를 돌며 `alarmKit.cancel(record:store:)` 를 호출한다. AlarmKitViewModel.swift:476-492 `cancel` → `deleteLocalAlarm` → `store.delete(record)` + 캐시 오디오 삭제로 **행이 사라진다**. 안내는 :433-439 의 스낵바 한 줄("무료 이용권으로 전환되어 목소리 알람을 삭제했어요.")뿐이고, AlarmRow.swift:211-220 의 `warningText` 에는 강등 안내 갈래가 아예 없다.

**사용자 영향**: 구독이 만료되거나 공유 이용권이 끊기는 순간 iOS 사용자의 목소리 알람이 **통째로 사라진다.** 안드로이드 사용자는 같은 상황에서 알람이 기본 알람음으로 계속 울리고, 다시 결제하면 원래 목소리로 복원된다. iOS 사용자는 재결제해도 알람을 처음부터 다시 만들어야 하고, 그 사이 내일 아침 알람이 없다.

**고칠 방향**: `LocalAlarmRecord` 에 `preLockPlayMode` 를 추가하고(서버 계약은 그대로), `applyFreePlanVoiceLock` 을 삭제 대신 `playMode = .alarmOnly` 로 잠그고 재무장하는 경로로 바꾼다. AlarmRow 의 `warningText` 에 안드로이드 `alarmRowNotice` 의 두 갈래(무료 강등 / 공유 해제)를 정보색으로 추가하고, 유료 복귀 시 복원(`restorePaidVoiceAlarmsIfLocked` 대응)을 함께 넣는다.

<details><summary>반증 검증 결과</summary>

반증 실패 — 인용된 줄이 전부 실제로 존재하고 주장대로다. 오히려 주장이 놓친 근거가 더 나왔다.

**1. 인용 검증 (전부 정확)**
- `apps/ios-native/AlarmTalk/SocialFeatureViewModel.swift:419-431` — `applyFreePlanVoiceLock` 이 `alarmStore.paidAlarmTalks()` 를 돌며 `await alarmKit.cancel(record:store:)` 호출. 주장대로다.
- `apps/ios-native/AlarmTalk/AlarmKitViewModel.swift:476-492` — `cancel` → `deleteLocalAlarm`(478/482) → `store.delete(record)` + `audioCache.deleteCachedAudio`(489-490). 행이 실제로 사라진다.
- `apps/ios-native/AlarmTalk/LocalAlarmStore.swift:214-226` — `delete` 가 `alarms.remove(at:)` + `persist()`. 로컬 영속 삭제 확정.
- `apps/ios-native/AlarmTalk/SocialFeatureViewModel.swift:434-438` — 안내는 스낵바 한 줄 "무료 이용권으로 전환되어 목소리 알람을 삭제했어요." 뿐.
- `apps/ios-native/AlarmTalk/Views/Alarms/AlarmRow.swift:211-220` — `warningText` 는 `.failed` 갈래 하나뿐, 강등 안내 갈래 없음. (주장의 경로 `AlarmRow.swift` 는 실제로 `Views/Alarms/` 아래)
- 안드로이드 `MainViewModelBillingActions.kt:528-530` 주석 + `:531` `applyFreePlanVoiceLock` → `:538` `repository.lockPaidAlarmTalks`, `:550-553` `restorePaidVoiceAlarmsIfLocked` → `unlockPaidAlarmTalks`. 잠금·복원 확정.
- `ControlsAndPermissions.kt:583-595` `alarmRowNotice` 의 `preLockPlayMode != null` 두 갈래(`common_alarm_notice_free_downgraded` / `..._default_converted`, `isError = false`), `AlarmListScreen.kt:290-293` 이 `preLockPlayMode == null` 일 때만 목소리 이름 표시. 전부 주장대로.

**2. 주장이 놓친 경로 — 인정 근거를 오히려 강화한다**
iOS 에는 `apps/ios-native/AlarmTalk/PaidVoiceGate.swift` 가 있고, `AlarmKitViewModel.swift:269-270`·`427-428` 에서 **예약 시점 비파괴 강등**을 한다. 그런데 그 파일의 자체 주석이 지금 정책과 정반대다: `PaidVoiceGate.swift:82` "강등된 형태 — **알람은 그대로 울린다.**", `:85` "⚠ 이 값을 store 에 쓰지 **않는다** … 저장해 버리면 구독을 되살렸을 때 되돌릴 원본이 사라진다." 즉 iOS 안에 안드로이드 파리티 정책(PaidVoiceGate)과 파괴적 경로(applyFreePlanVoiceLock)가 **동시에** 있고, 후자가 행을 통째로 지워 먼저 이기므로 PaidVoiceGate 는 `localOwned` 무료전환 건에 대해 강등할 대상이 남지 않는다.

**3. 결정적 증거 — 주석이 안드로이드가 이미 지운 함수를 베끼고 있다 (CLAUDE.md 가 경고한 그 함정)**
- `SocialFeatureViewModel.swift:416` "Android `MainViewModelGrowthBillingActions.applyFreePlanVoiceLock` equivalent" → **그런 파일 없다**(`ui/main/` 에는 `MainViewModelBillingActions.kt` 뿐). 실제 함수는 잠근다.
- `LocalAlarmRecord.swift:102` "Android `AlarmRepository.deletePaidAlarmTalks` 의 `usesVoice && !stockVoiceOnly` 동일" → `deletePaidAlarmTalks` 는 **현재 안드로이드에 존재하지 않는다**(grep 0건). `git log -S deletePaidAlarmTalks` 로 제거 커밋 확인: **`4d28f1d8` "무료 전환 시 유료 목소리 알람을 삭제 대신 사운드온리로 잠금(재유료 복원)"**. iOS 는 정책 변경 **이전**의 안드로이드를 미러하고 있다.

**4. 복구 불가 확인**
- iOS 에 `preLockPlayMode` 상당 필드 없음(grep 0건), `restorePaid`/`unlockPaid` 상당 경로 없음(`apps/ios-native/` 전체 grep 0건) → 재결제해도 복원 갈래 자체가 없다.
- 서버 pull 도 못 살린다: `RemoteAlarmPullSync.swift:215-221` "대기 중 지워졌다 — **되살리지 않는다.**", 재구성·재예약 분기는 전부 `.receivedRemote` 게이트(`:232`, `:251`, `:331`, `:413`, `:468`). 삭제된 `localOwned` 행은 재임포트 경로가 없다.

**5. CLAUDE.md 예외 아님**
AlarmKit 제약은 "발사 시점에 우리 코드가 안 돈다" 뿐이고, 그래서 만든 해법이 바로 예약 시점 비파괴 강등(`PaidVoiceGate.downgraded`)이다 — 즉 **iOS 에서도 비파괴 강등이 가능함을 같은 코드베이스가 증명**한다. 삭제는 AlarmKit 이 강요하는 게 아니다. 플랫폼 표준 알럿 예외와도 무관.

**6. 심각도 — 과장 아님, 다만 범위는 좁다**
완화 요인: 대상은 `LocalAlarmStore.swift:59` 의 `originEnum == .localOwned` 뿐이라 공유받은 알람은 안전하고, `LocalAlarmRecord.swift:101-109` 가 무료 스톡 보이스(`stockVoiceOnly`/`isStockVoiceClip`/`isGeneratedFreeSystemPresetVoice`)를 제외한다. 트리거도 `AlarmTalkApp.swift:301-312` 가 세션·디스크로드·`hasLoadedEntitlements`·`subscription != nil` 로 가드하고 `PlanTier.bestKnown` 을 쓴다.
그럼에도 발동하면 본인 소유 유료 목소리 알람이 **오디오 캐시까지 영구 삭제**되고, 사라지는 것은 목소리가 아니라 **기상 시각을 포함한 알람 행 자체**다. 안드로이드는 같은 상황에서 기본 톤으로 계속 울리고 재결제 시 복원된다. 조용한 영구 사용자 데이터 손실 + 문서화된 정책 정면 위반 → P1 유지.

</details>

### ☑ [voice-save] 무료 전환 시 iOS 는 목소리 알람을 **삭제**한다 — 안드로이드는 잠갔다가 유료 복귀 시 복원한다

**안드로이드**: apps/android-native/.../data/AlarmRepository.kt:807-850 `lockPaidAlarmTalks` — 알람을 지우지 않고 `preLockPlayMode = alarm.playMode` 로 원래 재생모드를 보관한 뒤 `playMode = ALARM_ONLY` 로 내리고 사운드온리로 재예약한다. 캐시 오디오·voiceProfileId·ttsMessageId 는 전부 보존. :860-878 `unlockPaidAlarmTalks` 가 재유료 시 `preLockPlayMode` 로 되돌린다. 호출부 ui/main/MainViewModelBillingActions.kt:531-547(lock, `expectedOwnerUserId` 로 계정 바뀜 가드) / :550-558(unlock). 저장 필드는 data/AlarmEntity.kt:76 `preLockPlayMode`, :80 `ownerUserId`.

**iOS**: apps/ios-native/AlarmTalk/SocialFeatureViewModel.swift:416-439 `applyFreePlanVoiceLock` — 주석은 "Android applyFreePlanVoiceLock equivalent" 라고 적혀 있지만 실제로는 `alarmStore.paidAlarmTalks()` 전부를 `alarmKit.cancel(record:store:)` 로 돌린다. AlarmKitViewModel.swift:476-492 `cancel` → `deleteLocalAlarm` → `store.delete(record)` + `audioCache.deleteCachedAudio(cacheKey:)` — **행과 음원을 함께 영구 삭제**한다. 안내 문구도 SocialFeatureViewModel.swift:434-439 "무료 이용권으로 전환되어 목소리 알람을 삭제했어요." 로 삭제를 전제한다. 호출부 AlarmTalkApp.swift:299-318 은 `currentPlan.meetsOrExceeds(.personal)` 이 아니면 무조건 실행. 복원 경로는 존재하지 않는다(`preLockPlayMode` 필드 자체가 LocalAlarmRecord.swift:6-55 에 없음). 안드로이드에 있는 `ownerUserId` 소유자 가드도 없어 같은 기기에서 계정을 바꾸면 앞 계정 알람까지 지운다.

**사용자 영향**: 구독이 만료·해지되거나 서버 구독 스냅샷이 잠깐 무료로 읽히는 순간, 사용자가 만든 목소리 알람이 **통째로 사라진다.** 시각·반복·문구·목소리 선택이 전부 없어지고 다시 결제해도 돌아오지 않는다(안드로이드는 재결제하면 그대로 되살아난다). 알람 앱에서 "내일 아침 알람이 없어졌다" 는 가장 무거운 실패다.

**고칠 방향**: `LocalAlarmRecord` 에 `preLockPlayMode`(+`ownerUserId`)를 추가하고, `applyFreePlanVoiceLock` 을 삭제가 아니라 잠금으로 바꾼다 — 원래 `playMode` 를 `preLockPlayMode` 에 적고 `playMode = .alarmOnly` 로 내려 재예약, 음원 캐시는 남긴다. 유료 복귀 시 `unlockPaidAlarmTalks` 에 해당하는 복원 경로와, 안드로이드의 `expectedOwnerUserId` 가드를 함께 이식할 것. 문구도 '삭제했어요' → '잠갔어요' 로 바꾼다.

<details><summary>반증 검증 결과</summary>

반증 실패 — 코드로 확인됨. 인용된 파일:줄이 모두 실재하고 주장대로다.

**1) 인용 검증**
- 안드로이드 잠금(삭제 아님): `AlarmRepository.kt:807` `suspend fun lockPaidAlarmTalks(expectedOwnerUserId)`, `:836-837` `preLockPlayMode = if (needsLock) alarm.playMode …` / `playMode = … ALARM_ONLY`, `:831` `ownedByCurrentSession(...)` 소유자 가드, `:860` `unlockPaidAlarmTalks` 가 `preLockPlayMode` 로 복원. 행·`voiceProfileId`·`ttsMessageId`·캐시 오디오 모두 보존. 필드는 `AlarmEntity.kt:76 preLockPlayMode`, `:80 ownerUserId`. 호출부 `MainViewModelBillingActions.kt:531`, `AlarmTalkApp.kt:504`.
- iOS 삭제: `SocialFeatureViewModel.swift:419-431` — 주석은 "Android applyFreePlanVoiceLock equivalent"(`:416`)인데 실제로는 `:424 alarmStore.paidAlarmTalks()` 전부를 `:426 await alarmKit.cancel(record:store:)`. `AlarmKitViewModel.swift:476-486 cancel` → `:488-492 deleteLocalAlarm` → `LocalAlarmStore.swift:214-226 delete()`(배열에서 제거 + `persist()`) + `audioCache.deleteCachedAudio`. 문구 `SocialFeatureViewModel.swift:437` "…목소리 알람을 삭제했어요." 호출부 `AlarmTalkApp.swift:174 → :300-318`.
- 복원 경로 부재 확인: `LocalAlarmRecord.swift:7-55` 에 `preLockPlayMode`·`ownerUserId` 필드 없음(`ownerUserId` 는 `AlarmTalkAPIModels.swift:620` API 모델뿐). pull 은 **받은 알람만** 되살린다 — `RemoteAlarmPullSync.swift:139-151` 이 `isReceivedRemoteCandidate` 로 거른 `receivedRemoteAlarms` 만 머지하므로 `localOwned` 로 삭제된 행은 서버에 남아도 **영영 다시 안 내려온다.** `AuthViewModel.swift:1061-1091 signOut` 은 alarmStore 를 건드리지 않아 로컬 알람이 계정 전환 후에도 남는다(안드로이드가 `ownerUserId` 가드를 둔 바로 그 상황).

**2) 놓친 경로 — 오히려 주장보다 나쁘다**
- iOS 자신의 비파괴 게이트가 이미 있고, 이 삭제 코드와 **정면으로 모순**된다: `PaidVoiceGate.swift:80-92` `downgraded()` 는 `playMode` 만 `alarmOnly` 로 내리고 주석에 "⚠ 이 값을 store 에 쓰지 **않는다** … 저장해 버리면 구독을 되살렸을 때 되돌릴 원본이 사라진다" 라고 적혀 있다(`AlarmKitViewModel.swift:427-443`, `:269-275` 에서 예약·폴백 시점 사용). 즉 울림 차단은 이미 비파괴로 끝나 있고, `applyFreePlanVoiceLock` 의 삭제는 중복이면서 그 원칙을 깬다.
- 게이트 폭도 안드로이드보다 훨씬 넓다. 안드로이드는 3중 조건(`AlarmTalkApp.kt:498-502`: `!hasPaidVoiceAccess` **AND** `!hasCoupleOrFamilyAccess(subscriptionResponse, familyGroup)` **AND** `plan==free`)인데, iOS `AlarmTalkApp.swift:307-312` 는 `PlanTier.bestKnown(serverSubscription:storeTier:userPlan:)`(`PlanGateDialog.swift:96-111`) 만 본다. `bestKnown` 은 `serverSubscription != nil` 이면 `userPlan` 을 후보에서 빼고, `subscription?.status == "active"` 일 때만 plan 을 후보에 넣는다. 백엔드 `billing-query.ts:47-71` 은 **본인 명의 active 구독이 없으면 `subscription: null`** 을 준다 — 그래서 (a) 결제자가 아닌 **가족/커플 초대 멤버**(그룹으로 정당하게 유료), (b) `ON_HOLD/PAUSED` 같은 회복형 상태(`PaidVoiceGate.swift:113-116` 은 이를 유효로 본다)가 모두 `.free` 로 판정돼 **알람이 삭제**된다. 안드로이드는 두 경우 모두 잠그지조차 않는다.
- 다만 `AlarmTalkApp.swift:301-306` 에 `session != nil` / `hasLoadedFromDisk` / `hasLoadedEntitlements` / `subscription != nil` 가드는 있으므로 "무조건 실행" 은 과장이다(초기 로딩 순간의 오삭제는 막힌다). 위 (a)(b) 경로가 남는다는 점에서 결론은 그대로다.

**3) 주장 중 부정확한 한 대목**
"안드로이드는 재결제하면 그대로 되살아난다" 는 절반만 맞다. `restorePaidVoiceAlarmsIfLocked` 는 `MainViewModelBillingActions.kt:550` 에 정의만 있고 `app/src` 어디에서도 **호출되지 않는다**(`unlockPaidAlarmTalks` 도 정의 `:860` 과 주석 `AlarmRepository.kt:84,378`·`RemoteAlarmPullSyncService.kt:454` 뿐). `AlarmTalkApp.kt:493-495` 주석도 '영구 변환' 이라고 적는다. 그러나 핵심 차이는 그대로다 — 안드로이드는 **행이 살아 있어 시각·반복·문구·목소리 참조·캐시 오디오가 전부 남고 기본음으로 계속 울린다**. iOS 는 행 자체가 사라져 알람이 목록에서 없어진다.

**4) 예외 해당 여부 / 심각도**
CLAUDE.md 가 인정하는 예외 아님. AlarmKit 제약은 울림 화면·알람 음량 슬라이더에 한정되고, 실제로 iOS 는 `AlarmKitViewModel.swift:427-443` 에서 강등된 사운드로 재예약할 수 있음을 스스로 증명한다. 플랫폼 표준도 아니다. 심각도 과장 아님 — 사용자가 만든 알람 행과 캐시 음원이 **조용히 영구 삭제**되고, 서버 사본은 `localOwned` 라 다시 내려오지 않으며, 정당한 가족 멤버와 회복형 구독 상태에서도 발동한다. P1 유지.

</details>


## P2 (19건)

### ☐ [dead-code] 안드로이드가 의도적으로 걷어낸 '이용권 선물하기' 결제 UI 가 iOS 에만 살아 있다 (안드로이드 쪽에는 문자열 잔재 2개가 남았다)

**안드로이드**: apps/android-native/.../ui/main/MainViewModelBillingActions.kt:299-301 — "이용권 '선물' 결제는 UI 가 없다(선물은 GIFT- 코드 등록/공유 경로로만 쓴다). 남아 있던 gift 인자와 그 분기를 걷었다 — 두 호출부 모두 기본값(false)으로만 불렀다." network/BillingApi.kt:126-162 에도 gift 갈래가 없다. 그 흔적으로 res/values/strings.xml:383 `msg_gb_gift_failed`, :405 `msg_gb_plan_gift_available` 이 코드 참조 0건으로 남아 있다.

**iOS**: apps/ios-native/AlarmTalk/Views/Settings/BillingPanelComponents.swift:234-243 — 개인 티어 카드에 '개인 이용권 선물하기' 버튼이 있고, :486 `PersonalGiftPassSheet`(:512 '선물 코드 만들기')가 뜬다. Views/Settings/BillingPanel.swift:88 이 onGiftPersonal 을 연결하고, SocialFeatureViewModel.swift:292-296 이 결과를 처리한다. 호출 경로는 AlarmTalkAPI.swift:504-516 의 `POST /billing/checkout` gift:true (주석: '여기는 선물 코드를 만드는 것뿐이다').

**사용자 영향**: 같은 '이용권' 화면인데 iOS 에만 결제 버튼이 하나 더 있다. 안드로이드 사용자는 선물 코드를 받아서 등록만 할 수 있고, iOS 사용자는 발급까지 할 수 있다 — 같은 제품이 플랫폼마다 다른 상품 구성을 보여준다.

**고칠 방향**: 판정: 결정이 필요하다. 'iOS 는 안드로이드를 원본으로 삼는다' 규약대로면 iOS 에서 지워야 한다 — BillingPanelComponents.swift:234-243, :486-524(PersonalGiftPassSheet), BillingPanel.swift:88 의 onGiftPersonal 배선, SocialFeatureViewModel 의 giftPersonalPass 갈래, AlarmTalkAPI.swift:504-516. 반대로 되살릴 거면 안드로이드에 같은 버튼을 붙이고 잔재 문자열 msg_gb_gift_failed·msg_gb_plan_gift_available 을 다시 연결한다(어느 쪽이든 지금처럼 한쪽만 두지는 않는다).

<details><summary>반증 검증 결과</summary>

핵심 사실은 코드로 확인된다 — 반증 실패. 다만 성격 규정("결제 UI")과 사용자 영향은 과장돼 있어 심각도를 낮춘다.

■ 인용 검증 (전부 실재, ±1줄 오차만)
- apps/android-native/app/src/main/java/com/alarmtalk/app/ui/main/MainViewModelBillingActions.kt:299-301 — 주석 문구 그대로. :301 `internal fun MainViewModel.checkoutPlan(planKey: String)` 에 gift 인자 없음.
- .../network/BillingApi.kt:61-63 `data class CheckoutRequest(@SerializedName("plan_key") val planKey: String)` — gift 필드 없음. :131-136 `@POST("billing/checkout")` 도 gift 갈래 없음.
- .../res/values/strings.xml:383 `msg_gb_gift_failed`, :405 `msg_gb_plan_gift_available` — `grep -rn gift --include=*.kt app/src` 결과 참조 0건(빌드 산출물 build/ 만 히트).
- apps/ios-native/AlarmTalk/Views/Settings/BillingPanelComponents.swift:234 `if tier == .personal {` → :235-236 `Button(action: onGiftPersonal) { Label("개인 이용권 선물하기", systemImage: "gift") }`, :243 닫힘. :485 `struct PersonalGiftPassSheet`(주장은 486, 1줄 오차), :512 "선물 코드 만들기".
- Views/Settings/BillingPanel.swift:88 `onGiftPersonal:`, :197-204 `.sheet` → :260-274 `giftPersonalPass()`.
- SocialFeatureViewModel.swift:279-300 `giftPersonalPass` (주장의 292-296 은 성공 메시지+catch 구간).
- AlarmTalkAPI.swift:514-520 `createGiftVoucher` → `CheckoutRequest(planKey: planKey, gift: true)`(gift:true 는 :519, 주장의 504-516 범위 밖 1줄 오차).
→ 안드로이드에는 선물 발급 UI가 없고 iOS 에만 있다. CLAUDE.md 예외 둘(AlarmKit 제약 / 플랫폼 표준 alert) 어디에도 해당하지 않으므로 규약상 iOS 가 틀린 것이 맞다.

■ 주장이 틀린 부분 (심각도 하향 근거)
1) '결제' 가 아니다. packages/backend/src/routes/billing-mutation.ts:305-317 의 gift 갈래는 돈을 받지 않고 voucher 코드만 발급하며 응답은 `checkout_stub: true`(:330-338).
2) '발급까지 할 수 있다' 는 프로덕션에서 거짓. billing-mutation.ts:101-108 `isBillingStubEnabled` 가 `ENVIRONMENT === 'production'` 이면 무조건 false, :251-254 에서 409 `CHECKOUT_DISABLED`. iOS 기본 baseURL 은 프로덕션이다(AlarmTalkAPI.swift:880 `https://api.alarm-talk.com/api`). 즉 실제 증상은 "상품 구성이 다르다" 가 아니라 "항상 실패하는 버튼이 iOS 에만 있다".
3) 안드로이드는 스텁 전용 UI 를 플레이버로 숨긴다 — ui/billing/BillingPanels.kt:596-600 `val changePlanSupported = BuildConfig.FLAVOR == "dev"` (주석: "운영 Play 결제에서는 CHECKOUT_DISABLED 로 항상 실패하므로"). iOS 선물 버튼에는 이런 게이트가 없다 — 이게 진짜 갈라진 지점이다.
4) 실패 문구도 갈라진다. iOS SocialFeatureViewModel.swift:315-330 `billingFailureMessage` 에 `CHECKOUT_DISABLED` 케이스가 없어 기본 폴백("선물하기에 실패했어요", :304)으로 떨어진다. 안드로이드는 MainViewModelBillingActions.kt:132 에서 전용 문자열로 매핑한다.

■ 주장이 놓친 것 (오히려 더 나쁜 축)
- 카피까지 갈라져 있다: BillingPanelComponents.swift:336 `case .personal: return "내 목소리 만들기, 광고 제거, 개인 이용권 선물"`, :347 `case .personal: return ["목소리", "음성 메시지", "개인 이용권 선물"]`. 안드로이드 개인 플랜 기능은 strings.xml:99-100 (`원하는 목소리 1개 등록` / `날씨·운세 등 매일 다른 문구`) 둘뿐이고 선물이 없다. 게다가 :343-344 주석은 "Android `billing_plan_*_feature_*` 문자열과 1:1" 이라고 적혀 있는데 사실이 아니다 — 「주석의 안드로이드 미러 주장을 믿지 말 것」 사례가 하나 더 늘었다. 버튼보다 이쪽이 규약 위반("없는 기능을 광고")에 더 가깝다.
- 안드로이드 잔재는 2개가 아니라 3개다: strings.xml:748 `msg2_billing_fail_gift_personal_only` 가 MainViewModelBillingActions.kt:131 에서 아직 매핑돼 있는데, 안드로이드는 gift 요청을 보낼 수 없으므로 서버가 그 코드를 돌려줄 경로가 없다(billing-mutation.ts:290-295 는 `gift && planType !== 'personal'` 일 때만 낸다).

■ 심각도
P1 급 표현("같은 제품이 플랫폼마다 다른 상품 구성")은 과장이다 — 프로덕션에서 두 플랫폼 다 선물 발급이 불가능하고(서버 fail-closed), iOS 는 아직 App Store 에 없다(CLAUDE.md). 데이터 손실·보안 이슈도 아니다. 다만 (a) 출시 빌드에서 항상 실패하는 버튼이 이용권 화면에 노출되고 (b) 플랜 기능 목록이 없는 기능을 광고하며 (c) 심사 경로에 그대로 놓인다 — 단순 미관이 아니므로 P2 가 맞다. 조치는 iOS 에서 선물 버튼·시트·`createGiftVoucher`·기능 카피(:336, :347)를 걷고, 안드로이드 잔재 3종(strings.xml:383, :405, :748 + MainViewModelBillingActions.kt:131)도 함께 정리하는 것.

</details>

### ☑ [modals] 「누구를 깨울까요?」 시트에서 고른 수신자가 버려진다 — iOS 는 항상 첫 번째 구성원에게 알람이 간다

**안드로이드**: apps/android-native/.../ui/app/AlarmTalkApp.kt:779-812 — WakerSelectionSheet(title=alarms_target_sheet_title "누구를 깨울까요?")의 수신자 행이 807줄 `startCreateAlarm(familyTargetMode = true, targetUserId = recipient.userId)` 로 **누른 사람의 userId 를 편집기 라우트에 실어 보낸다**. 편집기는 AlarmEditorScreen.kt:892 에서 그 값을 targetUserId 로 저장·생성에 쓴다.

**iOS**: apps/ios-native/AlarmTalk/Views/Alarms/AlarmsListView.swift:82-85 — `onSelectRecipient: { _ in wakeTargetSheetOpen = false; openEditor(.createFamily()) }` 로 **인자를 `_` 로 버린다**. Views/Auxiliary/AuxiliaryScreen.swift:41-44 의 `AlarmEditorTarget.createFamily()` 에는 targetUserId 파라미터 자체가 없다. 편집기는 Views/Editor/AlarmEditorSheet.swift:1278-1287 `selectDefaultFamilyRecipientIfNeeded()` 에서 `familyRecipients.first` 를 자동 선택한다.

**사용자 영향**: 가족·커플 구성원이 2명 이상일 때 시트에서 '아빠' 를 눌러도 편집기에는 목록 첫 번째 사람(예 '엄마')이 수신자로 잡힌다. 사용자는 시트에서 골랐다고 믿고 저장하므로 엉뚱한 사람 폰에서 알람이 울린다. 안드로이드가 각 행에 '받지 않는 시간' 까지 붙여 막으려던 사고가 그대로 난다.

**고칠 방향**: `AlarmEditorTarget.createFamily(targetUserId:)` 로 수신자 id 를 받게 하고 AlarmsListView 의 onSelectRecipient 가 `recipient.userId` 를 넘긴다. AlarmEditorSheet 는 target 에 id 가 있으면 `selectDefaultFamilyRecipientIfNeeded()` 대신 그 id 를 그대로 선택하고, id 가 없을 때만 기존 폴백을 탄다.

<details><summary>반증 검증 결과</summary>

반증 실패 — 인용된 코드가 전부 주장대로다. 다만 주장이 놓친 완화 경로가 하나 있어 심각도는 낮춘다.

**1. 인용 검증(모두 실재·주장대로)**
- iOS `apps/ios-native/AlarmTalk/Views/Alarms/AlarmsListView.swift:75-88` — `WakeTargetSheet(recipients: familyRecipients, onSelectSelf: {...}, onSelectRecipient: { _ in wakeTargetSheetOpen = false; openEditor(.createFamily()) })`. 82줄에서 인자를 `_` 로 **실제로 버린다**. 시트 쪽(`Views/Alarms/WakeTargetSheet.swift:33-36`)은 `onSelectRecipient(recipient)` 로 누른 사람을 **제대로 넘기고 있다** — 받는 쪽에서만 버린다.
- `Views/Auxiliary/AuxiliaryScreen.swift:27-44` — `AlarmEditorTarget` 의 저장 프로퍼티는 `id / editingAlarmID / familyAlarmMode` 셋뿐이고 `createFamily()` 는 `create(familyAlarmMode: true)` 를 부를 뿐이다. **targetUserId 를 실어 보낼 통로 자체가 없다.**
- `Views/Editor/AlarmEditorSheet.swift:1310-1319` — `selectDefaultFamilyRecipientIfNeeded()` 가 유효한 선택이 없으면 `familyRecipients.first` 를 고른다. 호출 지점은 `:383-385`(onAppear), `:1080`(신규 알람 초기화) 둘. 편집기의 `familyRecipients`(`:1045-1053`)는 AlarmsListView 의 것(`:90-97`)과 **필터·순서가 완전히 동일**하므로 시트 목록의 첫 행이 그대로 자동 선택된다.
- 안드로이드 대조도 주장대로다: `AlarmTalkApp.kt:807` `startCreateAlarm(familyTargetMode = true, targetUserId = recipient.userId)` → `AlarmTalkAppHelpers.kt:83-85` 라우트 인자 → `AlarmTalkApp.kt:1114,1130` `initialFamilyRecipientId = targetUserId` → `ui/editor/AlarmEditorScreen.kt:249-256` (`initialFamilyRecipientId?.takeIf{유효} ?: familyRecipients.firstOrNull()`, 주석: "시트에서 사람을 미리 골라 들어온 경우 그 사람으로 연다") → `:892` 저장 시 `targetUserId`.
→ **iOS 만 이 사슬이 끊겨 있다. 규약상 "다르면 iOS 가 틀린 것" 에 정확히 해당한다.**

**2. 주장이 놓친 경로(심각도 하향 근거)**
iOS 편집기에는 안드로이드에 **없는** 수신자 피커가 있다: `AlarmEditorSheet.swift:193-206` 이 `familyAlarmMode` 일 때 "알람 받을 사람" 섹션 + `FamilyAlarmTargetPicker` 를 그리고, `Views/Editor/AlarmEditorComponents.swift:243-303` 이 구성원 전원을 체크마크·이름·이메일로 나열하며 선택 시 `selectFamilyRecipient`(`AlarmEditorSheet.swift:1376`)로 바뀐다. 게다가 선택자 아래에 `받지 않는 시간`(`:266`)과 차단 상태(`:259-265`)까지 붙는다. 저장은 그 시점의 `selectedFamilyRecipient` 를 쓴다(`:1486`, `:1835`).
반대로 안드로이드 편집기에는 피커가 **없다** — `grep 'selectedFamilyRecipientId ='` 결과 대입 지점 0개이고, 값은 `:249` 의 `remember` 초기값으로 고정, 수신자는 저장 버튼 라벨(`:1488-1491` `EditorActionButtons(recipientName=...)`)로만 보인다.
따라서 "**항상** 첫 번째 구성원에게 알람이 간다"는 과장이다. 정확히는 "**편집기가 엉뚱한 사람으로 프리셀렉트되어 열리고, 사용자가 편집기 안 피커에서 다시 고르지 않으면 그 사람에게 간다**" 이다. 오배송 위험은 실재하지만 화면상 되돌릴 길과 표시가 있다.

**3. CLAUDE.md 예외 여부: 해당 없음.** AlarmKit 제약(울림 화면·알람 음량)과도, 플랫폼 표준 알럿과도 무관한 순수 상태 전달 누락이다.

**4. 결론:** 결함 자체는 코드로 확인됨(반증 불가). 다만 "선택이 통째로 버려져 복구 불가" 가 아니라 "프리셀렉트가 틀림 + 편집기 내 피커로 복구 가능" 이므로 P1 이 아니라 **P2**. 수정은 `AlarmEditorTarget` 에 `familyTargetUserId` 를 추가해 `createFamily(_:)` 로 실어 보내고, `selectDefaultFamilyRecipientIfNeeded()` 가 `familyRecipients.first` 앞에 그 값을 유효성 검사 후 우선 적용하면 된다(안드로이드 `AlarmEditorScreen.kt:253-254` 와 동일한 형태).

</details>

### ☐ [modals] 목소리 삭제 확인이 시스템 알럿이 아니라 커스텀 시트이고, 안드로이드에 없는 '사용 중인 알람도 함께 정리' 토글이 붙어 있다

**안드로이드**: apps/android-native/.../ui/voices/VoiceProfileManagementComponents.kt:124-149 `VoiceProfileDeleteDialog` = IosAlertDialog(title=`voicesr_delete_dialog_title` "목소리 삭제", message="'%s' 목소리를 삭제할까요?" + \n + "이 목소리를 쓰는 알람은 기본 알람음으로 바뀌어요. 저장된 음원 파일도 함께 삭제돼요.", actions=[닫기, 삭제(destructive)]). 토글 없음. 월 한도 소진 시에는 VoiceProfileManagementPanel.kt:2192-2214 에서 아예 다른 알럿(title "정말 삭제할까요?", message `voices_delete_quota_message`, actions [취소, 삭제(destructive)])으로 갈아탄다.

**iOS**: apps/ios-native/AlarmTalk/Views/Voices/VoiceProfileManagementPanel.swift:148-170 `.sheet(item: $deleteTarget)` → Views/Voices/VoiceProfileManagementComponents.swift:19-73 커스텀 시트. 49-56줄 `Toggle(isOn: $force)` "사용 중인 알람도 함께 정리 / 기본 알람음으로 강등돼요·사용 중이면 삭제하지 않아요", 그리고 ⋮ 메뉴 삭제는 같은 패널 117줄 `deleteForce = true` 로 강제 on. 본문도 다르다(39줄 "이 목소리를 쓰는 메시지는 텍스트만 남고, 알람은 기본 알람음으로 바뀌어요."). 월 한도 소진은 42-47줄에서 붉은 한 줄만 덧붙일 뿐 제목이 바뀌지 않는다.

**사용자 영향**: 삭제 확인이 앱의 다른 확인 모달과 전혀 다른 모양으로 뜨고, 안드로이드에 없는 선택지(force 토글)를 사용자가 판단해야 한다. 진입 경로(⋮ vs 행)마다 토글 초기값이 달라 같은 버튼이 어떤 때는 지우고 어떤 때는 안 지운다. 한도 소진 사용자는 '이번 달엔 다시 못 만든다' 를 제목이 아닌 작은 줄로만 보고 되돌릴 수 없는 삭제를 누른다.

**고칠 방향**: 시스템 `.alert` 로 바꾸고(플랫폼 표준 규약) force 토글을 제거해 항상 강등 삭제로 통일한다. 본문을 `voicesr_delete_dialog_confirm` + `voicesr_delete_dialog_warning` 로 맞추고, `monthlyQuotaExhausted` 면 제목을 "정말 삭제할까요?", 본문을 `voices_delete_quota_message` 로 통째로 교체한다.

<details><summary>반증 검증 결과</summary>

핵심 주장은 코드로 확인된다. 다만 '사용자 영향' 중 한 갈래는 반증되고, 대신 주장이 놓친 더 실질적인 문제가 있다.

【확인된 것】
1. 커스텀 시트 맞다. apps/ios-native/AlarmTalk/Views/Voices/VoiceProfileManagementPanel.swift:148 `.sheet(item: $deleteTarget)` → :173 `.presentationDetents([.medium])`. 내용은 Views/Voices/VoiceProfileManagementComponents.swift:19-73 의 순수 VStack(제목 Text .title3, 버튼 HStack .bordered/.borderedProminent). 시스템 .alert 가 아니다. 같은 파일 안 다른 확인 모달은 전부 .alert 다 — 이름 수정 :134, 월 한도 :176, 플랜 게이트 :181. 삭제만 시트라 iOS 내부에서도 일관성이 깨져 있다.
2. force 토글 맞다. Components.swift:49-56 `Toggle(isOn: $force)` "사용 중인 알람도 함께 정리" + :52 부제(on="기본 알람음으로 강등돼요" / off="사용 중이면 삭제하지 않아요").
3. 안드로이드에는 토글이 없다. VoiceProfileManagementComponents.kt:123-148 `VoiceProfileDeleteDialog` = IosAlertDialog(title voicesr_delete_dialog_title "목소리 삭제", message = voicesr_delete_dialog_confirm + "\n" + voicesr_delete_dialog_warning, actions [닫기, 삭제(destructive)]) — content 슬롯도 안 쓴다. force 는 사용자 선택이 아니라 MainViewModelVoiceActions.kt:486-490 에서 `force = true` 하드코딩이다.
4. 월 한도 분기도 맞다. 안드로이드 VoiceProfileManagementPanel.kt:2191-2222 는 `voiceDraftQuotaExhausted` 면 제목부터 다른 알럿(strings.xml:626 "정말 삭제할까요?", :627 voices_delete_quota_message, [취소, 삭제])으로 통째로 갈아탄다. iOS 는 Components.swift:42-47 에서 제목 "목소리 삭제" 를 그대로 두고 붉은 한 줄만 덧붙인다.
5. CLAUDE.md 예외 아님. AlarmKit 제약과 무관하고, 「플랫폼 표준」 예외는 '확인 알럿은 iOS 시스템 .alert 를 쓴다' 이므로 오히려 반대 방향을 가리킨다.

【반증되는 부분 — 주장의 '사용자 영향' 1개】
"진입 경로(⋮ vs 행)마다 토글 초기값이 달라 같은 버튼이 어떤 때는 지우고 어떤 때는 안 지운다" 는 사실이 아니다.
- iOS 전체에서 `deleteTarget` 을 세팅하는 곳은 한 곳뿐이다(VoiceProfileManagementPanel.swift:121, ⋮ confirmationDialog 의 '삭제' 버튼). 행에서 직접 여는 경로는 없다(`grep -rn 'deleteTarget|deleteForce'` 전체 결과 = :33,34,119,121,148,151,153,156,157).
- `deleteForce` 는 :34 에서 `= true` 초기화, :119 에서 제시 직전 다시 `true`. 초기값은 항상 on 이라 경로별로 갈릴 수 없다.

【주장이 놓친, 더 나쁜 사실】
토글은 아무 일도 하지 않는다 — 서버가 force 를 읽지 않는다.
- packages/backend/src/routes/voice-profile.ts:1992-2121 `voiceProfile.delete('/:id')` 가 읽는 쿼리 파라미터는 :2006 `draftOnly` 하나뿐이고 파일 전체에 'force' 문자열이 없다(grep 0건). :2107-2113 의 `UPDATE alarms SET mode='sound-only' ... WHERE voice_profile_id = ?` 는 무조건 실행된다.
- iOS 도 마찬가지다. AlarmTalkAPI.swift:318-323 은 force 를 쿼리로 붙이기만 하고, VoiceStudioViewModel.swift:944-972 의 로컬 cascade(`handleDeletedVoiceProfile` → `cascadeAlarmsAfterVoiceDeletion`)는 force 와 무관하게 항상 돈다.
- 결과: 토글을 끄고 "사용 중이면 삭제하지 않아요" 를 읽은 뒤 [삭제]를 누르면 목소리는 그대로 삭제되고 알람도 강등된다. 거짓 약속 아래 되돌릴 수 없는 삭제를 유도한다 — 토글을 없애야 할 근거는 주장보다 오히려 강하다.

【심각도 조정: P2】
- 데이터 손실 차이는 없다(백엔드가 항상 cascade, 안드로이드도 force=true 로만 호출).
- 정보량 차이도 주장만큼 크지 않다. iOS 붉은 줄(Components.swift:43)은 안드로이드 voices_delete_quota_message 마지막 문장과 글자까지 동일하고 .footnote.weight(.semibold) + error 색이다. 안드로이드도 그 문장을 제목이 아니라 본문에 둔다 — 실제 차이는 제목("정말 삭제할까요?" vs "목소리 삭제")과 취소 라벨("취소" vs "닫기") 정도라 "작은 줄로만 보고" 는 과장이다.
- 남는 실질 문제: (a) 확인 모달 껍데기가 iOS 내부에서도 이것만 다르다, (b) 안드로이드에 없는 죽은 컨트롤이 거짓 문구를 달고 있다, (c) 본문 문장이 다르다(iOS "이 목소리를 쓰는 메시지는 텍스트만 남고…" vs 안드로이드 voicesr_delete_dialog_warning). UI 정합성 + 오해 유발이라 P2 가 적정하고 P1 은 아니다.

</details>

### ☐ [modals] 목소리 '이름 수정' 알럿이 빈 이름을 조용히 삼킨다 — 저장을 눌러도 알럿만 닫히고 아무 일도 안 일어난다

**안드로이드**: apps/android-native/.../ui/voices/VoiceProfileManagementComponents.kt:84-121 — 저장 액션에 "여기서 비었는지 보고 삼키면 안 된다"(Codex #671 P2) 주석과 함께 검증을 부모로 올려 뒀다. VoiceProfileManagementPanel.kt:2171-2189 의 onConfirm 이 `renameSubmitAttempted = true` 를 세우고, 비어 있으면 다이얼로그를 닫지 않고 `voicesr_required_field`("꼭 입력해 주세요.")를 필드 아래 붉게 띄운다. 설명 문구는 `voices_edit_name_desc` = "알람 목록과 목소리 선택에서 보일 이름이에요."

**iOS**: apps/ios-native/AlarmTalk/Views/Voices/VoiceProfileManagementPanel.swift:134-147 — `Button("저장") { ...; editTarget = nil; guard !newName.isEmpty, newName != profile.name else { return } ... }`. `editTarget = nil` 로 먼저 알럿을 닫고 그다음 guard 로 조용히 return 한다. 오류 표시 경로가 없고 VoiceStudioViewModel.swift:1102-1105 의 "이름을 비울 수 없어요." 는 renameProfile 이 호출되지 않아 절대 뜨지 않는다. message 도 "알람 목록과 목소리 탭에 보이는 이름이에요." 로 다르다.

**사용자 영향**: 이름을 지우고 저장을 누르면 알럿이 닫히고 이름은 그대로다 — 실패 신호가 어디에도 없다. 사용자는 저장된 줄 알고 나갔다가 목록에서 옛 이름을 보고 고장으로 판단한다. 목소리는 계정당 1개·교체 월 1회라 등록 때 낸 오타를 못 고치면 한 달을 그대로 산다.

**고칠 방향**: `editTarget = nil` 을 성공 경로로 옮기고 빈 이름이면 알럿을 유지한 채 오류를 노출한다(알럿 안에서 어렵다면 저장 버튼을 `.disabled(trimmed.isEmpty)` 로 두고 이유를 message 에 상시 표기). 설명 문구도 `voices_edit_name_desc` 로 맞춘다.

<details><summary>반증 검증 결과</summary>

반증 실패 — 인용된 파일:줄이 전부 실재하고 주장대로다.

**1) 인용 검증 (전부 정확)**
- `apps/android-native/.../ui/voices/VoiceProfileManagementComponents.kt:84-121` — `IosAlertDialog(` 84줄, 저장 액션 주석 96-99줄이 정확히 "**여기서 비었는지 보고 삼키면 안 된다.** … 여기서 막으면 플래그가 안 켜져 오류가 영영 안 뜨고, 저장 버튼은 멀쩡해 보이는데 눌러도 아무 일이 없다(Codex #671 P2)." 이고, 109-119줄이 `if (nameError)` → `voicesr_required_field` 를 `colorScheme.error` 로 필드 아래 렌더한다. 검증을 부모로 올려 둔 것 맞다(`onClick = onConfirm` 그대로 전달, 100줄).
- `VoiceProfileManagementPanel.kt:2171-2189` — 2173줄 `val renameNameError = renameSubmitAttempted && resolvedRenameName.isBlank()`, 2181-2186줄 `onConfirm = { renameSubmitAttempted = true; if (resolvedRenameName.isNotBlank()) { onRenameVoiceProfile(...); renameTarget = null } }`. **비면 `renameTarget` 을 null 로 만들지 않아 다이얼로그가 열린 채 붉은 오류가 뜬다.** 주장대로.
- 문자열도 확인: `res/values/strings.xml:562` `voices_edit_name_desc` = "알람 목록과 목소리 선택에서 보일 이름이에요.", `:642` `voicesr_required_field` = "꼭 입력해 주세요.", `:563` 제목 "이름 수정".
- `apps/ios-native/AlarmTalk/Views/Voices/VoiceProfileManagementPanel.swift:134-147` — 138줄 `Button("저장")`, 139 `guard let profile = editTarget`, 140 trim, **141줄 `editTarget = nil`(알럿 닫힘) → 142줄 `guard !newName.isEmpty, newName != profile.name else { return }`**. 순서가 주장대로 "닫고 나서 조용히 return" 이다. message 는 146줄 "알람 목록과 목소리 탭에 보이는 이름이에요." 로 안드로이드와 문구가 다른 것도 맞다.
- `apps/ios-native/AlarmTalk/VoiceStudioViewModel.swift:1099-1105` (주장의 경로 `ViewModels/` 는 오타, 실제는 `AlarmTalk/VoiceStudioViewModel.swift`) — `renameProfile` 안에 `guard !trimmed.isEmpty else { statusMessage = "이름을 비울 수 없어요."; return }` 이 있으나 **전 저장소 유일 호출처가 위 143줄 하나**(`grep -rn renameProfile apps/ios-native` 결과 정의 1 + 호출 1)이고 그 호출은 이미 non-empty 로 걸러져 있어 **도달 불가능한 죽은 분기**다. 주장대로.

**2) 놓친 처리 경로 없음** — iOS 이름 수정 진입점은 101줄 액션시트 버튼 하나뿐이고(`grep "이름 수정"` 결과 91/101/134줄 + `VoiceCatalogRow.swift:10` 주석), 알럿 밖 대체 검증도 없다. `editName` 은 103줄에서 프로필 이름으로 프리필될 뿐 `onChange` 새니타이즈도 없다(안드로이드 2179줄 `sanitizeDisplayName(it, maxLength = VoiceNameMaxLength)` 대비 누락 — 인접 갭). 오히려 **실패 신호를 띄울 표면은 이미 있다**: 같은 파일 73-77줄이 `voice.statusMessage` 를 패널 최상단 footnote 로 그린다. VM 에 문구까지 있는데 호출이 안 돼 안 뜨는 것이라, "처리하고 있는 다른 곳" 이 아니라 "붙이다 만 상태" 다.

**3) CLAUDE.md 예외 아님** — 「플랫폼 표준: 확인 알럿은 시스템 `.alert`」 예외는 *껍데기 선택*을 덮는다. 시스템 `.alert` 은 버튼을 누르면 무조건 닫히므로 안드로이드식 "열어 둔 채 필드 아래 붉은 문구" 는 구조적으로 불가능한 게 맞다. 하지만 그 예외가 **피드백 0** 을 정당화하지는 않는다 — 141줄 앞에 `guard` 를 옮기고 `voice.statusMessage = "이름을 비울 수 없어요."`(이미 존재하는 문자열, `Localizable.xcstrings:9762` 에 번역까지 등재) 를 세우면 73줄 배너로 즉시 보인다. AlarmKit 제약과도 무관.

**4) 심각도는 과장** — 사용자 영향 서술의 "등록 때 낸 오타를 못 고치면 한 달을 그대로 산다" 는 틀렸다. **비어 있지 않은 이름의 변경은 정상 동작한다**(143줄 → 1099줄 → `updateVoiceProfile`, 1118줄 "이름을 바꿨어요." + refresh). 깨지는 건 *빈/공백만 입력해 저장* 한 경우뿐이고, 데이터 손실 없이 알럿을 다시 열어 복구 가능하다. `VoiceProfileLimits.maxProfiles = 1`(`VoiceStudioViewModel.swift:25`)이라 "계정당 1개" 는 사실이나, 이름 수정이 봉쇄되는 건 아니다. 부수로 142줄의 `newName != profile.name` 도 무피드백 no-op 이지만 무해하다. 안드로이드 주석이 스스로 붙인 등급(Codex #671 **P2**)이 적정선이다 — 침묵 실패 UX 결함이지 기능 봉쇄나 데이터 손실이 아니다.

</details>

### ☐ [modals] 「직접 입력」 알럿의 '취소' 가 취소가 아니다 — 두 버튼 모두 빈 클로저이고 입력이 draft 에 곧바로 반영된다

**안드로이드**: apps/android-native/.../ui/editor/AlarmRandomPromptSettings.kt:320-331, 337-370 — `ManualMessageDialog` 는 로컬 `draft` 에 타이핑하고 onConfirm 때만 `draftManualText = text` 로 반영한다. 322줄 주석: "확인 없이 닫으면 입력한 내용은 그대로 폐기된다." 입력은 367줄 `sanitizeUserText(allowNewlines = true).takeWithoutSplittingPairs(200)` 으로 정리·200자 상한, 확인 라벨은 `editorp_random_save_button`("저장"), 빈 문구면 359줄에서 버튼을 흐리게 둔다.

**iOS**: apps/ios-native/AlarmTalk/Views/Editor/MessageSettingsPane.swift:139-145 — `.alert("직접 입력", isPresented: $manualDialogOpen) { TextField("알람에서 읽어 줄 문구", text: $draftManualText); Button("취소", role: .cancel) { }; Button("확인") { } }`. TextField 가 화면 draft 인 `$draftManualText` 에 직접 바인딩돼 있고 두 버튼 body 가 모두 비어 있다. 새니타이즈·길이 상한·빈 문구 비활성화 전부 없다.

**사용자 영향**: 문구를 고치다 '취소' 를 눌러도 고친 내용이 그대로 남아 되돌릴 방법이 없다. 200자 상한이 없어 긴 문구가 서버까지 흘러가고, 제어문자·제로폭이 그대로 들어가 TTS 낭독이 깨진다. 빈 문구로 '확인' 을 눌러도 막히지 않아 저장 단계에서야 실패한다.

**고칠 방향**: 알럿 전용 `@State manualDraft` 를 두고 열 때 `draftManualText` 로 시드, '확인' 에서만 대입한다. `InputSanitizer` 로 새니타이즈 + 200자 클램프, 빈 값이면 확인 비활성화, 라벨은 "저장" 으로 맞춘다.

<details><summary>반증 검증 결과</summary>

확인됨 — 인용이 실물과 일치한다. iOS `apps/ios-native/AlarmTalk/Views/Editor/MessageSettingsPane.swift:139-145` 는 인용 그대로다: `.alert("직접 입력", isPresented: $manualDialogOpen) { TextField("알람에서 읽어 줄 문구", text: $draftManualText); Button("취소", role: .cancel) { }; Button("확인") { } }`. `draftManualText` 는 pane 의 `@State`(:38)이고 `result`(:275)·`detailCard`(:164)가 그대로 읽으므로 타이핑이 곧바로 draft 에 반영되고, 두 버튼 body 가 비어 있어 '취소' 는 알럿만 닫는다 — 되돌리는 코드가 없다. 새니타이즈·길이 상한도 없다: 앱의 `InputSanitizer` 호출부는 `AccountPanel.swift:165`, `LoginView.swift:174`, `VoiceCloneUploadFlow.swift:235`, `WelcomePromoDialog.swift:55`, `VoiceStudioViewModel.swift:1101` 뿐이고 문구 필드에는 없다.

안드로이드 근거도 실물과 일치한다. `apps/android-native/.../ui/editor/AlarmRandomPromptSettings.kt:320-331` 에 "확인 없이 닫으면 입력한 내용은 그대로 폐기된다" 주석과 `onConfirm` 에서만 `draftManualText = text`, `:337-370` 의 `ManualMessageDialog` 는 로컬 `draft`(:341)에 타이핑하고 `:366` 에서 `sanitizeUserText(it, allowNewlines = true).takeWithoutSplittingPairs(200)`, `:359` 에서 `enabled = draft.isNotBlank()`.

다만 주장 중 두 가지는 반증된다.
1) "되돌릴 방법이 없다" — 과장. pane 자체의 취소(`MessageSettingsPane.swift:85` `onCancel: { dismiss() }`)가 draft 전체를 버리고, 알람에 반영되는 유일한 지점은 `onSave` → `AlarmEditorSheet.swift:843` 이다. 피해는 pane 세션 안으로 한정된다(navigationDestination, `AlarmEditorSheet.swift:308-320`).
2) "빈 문구로 확인해도 막히지 않아 저장 단계에서야 실패한다" — 틀렸다. `saveEnabled`(`MessageSettingsPane.swift:263-270`)가 직접 입력일 때 공백이면 pane 저장 버튼을 끄고, `AlarmEditorSheet.swift:649` 가 한 번 더 막는다. 빈 문구는 알람 저장까지 가지 않는다.

길이 상한 부재는 실재하고, 오히려 주장이 놓친 악화 요소가 있다. 서버가 `packages/backend/src/routes/tts.ts:734, 1067, 1143` 에서 200자를 fail-closed 로 거부(`TEXT_TOO_LONG`)하므로 잘못된 데이터가 저장되지는 않지만, `TEXT_TOO_LONG` 이 `VoiceStudioViewModel+ErrorMapping.swift:44-72, 96-108` 의 매핑·`knownErrorCodes` 에 없어 기본 문구 "목소리를 처리하지 못했어요. 잠시 후 다시 시도해 주세요." 로 떨어진다 — 재시도해도 영영 안 되는 조건에 '나중에 다시' 를 띄우고, 화면에 글자 수 표시도 없어 사용자가 원인을 알 길이 없다. 제어문자·제로폭도 서버는 `routes/tts.ts:722` 의 `.trim()` 만 하고 걸러 주지 않으므로 앱 1차 방어선 부재가 하류에서 보완되지 않는다.

CLAUDE.md 예외에 해당하지 않는다. 시스템 `.alert` 를 쓰는 것 자체는 플랫폼 표준 예외가 맞지만, 별도 `@State` 를 두고 확인 클로저에서만 커밋하는 것은 `.alert` 안에서도 가능한 애플 표준 패턴이다 — 빈 클로저는 AlarmKit 제약도 플랫폼 표준도 아니다. 새니타이즈·상한은 껍데기와 무관하다.

같은 파일의 인접 이슈(주장 범위 밖, 참고): 날씨·운세 시트(`:96-138`)도 draft 에 직접 바인딩돼 스와이프로 닫아도 편집이 남는다(안드로이드는 `AlarmRandomPromptSettings.kt:293-296, 311` 의 `onDismissWithoutSave` 로 폐기). 알럿 `TextField` 는 한 줄이라 안드로이드가 의도적으로 둔 여러 줄 필드(`:361-369`, `minHeight = 108.dp, singleLine = false`)와 다르다. `AlarmEditorSheet.swift:312-313` 이 `manualRemaining/manualLimit` 을 nil 로 넘겨 안드로이드(`AlarmRandomPromptSettings.kt:211-219`)의 월 한도 표기도 없다.

결론: 핵심 주장(취소가 취소가 아니다 / 새니타이즈·상한 부재)은 코드로 확인되어 인정. 사용자 영향 서술 중 '되돌릴 수 없다', '빈 문구가 저장 단계까지 흘러간다' 는 과장이고, 데이터 손상·보안 영향은 없어 심각도는 P2 로 조정.

</details>

### ☐ [modals] 쿠폰 입력이 붙은 PlanGateDialog 가 iOS 에 통째로 없다 — PlanGateState 는 아무도 안 쓰는 죽은 코드다

**안드로이드**: apps/android-native/.../ui/components/PlanGateDialog.kt:32-140 — 액션 3개(닫기 / `plan_gate_redeem_action` "쿠폰이 있어요" / confirmLabel)이고, '쿠폰이 있어요' 를 누르면 같은 파일 47-79줄의 코드 입력 다이얼로그(`plan_gate_redeem_title` "쿠폰 입력")가 뜬다. 호출부: AlarmTalkApp.kt:756-769, VoiceProfileManagementPanel.kt:1456-1467(title=`voices_create_paid_title` "내 목소리 만들기는 유료 기능이에요", message=`voices_create_paid_notice` "기본 목소리는 계속 무료로 쓸 수 있어요.", confirm="이용권 보기"), AlarmEditorScreen.kt:1653-1686.

**iOS**: apps/ios-native/AlarmTalk/Views/Common/PlanGateDialog.swift 의 `PlanGateState` 는 어디에서도 참조되지 않는다(`grep -rn PlanGateState --include=*.swift` 결과가 정의 파일 2줄뿐). 실제로 뜨는 유일한 플랜 게이트는 Views/Voices/VoiceProfileManagementPanel.swift:181-185 `.alert("녹음으로 목소리를 만들려면 유료 플랜이 필요해요.", isPresented: $planGateOpen) { Button("닫기", role: .cancel); Button("플랜 보기") }` — 제목·본문이 한 줄로 뭉쳐 있고 액션 2개, 쿠폰 경로 없음, 확인 라벨도 "플랜 보기"(안드로이드 "이용권 보기").

**사용자 영향**: 프로모션·선물 코드를 받은 사용자가 목소리 만들기에서 막혔을 때 앱은 결제 화면만 권한다. 코드 등록은 더보기 2뎁스 안쪽이라 그 자리에서 찾지 못하고 이탈한다. '유료 기능이지만 기본 목소리는 계속 무료' 라는 안심 문장도 사라져 게이트가 더 딱딱하게 읽힌다.

**고칠 방향**: 시스템 `.alert` 기반 PlanGateAlert 를 만들어 제목 "내 목소리 만들기는 유료 기능이에요", message "기본 목소리는 계속 무료로 쓸 수 있어요.", 액션 [닫기 / 쿠폰이 있어요 / 이용권 보기] 로 맞추고 '쿠폰이 있어요' 는 코드 입력 알럿으로 체이닝한다. 쓰이지 않는 `PlanGateState` 는 여기에 연결하거나 삭제한다.

<details><summary>반증 검증 결과</summary>

반증 실패 — 코드로 확인됨. 다만 주장의 근거 일부는 틀렸고, 실제 격차는 주장보다 넓다.

**1) 인용 파일:줄 검증**
- 안드로이드 `ui/components/PlanGateDialog.kt:32-140` 실재. 액션 3개(`r3dlg_modal_dialog_close` "닫기"(834행) / `plan_gate_redeem_action` "쿠폰이 있어요"(strings.xml:890) / confirmLabel)이고, `onRedeemCode != null` 일 때만 쿠폰 액션이 붙는다(`PlanGateDialog.kt:87-94`). 누르면 44-79행의 별도 `Dialog` 로 `plan_gate_redeem_title` "쿠폰 입력"(891) + `plan_gate_redeem_desc`(892) + `CodeRedeemField` 가 뜬다. 주장대로.
- iOS `Views/Common/PlanGateDialog.swift` 전체를 읽었다. **View 가 없다** — `PlanGateState`(4-38행)와 `PlanTier`(45-116행) 두 타입뿐이다. `grep -rn PlanGateState apps/ios-native --include=*.swift` 결과는 자기 파일 3줄(3, 4, 20)뿐 → **`PlanGateState` 는 참조 0, 죽은 코드 맞다.** ⚠ 단 같은 파일의 `PlanTier` 는 `BillingPanel.swift:33`, `AlarmEditorSheet.swift:927`, `SubscriptionManager.swift:31`, `VoiceShareAccess.swift:7` 등 10곳 이상이 쓴다 — **파일을 지우면 안 되고 struct 만 죽었다.**
- iOS `Views/Voices/VoiceProfileManagementPanel.swift:181-185` 실재. `.alert("녹음으로 목소리를 만들려면 유료 플랜이 필요해요.", isPresented: $planGateOpen) { Button("닫기", role:.cancel); Button("플랜 보기"){ onRequestBilling?() } }` — message 클로저 없음(제목 한 줄에 뭉침), 액션 2개, 쿠폰 없음. 트리거는 296-306행(`!hasPaidVoiceAccess` / 슬롯 초과). 주장대로.

**2) 주장이 틀린 부분 — 안드로이드 근거 1건은 죽은 호출부**
`AlarmTalkApp.kt:755-768` 의 `planGateDialog` 는 `grep planGateDialog` 결과 102(초기 null)·349(null)·755·761·764 뿐 — **non-null 로 대입되는 곳이 없다.** 안드로이드에서도 안 뜨는 게이트다. 살아 있는 호출부는 둘: `ui/voices/VoiceProfileManagementPanel.kt:1456-1467`(트리거 1298행 `!canCreateVoice`, `onRegisterCode` 는 `AlarmTalkApp.kt:1063/1174` 에서 `viewModel::registerCode` 로 실배선), `ui/editor/AlarmEditorScreen.kt:1651-1686`(트리거 615·1604행, `onRedeemCode` 는 `gateReason == PLAN_REQUIRED` 일 때만 — 1684행).

**3) 주장이 놓친 부분 — 격차가 더 크다**
- iOS 편집기 게이트는 **더 나쁘다.** `AlarmEditorSheet.swift:1289-1307` `showVoicePlanLockedAlert()` 는 `planAccess` 3분기(loggedOut/free/paid)까지는 안드로이드 `VoiceGateReason` 과 맞췄지만, 결과가 `validationAlert` 다 → 렌더링은 353-358행 `Alert(dismissButton: .default(Text("확인")))` **단일 버튼**. 쿠폰은커녕 **결제 화면으로 가는 액션조차 없다**(안드로이드는 `onOpenBilling()` + 쿠폰).
- iOS "플랜 보기" 의 착지점도 막다른 길이다. `MainTabsView.swift:154-159` → `auxiliaryScreen = .billing` → `Views/Settings/BillingPanel.swift` 에는 코드 **입력**란이 없다(135행 "공유 코드" 는 발급/공유용). 안드로이드도 `ui/billing/BillingPanels.kt:221` 에서 결제 화면의 코드 입력을 일부러 뺐는데, 그래서 게이트에 쿠폰을 붙인 것이다(`PlanGateDialog.kt:26-29` 주석). iOS 는 뺀 쪽만 따라 하고 붙인 쪽을 안 따라 했다.
- iOS 에 쿠폰 등록 경로가 아예 없지는 않다: `MenuView.swift:60-62`(더보기 → `hasSharedPass == false` 일 때만 "초대 코드 등록") → `PeoplePanel.swift:53` `CodeRegisterRow`, 그리고 1회성 `WelcomePromoDialog.swift:44`. **공유 이용권 그룹에 든 사용자는 더보기에서 그 행이 "초대 및 구성원 관리" 로 바뀌어 사라진다**(MenuView.swift:60). 즉 "2뎁스 안쪽" 은 사실이고 일부 사용자에겐 그마저 안 보인다.
- 안심 문구도 실제로 없다: 안드로이드 `voices_create_paid_title`/`voices_create_paid_notice`(strings.xml:554-555 "내 목소리 만들기는 유료 기능이에요"/"기본 목소리는 계속 무료로 쓸 수 있어요.") vs iOS 한 줄 제목. confirmLabel 도 안드로이드 `r3dlg_plan_gate_confirm`(833행 "이용권 보기") vs iOS "플랜 보기".

**4) CLAUDE.md 예외 아님**
AlarmKit 제약과 무관하고(울림 화면·알람 음량이 아니다), 플랫폼 표준 예외도 안 된다 — 안드로이드 구현 자체가 `PlanGateDialog.kt:45-47` 주석대로 "알럿에는 텍스트 액션만, 입력은 별도 다이얼로그" 라는 **iOS 알럿 규칙을 따른 것**이라, iOS 는 `.alert` 에 세 번째 버튼을 두고 `.sheet` 로 코드 입력을 띄우면 그대로 재현된다. 오히려 지금이 원본에서 멀다.

**5) 심각도**
데이터 손실·크래시 없음, 코드 등록 경로가 앱 안에 존재하긴 함(더보기 2뎁스, 조건부 노출) → P1 은 과장. 다만 이탈 지점이 둘(목소리 탭·편집기)이고 편집기 쪽은 결제 화면 진입조차 없어 단순 문구 차이가 아니다 → **P2**.

</details>

### ☐ [modals] 닉네임 수정이 알럿이 아니라 커스텀 시트이고, 금지된 상시 카운터(N/30) + 말없는 잘라내기를 쓴다

**안드로이드**: apps/android-native/.../ui/home/HomeComponents.kt:345-413 — `IosAlertDialog(title=hs_nickname_dialog_title "닉네임 수정", message=null, actions=[닫기, 저장/저장 중])`. 주석 361-363: "라벨을 두지 않는다 — 제목이 이미 '닉네임 수정' 이라 같은 말을 두 번 하는 셈". 카운터를 두지 않고 상한을 넘겨 칠 때만 404-412줄에서 `auth_error_name_too_long` 을 띄운다(`tooLong` 은 상한과 정확히 같을 때 건드리지 않는다).

**iOS**: apps/ios-native/AlarmTalk/Views/Settings/AccountPanel.swift:56-67 `.sheet(isPresented: $nicknameDialogOpen)` → 같은 파일 78-190 `NicknameEditSheet`. 안드로이드에 없는 부제(107줄 "공유 이용권과 메시지에서 표시되는 이름이에요.")와 아이콘 카드(137-146 "앱에서 보일 이름")가 있고, 168-171줄 `Text("\(name.count)/30")` 상시 카운터, 163-168줄 onChange 가 `InputSanitizer.clampDisplayName` 으로 아무 안내 없이 잘라낸다.

**사용자 영향**: 같은 성격의 입력 모달인데 안드로이드는 알럿, iOS 는 큰 시트로 떠서 앱이 화면마다 달라 보인다. 카운터는 넘기 전까지 알려 줄 게 없는데 늘 떠 있어 시선을 뺏고, 30자를 넘겨 치면 이유 없이 글자가 사라져 IME 로 한글을 조합하던 사용자가 입력이 씹혔다고 느낀다.

**고칠 방향**: 시스템 `.alert` + TextField 로 바꾸고 부제·아이콘 카드를 뺀다. 카운터를 없애고 clamp 로 값이 줄었을 때만 `auth_error_name_too_long` 과 같은 뜻의 경고를 띄우되, 정확히 상한일 때는 켜지 않는다.

<details><summary>반증 검증 결과</summary>

반증 실패 — 인용된 코드가 전부 실제로 존재하고 주장대로다. 인용 줄번호는 1~2줄씩 어긋나지만 내용은 정확하다.

**1. 인용 검증 (모두 확인됨)**

안드로이드 `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/home/HomeComponents.kt`
- `:361-381` — `IosAlertDialog(title = stringResource(R.string.hs_nickname_dialog_title), message = null, actions = [닫기, 저장/저장 중])`. 주장대로 message 는 `null` 이고 부제가 없다.
- `:358-360` 주석 "공용 알럿을 그대로 쓴다 — 입력이 있다고 별도 모달을 두지 않는다([IosAlertDialog])", `:383-384` 주석 "라벨을 두지 않는다 — 제목이 이미 '닉네임 수정' 이라 같은 말을 두 번 하는 셈이다"(주장은 361-363 이라 했으나 실제 383-384).
- `:402-403` 주석 "항상 켜져 있는 카운터(7/30)는 상한을 넘기 전까진 알려 줄 게 없다. 넘었을 때만, 무엇을 하면 되는지 말한다."
- `:392-397` — `cleaned.length > DisplayNameMaxLength` 면 `tooLong = true`, **정확히 같을 때는 플래그를 건드리지 않는다**(IME 되돌림 대비). `:404-413` 에서만 `auth_error_name_too_long` 노출.
- 살아 있는 경로다 — `ui/app/AlarmTalkApp.kt:673` 에서 호출.

iOS `apps/ios-native/AlarmTalk/Views/Settings/AccountPanel.swift`
- `:56-69` — `.sheet(isPresented: $nicknameDialogOpen) { NicknameEditSheet(...) }.presentationDetents([.medium])`. 알럿이 아니라 시트가 맞다.
- `:80-200` `NicknameEditSheet`(주장 78-190).
- `:108` — 안드로이드에 없는 부제 `Text("공유 이용권과 메시지에서 표시되는 이름이에요.")`.
- `:128-153` — 안드로이드에 없는 아이콘 카드(`:139` "앱에서 보일 이름", `:142` "알람, 메시지, 공유 이용권 화면에서 이 이름을 사용해요.").
- `:170` — `Text("\(name.count)/30")` **상시 카운터**. 조건 없이 항상 렌더된다.
- `:164-169` — `onChange` 가 `InputSanitizer.clampDisplayName(newValue)` 로 잘라 되돌려 넣을 뿐, **too-long 안내가 없다**. 안내는 빈 값일 때(`:174-178` "닉네임을 입력해 주세요.")만 있다.
- `SettingsView.swift:85` 에서 실제로 쓰인다 — 죽은 코드 아님.

**2. 주장이 놓친 것 — 전부 주장을 강화하는 방향**

(a) **카운터가 잘라내는 단위와 다른 단위로 센다.** `InputSanitizer.swift:89-96` 의 `clamp` 는 **UTF-16 코드 유닛**으로 자르는데(`Array(raw.utf16)`), `AccountPanel.swift:170` 의 카운터는 Swift `name.count` = **grapheme cluster** 다. 이모지 15개면 카운터는 "15/30" 인데 UTF-16 은 이미 30이라 더는 입력이 안 들어간다 — 카운터가 여유가 있다고 **거짓말을 한다.** `InputSanitizer.swift:82-85` 주석이 바로 이 상황을 문제로 적어 뒀고("사용자는 '16/30' 을 보면서 저장이 안 되고, 무엇을 지워야 하는지 알 방법이 없어 갇힌다"), `docs/ios/PROGRESS.md:70` 이 같은 단위 불일치를 이미 고친 결함으로 기록해 뒀다. clamp 는 UTF-16 으로 고쳤는데 **그 잘못된 숫자를 그리던 카운터는 그대로 남았다.**

(b) **같은 위반이 가입 화면에도 있다.** `LoginView.swift:172-176` 도 `clampDisplayName` 으로 말없이 자르고 안내가 없다. 안드로이드 대응 `ui/auth/AuthScreen.kt:263-280` 은 `nameTooLong` → `isError` + `supportingText = auth_error_name_too_long` 를 띄우고, `:262` 주석에 "항상 켜진 카운터(7/30)는 넘기 전까진 알려 줄 게 없어 두지 않는다" 를 명시한다.

(c) **iOS 자신의 형제 모달과도 어긋난다.** 이름을 고치는 같은 성격의 모달인 목소리 이름 변경은 iOS 에서 시스템 알럿이다 — `Views/Voices/VoiceProfileManagementPanel.swift:134-147` `.alert("이름 수정", ...) { TextField("목소리 이름", ...); Button("닫기", role: .cancel); Button("저장") }`. 스누즈 직접 입력(`Views/Editor/AlarmSettingsPanes.swift:98`)·직접 문구(`Views/Editor/MessageSettingsPane.swift:139`)도 `.alert` + `TextField` 다. 즉 안드로이드가 `IosAlertField` 로 통일한 5종 중 iOS 에서 **닉네임 수정만 혼자 시트**다. 상시 카운터도 표시 이름 계열에서는 여기 하나뿐이다(`grep 'count)/'` 결과: `AccountPanel.swift:170`, `MemberManagementView.swift:191`(인원수 표시), `AlarmEditorComponents.swift:502`(직접 문구 200자)).

**3. 예외 해당 없음**
- AlarmKit 제약 아님(울림 화면·알람 음량과 무관).
- 플랫폼 표준 예외에도 해당하지 않는다. CLAUDE.md 는 "확인 알럿은 시스템 `.alert` 를 쓴다" 인데, 이 화면은 시스템 `.alert` 도 아니고 안드로이드의 `IosAlertDialog` 도 아닌 **제3의 커스텀 시트**다. SwiftUI `.alert` 는 `TextField` 를 받으며 이 앱이 이미 세 곳에서 그렇게 쓰고 있으므로, 시트여야 할 플랫폼적 이유가 없다. CLAUDE.md 「폼(입력 여러 개 + 저장)은 알럿이 아니다」 예외도 안 걸린다 — 필드가 하나다.

**4. 심각도**
과장은 아니지만 P1 도 아니다. 데이터 유실·크래시·보안 문제가 없고 닉네임 변경 자체는 동작한다. 다만 CLAUDE.md 에 명문화된 규칙 3개(모달 껍데기 통일 / "항상 켜진 카운터는 두지 않는다" / "말없이 자르지 말 것")를 동시에 어기고, 카운터가 clamp 단위와 달라 **실제로 틀린 숫자**를 보여주며(2-a), 같은 패턴이 가입 화면에도 있다(2-b). P2 가 맞다.

</details>

### ☐ [plan-gate] 게이트에서 쿠폰을 등록하면 편집 중이던 알람이 통째로 사라진다 (Android)

**안드로이드**: PlanGateDialog.kt:65-74 — CodeRedeemField 제출 즉시 `onRegisterCode(code)` 후 `onDismiss()`. 편집기 호출부는 AlarmEditorScreen.kt:1650 `onRedeemCode = onRegisterCode`(AlarmTalkApp.kt:1123/:1174 `viewModel::registerCode`). registerCode 는 성공 시 MainViewModelBillingActions.kt:224-228 에서 `navigateSharedPassTick++`(초대·커플·가족) 또는 `navigateHomeTick++`(개인 플랜) 를 올리고, AlarmTalkApp.kt:325-329 → AlarmTalkAppHelpers.kt:113-119 `navigateHomeClearingStack()` 이 `popUpTo(NativeTab.Alarms.route)` 로 편집기를 스택에서 걷어낸다(공유패스 갈래는 :331-337 로 구성원 관리 화면으로 이동).

**iOS**: 없음 — iOS 편집기 게이트에는 쿠폰 액션 자체가 없다(AlarmEditorSheet.swift:353-359 알럿 버튼은 "확인" 하나). 따라서 이 소실은 안드로이드 전용이다.

**사용자 영향**: 알람 시각·요일·목소리·문구를 다 정해 둔 사용자가 게이트에서 쿠폰을 넣어 성공하면, 화면이 알람 목록(또는 구성원 관리)으로 튕기고 **입력한 알람이 전부 사라진다.** 쿠폰이 통해서 이제 막 쓸 수 있게 된 바로 그 순간에 하던 일을 잃으므로 체감이 특히 나쁘다.

**고칠 방향**: `registerCode` 의 화면 이동을 호출부 선택으로 뺀다 — 지금은 어디서 부르든 무조건 홈/구성원으로 보낸다. 편집기 경로에서는 `navigateHomeTick`/`navigateSharedPassTick` 을 올리지 않고 게이트만 닫은 뒤 그 자리에서 계속 편집하게 한다(구독 갱신은 refreshBillingAfterMutation 이 이미 처리하므로 freeVoiceTier 가 재계산되어 잠금이 풀린다). 최소한 편집기에서 온 등록은 tick 을 소비하지 않도록 플래그를 넘길 것.

<details><summary>반증 검증 결과</summary>

주장은 코드로 확인된다(반증 실패).

체인 전부 실재:
1) PlanGateDialog.kt:65-74 — CodeRedeemField.onSubmit → `onRedeemCode(code)` → `codeEntryOpen=false` → `onDismiss()`. 주장대로.
2) AlarmEditorScreen.kt:1651 `PlanGateDialog(` … :1684 `onRedeemCode = if (gateReason == VoiceGateReason.PLAN_REQUIRED) onRegisterCode else null`. (주장이 인용한 :1650 은 gateReason when 의 닫는 줄로 인용이 한 칸 어긋났으나, 실제 코드는 주장보다 오히려 **좁다** — 쿠폰 액션은 PLAN_REQUIRED 갈래에만 붙는다. 반증 사유는 못 된다.)
3) 두 편집기 라우트 모두 전달: AlarmTalkApp.kt:1123(AlarmCreate) / :1174(AlarmEdit) `onRegisterCode = viewModel::registerCode`.
4) MainViewModelBillingActions.kt:224-228 성공 시 `navigateSharedPassTick++` / `navigateHomeTick++`. 자유문자열 프로모가 실제로 타는 폴백 경로 redeemPromoCode 도 :277-281 에서 동일하게 올린다(주장이 안 짚었지만 결론을 강화).
5) AlarmTalkApp.kt:325-329 → AlarmTalkAppHelpers.kt:113-119 `navigate("alarms"){ popUpTo("alarms"); launchSingleTop=true }` — inclusive=false 라 편집기 목적지가 팝된다.

입력값이 실제로 복구 불가라는 결정적 근거(주장이 인용하지 않았음):
- AlarmEditorScreen.kt:178 `val editor = remember(alarm?.id) { AlarmEditorState.from(...) }` — `rememberSaveable` 아님, MainViewModel 로 호이스팅도 안 됨(AlarmEditorState.kt:54-120 은 mutableStateOf 필드 뭉치의 평범한 클래스).
- 모듈 전체 grep: pendingAlarmDraft / restoreEditor / draftRestore / savedEditor 전부 0건 — 초안 복원 경로가 아예 없다.

주장의 기술(記述) 중 한 곳은 부정확하다(결론은 불변):
- 공유패스 갈래 AlarmTalkApp.kt:331-337 은 `navigate(MemberManagement){ launchSingleTop = true }` 로 **popUpTo 가 없다** — 편집기는 스택에 남고 뒤로가기로 화면 자체는 돌아온다. 다만 상태가 plain `remember` 라 `AlarmEditorState.from(alarm=null,…)` 로 재구성돼 **빈 편집기**가 돌아온다. 즉 "스택에서 걷어낸다" 는 홈 갈래에만 해당하고, 데이터 소실이라는 결론은 두 갈래 모두 성립한다.

iOS 근거도 확인됨: AlarmEditorSheet.swift:1282-1301 `showVoicePlanLockedAlert()` → :353-359 `.alert(item:$validationAlert)` 버튼은 `.default(Text("확인"))` 하나뿐. 쿠폰 액션·결제 이동 없음 → iOS 는 이 소실이 불가능하다. 안드로이드 전용 맞다.

CLAUDE.md 예외 아님: AlarmKit 제약도 플랫폼 표준도 아니고, 오히려 기능 자신의 명시 의도(PlanGateDialog.kt:27-29 "막힌 그 자리에서 바로 넣을 수 있게 한다")를 정면으로 뒤집는다 — 쿠폰이 통한 순간 방금 열린 그 화면에서 튕겨 나간다.

심각도 조정 P2(과장 일부 있음):
- 자유 등급은 녹음·파일·직접 입력이 이미 게이트로 막혀 있으므로(AlarmEditorScreen.kt:613-616, :1604) 실제로 잃는 값은 시각·요일·라벨·스누즈·진동·알람음·음량·무료 버킷 선택이다. 주장의 "목소리·문구를 다 정해 둔" 은 게이트가 막고 있던 바로 그 항목이라 성립하지 않고, "전부 사라진다" 도 다소 과하다.
- 영구 데이터 손실·서버 상태 오염·앱 벽돌화 없음, 재입력으로 완전 복구 가능(수십 초). 다만 도달 경로가 이 기능의 설계 시나리오 그 자체(커밋 845a8e3e "게이트 모달에서 쿠폰 입력")라 재현이 드물지 않다. P1 은 아니고 P2 가 맞다.

</details>

### ☐ [plan-gate] iOS 플랜 게이트에는 '쿠폰이 있어요' 도 '이용권 보기' 도 없다 (편집기는 '확인' 버튼 하나)

**안드로이드**: PlanGateDialog.kt:86-108 — 액션이 언제나 세 개다: `r3dlg_modal_dialog_close`(닫기) / `plan_gate_redeem_action`(strings.xml:887 "쿠폰이 있어요", onRedeemCode 가 있을 때) / `confirmLabel`(strings.xml:830 "이용권 보기", 강조). 주석 :27-29 가 이유를 명시한다 — "결제 화면까지 갔다가 거기서 코드 입력란을 찾아야 했는데, 막힌 그 자리에서 바로 넣을 수 있게 한다". 두 호출부 모두 onRedeemCode 를 넘긴다(AlarmEditorScreen.kt:1650, VoiceProfileManagementPanel.kt:1465).

**iOS**: Views/Editor/AlarmEditorSheet.swift:1264-1276 showVoicePlanLockedAlert 는 `ValidationAlertContent(title:message:)`(:122-126, 필드가 title/message뿐) 를 채우고, :353-359 `.alert(item:)` 이 `dismissButton: .default(Text("확인"))` **하나만** 그린다 — 결제 화면으로 가는 길도, 쿠폰 입력도 없다. 목소리 탭은 Views/Voices/VoiceProfileManagementPanel.swift:181-186 에서 "닫기" + "플랜 보기" 두 개뿐이고 쿠폰 액션이 없다. 코드 등록 경로 자체는 존재한다(Views/Root/RootView.swift:125 `socialFeatures.registerCode`) — 게이트에 연결만 안 돼 있다.

**사용자 영향**: iOS 에서 쿠폰·선물·초대 코드를 받은 사용자는 막힌 자리에서 코드를 넣을 수 없다. 편집기 게이트는 '확인' 만 있어 결제 화면으로 가는 길조차 없으므로, 사용자는 알럿을 닫고 탭을 뒤져 이용권 화면을 스스로 찾아야 하고 그 왕복에서 편집하던 알람을 잃는다.

**고칠 방향**: iOS 게이트를 `ValidationAlertContent`(제목/본문만) 에서 분리해 전용 상태로 만들고, 시스템 `.alert` 에 액션 세 개를 단다 — 취소(`role: .cancel`) / "쿠폰이 있어요"(코드 입력 시트 → RootView.swift:125 의 registerCode 재사용) / "이용권 보기"(BillingPanel 로 라우팅, VoicesPanelView.swift:25-27 의 onRequestBilling 체인과 동일 방식). 플랫폼 표준 예외는 '껍데기를 시스템 .alert 로 쓴다' 는 것이지 '액션을 줄인다' 가 아니다.

<details><summary>반증 검증 결과</summary>

코드로 확인된다 — 인정. 다만 인용 줄번호에 오차가 있고 사용자 영향 서술 일부가 과장이라 P2 로 조정한다.

[안드로이드 — 주장대로]
- ui/components/PlanGateDialog.kt:86-108 buildList 가 세 액션을 쌓는다: :89 R.string.r3dlg_modal_dialog_close(닫기) / :96 R.string.plan_gate_redeem_action(onRedeemCode != null 일 때) / :103 confirmLabel(emphasized=true).
- 주석 :27-29 문구도 문자 그대로 존재("결제 화면까지 갔다가 거기서 코드 입력란을 찾아야 했는데, 막힌 그 자리에서 바로 넣을 수 있게 한다").
- 코드 입력은 알럿 안이 아니라 별도 Dialog(:47-77)의 CodeRedeemField(:65)이고 등록 후 게이트까지 닫는다(:72).

[iOS — 주장대로]
- Views/Editor/AlarmEditorSheet.swift:1282-1301 showVoicePlanLockedAlert 은 planAccess 3갈래로 message 만 가르고 :1304-1307 에서 ValidationAlertContent(title:message:) 를 채운다.
- :122-126 ValidationAlertContent 는 id/title/message 뿐 — 액션 필드가 없다.
- :353-359 .alert(item: $validationAlert) 가 dismissButton: .default(Text("확인")) 하나만 그린다.
- 호출부 Views/Root/MainTabsView.swift:103-114 는 target/onClose/onJumpToVoices/onSchedulingDidFinish 4개뿐 — 결제·코드 등록 콜백이 아예 없다. onJumpToVoices 는 AlarmEditorSheet+AlarmModeSection.swift:72 한 곳에서만 쓰이고 게이트와 무관.
- Views/Voices/VoiceProfileManagementPanel.swift:181-186 은 닫기 + 플랜 보기(onRequestBilling?()) 두 개, 쿠폰 액션 없음.

[주장의 오차 — 결론은 안 바뀜]
- iOS showVoicePlanLockedAlert 는 1264-1276 이 아니라 1282-1301(18줄 드리프트). :122-126, :353-359, VoiceProfileManagementPanel.swift:181-186 은 정확.
- strings.xml 은 plan_gate_redeem_action 890(주장 887), r3dlg_plan_gate_confirm 833(주장 830).
- 호출부는 2곳이 아니라 3곳: AlarmTalkApp.kt:756(:765 onRedeemCode = viewModel::registerCode) / VoiceProfileManagementPanel.kt:1457(:1465 onRedeemCode = onRegisterCode) / AlarmEditorScreen.kt:1651. 편집기는 무조건이 아니라 조건부다 — AlarmEditorScreen.kt:1684 `onRedeemCode = if (gateReason == VoiceGateReason.PLAN_REQUIRED) onRegisterCode else null`. iOS .free 와 대응하는 PLAN_REQUIRED 갈래에서는 세 액션이 모두 뜨므로 파리티 갭 자체는 성립.

[다른 경로가 처리하나 — 아니다]
iOS 에 코드 등록 경로는 있으나 게이트와 연결이 없다: Views/Settings/MenuView.swift:62 '초대 코드 등록' → Views/Messages/VoiceMessagePanel.swift:48,102 registerCode, 그리고 1회성 웰컴 프로모 Views/Root/RootView.swift:125.

[예외 아님]
AlarmKit 제약과 무관. 플랫폼 표준도 아니다 — 같은 파일 AlarmEditorSheet.swift:392-405 가 이미 시스템 .alert 로 버튼 2개(바꾸기/닫기)를 그린다. 편집기 게이트가 1개인 건 구형 Alert(item:) API 선택의 결과일 뿐이고 .alert(_:isPresented:actions:) 는 버튼 N개를 지원한다. 쿠폰 입력창도 안드로이드가 알럿 밖 별도 다이얼로그로 뺐으므로(PlanGateDialog.kt:45-46) iOS 는 시트로 동형 구현이 가능하다.

[심각도]
"쿠폰 코드를 넣을 수 없다" 는 앱 전체로는 과장(더보기 경로 존재). "편집하던 알람을 잃는다" 는 구조적으로 맞다 — 편집기는 MainTabsView.swift:101 .sheet(item: $editorTarget) 라 결제/코드 화면으로 가려면 시트를 닫아야 하고 @State 가 소멸한다. 다만 잃는 건 저장 전 초안이지 기존 알람 데이터가 아니다. 데이터 손실·크래시·보안이 아니고 우회 경로가 있으므로 P1 은 아니다. 더 날카로운 쪽은 쿠폰이 아니라 편집기 게이트에 결제 경로가 통째로 없다는 점이다(목소리 탭은 '플랜 보기' 라도 있다).

</details>

### ☐ [plan-gate] iOS 무료 테마 화면에 잠긴 '직접 입력' 행이 없다 — 유료에 무엇이 있는지 알 길이 사라졌다

**안드로이드**: VoiceAudioCard.kt:655-661 — FreeBucketSettingsPane 의 버킷 라디오 목록 아래에 `SnoozeLockedRow(label = stringResource(R.string.editor_msg_mode_manual), onClick = onManualLocked)` 가 붙는다. 바로 위 주석 :656-657 이 의도를 못박는다: "무료에게도 '직접 입력'이 존재한다는 걸 보여준다. 목록에서 아예 빼면 이런 기능이 있는지조차 모르고, 유료 전환 동기 중 가장 강한 것을 잃는다." 행 모양은 AlarmSnoozeSettings.kt:369-390(자물쇠 배지 + 흐린 라벨).

**iOS**: Views/Editor/FreeBucketSettings.swift:82-105 — FreeBucketSettingsPane 은 `ForEach(available) { RadioRow(...) }` 와 안내 문구 한 줄("고른 테마의 문구가 알람마다 번갈아 나와요. 유료 이용권에서는 목소리를 직접 만들고 문구도 고를 수 있어요.") 뿐이고 잠긴 '직접 입력' 행이 없다.

**사용자 영향**: iOS 무료 사용자는 '직접 입력' 이라는 기능이 있다는 사실을 문구 화면에서 볼 수 없다. 안내 문구 한 줄로 대체돼 있어 안드로이드보다 유료 기능의 실체가 흐리고, 두 앱의 같은 화면이 다르게 보인다.

**고칠 방향**: FreeBucketSettings.swift 의 라디오 목록 아래에 잠금 배지 + '직접 입력' 라벨의 비활성 행을 추가하고, 탭하면 (개선된) 플랜 게이트를 띄운다. 단 **P1-1 을 먼저 고친 뒤에** 붙일 것 — 지금 구조 그대로 옮기면 iOS 에도 같은 '유료인데 로그인 요구' 경로가 생긴다. 안내 문구는 행이 생기면 중복이므로 함께 정리한다.

<details><summary>반증 검증 결과</summary>

반증 실패 — 주장은 코드로 확인된다. 다만 인용 좌표 2건이 틀렸으니 바로잡는다.

## 1. 인용 검증

**안드로이드 (내용 정확, 경로 오기)**
- 주장은 `ui/components/VoiceAudioCard.kt` 라 했으나 실제는 `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/editor/VoiceAudioCard.kt` 다. **줄 번호는 정확**하다.
- `VoiceAudioCard.kt:656-661` — 주석과 코드가 주장대로 있다:
  `// 무료에게도 '직접 입력'이 존재한다는 걸 보여준다. 목록에서 아예 빼면` / `// 이런 기능이 있는지조차 모르고, 유료 전환 동기 중 가장 강한 것을 잃는다.` 뒤에 `SnoozeLockedRow(label = stringResource(R.string.editor_msg_mode_manual), onClick = onManualLocked)`.
- `AlarmSnoozeSettings.kt:363-390` — `SnoozeLockedRow` 정의 확인. `FeatureLockBadge(size = 18.dp, iconSize = 11.dp)` + `onSurfaceVariant` 흐린 라벨(:381-388). 독스트링 :364-366 이 의도를 재확인한다("고를 수는 없지만 **목록에서 감추지도 않는다**").
- 문자열도 실재: `res/values/strings.xml:214` `<string name="editor_msg_mode_manual">직접 입력</string>`.
- 배선까지 확인: `AlarmEditorScreen.kt:1604` `onManualLocked = { voicePlanGateOpen = true }` → `PlanGateDialog`(:1633-1651), `VoiceGateReason` 3분기. :1640 주석이 이 경로를 명시한다("그 pane 의 잠긴 '직접 입력' 을 누르면 `onManualLocked` 가 이 게이트를 연다").

**iOS (내용 정확, 줄 번호 오기)**
- 주장은 `FreeBucketSettings.swift:82-105` 라 했으나 **파일 전체가 102줄**이라 그 범위는 파일을 벗어난다. 실제 좌표: `struct FreeBucketSettingsPane` 은 :54-102, `ForEach ... RadioRow` 는 :69-72, 안내 문구는 **:75** 다.
- 인용된 문구는 :75 에 **글자 그대로** 존재한다: "고른 테마의 문구가 알람마다 번갈아 나와요. 유료 이용권에서는 목소리를 직접 만들고 문구도 고를 수 있어요."
- 잠긴 '직접 입력' 행 없음 확인. 더 강한 증거: **iOS 시그니처에는 `onManualLocked` 파라미터 자체가 없다**(:58-60 `available` / `initialSelection` / `onSave` 셋뿐), 호출부 `AlarmEditorSheet.swift:302-306` 도 3개만 넘긴다.

## 2. 다른 경로가 처리하고 있는가 — 아니다

- `showVoicePlanLockedAlert()`(`AlarmEditorSheet.swift:1289-1308`)가 안드로이드 `PlanGateDialog` 의 대응물로 **이미 존재**하며 `planAccess` 3분기(loggedOut/free/paid)까지 같다. 호출처는 `AlarmEditorSheet.swift:757`, `:1424`, `AlarmModeSection.swift:14`, `:35` 뿐 — **무료 테마 pane 에서 닿는 길이 없다.**
- 잠금 행 관용구도 iOS 에 이미 있다: `Views/Common/FeatureLockBadge.swift`, `VoiceSelectionSheet.swift:74` (`Image(systemName: "lock.fill")`). 즉 부품은 다 있는데 이 화면에만 안 붙었다 — 의도적 플랫폼 결정이 아니라 누락이다.
- 무료 사용자에게 노출되는 다른 문구도 대체가 안 된다. `AlarmModeSection.swift:103-107` 은 `freeVoiceTier` 일 때 "무료에서는 시스템 목소리와 기본 랜덤 문구로 깨워드려요." 만 띄우고 **'직접 입력' 을 언급하지 않는다**. '직접 입력' 을 명시하는 :106 문구는 `freeVoiceTier == false`(유료 + 기본 목소리) 갈래 전용이다.
- 조건 자체는 양쪽이 같다: `restrictToWeatherMedication`(iOS `AlarmEditorSheet.swift:919-921`, 안드로이드 `AlarmEditorScreen.kt:190`)가 안드로이드에서도 `VoiceAudioCard.kt:251-256` 의 `FreeThemeSummaryRow` 와 같은 pane 을 띄운다. 무료 진입 조건은 동일하고 pane 내용만 갈린다.

## 3. CLAUDE.md 예외 해당 없음

AlarmKit 제약(울림 화면·알람 음량 슬라이더)과 무관하고, 플랫폼 표준도 아니다 — 잠긴 목록 행은 iOS 자체 관용구이며 같은 편집기의 `VoiceSelectionSheet.swift:74` 가 이미 쓰고 있다. 「다르면 iOS 가 틀린 것」에 그대로 걸린다.

## 4. 심각도 — P1 아님, P2

주장의 "알 길이 사라졌다" 는 **다소 과장**이다. iOS :75 안내 문구가 "유료 이용권에서는 … 문구도 고를 수 있어요" 로 유료 가치의 존재는 산문으로 전달한다. 실제로 없어진 것은 (a) '직접 입력' 이라는 **기능 이름**과 (b) 눌러서 이용권 게이트로 가는 **탭 경로** 둘이다.
동작 파손·데이터 손실·저장 오류는 없어 P1 은 아니다. 반면 모든 iOS 무료 사용자에게 상시 보이는 화면의 파리티 누락이고, 안드로이드가 주석으로 "유료 전환 동기 중 가장 강한 것" 이라 못박은 요소이며, 고치는 비용은 파라미터 1개 + 행 1개(게이트는 이미 있음)라 단순 nit(P3)로 내릴 것도 아니다. **P2** 가 맞다.

</details>

### ☐ [plan-gate] iOS 문구 화면은 직접 입력 월 한도를 아예 표시하지 않는다 (manualRemaining/manualLimit 이 항상 nil)

**안드로이드**: AlarmEditorScreen.kt:227-230 `LaunchedEffect(freeVoiceTier, onLoadManualQuota) { manualQuota = if (!freeVoiceTier && onLoadManualQuota != null) onLoadManualQuota() else null }`(유료만 조회), :1572-1573 `manualRemaining = manualQuota?.remaining, manualLimit = manualQuota?.limit` → AlarmRandomPromptSettings.kt:210-213 에서 `"$baseLabel ($manualRemaining/$manualLimit)"` 로 '직접 입력' 옆에 남은 횟수를 붙인다. 한도 소진은 게이트가 아니라 생성 실패로 나타난다 — AlarmEditorScreen.kt:948-951 `"MANUAL_TTS_QUOTA_EXCEEDED" -> editor_error_manual_tts_quota`.

**iOS**: Views/Editor/AlarmEditorSheet.swift:308-312 — MessageSettingsPane 호출에 `manualRemaining: nil, manualLimit: nil` 이 **리터럴 nil 로 하드코딩**돼 있다. 파라미터는 존재하나(MessageSettingsPane.swift:25-26 "이번 달 직접 입력 여유 — 유료이고 limit > 0 일 때만 보여준다") 채워 주는 쪽이 없다. `MANUAL_TTS_QUOTA_EXCEEDED` 에러 코드 매핑도 없다(VoiceStudioViewModel+ErrorMapping.swift 전체 grep — 미존재).

**사용자 영향**: iOS 유료 사용자는 이번 달 직접 입력이 몇 번 남았는지 알 수 없다. 한도를 다 쓰면 알람을 다 만든 뒤 저장 단계에서 처음 막히고, 그 실패 문구조차 매핑이 없어 일반 오류로만 보인다 — 유료인데 유료 기능이 이유 없이 실패하는 것으로 읽힌다.

**고칠 방향**: 안드로이드의 `onLoadManualQuota` 에 대응하는 조회를 iOS 에도 붙여(유료일 때만) AlarmEditorSheet.swift:311-312 의 nil 을 실제 값으로 채운다. 함께 ErrorMapping 에 `MANUAL_TTS_QUOTA_EXCEEDED` 를 추가해 안드로이드 `editor_error_manual_tts_quota` 와 같은 뜻의 문구를 낸다. 번역 카탈로그(Localizable.xcstrings)도 같이 고칠 것.

<details><summary>반증 검증 결과</summary>

반증 실패 — 인용된 모든 file:line 이 실재하고 주장대로다.

[안드로이드 근거 검증 — 전부 정확]
- apps/android-native/.../ui/editor/AlarmEditorScreen.kt:227-230 — `var manualQuota by remember { mutableStateOf<ManualQuotaResponse?>(null) }` + `LaunchedEffect(freeVoiceTier, onLoadManualQuota) { manualQuota = if (!freeVoiceTier && onLoadManualQuota != null) onLoadManualQuota() else null }` (유료만 조회). 정확.
- 같은 파일 :1572-1573 — `manualRemaining = manualQuota?.remaining, manualLimit = manualQuota?.limit`. 정확.
- AlarmRandomPromptSettings.kt:207-215 — `manualLimit != null && manualLimit > 0 && manualRemaining != null` 일 때 `"$baseLabel ($manualRemaining/$manualLimit)"`. 파라미터 선언은 :70-71. 인용한 210-213 이 이 블록 안이다.
- AlarmEditorScreen.kt:949-951 — `"MANUAL_TTS_QUOTA_EXCEEDED" -> context.getString(R.string.editor_error_manual_tts_quota)`. 문자열 3개국어 존재(values/strings.xml:186, values-en:184, values-ja:184).
- 배선: AlarmTalkApp.kt:1143,1190 `onLoadManualQuota = viewModel::loadManualQuota` → MainViewModelVoiceActions.kt:578 → TtsApi.kt:127-128 `@GET("tts/manual-quota")`.

[iOS 근거 검증 — 정확, 주장보다 더 깊음]
- Views/Editor/AlarmEditorSheet.swift:312-313 — `manualRemaining: nil, manualLimit: nil` 리터럴 하드코딩(호출 시작은 309).
- Views/Editor/MessageSettingsPane.swift:25-27 파라미터 존재, :236-241 `rowLabel` 이 `"\(option.label) (\(max(remaining,0))/\(limit))"` 로 렌더 준비까지 완료 — 입력만 영원히 nil.
- ⚠ API 배선 자체가 없다: iOS 전체 grep 에서 `tts/manual-quota` 0건. AlarmTalkAPI.swift 의 쿼터 호출은 `voice/draft-quota`(:202-205, 목소리 등록 쿼터로 성격이 다름) 하나뿐이고 ManualQuotaResponse 대응 모델도 없다. "채워 주는 쪽이 없다"가 아니라 가져올 경로가 아예 없다.
- 에러 매핑 부재 확인: VoiceStudioViewModel+ErrorMapping.swift:44-72(localizedVoiceMessage), :96-108(knownErrorCodes) 어디에도 MANUAL_TTS_QUOTA_EXCEEDED 없음.

[주장이 오히려 과소평가한 부분]
서버는 한국어 안내를 함께 준다 — packages/backend/src/routes/tts.ts:1345-1348 `error: '이번 달 직접 입력 문구 만들기 횟수를 모두 사용했어요.', error_code: 'MANUAL_TTS_QUOTA_EXCEEDED'` (429). 그런데 AlarmTalkAPI.swift:729-732 가 `errorCode: serverError?.errorCode` 를 실어 주므로 ErrorMapping.swift:11-13 의 코드 우선 분기가 먼저 잡히고, 미등록 코드라 default(:69-70) 로 떨어져 "목소리를 처리하지 못했어요. 잠시 후 다시 시도해 주세요." 가 뜬다. `.server` 폴백의 `trimmed.containsKorean ? trimmed`(:37)까지 도달하지 못해 서버의 정확한 문구가 버려지고, 이번 달엔 성공할 수 없는 재시도를 지시하는 문구로 바뀐다. 표시 경로는 VoiceStudioViewModel.swift:903 (generateTTS catch → statusMessage = mapVoiceError(error)).

[다른 처리 경로 없음]
iOS 전체 "이번 달" grep 결과는 전부 목소리 등록 쿼터(VoiceProfileManagementPanel.swift:290-291 등)이고 직접 입력 TTS 쿼터를 보여주는 곳은 없다.

[예외 해당 여부]
AlarmKit 제약도 플랫폼 표준도 아니다 — 단순 데이터 조회 + 라벨 표시. iOS 편집기는 freeVoiceTier(AlarmEditorSheet.swift:905)를 이미 보유해 안드로이드와 동일 게이트를 그대로 적용 가능하다.

[심각도]
한도는 실재·유한: packages/backend/src/lib/manual-tts-quota.ts:9-13 personal 30 / couple 50 / family 100. 무료는 직접 입력 자체가 막혀 영향 대상은 유료 사용자. 데이터 손실·크래시·보안 문제는 없어 P1 은 아니고, 오류 문구가 사용자를 무의미한 재시도로 유도하므로 단순 표시 누락(P3)보다는 무겁다 → P2.

</details>

### ☑ [ringing] iOS: 끄기/다시 울림을 눌러도 in-app 목소리가 멈추지 않는다 — stop() 호출부가 '알람이 목록에서 사라졌을 때' 하나뿐

**안드로이드**: apps/android-native/.../alarm/RingingService.kt:128-161 — onStartCommand 의 세 액션(ACTION_DISMISS:141 / ACTION_DISMISS_SILENT:149 / ACTION_SNOOZE:154)이 모두 dismiss():610 또는 snooze():625 로 간다. snooze() 는 :626 에서 먼저 stopRingingOutputs(alarmId) 를 부르고, dismiss() 는 :615 에서 부른다. stopRingingOutputs:653 → stopMediaAndVibration:682 → stopMediaOnly:687 이 voiceLoopActive=false, cancelVoiceRepeatJob(), mediaPlayer.stop()/release() 를 수행한다. 즉 '어떤 경로로 끝나든 소리가 먼저 죽는다'.

**iOS**: apps/ios-native/AlarmTalk/AlarmKitViewModel.swift:224 — `AlarmVoicePlayer.shared.stop()` 의 유일한 호출부이며 disappearedIDs 루프(:219) 안에 있다(전 저장소 grep 결과 호출부 1곳). Shared/AlarmIntents.swift:51-71 StopAlarmIntent.perform 은 AlarmManager.stop + ctx.handleAlarmStopped 만 부르고, :106-158 SnoozeAlarmIntent.perform 은 AlarmManager.countdown + ctx.handleAlarmSnoozed 만 부른다. AlarmAppContext.swift:49-65 handleAlarmStopped / :87-104 handleAlarmSnoozed 어느 쪽도 AlarmVoicePlayer 를 건드리지 않는다. 스누즈는 같은 id 로 countdown(id:) 을 걸므로 알람이 목록에서 사라질 수 없어 disappearance 분기가 원천적으로 안 돈다. 주간 반복 알람도 마찬가지다 — AlarmKitViewModel.swift:315-318 주석이 '네이티브 .relative 알람은 발화해도 alarmKitID 를 유지하고 AlarmKit 이 recurrence 를 소유한다'고 스스로 밝히고 있다. 그런데 AlarmVoicePlayer.swift:33 주석은 "`dismissed` / `stopped` / `snoozed` 에서는 `AlarmVoicePlayer.shared.stop()`" 이라고 적혀 있다 — 코드에 없는 동작이다.

**사용자 영향**: 목소리가 30초를 넘거나 스테이징이 실패해 .cachedAudio 경로(AlarmSoundResolver.swift:88/99, AlarmKitViewModel.swift:272-275)로 떨어진 알람에서, 사용자가 '다시 울리기'나 '알람 끄기'를 눌러도 목소리가 계속 나온다. voiceRepeat 기본값이 true 라(LocalAlarmRecord.swift:204,372) AlarmVoicePlayer.swift:151-162 의 repeatTask 가 900ms 간격으로 무한 반복하고, 세션이 .playback + .mixWithOthers 라(:96) 앱을 백그라운드로 보내도 계속 재생된다. 시스템 알럿과 Live Activity 는 이미 사라진 뒤라 화면에 멈출 버튼이 하나도 없다 — 앱을 강제 종료해야 소리가 그친다. 스누즈 5분 내내 목소리가 낭독되는 것이 기본 시나리오다.

**고칠 방향**: StopAlarmIntent.perform 과 SnoozeAlarmIntent.perform 의 양쪽 분기, 혹은 더 낫게는 AlarmAppContext.handleAlarmStopped / handleAlarmSnoozed 진입부에서 `AlarmVoicePlayer.shared.stop()` 을 부른다(두 곳으로 수렴시키면 LiveActivity·시스템 알럿·disappearance 세 경로가 모두 덮인다). 안드로이드가 '해제/스누즈 = 먼저 출력을 끈다'를 stopRingingOutputs 한 곳으로 모아 둔 것과 같은 구조. 아울러 AlarmVoicePlayer.swift:33 의 사실과 다른 주석을 고친다.

<details><summary>반증 검증 결과</summary>

반증 실패 — 핵심 메커니즘은 코드로 확인된다. 다만 영향 범위는 과장됐다.

【인용 검증: 모두 실재하고 주장대로】
- apps/ios-native/AlarmTalk/AlarmKitViewModel.swift:224 `AlarmVoicePlayer.shared.stop()` — apps/ios-native 전체 grep 결과 외부 호출부는 이 한 곳뿐(나머지는 :274 재생, AlarmVoicePlayer.swift:206-210 디코드 에러 자가 복구). :221 `for kitID in disappearedIDs` 루프 안에 있는 것 맞다.
- Shared/AlarmIntents.swift:51-71 StopAlarmIntent.perform → AlarmManager.stop(:58) + ctx.handleAlarmStopped(:64). :107-158 SnoozeAlarmIntent.perform → countdown(:135)/deny 시 stop(:128) + handleAlarmSnoozed(:139). 어느 쪽도 AlarmVoicePlayer 를 건드리지 않는다.
- AlarmAppContext.swift:49-65 handleAlarmStopped, :87-104 handleAlarmSnoozed — 플레이어 참조 없음.
- 이 인텐트들이 실제 시스템 alert 버튼에 물려 있다: AlarmKitViewModel.swift:594-595 `stopIntent:`/`secondaryIntent:`, :549 `secondaryButtonBehavior: .custom`.
- AlarmVoicePlayer.swift:33 주석("dismissed/stopped/snoozed 에서는 stop()")은 코드에 없는 동작 — 문서/코드 괴리 확인.
- 반복 재생·백그라운드 지속도 사실: voiceRepeat 기본 true(LocalAlarmRecord.swift:204,372), repeatTask 900ms 재무장(AlarmVoicePlayer.swift:43,151-162), 세션 .playback+.mixWithOthers(:96), Info.plist:45-48 UIBackgroundModes 에 `audio` 포함.
- 안드로이드 근거 줄번호 정확: RingingService.kt:128/141/149/154 → dismiss():610(stopRingingOutputs :615) / snooze():625(:626) → :653 → stopMediaAndVibration:682 → stopMediaOnly:687.

【실제로 구멍이 남는 경로 — 2개】
1) 다시 울림(모든 알람): countdown(id:) 은 알람을 목록에 남기므로 disappearedIDs 에 절대 안 들어간다 → stop() 미호출. 스누즈 대기 내내(그리고 그 이후로도) 목소리가 900ms 간격으로 무한 반복된다.
2) 주간 반복 알람의 끄기: makeSchedule 이 `.relative(.weekly(...))`(AlarmKitViewModel.swift:507-512)로 무장하고, LocalAlarmStore.swift:295-300 이 "네이티브 `.relative` 반복 알람은 AlarmKit 이 여전히 소유하므로 alarmKitID 를 비우지 않는다"고 명시한다 → 정지해도 목록에 남아 disappearance 가 안 돈다 → stop() 미호출.
CLAUDE.md 예외에 해당하지 않는다: 울림 화면(AlarmKit 소유)이나 플랫폼 표준 알럿 문제가 아니라, 우리가 소유한 AVAudioPlayer 를 우리 프로세스에서 도는 인텐트(StopAlarmIntent/SnoozeAlarmIntent.perform, 둘 다 @MainActor + ALARMTALK_APP)에서 한 줄로 끌 수 있는데 안 끄는 것이다.

【주장의 과장 — 심각도 하향 근거】
- "끄기를 눌러도 멈추지 않는다"는 단발 알람에 대해 틀렸다. `.relative(.never)`/`.fixed` 는 stop 후 AlarmKit 목록에서 사라지고, AlarmKitViewModel.swift:204-215 의 dismiss 감지 설계 자체가 그 전제 위에 서 있다 → disappearedIDs → :224 stop() 이 실제로 돈다.
- "목소리가 30초를 넘으면 .cachedAudio" 도 틀렸다. AlarmSoundResolver.swift:91-99 가 길이 초과분을 30초 캡으로 재-staging 해 `.bundledNamed` 로 승격시키므로, :88/:99 에 닿으려면 `AlarmSoundStaging.stage` 가 throw 해야만 한다. 서버 TTS 는 mp3/m4a/wav 로 떨어지고(AudioCacheStore.swift:567-572) 셋 다 transcodable(AlarmSoundStaging.swift:149-161)이라 정상 경로에서는 staging 이 성공한다 — 즉 전제 조건은 예외 경로(트랜스코드 실패, ogg/미상 mime)다.
- "앱을 강제 종료해야 소리가 그친다" 도 과장. 알람 토글 off/삭제가 AlarmManager.cancel(AlarmKitViewModel.swift:458-473)로 목록에서 지우면 disappearance 가 돌아 stop() 이 호출된다. 다만 사용자가 알아채기 어려운 탈출구다.

따라서 P1 이 아니라 P2. 회귀 테스트도 없다(AlarmTalkTests 전체에 processAlarmUpdate/disappearance/voice-stop 커버리지 0, AlarmIntentsTests.swift:9-50 은 파라미터·no-context no-op 만 검증).

</details>

### ☑ [ringing] iOS: 다른 알람이 목록에서 사라지면 지금 울리는 알람의 목소리가 끊긴다 — 소유권 확인이 없다

**안드로이드**: apps/android-native/.../alarm/RingingService.kt:58-71 `ringingTeardownBelongsToCurrentAlarm(currentAlarmId, completedAlarmId)` 이 정확히 이 문제(Codex #666 P1)를 막으려고 존재한다. :664-668 에서 이 판정이 false 면 stopMediaAndVibration() 을 건너뛰고 자기 인계 표시만 거둔 뒤 빠진다 — 주석(:59-63)에 '늦게 도는 마무리가 이미 다른 알람으로 넘어간 서비스의 소리·진동·알림을 끄면 새 알람이 소리 없이 살아 있다'고 명시.

**iOS**: apps/ios-native/AlarmTalk/AlarmKitViewModel.swift:216-224 — disappearedIDs(= previouslyKnownIDs ∪ activeStoredIDs − currentIDs) 를 도는 루프 첫 줄이 조건 없는 `AlarmVoicePlayer.shared.stop()` 이다. 사라진 kitID 와 지금 재생 중인 레코드가 같은지 보지 않는다. AlarmVoicePlayer 는 `private(set) var currentRecordID`(AlarmVoicePlayer.swift:53)를 공개하고 있어 확인이 가능한데도 쓰지 않는다.

**사용자 영향**: 알람 B 가 울리며 in-app 목소리를 재생하는 동안, 사용자가 알람 목록에서 다른 알람 A 를 지우거나 끄면(cancelScheduledAlarm → AlarmManager.cancel → 다음 alarmUpdates emit 에서 A 가 사라짐) B 의 목소리가 그 자리에서 끊긴다. 같은 시각에 두 알람이 걸려 A 를 먼저 끈 경우도 같다. 알람은 계속 울리는데 목소리만 사라지므로 '왜 목소리가 안 나오지'로 보인다.

**고칠 방향**: `if AlarmVoicePlayer.shared.currentRecordID == recordBeforeStop?.id { AlarmVoicePlayer.shared.stop() }` 처럼 소유권을 확인하고 끈다. 안드로이드 ringingTeardownBelongsToCurrentAlarm 과 같은 규칙(대상을 모르면 끈다, 다른 알람이면 빠진다)을 그대로 이식하고 회귀 테스트를 붙인다.

<details><summary>반증 검증 결과</summary>

반증 실패 — 인용된 코드가 전부 주장대로 존재하고, 다른 경로가 이를 보완하지도 않는다.

**1. 인용 검증 (전부 사실)**
- `apps/ios-native/AlarmTalk/AlarmKitViewModel.swift:217-224` — `disappearedIDs = previouslyKnownIDs.union(activeStoredIDs).subtracting(currentIDs)` 이고, `for kitID in disappearedIDs {` (:221) 의 두 번째 줄 `:224` 가 조건 없는 `AlarmVoicePlayer.shared.stop()` 이다. 사라진 `kitID` 와 재생 중인 레코드를 대조하는 코드가 없다. 심지어 `let recordBeforeStop = store.recordByAlarmKitID(kitID)`(:222) 로 레코드를 이미 손에 쥐고 있는데, 그 값은 `:228` 의 `recordBeforeStop != nil` 분기에만 쓰이고 stop 판정에는 쓰이지 않는다.
- `apps/ios-native/AlarmTalk/AlarmVoicePlayer.swift:53` — `private(set) var currentRecordID: String?` 실재. 내부 재진입 가드(:87 `if currentRecordID == record.id`)로는 쓰지만 외부 소유권 판정에는 아무도 안 쓴다(`grep currentRecordID` 결과 전부 AlarmVoicePlayer.swift 내부).
- `apps/android-native/.../alarm/RingingService.kt:59-71` KDoc + `internal fun ringingTeardownBelongsToCurrentAlarm`(:68), `:664-668` 의 `if (!ringingTeardownBelongsToCurrentAlarm(ringingAlarmId, completedAlarmId)) { releaseRingingMarkers(...); return }` — `stopMediaAndVibration()`(:669) 을 건너뛴다. 주석에 Codex #666 P1 명시. 안드로이드 근거도 정확하다.

**2. 다른 경로가 막아 주는가 — 아니다**
- `AlarmVoicePlayer.shared.stop()` 호출부는 **저장소 전체에서 `AlarmKitViewModel.swift:224` 하나뿐**이다(`playIfNeeded` 도 `:274` 하나뿐). `AlarmAppContext.handleAlarmStopped`(AlarmAppContext.swift:49)·`Shared/AlarmIntents.swift:64,132` 어디에도 플레이어를 만지는 코드가 없다.
- `stop()`(AlarmVoicePlayer.swift:166-189) 은 `stopPlayback(deactivateSession: true)` → `player?.stop()` + `resetPlaybackState` 로 **무조건** `currentRecordID = nil`(:185), `voiceHasPlayedThisRing = false`(:184), `repeatTask` 취소(:171-172) 까지 밀어 버린다. 소유자 확인 없음.
- **복구되지 않는다.** 재생 재진입은 `didEnterAlerting`(:248-250) 하나뿐인데 이건 스냅샷 엣지 트리거다 — B 는 직전 emit 에서 이미 `alerting` 이라 `previousStateRaw?.contains("alerting") != true` 가 false → 그 회차 목소리는 영구 소실. (`lastAlarmStateSnapshot = currentSnapshot` :280)
- 트리거 경로도 실재: `cancelScheduledAlarm`(:458-473) 의 `try AlarmManager.shared.cancel(id: alarmKitUUID)`(:462) → 다음 emit 에서 A 가 `currentIDs` 에서 빠짐 → `previouslyKnownIDs` 차집합에 포함.

**3. CLAUDE.md 예외 아님** — AlarmKit 제약(울림 화면 소유·음량 슬라이더)도, 플랫폼 표준 알럿도 아니다. `AlarmVoicePlayer` 는 우리가 소유한 `AVAudioPlayer` 이고, 소유권 판정에 필요한 값(`currentRecordID`, `store.recordByAlarmKitID(kitID)?.id`)이 이미 그 자리에 다 있다. 회귀 테스트도 없다 — `AlarmTalkTests/AlarmVoicePlayerTests.swift` 는 `voiceVolume(forPercent:)` 세 줄이 전부(:9-11).

**4. 심각도는 과장 — P1 이 아니라 P2**
주장이 놓친 완화 요인이 하나 있다. in-app 폴백 자체가 **정상 경로가 아니다**: `AlarmSoundResolver.resolve`(AlarmSoundResolver.swift:83-99) 는 30초 이내면 `AlarmSoundStaging.stage` 를 시도해 성공 시 `.bundledNamed` 를 돌려주고(:85), 30초 초과여도 stage 를 한 번 더 시도해 성공하면 `.bundledNamed` 로 승격한다(:96-97). `.cachedAudio`(=`requiresInAppFallback`, :25-28)는 **staging 이 실패했을 때만** 나온다. 즉 정상 기기에서는 AlarmKit 이 목소리를 직접 울리고 `AlarmVoicePlayer` 에 플레이어가 없어 `:224` 는 무해한 no-op 이다.
따라서 발현 조건은 ①staging 실패(퇴화 경로) **그리고** ②그 재생 중 다른 kitID 가 사라짐(같은 시각 두 알람 중 하나를 먼저 끔 / 앱 포그라운드에서 다른 알람 삭제·비활성·편집) 의 곱이다. 데이터 손실은 없고 OS 톤은 계속 울려 알람 자체는 깨운다. 결함은 실재하고 안드로이드가 명시적으로 막아 둔 것과 정확히 같은 형태이므로 고쳐야 하지만, 등급은 P2 가 적정하다.

</details>

### ☑ [screens-flow] '누구를 깨울까요?' 에서 고른 구성원이 편집기로 전달되지 않는다 — 항상 첫 번째 구성원에게 간다

**안드로이드**: apps/android-native/.../ui/app/AlarmTalkApp.kt:797-810 — 시트의 각 행이 `startCreateAlarm(familyTargetMode = true, targetUserId = recipient.userId)` 로 **고른 사람의 id 를** 넘기고, 라우트 인자(`AppRoute.TargetUserIdArg`)로 실려 :1113-1130 에서 `initialFamilyRecipientId = targetUserId` 로 편집기에 주입된다. 주석(:795-796)이 목적을 명시한다 — "대상을 사람별로 바로 고른다 … 자동선택으로 엉뚱한 사람에게 알람이 가는 일을 막는다".

**iOS**: apps/ios-native/AlarmTalk/Views/Alarms/AlarmsListView.swift:82-85 — `onSelectRecipient: { _ in wakeTargetSheetOpen = false; openEditor(.createFamily()) }` 로 **선택한 recipient 를 `_` 로 버린다.** Views/Auxiliary/AuxiliaryScreen.swift:27-44 의 `AlarmEditorTarget` 에는 대상 사용자 필드 자체가 없다(`id`/`editingAlarmID`/`familyAlarmMode` 뿐). 그래서 Views/Editor/AlarmEditorSheet.swift:1278-1288 `selectDefaultFamilyRecipientIfNeeded()` 가 `familyRecipients.first` 를 자동 선택한다.

**사용자 영향**: 가족 구성원이 둘 이상일 때, 시트에서 '아빠' 를 골라도 편집기는 목록 첫 사람('엄마')으로 열린다. 사용자가 편집기 안에서 대상을 다시 확인하지 않으면 **엉뚱한 사람의 폰이 새벽에 울린다.** 시트에서 각 행에 '받지 않는 시간' 을 보여준 것도 무의미해진다.

**고칠 방향**: `AlarmEditorTarget` 에 `familyRecipientID: String?` 를 추가하고 `createFamily(recipientID:)` 로 넘긴다. AlarmEditorSheet 의 `selectDefaultFamilyRecipientIfNeeded()` 는 target 이 준 id 가 있으면 그것을 우선 선택하고, 없을 때만 first 로 폴백하도록 고친다(안드로이드 `initialFamilyRecipientId` 와 동일 규칙).

<details><summary>반증 검증 결과</summary>

코드로 확인됨 — 인용 근거가 (한 곳의 줄번호 오차를 빼면) 전부 사실이다.

**안드로이드(원본)는 고른 사람을 끝까지 나른다**
- `apps/android-native/.../ui/app/AlarmTalkApp.kt:795-796` 주석이 목적을 명시("가족 알람: 대상을 사람별로 바로 고른다 … 자동선택으로 엉뚱한 사람에게 알람이 가는 일을 막는다"), `:807` 이 `startCreateAlarm(familyTargetMode = true, targetUserId = recipient.userId)` 로 **고른 사람의 id** 를 넘긴다(내 알람 행은 `:791` 에서 id 없이).
- `:635-642` `startCreateAlarm` → `AppRoute.alarmCreate(..., targetUserId = ...)`, 권한 팝업 경유 시에도 `:638` `pendingCreateAlarmAfterPermission = familyTargetMode to targetUserId` 로 보존.
- `:1114` `entry.arguments?.getString(AppRoute.TargetUserIdArg)` → `:1130` `initialFamilyRecipientId = targetUserId`.
- `apps/android-native/.../ui/editor/AlarmEditorScreen.kt:249-254` — `initialFamilyRecipientId?.takeIf { 유효한 멤버 } ?: familyRecipients.firstOrNull()` (주석: "시트에서 사람을 미리 골라 들어온 경우 그 사람으로 연다. 유효하지 않으면 첫 멤버로 폴백").

**iOS 는 그 선택을 버린다**
- `apps/ios-native/AlarmTalk/Views/Alarms/AlarmsListView.swift:82-85` — `onSelectRecipient: { _ in wakeTargetSheetOpen = false; openEditor(.createFamily()) }`. 클로저 인자를 `_` 로 버린다. 값이 없어서가 아니다 — `Views/Alarms/WakeTargetSheet.swift:13-14, 32-35` 가 `onSelectRecipient: (FamilyGroupMember) -> Void` 로 **선택한 구성원 객체를 그대로 넘겨주고** 있다.
- `Views/Auxiliary/AuxiliaryScreen.swift:27-50` — `AlarmEditorTarget` 필드는 `id`/`editingAlarmID`/`familyAlarmMode` 셋뿐. `createFamily()`(:42-44)는 인자를 받지 않는다. 대상 사용자를 실을 통로 자체가 없다.
- `Views/Editor/AlarmEditorSheet.swift:69` — `@State var selectedFamilyRecipientID: String?` 초기값 nil. 채워지는 경로는 둘뿐이다: 편집기 안 피커의 `selectFamilyRecipient`(:1375-1376), 그리고 자동선택 `selectDefaultFamilyRecipientIfNeeded()`(**실제 위치 :1310-1319** — 주장의 :1278-1288 은 오차, 함수 내용은 주장대로 `familyRecipients.first` 를 고른다). 호출 지점은 :385(가족 모드 refresh 직후), :1080(신규 draft 로드).
- 저장도 그 값을 그대로 쓴다: `:1055-1061` `selectedFamilyRecipient` 가 nil 이면 `familyRecipients.first` 폴백, `:1440` `validateFamilyAlarmTarget()`, `:1486-1487` `targetUserId: selectedFamilyRecipient?.userId`. 즉 **잘못 선택된 첫 사람에게 실제로 발송된다.**
- 부수 효과까지 어긋난다: `:1375-1386` `selectFamilyRecipient` 가 그 사람의 날씨/사주 설정을 `voiceStudio` 에 로드하므로, 첫 사람 기준의 날씨·운세 문구가 들어간다.

**놓친 경로 없음** — `grep -rn "createFamily|AlarmEditorTarget|familyAlarmMode|selectedFamilyRecipientID"` 전수 확인 결과 iOS 에 선택을 기억·전달하는 다른 경로(영속 저장, 뷰모델 공유 상태)는 없다. 가족 편집기 진입점도 이 시트 하나뿐이다(`AlarmsListView.swift:278-287` `presentCreateEntry`, FAB 는 `MainTabsView.swift:68, 89` 로 `familyAlarmMode: false` 만 만든다).

**예외 아님** — AlarmKit(울림 화면·음량)과 무관하고, 시스템 `.alert` 플랫폼 표준과도 무관한 순수 상태 전달 누락이다. CLAUDE.md 「iOS 는 안드로이드를 원본으로 삼는다」에 따라 iOS 가 틀렸다.

**심각도는 P1 이 아니라 P2** — 주장의 "사용자가 편집기 안에서 대상을 다시 확인하지 않으면" 이라는 전제는 맞지만, 대상이 숨겨져 있지는 않다. `AlarmEditorSheet.swift:193-206` 이 편집기 상단(시각 카드 바로 아래)에 "알람 받을 사람" 섹션 + `FamilyAlarmTargetPicker` 를 항상 펼쳐 놓고, `Views/Editor/AlarmEditorComponents.swift:243-268` 이 선택된 행을 강조하고 그 사람의 '받지 않는 시간'·차단 상태까지 표시한다. 즉 잘못된 대상이 화면에 보이고 탭 한 번으로 고칠 수 있으며, 영향 범위도 수신 허용 구성원이 2명 이상인 커플/가족 이용권 사용자로 한정된다(`AlarmsListView.swift:92-99` 필터). 그럼에도 안드로이드가 명시적으로 막으려 한 오발송이 iOS 에서 그대로 발생하므로 실제 결함이다.

</details>

### ☐ [screens-flow] '목소리 받기' 게이트 통과가 저장되지 않아 콜드 스타트마다 다시 뜬다

**안드로이드**: apps/android-native/.../ui/main/MainViewModel.kt:797 `showVoiceSetup = cachedStockClips == 0 && !defaultVoiceStore.hasSkipped(userId)` — 클립을 받았거나 '나중에 받기' 를 눌러 `hasSkipped` 가 남으면 다시 뜨지 않는다. :819 `skipVoiceSetup()` 이 그 플래그를 쓰고, :830 `completeVoiceSetupIfDownloaded()` 가 캐시가 생겼는지로 게이트를 닫는다.

**iOS**: apps/ios-native/AlarmTalk/Views/Root/RootView.swift:195-205 — `refreshOnboardingCompletion()` 은 `DefaultVoicePreferenceStore().hasCompletedSetup(userID:)` 를 읽고, `completeVoiceSetup()` 은 `voiceSetupDone = true` 로 **메모리 상태만** 바꾼다. 판정에 필요한 두 키(`default_voice_<uid>` / `default_voice_setup_skipped_<uid>`, DefaultVoicePreferenceStore.swift:74-86)를 쓰는 프로덕션 호출자가 없다 — `VoiceStudioViewModel.swift:186-188 skipVoiceSetup()` 은 어디서도 호출되지 않고, `setDefaultVoiceId` 를 부르는 곳도 UIPreviewSeed.swift:58-60(DEBUG) 뿐이다. VoiceSetupView.swift:82-86 은 진입 6초 뒤에야 탈출구를 그린다.

**사용자 영향**: 앱을 껐다 켤 때마다, 계정을 바꿀 때마다 '알람에 쓸 목소리를 받고 있어요' 전체 화면이 다시 뜬다. 네트워크가 없으면 StockClipPrefetcher 가 실패해(StockClipPrefetcher.swift:110-112) '목소리를 받지 못했어요' 화면이 뜨고, **최소 6초 동안 홈으로 갈 버튼조차 없다.** 안드로이드는 이 화면을 계정당 사실상 한 번만 보여준다.

**고칠 방향**: `RootView.completeVoiceSetup()` 에서 `VoiceStudioViewModel.skipVoiceSetup()`(= `markSkipped`)을 호출해 플래그를 영구 저장한다. 나아가 안드로이드처럼 '받아 둔 클립이 있으면 게이트를 열지 않는' 판정(AudioCacheStore 의 스톡 캐시 개수 > 0)을 `hasCompletedSetup` 과 OR 로 묶으면, 다운로드가 성공한 경우에도 다시 뜨지 않는다.

<details><summary>반증 검증 결과</summary>

반증 실패 — 코드로 확인된다.

1) 인용 줄은 모두 실재하고 주장대로다.
- 안드로이드: MainViewModel.kt:797 `showVoiceSetup = cachedStockClips == 0 && !defaultVoiceStore.hasSkipped(userId)`, :817-819 `skipVoiceSetup()`→`markSkipped`, :828-830 `completeVoiceSetupIfDownloaded()`(캐시>0 이면 닫음). 둘 다 프로덕션에 연결돼 있다(AlarmTalkApp.kt:989 `completeVoiceSetupIfDownloaded`, :1004 `onSkip = viewModel::skipVoiceSetup`), 재평가 진입점은 AlarmTalkApp.kt:443 `checkVoiceSetupFor`. 두 닫기 경로 모두 **영속**이며 기기 스코프라 다음 실행에 네트워크가 필요 없다.
- iOS: RootView.swift:195-201 `refreshOnboardingCompletion()` 이 `DefaultVoicePreferenceStore().hasCompletedSetup(userID:)` 를 읽고, :203-205 `completeVoiceSetup()` 은 `voiceSetupDone = true` 만 한다. 그 값은 RootView.swift:18 의 `@State` 이고 :105-107 `.task(id: auth.session?.user.id)` 로 매번 다시 계산된다 → 콜드 스타트·계정 전환마다 초기화된다.
- DefaultVoicePreferenceStore.swift:74-86 `hasCompletedSetup = hasChosen || hasSkipped`(키 `default_voice_<uid>` :116-119, `default_voice_setup_skipped_<uid>` :131-134).

2) 놓친 경로 없음 — 두 키의 **프로덕션 기록자가 0개**다(전수 grep).
- `setDefaultVoiceId` 호출: VoiceStudioViewModel.swift:161(`setDefaultVoice`) 와 UIPreviewSeed.swift:60(DEBUG) 뿐. `setDefaultVoice` 를 부르는 곳은 같은 파일 :182 `completeVoiceSetup(voiceId:listenerTitle:)` 하나이고, 그 함수는 **호출자가 없다**.
- `markSkipped` 호출: VoiceStudioViewModel.swift:187 `skipVoiceSetup()`(호출자 없음) 과 UIPreviewSeed.swift:59(DEBUG) 뿐.
- 알람 저장 경로는 **일부러 다른 키**를 쓴다: AlarmEditorSheet.swift:1666 `setLastUsedVoiceId` → `last_voice_<uid>`(DefaultVoicePreferenceStore.swift:126-128). 이 분리는 테스트로 고정돼 있다(AlarmTalkTests/DynamicPromptPreferenceStoreTests.swift:141-151 "온보딩 완료로 바뀌면 안 된다"). 즉 알람을 아무리 저장해도 게이트는 안 닫힌다.
- AuthViewModel.swift:717,743 은 명시적 로그아웃·탈퇴에서 `clear` 만 한다(기록 아님).

3) 주장이 놓친, 더 나쁜 사실: iOS 에는 안드로이드의 '파일이 있으면 닫는다' 경로 자체가 없다. `cachedStockClipCount` 대응물이 없고(iOS 는 AudioCacheStore.swift:148 `stockCacheKey` 만 있고 StockClipPrefetcher.swift:71-76 안에서만 쓴다), 그래서 클립이 전부 캐시돼 있어도 **매 실행 `getStockClips` 왕복이 성공해야** 화면이 닫힌다(VoiceSetupView.swift:87-89 `.onChange(state == .finished)`). 오프라인이면 StockClipPrefetcher.swift:110-112 로 `.failed` → VoiceSetupView.swift:32 '목소리를 받지 못했어요' 전체 화면.

4) 탈출구 비교도 주장대로다. iOS 는 VoiceSetupView.swift:82-86 에서 6초 sleep 뒤에야 `showEscape = true`(:66-71), 실패 시 즉시 있는 건 '다시 시도'(:61-64)뿐이다. 안드로이드는 VoiceOnboardingScreen.kt:100 `showEscape = failed || stalled || graceElapsed` 로 **실패·정체면 즉시** 열고(AlarmTalkApp.kt:1001 `stockPrefetchStalled`, state.isFinished 포함), 12초 유예는 모르는 조합용이다.

5) CLAUDE.md 예외 아님 — AlarmKit 제약(울림 화면·알람 음량)도, 플랫폼 표준 알럿도 아니다. 그냥 안드로이드가 영속화하는 상태를 iOS 가 영속화하지 않는 파리티 결함이다.

심각도: P2. 데이터 손실은 없고 6초 뒤(온라인이면 보통 1초 이내 자동 닫힘) 빠져나올 수 있으나, 매 콜드 스타트·매 계정 전환마다 전체 화면 온보딩이 다시 뜨고 오프라인에서는 매번 6초간 홈 진입이 막힌다(안드로이드는 기기당 사실상 1회).

</details>

### ☐ [screens-flow] 동의 확인 결과 캐시가 없어 콜드 스타트마다 전체 화면 스피너를 본다

**안드로이드**: apps/android-native/.../ui/main/MainViewModelAuthActions.kt:601-617 — `isConsentCachedDone(userId)` 면 `consentChecked = true` 로 **즉시** 통과시키고, 캐시가 없을 때만 로딩을 건다. AlarmTalkApp.kt:948-957 의 로딩 게이트가 보는 값도 그 `consentChecked` 다. 즉 이미 동의를 마친 계정은 재실행 시 홈이 바로 뜬다.

**iOS**: apps/ios-native/AlarmTalk/Views/Root/RootView.swift:53-66 — `!auth.consentStatusChecked` 이면 무조건 `AuthBackdrop { ProgressView() }`. 그 값은 AuthViewModel.swift:775-799 `checkConsentStatus()` 의 **응답이 와야만** true 가 되고(캐시 경로 없음), 그 호출은 restoreSession(:262-266)에서 `await refreshUser()` **뒤에** 직렬로 실행된다. AlarmTalkAPI.swift:31-33 의 타임아웃은 요청당 60초다.

**사용자 영향**: 이미 동의를 마친 사용자도 앱을 켤 때마다 스피너를 본다. 지하철·엘리베이터처럼 응답이 느린 곳에서는 `/auth/me` + `/user/consents/status` 두 번의 왕복(최악 120초)이 끝날 때까지 알람 목록을 볼 수 없다 — 알람 앱에서 '지금 몇 시에 울리나' 를 못 보는 시간이다. 안드로이드는 같은 상황에서 즉시 홈을 그린다.

**고칠 방향**: 안드로이드의 `voice_alarm_consent` SharedPreferences 캐시에 대응하는 UserDefaults 캐시(계정별 '동의 완료' 플래그)를 만들어, 캐시가 있으면 로딩 게이트를 즉시 통과시킨다. 1회성 오버레이 판정은 그대로 `consentStatusChecked`(실제 응답)만 보게 남겨 둔다 — 두 값의 역할이 다르다.

<details><summary>반증 검증 결과</summary>

주장이 코드로 전부 확인된다. 반증 실패.

[1] 인용 위치 검증 — 실질적으로 정확(경로 오타 1건뿐)
- 안드로이드 캐시 경로: apps/android-native/app/src/main/java/com/alarmtalk/app/ui/main/MainViewModelAuthActions.kt:597-616 — `if (isConsentCachedDone(userId)) { needsConsent = false; consentChecked = true }`(603-605), 캐시 없을 때만 `consentChecked = false`(616). 캐시 판정은 MainViewModel.kt:918-924(`consented_users` + cachedPolicyVersion 게이트 — 정책 개정 시 무효화), 기록은 MainViewModelAuthActions.kt:651-653(받을 게 하나도 없을 때만 '완료').
- 안드로이드 로딩 게이트: 주장은 `AlarmTalkApp.kt:948-957` 이라 했으나 실제 파일은 ui/**app**/AlarmTalkApp.kt:950-956 (`if (!viewModel.consentChecked) { ConsentCheckLoadingScreen(...); return@Scaffold }`). 경로 세그먼트 하나 누락일 뿐 내용은 그대로. 앞선 게이트는 전부 기본값 false(:877 updateRequired/consentUnsupported, :936 pendingDeletion)라, 캐시된 계정은 네트워크를 기다리지 않고 첫 프레임에 홈이 뜬다.
- iOS 스피너: apps/ios-native/AlarmTalk/Views/Root/RootView.swift:53-66 — `else if !auth.consentStatusChecked { AuthBackdrop { ProgressView()... } }` 주장 그대로.
- iOS 캐시 부재: AuthViewModel.swift:775-799 — `consentStatusChecked = true` 는 :790(성공)·:797(실패) 두 곳뿐. iOS 전체 grep 결과 다른 쓰기는 :195(DEBUG `-UIPreviewSeed` 전용)와 :1083(세션 정리)뿐이고, AuthViewModel.swift 에 UserDefaults 사용이 0건 — 동의 완료 캐시가 아예 없다.
- 직렬 왕복: AuthViewModel.swift:261-266 `restoreSession()` = `session = saved` → `await refreshUser()` → `await checkConsentStatus()`. 호출자는 AlarmTalkApp.swift:129.
- 콜드스타트 첫 프레임부터 스피너: AuthViewModel.swift:185 `session = KeychainStore.readSession()` 가 init 에서 동기로 돌아 isAuthenticated 가 즉시 true → consentStatusChecked=false → RootView:53 분기.
- 타임아웃: AlarmTalkAPI.swift:31-32 `timeoutIntervalForRequest = 60`, `timeoutIntervalForResource = 120`. 직렬 2회면 최대 ~120초까지 스피너가 유지될 수 있다(단, 완전 오프라인은 URLSession 이 즉시 실패하므로 실제 장시간 케이스는 응답이 매달리는 저속/캡티브 네트워크에 한정).

[2] 놓친 처리 경로 — 없음
iOS 에서 이 게이트를 조기 통과시키는 코드는 DEBUG 프리뷰(:195)뿐. checkConsentStatus 호출부 4곳(:265 restoreSession, :334/:392/:420 로그인 직후) 어디에도 캐시 선통과가 없다.

[3] CLAUDE.md 예외 아님
AlarmKit 제약(울림 화면·알람 음량)과 무관하고, 플랫폼 표준(.alert)과도 무관하다. 콜드스타트 진입 경로의 순수 parity 격차다.

[4] 주장이 덜 말한 것(수정 방향)
안드로이드는 플래그가 **둘**이다 — 게이트용 `consentChecked`(캐시로 켜짐)와 '이 계정 응답이 실제로 왔다' 는 `consentStatusChecked`(MainViewModel.kt:684-690, 기록은 MainViewModelAuthActions.kt:663). iOS 는 이 둘을 `consentStatusChecked` 하나로 합쳤고, 그 값이 웰컴 프로모 준비 신호(RootView.swift:176,186)와 목소리 클론 동의 폼(VoiceCloneUploadFlow.swift:110)에도 쓰인다. 따라서 `consentStatusChecked` 에 캐시를 직접 물리면 CLAUDE.md 「1회성 오버레이는 확인이 끝난 뒤에만 판단한다」를 깬다 — 안드로이드처럼 **플래그 2개로 분리**해야 한다.

[5] 심각도 — P1 아님, P2
알람은 AlarmKit 이 로컬로 이미 무장돼 있어 그대로 울리고, 데이터 손실·영구 손상은 없다. 정상 네트워크에서는 스피너가 1초 미만이다. 다만 매 콜드스타트가 서버 왕복에 묶여 있고(안드로이드는 안 묶임), 응답이 매달리는 망에서는 앱 전체가 수 초~최대 120초 막힌다.

</details>

### ☐ [voice-save] 알람 전용·녹음 알람을 저장하면 iOS 가 '마지막 직접 입력 문구' 기록을 지운다 (안드로이드는 조기 return)

**안드로이드**: apps/android-native/.../ui/main/MainViewModel.kt:861-901 `rememberMessageChoiceUsed` — :866 `if (!draft.targetUserId.isNullOrBlank()) return`, :867 `if (draft.playMode == ALARM_ONLY) return` 로 먼저 빠져나가고, 직접 입력 기록은 :894-898 에서 `draft.voiceSource == VoiceSources.TTS_PROFILE` 이면서 `voiceText` 가 `isNotBlank` 일 때만 `saveLastManualText` 를 부른다. 녹음(LOCAL_AUDIO)·알람전용은 :899 `else -> Unit` 으로 **아무 것도 건드리지 않는다.**

**iOS**: apps/ios-native/AlarmTalk/Views/Editor/AlarmEditorSheet.swift:1654-1672 `rememberChoicesUsed` — 가드가 하나도 없다. `record.voiceRandomPrompt` 가 false 이기만 하면 :1670 `promptStore.saveLastManualText(userID:, text: record.voiceText)` 를 부른다. 알람 전용은 Views/Editor/AlarmEditDraft.swift:280 `voiceText: alarmOnly ? nil : ...` 이라 nil, 녹음/파일은 AlarmEditorSheet.swift:1549 `merged.voiceText = nil` 이라 nil 이다. 그리고 DynamicPromptPreferenceStore.swift:65-75 는 text 가 비면 `defaults.removeObject(forKey: manualTextKey)` 로 **기록을 삭제**한다.

**사용자 영향**: 직접 입력 문구로 알람을 만들어 둔 뒤 알람 전용 알람이나 녹음 알람을 하나만 저장해도, 기억해 둔 문구가 조용히 사라진다. 다음에 새 알람을 열면 직전 선택(직접 입력 + 그 문구)이 아니라 '기본 인사말' 로 돌아가 있다 — CLAUDE.md 「알람 편집기 기본값 = 직전 선택 유지」가 회귀라고 못 박은 동작이다.

**고칠 방향**: `rememberChoicesUsed` 맨 앞에 안드로이드와 같은 조기 return 을 넣는다: `guard record.playModeEnum != .alarmOnly else { return }`, `guard record.voiceSourceEnum != .localAudio else { return }`. 직접 입력 기록도 `record.voiceText?.nilIfBlank` 가 있을 때만 부르고, 비면 저장소를 건드리지 않는다.

<details><summary>반증 검증 결과</summary>

반증 실패 — 인용된 줄이 전부 실재하고 주장대로다.

1) 안드로이드(원본): apps/android-native/.../ui/main/MainViewModel.kt:861 `rememberMessageChoiceUsed` — :866 `if (!draft.targetUserId.isNullOrBlank()) return`, :867 `if (draft.playMode == AlarmPlayModes.ALARM_ONLY) return` 로 조기 return. 직접 입력 기록은 :897 `?.let { dynamicPromptStore.saveLastManualText(userId, it) }` 가 `voiceSource == VoiceSources.TTS_PROFILE` + `isNotBlank` 일 때만 실행되고, 녹음(LOCAL_AUDIO)·알람전용은 :899 `else -> Unit` 로 아무것도 건드리지 않는다.

2) iOS: apps/ios-native/AlarmTalk/Views/Editor/AlarmEditorSheet.swift:1661-1678 `rememberChoicesUsed` 에 playMode 가드가 없다. :1672 `if record.voiceRandomPrompt` 가 false 면 :1677 `promptStore.saveLastManualText(userID:, text: record.voiceText)` 를 무조건 부른다.
   - 알람 전용: AlarmEditDraft.swift:280 `voiceText: alarmOnly ? nil : existing?.voiceText` 로 nil, 그리고 AlarmEditorSheet.swift:1278-1281 `applyVoicePromptState` 가 `playModeEnum != .alarmOnly` 조건으로 `record.voiceRandomPrompt = false` 를 강제 → else 갈래 확정.
   - 녹음/파일: AlarmEditorSheet.swift:1549 `merged.voiceText = nil`, :1556 `merged.voiceRandomPrompt = false` → 같은 else 갈래.
   - 저장소: DynamicPromptPreferenceStore.swift:65-75 — 빈/ nil 이면 :73 `defaults.removeObject(forKey: key)` 로 `last_manual_text_<uid>` 를 삭제한다.

3) 다른 경로가 막아 주지 않는다. `rememberChoicesUsed` 호출부는 finishScheduling:1652 한 곳이고, 일반 저장(:1621)·중복 교체(:1686)가 모두 그리로 간다. 가족 알람만 :1533 에서 먼저 return 하므로(안드로이드 targetUserId 가드에 해당) 구조적으로 커버되지만, playMode 가드에 해당하는 것은 iOS 어디에도 없다.
   완화처럼 보이는 :72-74(빈 manual 저장 시 context 키는 안 지움, 테스트 DynamicPromptPreferenceStoreTests.swift:82-88)도 이 시나리오에는 무효다 — 직전에 직접 입력을 저장할 때 :69-71 이 이미 context 키를 지워 놨기 때문에, 삭제 후 두 키가 모두 빈다. 읽기부 AlarmEditorSheet.swift:1106 `if let manual = store.lastManualText(...)` 가 nil, 다음 else-if 의 context 도 nil → 폴백 `randomPrompt = true` + `RandomPromptContext.defaultContext = .preset`(AlarmEnums.swift:209) = '기본 인사말'. 주장한 사용자 영향이 그대로 재현된다.

4) CLAUDE.md 예외 아님. AlarmKit 제약(울림 화면·음량 슬라이더)도, 플랫폼 표준 알럿도 아닌 순수 기록 규칙이라 「다르면 iOS 가 틀린 것」에 해당하고, 「알람 편집기 기본값 = 직전 선택 유지」가 명시적으로 회귀라 못 박은 동작이다.

추가로 확인된 인접 발산(주장 범위 밖): 스톡 클립 갈래 AlarmEditorSheet.swift:1586-1588 은 `voiceRandomPrompt = false` 로 두면서 :1580 `merged.voiceText = prepared.text` 가 비어 있지 않아, 스톡 클립 알람을 저장하면 그 문구가 `last_manual_text` 로 기록된다 → 다음 새 알람이 '직접 입력 + 스톡 문구' 로 열린다. 안드로이드는 같은 경우를 MainViewModel.kt:889 `bucket != null -> rememberContext()` 로 '문구 종류' 만 기록한다. 같은 뿌리(가드 부재)다.

심각도: P2. 소리 없이 취향 기록이 사라지고 사용자에게 신호가 없지만, 알람 자체나 사용자가 쓴 문구가 파괴되는 것은 아니고(그 알람은 자기 문구를 그대로 유지) 다시 입력하면 복구되므로 P1 은 과하다.

</details>

### ☐ [voice-save] 무료 '테마(버킷)' 를 골라 저장하면 테마 대신 **스톡 문장이 '직접 입력' 으로** 기억된다 — 다음 새 알람의 테마가 매번 초기화된다

**안드로이드**: apps/android-native/.../ui/main/MainViewModel.kt:877-881 — `bucket != null && isSystemVoiceId(draft.voiceProfileId)` 이면 `dynamicPromptStore.saveLastFreeBucket(userId, bucket)` 로 **테마를 기억한다**(유료 클론 버킷은 :889 에서 문구 종류로 기억). 그 값을 ui/editor/AlarmEditorScreen.kt:1051-1062 가 신규 알람에서 이어받아(`remembered = lastFreeBucket?.takeIf { alarm == null && it in buckets ... }`) 프리셀렉트한다. 저장소는 data/DynamicPromptPreferenceStore.kt:118-122 `readLastFreeBucket`/`saveLastFreeBucket`(`last_free_bucket_<userId>`).

**iOS**: apps/ios-native/AlarmTalk/Views/Editor/AlarmEditorSheet.swift:1580-1583 — 스톡 클립 저장 시 `merged.voiceRandomPrompt = false`, `merged.voiceRandomContext = nil` 로 만든다. 그래서 :1654-1672 `rememberChoicesUsed` 가 else 분기로 떨어져 :1670 `saveLastManualText(text: record.voiceText)` — 즉 **서버 스톡 클립의 문장**이 '내가 친 직접 입력 문구' 로 저장되고, DynamicPromptPreferenceStore.swift:69-71 이 `last_message_context` 까지 지운다. 테마를 담을 키는 아예 없다(DynamicPromptPreferenceStore.swift:23-24 "⚠ last_free_bucket_<userId> 는 만들지 않는다 — iOS 에는 무료 버킷 회전 개념이 아직 없다" 는 주석이 남아 있지만, 실제로는 Views/Editor/FreeBucketSettings.swift 와 AlarmEditorSheet+AlarmModeSection.swift:87-93 로 **테마 선택 UI 가 이미 있다** — 주석이 사실과 어긋난다). 신규 알람 시드도 AlarmEditorSheet.swift:1106-1115 에 테마 분기가 없다.

**사용자 영향**: 무료 사용자가 '날씨' 테마를 골라 저장해도 다음 새 알람의 문구 행은 '불러오는 중이에요' 로 비어 있고, 테마 화면을 열면 목록 첫 값('약')이 선택돼 있다 — 매번 다시 골라야 한다. 안드로이드 주석이 "이 순서를 항상 적용되는 기본값으로 되돌리면 날씨로 저장해도 다음 알람이 다시 약이 된다" 고 경고한 바로 그 상태다. 게다가 유료로 올라가면 첫 새 알람이 고른 적 없는 스톡 문장을 담은 '직접 입력' 으로 열린다.

**고칠 방향**: `DynamicPromptPreferenceStore` 에 안드로이드와 같은 키(`last_free_bucket_<userId>`)를 추가하고, `rememberChoicesUsed` 에 스톡 클립 분기를 만든다 — `prepared.audioCacheKey.hasPrefix("stock_")` 이고 시스템 목소리면 `saveLastFreeBucket(clip.category)` 를 부르고 `saveLastManualText` 는 부르지 않는다. `loadVoicePromptState(from: nil)` 이 그 값으로 `selectFreeBucket` 을 프리셀렉트하도록 잇는다. 스톡 클립 저장 시 스톡 문장이 절대 `last_manual_text` 로 새지 않게 할 것.

<details><summary>반증 검증 결과</summary>

반증 실패 — 인용된 코드가 전부 실제로 존재하고 주장대로다.

**안드로이드(원본) 확인**
- `MainViewModel.kt:877-881` — `val bucket = draft.bucketId?.takeIf{...}` → `bucket != null && isSystemVoiceId(draft.voiceProfileId)` 분기에서 `dynamicPromptStore.saveLastFreeBucket(userId, bucket)`. `when` 이 여기서 끊기므로 **마지막 입력 문구(`last_manual_text`)는 건드리지 않는다.** 유료 클론 버킷은 :889 에서 `rememberContext()`.
- `DynamicPromptPreferenceStore.kt:113-122` — `readLastFreeBucket`/`saveLastFreeBucket`(`KEY_LAST_FREE_BUCKET`, :159). 주석까지 "이걸 기억하지 않으면 새 알람이 매번 FreeBucketOrder 첫 값(=약)으로 돌아간다" 라고 못 박고 있다.
- `AlarmEditorScreen.kt:1051-1062` — 신규 알람(`alarm == null`)이면 `remembered = lastFreeBucket`, `target = 현재선택 ?: remembered ?: buckets.firstOrNull()` → `selectBucket(target)`. 전달은 `AlarmTalkApp.kt:1119,1137`.

**iOS 확인 (주장 라인과 ±7줄 드리프트, 내용은 동일)**
- `AlarmEditorSheet.swift:1568-1590` — 스톡 클립 저장 시 `merged.voiceText = prepared.text`(:1581)이고 `isStockClip` 이면 `voiceRandomPrompt = false`, `voiceRandomContext = nil`(:1587-1589). `prepared.text` 는 `VoiceStudioViewModel.swift:536-547 makeStockPrepared` 의 `clip.text` = **서버 스톡 문장**이다.
- `AlarmEditorSheet.swift:1661-1679 rememberChoicesUsed` — 판정이 `if record.voiceRandomPrompt` 하나뿐이라 스톡(테마) 저장은 무조건 else 로 떨어져 :1677 `saveLastManualText(text: record.voiceText)`. 즉 **스톡 문장이 '내가 친 직접 입력 문구' 로 기록된다.** 편집기 다른 곳은 `!randomPrompt && !isActiveStockClipAlarm` 이라는 2항 판정을 쓰는데(:826-836, :783-788) **여기만 `randomPrompt` 단항이다** — CLAUDE.md 「버킷이 붙으면 voiceRandomPrompt 가 꺼진다」가 경고한 바로 그 지점.
- `DynamicPromptPreferenceStore.swift:65-75` — `saveLastManualText` 가 :69-71 에서 `last_message_context` 를 **지운다**. 안드로이드의 `saveLastFreeBucket` 은 아무것도 지우지 않으므로, iOS 는 테마 알람 하나 저장할 때마다 기억해 둔 문구 종류까지 날아간다.
- 테마 키 부재 확인: `grep -rn "FreeBucket|lastFreeBucket|last_free_bucket" apps/ios-native --include=*.swift` 결과가 `FreeBucketSettings.swift` / `AlarmEditorSheet.swift:301-305,787-822` / `AlarmEditorSheet+AlarmModeSection.swift:87-93` 뿐 — **저장소에 테마 키가 없다.** `DynamicPromptPreferenceStore.swift:23-24` 의 "iOS 에는 무료 버킷 회전 개념이 아직 없다" 주석은 `FreeBucketSettings.swift:11-27,54-101`(테마 선택 화면) 이 이미 있으므로 **사실과 어긋난다.**
- `AlarmEditorSheet.swift:1103-1117` — 신규 알람 시드는 `lastManualText` → `lastMessageContext` 두 갈래뿐, 테마 분기 없음.
- 결과 확인: `selectedFreeBucket`(:804-810)은 `preparedAlarm` 파생이고 신규 알람은 `preparedAlarm = nil`(:1089)이므로 **항상 nil** → `FreeThemeSummaryRow` 가 `FreeBucketSettings.swift:37-39` 의 "불러오는 중이에요" 를 띄우고, 화면을 열면 `:100 draft = initialSelection ?? available.first` → `order = [.medication, .weather]`(:19) 로 '약' 이 잡힌다. 주장 그대로다. 게다가 iOS 는 안드로이드의 `?: buckets.firstOrNull()` + `selectBucket` 자동 해석(AlarmEditorScreen.kt:1055-1062)에 해당하는 코드가 아예 없어(`selectStockClip` 호출부는 :305 패널 저장 하나뿐), 테마를 안 고르고도 저장이 통과한다(`editorSaveBlockedReason` :643-648 이 randomPrompt+preset 을 허용) — 주장보다 오히려 갭이 크다.

**예외 여부**: AlarmKit 제약(울림 화면·음량)과도, 플랫폼 표준(.alert)과도 무관한 순수 선호값 저장 로직이라 CLAUDE.md 가 인정하는 두 예외에 해당하지 않는다. 다른 곳에서 보완하는 경로도 없다.

**과장된 부분(심각도 조정 근거)**: "유료로 올라가면 첫 새 알람이 스톡 문장을 담은 직접 입력으로 열린다" 는 저장값 기준으로는 맞지만 화면에서는 대개 가려진다 — 같은 저장이 `lastUsedVoiceId` 를 시스템 목소리로 남기고(:1665-1667), 다음 신규 알람이 그 목소리를 프리셀렉트하면(:1340-1352) `restrictToWeatherMedication`(:919-920)이 켜져 `coerceFreeVoiceTierConstraints`(:1135, 1206-1214)가 `randomPrompt=true`/`preset` 으로 되돌린다. 클론 목소리가 프리셀렉트되는 경우(목록 로딩 전·오프라인)에만 실제로 노출된다. 확정적으로 남는 손실은 ①테마 미기억(무료 사용자 매 알람 재선택) ②`last_message_context` 소실 이며, 데이터 유실·크래시는 없고 저장 자체가 막히지도 않는다 → P1 이 아니라 P2.

</details>

### ☐ [voice-save] iOS 에는 `ttsInputKey`/`linkTtsInput` 입력 캐시가 없다 — '직접 입력 문구 이어받기' 가 오프라인에서 저장 불가

**안드로이드**: data/AlarmAudioStore.kt:1079-1097 `ttsInputKey`(userId+profileId+text+category+language+listenerTitle) 와 :607 `linkTtsInput` / :626 `resolveTtsInput` 별칭. ui/editor/AlarmEditorScreen.kt:784-797 이 저장 직전에 그 별칭을 먼저 찾아 서버 호출 없이 기존 음원을 재사용하고, :917-934 는 생성 후 **입력 원문 키와 서버 표시 문구 키 둘 다**로 별칭을 남긴다. CLAUDE.md 가 직접 입력 문구를 기억하기로 한 근거가 바로 이것이다 — "글자가 같아 AlarmAudioStore 입력 캐시에 걸려 **서버 호출도 월 한도 차감도 없이** 곧바로 저장된다(오프라인 포함)".

**iOS**: `ttsInputKey`/`linkTtsInput`/`resolveTtsInput` 에 해당하는 코드가 apps/ios-native/AlarmTalk 전체에 없다(grep 0건). 재사용 판정은 Views/Editor/AlarmEditDraft.swift:190-240 `canReuseExistingTtsAudio` 하나뿐인데, 이건 `guard let record` 로 시작해 **편집 중인 그 알람 자신의 음원**만 재사용한다. 그래서 AlarmEditorSheet.swift:1106-1115 가 이어받은 직접 입력 문구로 새 알람을 열어도, 저장하면 :1461-1490 의 `voiceStudio.generateTTS` 가 반드시 서버를 부른다.

**사용자 영향**: 어제 쓴 직접 입력 문구를 그대로 이어받아 새 알람을 만들 때 iOS 는 매번 서버 왕복이 필요하다. 오프라인이면 저장 자체가 실패한다(안드로이드는 그대로 저장된다). 월 한도는 서버 캐시 히트(tts.ts:1280-1301, 쿼터 예약보다 앞에서 반환)로 차감되지 않지만, 네트워크가 느리면 저장이 매번 몇 초씩 걸린다.

**고칠 방향**: `AudioCacheStore` 에 안드로이드와 같은 입력 별칭을 넣는다 — `ttsInputKey(userId:profileId:text:category:language:listenerTitle:)` 로 만든 키의 메타 사이드카에 서버 cacheKey 와 표시 문구를 적고(`linkTtsInput`), 저장 직전에 먼저 조회해 히트하면 `generateTTS` 를 건너뛴다. ⚠ 안드로이드처럼 **입력 원문 키와 서버 표시 문구 키 두 개 모두**에 별칭을 남겨야 번역 켜진 기기에서 다음 새 알람이 캐시를 빗나가지 않는다(AlarmEditorScreen.kt:925-934).

<details><summary>반증 검증 결과</summary>

인정한다(반증 실패). 인용된 파일:줄이 모두 실제로 존재하고 주장 그대로다.

[안드로이드 — 캐시 존재 확인]
- AlarmAudioStore.kt:1079-1097 `ttsInputKey(userId, profileId, text, category, language, listenerTitle)` 존재. 주석이 "linkTtsInput 별칭의 왼쪽" 이라고 명시.
- AlarmAudioStore.kt:607 `linkTtsInput(inputKey, serverCacheKey, displayText)` / :626 `resolveTtsInput` → `TtsInputAlias(cacheKey, displayText)`.
- AlarmEditorScreen.kt:784-800 이 서버 호출 **전에** 입력키를 만들고(`!familyAlarmMode && !editor.voiceRandomPrompt && reuseUserId != null`) `resolveTtsInput` → `getCachedAudio` → `setGeneratedTtsAudio` 로 곧바로 저장한다. 코드 주석 그대로: "대기 없음 + 직접 입력 월 한도 안 깎임 + 오프라인에서도 저장됨."
- AlarmEditorScreen.kt:917-934 가 입력 원문 키와 서버 표시 문구 키 **둘 다** 별칭을 남긴다(Codex #685 주석 포함). 회귀 테스트 apps/android-native/app/src/test/java/com/alarmtalk/app/data/TtsInputReuseTest.kt:69-93.

[iOS — 부재 확인, 다른 경로 없음]
- `grep -rn "ttsInputKey|linkTtsInput|resolveTtsInput" apps/ios-native/` = **0건**.
- AudioCacheStore.swift:232-249 의 `ttsCacheKey(...)` 는 안드로이드의 **서버 키**(tts-v2) 미러일 뿐 입력 별칭이 아니다. 호출부 3곳(VoiceStudioViewModel.swift:781, :877, DynamicVoiceRefreshService.swift:75)이 **전부 API 응답을 받은 뒤** 파일명을 정하는 용도다. TTS 경로에 사전 `cachedURL(for:)` 조회가 없다(나머지 cachedURL 사용처는 스톡 클립·로컬 오디오·pull sync·재생: AlarmEditorSheet.swift:1158/1996/2009, StockClipPrefetcher.swift:72, AlarmSoundResolver.swift:76, AlarmVoicePlayer.swift:80, RemoteAlarmPullSync.swift:645).
- VoiceStudioViewModel.swift:856-878 `generateTTS` 는 무조건 `try await api.generateTTS(...)` 를 먼저 부르고, cacheKey 는 응답 뒤에 계산한다.
- AlarmEditDraft.swift:190-206 `canReuseExistingTtsAudio` 는 `guard let record` 로 시작 → 신규 알람(existing == nil)은 구조적으로 재사용 불가.
- AlarmEditorSheet.swift:1103-1112 는 실제로 직접 입력 문구를 이어받고(`randomPrompt = false; ttsText = manual`), :1089 에서 `preparedAlarm = nil` 로 비운다 → 저장 시 :1469-1496 이 `generateTTS` 를 반드시 부르고 `guard prepared != nil else { return }` 로 저장을 중단한다. 오프라인은 VoiceStudioViewModel+ErrorMapping.swift:21(`.notConnectedToInternet`)로 statusMessage 만 남고 저장 실패. iOS 어디에도 오프라인 큐/폴백이 없다.

[예외 해당 없음] AlarmKit 제약(울림 화면·알람 음량)도, 플랫폼 표준(시스템 .alert)도 아니다. 로컬 파일 캐시 별칭은 순수 앱 로직이라 「다르면 iOS 가 틀린 것」 규약이 그대로 적용된다.

[심각도] 주장의 한도 관련 서술도 맞다 — packages/backend/src/routes/tts.ts:1280-1301 이 `cache_hit: true` 로 조기 반환하고 `reserveManualTtsQuota` 는 :1341 이라 캐시 히트 시 월 한도는 안 깎인다. 따라서 실제 피해는 (a) 새 알람마다 강제 서버 왕복 지연, (b) 오프라인에서 저장 자체 실패(안드로이드는 저장됨) 두 가지. 데이터 손실·잘못된 데이터 기록은 없고, 이어받기 덕에 '빈 직접입력으로 저장 막힘' 문제는 iOS 도 피한다. P1 은 과하고 **P2** 가 적정하다.

</details>


## P3 (11건)

### ☐ [dead-code] iOS FeatureLockBadge 는 정의만 있고 아무도 호출하지 않는다 — 잠금 표시를 두 곳에서 생 lock.fill 로 손수 그려 안드로이드와 다르게 보인다

**안드로이드**: apps/android-native/.../ui/components/FeatureLockBadge.kt:20 정의, 실제 호출 2곳: ui/editor/AlarmEditorControls.kt:430-435(잠긴 칩의 TopEnd, size=18dp/icon=10dp), ui/editor/AlarmSnoozeSettings.kt:381(SnoozeLockedRow 의 좌측, size=18dp/icon=11dp). 모양은 primaryContainer 원 + surface 1px 보더 + Icons.Outlined.Lock(아웃라인).

**iOS**: apps/ios-native/AlarmTalk/Views/Common/FeatureLockBadge.swift:11 — 파일 밖 참조 0건. 유일한 등장은 자기 파일의 #Preview(:35-49)와 :3 의 주석 'Android `FeatureLockBadge.kt:19-42` 와 1:1' 뿐. 정작 잠금이 필요한 두 곳은 컴포넌트를 안 쓰고 직접 그린다: Views/Editor/VoicePlayModePicker.swift:57-59 `Image(systemName: "lock.fill")` (채움 자물쇠, 배경 원 없음), Views/Editor/VoiceSelectionSheet.swift:73-77 `Image(systemName: "lock.fill")`.

**사용자 영향**: 같은 '유료 잠김' 상태가 두 앱에서 다르게 보인다 — 안드로이드는 배경 원이 있는 아웃라인 자물쇠, iOS 는 배경 없는 채움 자물쇠. 무료 사용자가 재생 방식 픽커·목소리 선택 시트에서 매번 보는 표식이라 눈에 띈다. CLAUDE.md 가 경고한 PlayModeCard 사고(만들어 놓고 아무도 호출하지 않음)와 똑같은 형태다.

**고칠 방향**: 판정: 연결해야 한다. VoicePlayModePicker.swift:57-59 와 VoiceSelectionSheet.swift:73-77 의 `Image(systemName: "lock.fill")` 를 `FeatureLockBadge(size: 18, iconSize: 10)` / `FeatureLockBadge(size: 18, iconSize: 11)` 로 교체해 안드로이드 두 호출부의 치수를 그대로 맞춘다. 그러면 FeatureLockBadge.swift:3 의 '1:1' 주장도 실제가 된다.

<details><summary>반증 검증 결과</summary>

핵심 사실은 코드로 전부 확인됐다 — 반증 실패.

【확인된 것】
1) iOS `Views/Common/FeatureLockBadge.swift:11` 정의. `apps/ios-native` 전체 grep 결과 파일 밖 참조 0건 — 등장은 자기 파일 `#Preview`(:37-39, :47-48)와 `project.pbxproj` 빌드 등록뿐. 컴파일만 되는 죽은 컴포넌트가 맞다.
2) 안드로이드 `ui/components/FeatureLockBadge.kt:20` 정의(primaryContainer Surface + CircleShape + `BorderStroke(1.dp, surface)` :31 + `Icons.Outlined.Lock` :36, tonalElevation 2.dp :32). 호출 2곳 주장대로 실재: `ui/editor/AlarmEditorControls.kt:431-435`(size 18dp/iconSize 10dp, `Alignment.TopEnd`, 조건 `if (locked && !selected)` :430), `ui/editor/AlarmSnoozeSettings.kt:381`(size 18dp/iconSize 11dp, 좌측).
3) **결정적**: `Icons.(Outlined|Filled|Default|Rounded).Lock` 를 안드로이드 소스 전역에서 grep 하면 `FeatureLockBadge.kt:36` **단 1건**이다. 안드로이드는 자물쇠를 손으로 그리는 곳이 한 곳도 없고, 모든 잠금 표식이 이 뱃지를 지난다.
4) iOS 는 `VoicePlayModePicker.swift:58` `Image(systemName: "lock.fill")` .system(size:10,.bold) 인라인(배경 원·보더 없음, 채움 글리프), `VoiceSelectionSheet.swift:74` `lock.fill` 12pt 로 손수 그린다. 두 곳 다 주장대로 실재.
5) 1:1 짝임도 문서로 확인: `docs/spec/voice-and-message.md:103` 이 `PlayModeCard`(AlarmEditorControls.kt) ↔ `VoicePlayModePicker` 를 같은 행에 놓는다. 조건식도 동일(`locked && !selected` — 안드 :430 / iOS :57). 즉 재생 방식 픽커는 진짜 대응 화면이고, 안드=18dp primaryContainer 원+1dp surface 보더+아웃라인 자물쇠 TopEnd, iOS=배경 없는 10pt 채움 자물쇠 인라인 — 실제로 다르게 보인다.
6) 주석 근거도 썩어 있다: `FeatureLockBadge.swift:3` "Android FeatureLockBadge.kt:19-42 와 1:1", :10 이 사용처로 적은 "비활성화된 목소리 슬롯 추가 버튼" 은 호출부가 없다.
7) CLAUDE.md 예외 2종(AlarmKit 제약 / 플랫폼 표준 .alert) 어디에도 해당하지 않는다 — 잠금 뱃지는 울림 화면도 아니고 시스템 알럿도 아니다. 규약상 "다르면 iOS 가 틀린 것".

【주장이 틀린 부분 — 두 군데 정정】
A) **사용자 영향 서술이 틀렸다.** "무료 사용자가 재생 방식 픽커에서 매번 본다" 는 반증된다. iOS `AlarmEditorSheet.swift:902` `voiceModeBlocked = planAccess == .loggedOut`(:895-898 에서 `auth.session == nil` 일 때만 .loggedOut)이고, 이 값이 `AlarmEditorSheet+AlarmModeSection.swift:13` 에서 `voiceLocked` 로 들어간다. 안드로이드도 같다 — `AlarmEditorScreen.kt:162` `val voicePlanLocked = authSession == null` → :1353 `voiceLocked = voicePlanLocked`. 즉 **양 앱 모두 로그아웃 상태에서만** 그 자물쇠가 뜬다. 로그인한 무료 사용자는 픽커에서 자물쇠를 아예 못 본다.
B) **목소리 선택 시트는 성격이 다른 문제다.** 안드로이드 시트(`VoiceAudioCard.kt:517-539`)는 `WakerSheetOptionRow` 에 title/description/selected/onClick/trailing/divider 만 넘기고 **locked 개념 자체가 없다.** 무료 등급은 잠그는 게 아니라 **걸러낸다** — `AlarmEditorScreen.kt:168-172` `visibleVoiceProfiles = if (freeVoiceTier) voiceProfiles.filter { it.isSystem == true }`. 반면 iOS 는 `AlarmEditorSheet.swift:732, 742` 에서 본인/공유 목소리를 `locked: freeVoiceTier` 로 **목록에 남기고** :74 자물쇠를 붙인다(무료 사용자가 실제로 보는 건 이쪽뿐이다). 따라서 이 자리는 "뱃지를 안 썼다" 가 아니라 "안드로이드에 없는 행을 iOS 가 만들었다" 이고, `FeatureLockBadge` 로 바꿔 끼워도 안드로이드와 같아지지 않는다(안드는 거기 아무것도 안 그린다).

【주장이 놓친 것 — 반증은 아니고 보강】
안드로이드의 두 번째 호출부 `SnoozeLockedRow`(AlarmSnoozeSettings.kt:369-390)의 실사용처는 무료 테마 pane 의 잠긴 '직접 입력' 행이다(`VoiceAudioCard.kt:658-661`, :656-657 주석이 "목록에서 아예 빼면 유료 전환 동기를 잃는다" 고 의도를 명시). iOS `FreeBucketSettings.swift:64-101` 에는 그 행이 통째로 없고 :75 안내 문장으로 대체돼 있다 — 자물쇠 스타일 이전에 행 자체가 없다.

【심각도】
P3. 죽은 컴포넌트 + 시각적 불일치이고 기능·데이터 손실은 없다. 실제로 다르게 보이는 유일한 1:1 대응 지점(재생 방식 픽커)은 **로그아웃 상태 전용**이라 노출 빈도가 낮고, 무료 사용자가 보는 시트 자물쇠는 애초에 안드로이드에 대응물이 없다. 주장이 붙인 "무료 사용자가 매번 본다" 는 과장이다. 다만 고칠 값어치는 있다 — 뱃지를 픽커에 연결(size 18/icon 10, TopEnd)하고, 시트는 안드로이드처럼 필터링으로 갈지 잠금 표시를 유지할지 먼저 정한 뒤 맞춰야 한다.

</details>

### ☐ [dead-code] 근거가 썩은 iOS 주석 22곳 — 안드로이드에 실제로 없는 심볼·파일을 가리키거나 줄번호가 파일 길이를 넘는다

**안드로이드**: grep 결과 아래 심볼은 안드로이드 소스(app/src 전체, .kt+.xml)에 0건이다: WakerBrandHeader / LandingPreviewWaveform / DeleteAccountDialog / SettingsToggleRow / CurrentPassSummaryCard / PassSummaryChip / MenuScreen / auth_reset_password_hint / SharedVoiceViewerInfoDialog / previewStockClip / selectStockClip / alarmSyncFailureMessage / firstMissingTarget / defaultPlayModeForPlan / deletePaidAlarmTalks / UsageGuideStore. 존재하지만 위치가 다른 것: HolidayCountryPickerDialog 는 ui/settings/SettingsScreen.kt:247(파일 271줄), FamilyAlarmQuietTimeDialog 는 ui/settings/SettingsScreenComponents.kt:154, quietScheduleLabel 은 SettingsScreenComponents.kt:482, SubscriptionPlanCard 는 ui/billing/BillingPanels.kt:503(파일 761줄). 약관/방침 URL 은 SettingsScreen.kt 가 아니라 ui/app/AlarmTalkApp.kt:1251-1253 에 있다. SettingsScreen.kt:152-170 은 '법적 정보' 카드지 마케팅 동의가 아니다.

**iOS**: 존재하지 않는 심볼을 가리키는 곳: Views/Auth/LandingView.swift:99(`WakerBrandHeader:156-166`), :201(`LandingPreviewWaveform:277-311`), Views/Settings/AccountPanel.swift:227(`DeleteAccountDialog` (HomeComponents.kt:480) — 그 파일은 467줄), Views/Settings/SettingsView.swift:273(`SettingsToggleRow`(SettingsScreenComponents.kt:112-143)), Views/Settings/BillingPanelComponents.swift:16(`CurrentPassSummaryCard`(BillingPanels.kt:607-644)), :109(`PassSummaryChip`(BillingPanels.kt:646-661)), Views/Settings/MenuView.swift:3(`MenuScreen` 미러), Views/Auth/PasswordResetView.swift:63(`auth_reset_password_hint`), Views/Voices/VoiceProfileManagementComponents.swift:79 및 Views/Voices/VoiceProfileManagementPanel.swift:50(`SharedVoiceViewerInfoDialog` (VoiceProfileManagementPanel.kt:1543)), Views/Editor/AlarmEditorSheet.swift:1677·1713 및 VoiceStudioViewModel.swift:473(`previewStockClip`/`selectStockClip` 미러), RemoteAlarmSyncViewModel.swift:143, AlarmKitViewModel.swift:89, AlarmEnums.swift:26, UsageGuideStore.swift:11, Views/Root/RootView.swift:5(`App.kt` — 실제는 ui/app/AlarmTalkApp.kt). 줄번호가 범위를 넘는 곳: Views/Settings/SettingsView.swift:361(SettingsScreen.kt:283-321), Views/Settings/FamilyAlarmQuietTimeDialog.swift:5(SettingsScreen.kt:387-559), Views/Common/HelperFormatters.swift:45(SettingsScreen.kt:746), Views/Settings/BillingPanelComponents.swift:195(BillingPanels.kt:682-826), Views/Settings/SettingsView.swift:304-306(SettingsScreen.kt:161-190 을 마케팅 3-상태라 주장), :31-32(SettingsScreen.kt:150,156 을 외부 링크라 주장).

**사용자 영향**: 사용자에게 직접 보이진 않지만, CLAUDE.md 가 '주석의 안드로이드 미러 근거를 믿지 말고 확인할 것' 이라 못 박은 바로 그 함정이다. 실제로 VoiceSetupView 가 이 방식으로 잘못 이식된 적이 있다. 다음 파리티 작업자가 존재하지 않는 파일을 열려다 시간을 잃거나, 더 나쁘게는 '없으니 내 맘대로' 로 또 갈라진다.

**고칠 방향**: 판정: 고쳐야 한다. 존재하지 않는 심볼을 가리키는 주석은 삭제하고(그 코드가 죽은 코드라면 코드째 삭제 — WakerBrandHeader/LandingWaveformBar/DeleteAccountPanel/SettingsToggleRow 가 여기 해당), 살아 있는 것은 실제 파일:줄로 고친다. 재발 방지로 '파일:줄' 대신 '파일 + 심볼명' 만 적는 규칙을 CLAUDE.md 에 넣으면 리팩터링으로 줄이 밀려도 썩지 않는다.

<details><summary>반증 검증 결과</summary>

반증 실패 — 주장은 코드로 전부 확인된다. 오히려 건수를 과소 집계했다(실측 24곳).

[1] 안드로이드 근거 16종 전부 0건 확인. apps/android-native/app/src 전체(*.kt+*.xml) grep: WakerBrandHeader / LandingPreviewWaveform / DeleteAccountDialog / SettingsToggleRow / CurrentPassSummaryCard / PassSummaryChip / MenuScreen / auth_reset_password_hint / SharedVoiceViewerInfoDialog / previewStockClip / selectStockClip / alarmSyncFailureMessage / firstMissingTarget / defaultPlayModeForPlan / deletePaidAlarmTalks / UsageGuideStore = 모두 0. 이전 위치 이동 4종도 주장대로: SettingsScreen.kt:247(HolidayCountryPickerDialog), SettingsScreenComponents.kt:154(FamilyAlarmQuietTimeDialog), SettingsScreenComponents.kt:482(quietScheduleLabel), BillingPanels.kt:503(SubscriptionPlanCard). 파일 길이도 일치: SettingsScreen.kt 271줄 / SettingsScreenComponents.kt 559 / BillingPanels.kt 761 / HomeComponents.kt 467. App.kt 는 안드로이드에 존재하지 않음(find 0건).

[2] 범위 초과 5건을 독립 스크립트로 재현. iOS 주석의 모든 `*.kt:NNN` 인용을 실제 파일 길이와 대조한 결과 정확히 5건, 주장이 든 것과 동일: SettingsView.swift:361(SettingsScreen.kt:283-321>271), AccountPanel.swift:227(HomeComponents.kt:480>467), BillingPanelComponents.swift:195(BillingPanels.kt:682-826>761), FamilyAlarmQuietTimeDialog.swift:5(SettingsScreen.kt:387-559>271), HelperFormatters.swift:45(SettingsScreen.kt:746>271). 초과도 부족도 없음.

[3] 이름만 썩은 게 아니라 가리키는 내용도 틀렸다(직접 열어 확인). SettingsScreenComponents.kt:112-143 은 SettingsRow 의 꼬리(label/value/chevron)로 스위치가 없다 → SettingsToggleRow 주장 이중 오류. BillingPanels.kt:607-661 구간 실제 내용은 shareableVouchersForPlan(634)·CancelSubscriptionDialog(649) → CurrentPassSummaryCard/PassSummaryChip 아님. SettingsScreen.kt:152-170 은 '법적 정보' 카드(동의내역+OSS)이고 161-190 은 divider+OSS행+로그아웃 다이얼로그 → 마케팅 3-상태 아님. 실제 마케팅 3-상태는 ConsentHistoryScreen.kt:51-53,176-179,245. SettingsScreen.kt:150 은 `}`, :156 은 SettingsRow( → 외부 링크 아님. 실제 약관/방침 URL 은 AlarmTalkApp.kt:1251,1253. 더보기 탭은 MenuTabPanel(HomeComponents.kt:122)이지 MenuScreen 이 아님. 비밀번호 문자열 실제는 auth_password_rule_min("8자 이상", strings.xml:57)이지 auth_reset_password_hint 아님.

[4] 주장 자체의 흠은 줄번호 4건이 소폭 어긋난 것뿐이며 결론을 바꾸지 않는다. previewStockClip 주석은 AlarmEditorSheet.swift:1709(주장 1677), selectStockClip 미러는 :1745(주장 1713), 마케팅 주석은 SettingsView.swift:301(주장 304-306), 약관 URL 주석은 SettingsView.swift:30(주장 31-32). 네 곳 모두 주석은 실재하고 근거가 썩은 것도 사실이며, 주장이 인접 줄을 인용했을 뿐이다. 또 deletePaidAlarmTalks 의 iOS 위치(LocalAlarmRecord.swift:97)를 주장이 빠뜨렸다.

[5] 실측 총계 24곳(주장 22곳)으로 과장이 아니라 과소 집계다. 확인된 목록: LandingView.swift:99·201, AccountPanel.swift:227, SettingsView.swift:273·301·30·361, BillingPanelComponents.swift:16·109·195, MenuView.swift:3, PasswordResetView.swift:63, VoiceProfileManagementComponents.swift:79, VoiceProfileManagementPanel.swift:50, AlarmEditorSheet.swift:1709·1745, VoiceStudioViewModel.swift:473, RemoteAlarmSyncViewModel.swift:143, AlarmKitViewModel.swift:89, AlarmEnums.swift:26, UsageGuideStore.swift:11, RootView.swift:5, FamilyAlarmQuietTimeDialog.swift:5, HelperFormatters.swift:45, LocalAlarmRecord.swift:97.

[6] CLAUDE.md 예외 해당 없음. AlarmKit 제약(울림 화면·음량 슬라이더)도, 플랫폼 표준(시스템 .alert)도 아니다 — 주석 문서 문제다. 오히려 CLAUDE.md 가 「주석의 '안드로이드 미러' 근거를 믿지 말고 확인할 것」 절에서 WakerBrandHeader:156-166 을 '존재하지 않음' 예시로 이미 명시해 두었다.

[7] 심각도 P3 이 적정. 런타임·사용자 노출 영향 0(주석뿐)이고 주장도 "사용자에게 직접 보이진 않지만" 이라 스스로 한정했다. 다만 다음 파리티 작업자를 오도하는 실제 함정이고 이미 VoiceSetupView 오이식 전례가 있어 무시할 항목은 아니다.

</details>

### ☐ [dead-code] 안드로이드에 호출되지 않는 Composable 7개 — AccountPanel.kt 의 옛 알람 편집기 잔재 5개 + FortuneSelectorRow + PlayingEqualizer

**안드로이드**: 전이적 dead-code 판정(정의 본문 안의 상호 참조 제외) 결과 7개: ui/account/AccountPanel.kt:51 StepperField, :88 OptionSection, :109 DayRows, :143 DayChip(DayRows 만 부른다), :157 OptionChips — 다섯이 서로만 부르고 파일 밖 참조 0건이다(같은 파일의 GoogleSignInButton:176 은 AuthScreen.kt 에서 살아 있다). ui/editor/AlarmFortuneSettings.kt:534 FortuneSelectorRow — 참조 0건(현재 생년월일은 같은 파일 :215-240 의 연/월/일 텍스트 필드로 받는다). ui/voices/VoiceProfileRowComponents.kt:602 PlayingEqualizer — 참조 0건.

**iOS**: 없음(대응 컴포넌트 자체가 없다). 재생 중 표시는 iOS 도 Views/Voices/VoiceCatalogRow.swift:70 의 play/stop 아이콘 한 개뿐이라, PlayingEqualizer 를 되살릴 근거는 어느 쪽에도 없다.

**사용자 영향**: 화면에 안 나온다. 다만 AccountPanel.kt 는 파일 이름이 '계정 패널' 인데 내용의 절반이 요일 칩·스테퍼 같은 옛 알람 편집기 부품이라, 계정 화면을 고치러 온 사람이 매번 읽고 지나가야 한다.

**고칠 방향**: 판정: 지워야 한다. AccountPanel.kt:51-174(StepperField/OptionSection/DayRows/DayChip/OptionChips)와 AlarmFortuneSettings.kt:534-572(FortuneSelectorRow), VoiceProfileRowComponents.kt:602-628(PlayingEqualizer)를 삭제하고, 그때 쓰이지 않게 되는 import(Icons.Outlined.Add/Remove, FilterChip, OutlinedCard, rememberInfiniteTransition 등)도 함께 정리한다.

<details><summary>반증 검증 결과</summary>

인정한다(refuted=false). 코드로 전부 확인됐다.

**1. 인용 위치 확인 — 전부 실재, 주장대로다.** (인용 줄은 `@Composable` 애노테이션 줄이고 `fun` 선언은 +1 — 오차 아님)
- `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/account/AccountPanel.kt`: :52 `StepperField`, :89 `OptionSection`, :110 `DayRows`, :144 `DayChip`, :158 `OptionChips`, :177 `GoogleSignInButton` — 파일 전체 222줄, 이 6개가 전부다.
- `ui/editor/AlarmFortuneSettings.kt:535 FortuneSelectorRow`, `ui/voices/VoiceProfileRowComponents.kt:603 PlayingEqualizer`.

**2. 참조 전수조사 — 다른 경로 없음.** `grep -rnw`(단어 경계)로 `apps/android-native` 전 소스셋(main/test/androidTest/debug/dev/prod, `.kt/.kts/.xml/.pro`) + node_modules/.git 제외 저장소 전체를 훑은 결과:
- `StepperField`·`OptionSection`·`OptionChips`·`DayRows`·`FortuneSelectorRow`·`PlayingEqualizer`: **정의 1건씩, 호출 0건.**
- `DayChip`: 호출은 `AccountPanel.kt:127`·`:132`(둘 다 죽은 `DayRows` 본문 안)뿐.
- 대조군 `GoogleSignInButton` 은 `ui/auth/AuthScreen.kt:525` 에서 살아 있다 — 주장이 정확히 갈랐다.
- 참고: 단어 경계 없는 grep 이면 `SnoozeOptionSection`(`ui/editor/AlarmSnoozeSettings.kt:309`, 호출 6곳)이 `OptionSection` 으로 오탐되는데, 이건 **다른 함수**다. 주장은 이 함정에 걸리지 않았다.

**주장이 놓친 것(추가 발견, 결론은 그대로):** `DayRows:136` 이 부르는 `ui/util/PlatformAndLabelUtils.kt:124 repeatLabel` 은 **호출자가 그 한 곳뿐**이라 전이적으로 같이 죽는다(살아 있는 반복 요약은 `ui/editor/AlarmEditorControls.kt:238 repeatSummaryLabel`, `AlarmEditorControls.kt:99` 에서 사용).

**근거 문구 중 부정확한 두 곳(판정 무관):**
- "연/월/일 **텍스트 필드**" 아니다 — `AlarmFortuneSettings.kt:217/:226/:235` 의 `FortuneUnitDropdown`(private fun `:287`), 즉 드롭다운 3개다.
- AccountPanel.kt 는 "내용의 절반이 옛 편집기 부품" 이 아니라 **`AccountPanel` 이라는 Composable 자체가 없다**(패키지도 `com.alarmtalk.app`). 6개 중 5개가 죽은 편집기 부품 — 주장이 오히려 축소해 썼다.

**3. CLAUDE.md 예외 아님.** AlarmKit 제약(울림 화면·알람 음량)도, 플랫폼 표준 알럿도 아니다. 안드로이드 쪽 데드코드라 iOS 대응물 부재는 판정에 영향이 없고, iOS `Views/Voices/VoiceCatalogRow.swift:70` 이 `isPlaying ? "stop.fill" : "play.fill"` 아이콘 1개인 것도 확인했다 — 안드로이드 **살아 있는** 행도 아이콘 1개다(`VoiceProfileRowComponents.kt:412` `ic_voice_stop_24`/`ic_voice_listen_24`). 양쪽 어디에도 이퀄라이저를 되살릴 근거는 없다.

**4. 심각도.** 과장 아니다. 한 번도 컴포즈되지 않아 런타임 동작·사용자 화면에 영향 0, 순수 가독성/정리 이슈 → **P3** 가 맞다.

</details>

### ☐ [dead-code] iOS 에 렌더되지 않는 SwiftUI View 8개 — 시스템 .alert 로 대체된 시트, 다른 화면으로 옮겨간 섹션, 사라진 로그인 세그먼트 컨트롤의 잔재

**안드로이드**: 각각의 살아 있는 대응물: 해지 2단 확인은 BillingPanels.kt:649 CancelSubscriptionDialog, 탈퇴는 더보기 한 곳, 마케팅 동의 토글은 ui/settings/ConsentHistoryScreen.kt:176-181, 로그인/가입 전환은 ui/auth/AuthScreen.kt 하단 텍스트 버튼, 직접 입력 문구는 ui/editor/AlarmRandomPromptSettings.kt 의 ManualMessageDialog. 번역 토글은 안드로이드에 아예 없다 — voiceLanguage 는 ui/editor/AlarmEditorScreen.kt:1003,1171,1183 에서 앱 언어로 자동 설정된다.

**iOS**: #Preview 전용 host 를 제외한 전이적 dead View 8개: Views/Settings/BillingPanelComponents.swift:526 CancelSubscriptionSheet(커밋 57f84005 에서 Views/Settings/BillingPanel.swift:173-193 의 시스템 .alert 2단 확인으로 대체됨), Views/Settings/AccountPanel.swift:203 DeleteAccountPanel(탈퇴는 Views/Settings/MenuView.swift:72,104-110 한 곳), Views/Settings/SettingsView.swift:304 MarketingConsentSection + :274 SettingsToggleRow(SettingsView.swift:91-93 주석이 '마케팅 토글은 동의 내역 화면에 있다' 고 적어 두고 실제로 Views/Settings/ConsentHistoryView.swift:110-119 로 옮겼는데 코드를 안 지웠다), Views/Auth/LoginView.swift:415 ModePicker(지금은 :328-332 의 하단 텍스트 버튼), Views/Editor/AlarmEditorComponents.swift:463 ManualVoiceMessageEditor + :443 EditorLanguageOption + :449 ttsLanguages + :455 ttsTranslationLanguages(직접 입력은 Views/Editor/MessageSettingsPane.swift:139 의 .alert 로 대체), Views/Auth/LandingView.swift:102 WakerBrandHeader, :202 LandingWaveformBar(살아 있는 것은 :176 MiniWaveform).

**사용자 영향**: 화면에 안 나온다. 문제는 ManualVoiceMessageEditor 가 '번역' 토글 + 5개 언어 픽커(:535-548)를 완성 상태로 들고 있다는 것 — 안드로이드에 없는 기능이라, 이걸 근거로 살리면 두 앱이 다시 갈라진다. 또 SettingsView.swift:91 의 '여기가 아니라 동의 내역에 있다' 주석과 20줄 아래 살아 있는 MarketingConsentSection 정의가 서로 모순돼, 어느 쪽이 현재 동작인지 코드만 봐서는 모른다.

**고칠 방향**: 판정: 지워야 한다. 위 8개 선언과 그에 딸린 #Preview/host 를 삭제한다. SnoozeRepeatLimitPicker.swift·AlarmVolumeSlider.swift 와 함께 지우면 iOS Views 에서 약 700줄이 정리된다. ManualVoiceMessageEditor 를 지울 때 ttsLanguages/ttsTranslationLanguages/EditorLanguageOption(유일한 소비자였다)도 같이 지운다.

<details><summary>반증 검증 결과</summary>

주장이 전부 코드로 확인된다. 인용된 파일:줄이 모두 실재하고 주장대로다. 반증 시도 결과 반례가 없었다.

**전 저장소 word-boundary grep(`grep -rn "\bNAME\b" apps/ios-native --include='*.swift'`) 결과 8개 View 모두 호출부 0:**
1. `CancelSubscriptionSheet` — BillingPanelComponents.swift:526, 정의 1건뿐. 살아 있는 것은 BillingPanel.swift:173-195 의 2단 시스템 `.alert`(`showCancelSubscriptionSheet` → :185 `showCancelImmediateConfirm`). `git show 57f84005 -- .../BillingPanel.swift` 가 `-.sheet(...) { CancelSubscriptionSheet(` → `+.alert("이용권을 해지할까요?"` 로 바뀐 것을 보여준다 — 커밋 귀속까지 주장대로.
2. `DeleteAccountPanel` — AccountPanel.swift:203. 유일 참조 :260 은 `#if DEBUG`(245) ~ `#endif`(276) 안의 프리뷰 호스트. 실경로는 MenuView.swift:67-85(버튼) + :104-111(alert).
3. `MarketingConsentSection` — SettingsView.swift:304, 정의 1건뿐. 실경로는 ConsentHistoryView.swift:109-122 `ConsentToggleRow`. SettingsView.swift:91-93 의 "마케팅 토글은 여기가 아니라 동의 내역 화면에 있다" 주석과 20줄 아래 살아 있는 정의가 실제로 모순 — 주장대로.
4. `SettingsToggleRow` — SettingsView.swift:274. 참조 :313·:338 은 **둘 다 MarketingConsentSection 내부**라 전이적 dead.
5. `ModePicker` — LoginView.swift:415, 정의 1건뿐. 실경로는 `modeSwitchRow`(:325-340, 텍스트+버튼 :328-332).
6. `ManualVoiceMessageEditor` — AlarmEditorComponents.swift:463, 정의 1건뿐. 실경로는 MessageSettingsPane.swift:139-145 `.alert("직접 입력")`. 부속 `EditorLanguageOption`:443 / `ttsLanguages`:449(사용처 0) / `ttsTranslationLanguages`:455(:545 즉 죽은 에디터 내부에서만) 도 전이적 dead. 번역 토글 :535 + 5개 언어 픽커 :538-549 가 완성 상태로 남아 있는 것도 사실.
7. `WakerBrandHeader` — LandingView.swift:102, 정의 1건뿐.
8. `LandingWaveformBar` — LandingView.swift:202, 정의 1건뿐. 살아 있는 것은 `MiniWaveform`:176(:158 에서 사용) — 주장대로.

**안드로이드 대응물(직접 열어 확인, 모두 살아 있음):** BillingPanels.kt:649 `CancelSubscriptionDialog`(:268 호출) / ConsentHistoryScreen.kt:175-181 마케팅 `ConsentToggleRow` / AuthScreen.kt:533-553 하단 `TextButton` 행이며 `SegmentedButton`·`TabRow` 는 파일에 **아예 없음** / AlarmRandomPromptSettings.kt:337 `ManualMessageDialog`(:322 호출) / AlarmEditorScreen.kt:1003-1004,1171,1183 `voiceLanguage = appVoiceLanguage` 자동 설정이고 에디터에 번역 토글 UI 없음(AlarmEditorScreen.kt:163 은 주석뿐).

**놓친 다른 경로 없음.** 다른 곳에서 처리 중인 정황도 없다 — 오히려 주장이 안 잡은 stale 주석 2건을 추가로 확인했다: LandingView.swift:99 가 인용한 안드로이드 `WakerBrandHeader:156-166` 과 :201 의 `LandingPreviewWaveform:277-311` 은 **안드로이드에 존재하지 않는다**(LandingScreen.kt 에는 `MiniWaveform`:540 만 있음 — CLAUDE.md 가 경고한 바로 그 허위 근거). LoginView.swift:406-407 의 "화면 내부 segmented control 로 전환할 수 있다" 도 거짓.

**CLAUDE.md 예외 아님.** AlarmKit 제약도 플랫폼 표준도 아니다. `.alert` 로의 교체 자체는 플랫폼 표준 예외에 정확히 부합하는 올바른 조치이고, 예외가 정당화하는 것은 교체이지 옛 껍데기를 남겨 두는 것이 아니다.

**심각도는 과장.** 렌더되지 않으므로 사용자 영향 0, 빌드 에러도 없다(Swift 는 미사용 타입을 진단하지 않는다). 실질 위험은 유지보수·재갈라짐 함정 — SettingsView.swift:91-93 vs :304 모순 주석, 그리고 안드로이드에 없는 번역 기능이 완성 상태로 남아 "살리면 된다" 는 오독을 부르는 것. 따라서 P2 가 아니라 P3.

참고(삭제 시 파급): `private` 인 MarketingConsentSection·SettingsToggleRow·ModePicker·WakerBrandHeader·LandingWaveformBar 는 파일 스코프라 확정적으로 안전. `internal` 인 CancelSubscriptionSheet·DeleteAccountPanel·ManualVoiceMessageEditor·EditorLanguageOption·ttsLanguages·ttsTranslationLanguages 는 현재 dead 이나, DeleteAccountPanel 제거 시 AccountPanel.swift:260 의 DEBUG 프리뷰도 함께 고쳐야 한다.

</details>

### ☐ [plan-gate] 구독 응답 도착 전에는 유료 사용자가 무료로 판정된다 — 클론이 사라지고 문구가 테마로 잠긴다 (Android)

**안드로이드**: PlatformAndLabelUtils.kt:204-210 `hasPaidVoiceAccess` 는 `subscriptionResponse?.subscription` 이 null 이면 즉시 false — **로딩 중과 무료를 구분하지 않는다.** 그 값이 AlarmEditorScreen.kt:164 freeVoiceTier → :168-172 `visibleVoiceProfiles = voiceProfiles.filter { isSystem == true }`(내 클론이 목록에서 사라짐) → :190 restrictToWeatherMedication(문구가 테마로 잠김) → :228-230 manualQuota 조회 스킵 으로 이어진다. 목소리 탭도 같다: VoiceProfileManagementPanel.kt:343 `canCreateVoice = hasPaidVoiceAccess(...)`, :345-347 `ownVoices = if (canCreateVoice) … else emptyList()`, :1293-1299 `!canCreateVoice -> voicePlanGateOpen = true`(:1456-1467 "내 목소리 만들기는 유료 기능이에요"). 캐시는 있으나 계정별이라 빈틈이 남는다 — MainViewModelAuthActions.kt:286 `restoreAccessSnapshotForCurrentUser()`, MainViewModel.kt:98-103/:953-961. 새 기기 첫 로그인엔 스냅샷이 없고, 갱신은 AlarmTalkApp.kt:453-462 에서 `consentChecked && !showConsentScreen` 이후에야 나가며 실패 시 다음 탭 전환(60초 스로틀, :513-530)까지 null 로 남는다.

**iOS**: iOS 가 이 축에서는 맞다 — Views/Common/PlanGateDialog.swift:97-113 `PlanTier.bestKnown(serverSubscription:storeTier:userPlan:)` 이 `serverSubscription == nil` 일 때 세션의 `user.plan` 과 StoreKit tier 를 후보에 넣고 최댓값을 쓴다(주석 :94-96 "구매 직후 UI가 순간적으로 무료처럼 보이는 일을 줄인다"). 편집기(AlarmEditorSheet.swift:910-916 currentPlan)와 목소리 패널(VoiceProfileManagementPanel.swift:232-239), 업로드 플로우(VoiceCloneUploadFlow.swift:740-747)가 모두 이걸 쓴다.

**사용자 영향**: 유료 사용자가 새 기기에서 처음 로그인했거나 구독 조회가 실패한 동안, 알람 편집기에 자기 클론 목소리가 아예 안 보이고 문구는 '약/날씨' 테마로만 잠긴다. 목소리 탭에서는 내 목소리 목록이 비고 '추가' 를 누르면 "내 목소리 만들기는 유료 기능이에요" 가 뜬다 — 이용권이 있는 사람에게 이용권을 사라고 말하는 상태다. 여기서 '직접 입력' 을 누르면 위 P1 게이트로 이어진다.

**고칠 방향**: 안드로이드에도 iOS 의 `bestKnown` 에 해당하는 판정을 둔다: `hasPaidVoiceAccess` 는 그대로 두되, **UI 잠금용** 판정은 `subscriptionResponse == null` 일 때 `authSession.user.plan`(서버 users.plan) 을 폴백으로 본다. 이미 같은 개념이 앱 안에 있다 — AlarmTalkApp.kt:499-510 의 영구 강등 판정은 `subscriptionResponse != null` 을 명시적으로 요구해 로딩 중 오강등을 막고 있으니, 화면 잠금도 같은 규칙(모르면 잠그지 않는다)을 따라야 앞뒤가 맞는다. 회귀 테스트: subscriptionResponse=null + user.plan="personal" 에서 freeVoiceTier=false, canCreateVoice=true.

<details><summary>반증 검증 결과</summary>

메커니즘은 코드로 확인된다 — 반증 실패. 다만 인용 경로 하나가 틀렸고, 노출 창이 주장보다 훨씬 좁으며 영구 피해 경로는 이미 막혀 있어 심각도는 P3 로 내린다.

■ 인용 확인 (경로 1건 정정)
- `hasPaidVoiceAccess` 는 `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/util/PlatformAndLabelUtils.kt:204-210` 에 있다(주장은 `ui/screens/` 라고 적었다 — 디렉터리 오기, 줄 번호는 정확). :205 `val subscription = subscriptionResponse?.subscription ?: return false` — 로딩 중과 무료를 구분하는 축이 없는 것은 사실이다.
- `AlarmEditorScreen.kt:164` freeVoiceTier / `:168-172` visibleVoiceProfiles 시스템만 필터 / `:190` restrictToWeatherMedication / `:228-230` manualQuota 스킵 — 전부 인용대로 존재.
- `VoiceProfileManagementPanel.kt:343` canCreateVoice / `:345-347` ownVoices=emptyList / `:1293-1299` `!canCreateVoice -> voicePlanGateOpen = true` / `:1456-1467` PlanGateDialog(voices_create_paid_*) — 전부 인용대로 존재.
- 안드로이드 전체 grep 에 `billingChecked`/`subscriptionChecked`/`billingLoaded` 류 준비 신호가 **하나도 없다.** `authSession.user.plan` 을 목소리 권한 판정에 쓰는 경로도 없다(`AlarmTalkApp.kt:487` 강등 판정에서만 읽는다).
- iOS `PlanTier.bestKnown` 은 `Views/Common/PlanGateDialog.swift:97-112` 에 실재하고, `serverSubscription == nil` 일 때 `PlanTier.from(userPlan)` 을 후보에 넣는다(:100-102). 소비처도 실재 — `AlarmEditorSheet.swift:928`, `VoiceProfileManagementPanel.swift:233`, `VoiceCloneUploadFlow.swift:741`, `AlarmTalkApp.swift:307`, `BillingPanel.swift:34`, `VoiceShareAccess.swift:10`. (주장이 적은 :910-916 / :232-239 / :740-747 은 1~18줄 어긋났지만 코드는 그대로다.)

■ 주장이 빠뜨린 것 — 노출 창이 좁다
1. `AlarmTalkApp.kt:825-826` `showAppChrome = authSession != null && consentChecked && !showConsentScreen && … && !showVoiceSetup && currentTab != null`. 하단바와 ＋FAB(편집기·목소리 탭으로 가는 **유일한** 길)가 이 조건에서만 그려지는데, `preloadBilling` 을 쏘는 `LaunchedEffect` 조건(`:455-462` — `consentChecked && !showConsentScreen`)이 **똑같다.** 즉 크롬이 열리는 순간에 구독 요청이 함께 나간다 — 정상 경로의 창은 왕복 1회다.
2. 주장이 최악 시나리오로 든 '새 기기 첫 로그인' 은 오히려 더 가려져 있다. `MainViewModel.kt:797` `showVoiceSetup = cachedStockClips == 0 && !hasSkipped(userId)` — 새 기기는 캐시가 0 이라 목소리 준비 화면이 뜨고, 그 동안 크롬 자체가 안 그려진다(`:826`). 그 화면을 '나중에 받기'(`MainViewModel.kt:817-820`)로 즉시 건너뛸 때만 창이 열린다.
3. 스냅샷 캐시는 주장보다 넓게 덮는다 — `MainViewModel.kt:96-103`(프로세스 시작 시 `initialAccessSnapshot` → `:493` subscriptionResponse 초기값), `:953-961` 재로그인 시 복원, `MainViewModelBillingActions.kt:106` 갱신마다 저장. 심지어 백그라운드 워커도 채운다(`sync/PlanChangeSyncWorker.kt:69-71`). 빈 구멍은 '그 계정으로 billing 을 한 번도 성공한 적 없는 기기' 뿐이다.

■ 영구 피해 경로는 이미 이 창을 알고 막아 뒀다
`AlarmTalkApp.kt:496-499` — `billingNotEntitled = authSession != null && subscriptionResponse != null && !hasPaidVoiceAccess(...) && !hasCoupleOrFamilyAccess(...)`. 주석(:494-497)이 이 상황을 그대로 지목한다: "이래야 갱신 지연·읽기리플리카 지연으로 subscription 이 잠깐 null 인 유료 사용자가 영구 오변환되지 않는다." 백그라운드도 같은 3조건(`PlanChangeSyncWorker.kt:93-95`). 따라서 이 창에서 유료 알람이 sound-only 로 영구 변환되는 일은 없다.

■ 자가 회복
`preloadBilling` 은 토큰·consent 키 변화마다 재실행되고, 탭 전환이 `refreshBilling` 을 부른다(`AlarmTalkApp.kt:513-545`, 스로틀 60초·`(tab, token)` 키). 조회 실패 시 "영영 null" 이 아니라 최대 수십 초다.

■ 주장이 오히려 과소평가한 지점 (있긴 하다)
편집기가 **열린 채로** 창을 통과하면 draft 가 실제로 변형된다 — `AlarmEditorScreen.kt:1028-1041` 이 `voiceRandomPrompt=false`, `voiceTranslationEnabled=false`, `voiceLanguage` 리셋, `clearRestrictedVoiceRemnants()` 를 수행하고, 저장 검증 `:764-771` 이 클론 목소리를 `editor_error_deleted_voice_cannot_edit` 로 막는다. 그래도 도달 조건은 위의 같은 좁은 창이다.

■ 규약 판단
CLAUDE.md 예외 둘(AlarmKit 제약 / 플랫폼 표준) 어디에도 해당하지 않는다. 다만 규약은 「iOS 는 안드로이드를 원본으로 삼는다 — 다르면 iOS 가 틀린 것」이고, 이 항목은 그 방향을 뒤집어 **안드로이드를 iOS 에 맞추자**고 한다. iOS 결함이 아니라 iOS 파리티 감사 중 발견된 안드로이드 하드닝 제안으로 분류해야 한다.

결론: 인용은(경로 오기 제외) 사실이고 iOS 와의 차이도 실재하므로 반증하지 않는다. 그러나 (a) 크롬 게이트와 billing 요청이 동시 개방, (b) 새 기기는 목소리 준비 화면이 추가로 가림, (c) 영구 변환 경로는 명시적으로 방어됨, (d) 재시도로 회복됨 — 이 넷을 합치면 P1/P2 가 아니라 P3 다.

</details>

### ☐ [plan-gate] 앱 최상위 PlanGateDialog 는 절대 뜨지 않는 죽은 코드다 (Android)

**안드로이드**: AlarmTalkApp.kt:102 `var planGateDialog by remember { mutableStateOf<PlanGateDialogState?>(null) }` 로 선언된 뒤, 파일 전체에서 대입은 :349 / :761 / :764 **세 곳 모두 `= null`** 뿐이다(레포 전역 grep 으로 확인 — 비-null 대입 없음). 따라서 :755-767 의 `planGateDialog?.let { … PlanGateDialog(...) }` 블록과 AlarmTalkAppHelpers.kt:175-181 의 `PlanGateDialogState`(title/confirmLabel 커스터마이즈 필드 포함)는 실행되지 않는다. 이 죽은 호출부만 `r3app_plan_gate_confirm` 을 쓴다.

**iOS**: 없음 — iOS 에는 앱 최상위 플랜 게이트가 아예 없다(게이트는 편집기·목소리 패널 로컬 상태). 다만 Views/Common/PlanGateDialog.swift 의 `PlanGateState`(:4-38) 역시 어느 화면에서도 sheet item 으로 쓰이지 않아(주석 :3 "View modifier 들이 sheet item 으로 사용" 이 실제와 다름) 같은 성격의 잔재다 — PlanTier(:45-114)만 살아 쓰인다.

**사용자 영향**: 직접적인 사용자 영향은 없다. 다만 화면별로 게이트를 새로 만들 때 '공용 게이트가 이미 있다' 고 오인해 이 죽은 상태에 연결하면 아무것도 안 뜨고, 반대로 이 잔재를 근거로 게이트 문구를 여기서 고치면 실제 화면에는 반영되지 않는다(이번 조사에서 실제로 후보로 잡혔다).

**고칠 방향**: `planGateDialog` 상태와 :755-767 블록, `PlanGateDialogState`(AlarmTalkAppHelpers.kt:175-181), 그리고 그 블록에서만 쓰는 `r3app_plan_gate_confirm` 문자열을 함께 걷어낸다. 지우기 아까우면 반대로 **살려서** 게이트를 한 곳으로 모으는 쪽을 택하되, 둘 중 하나만 하고 지금처럼 반쯤 남겨 두지 않는다. iOS 의 `PlanGateState` 도 같이 정리한다.

<details><summary>반증 검증 결과</summary>

반증 실패 — 주장은 코드로 전부 확인된다.

【Android: 죽은 코드 확인】
- 선언: apps/android-native/app/src/main/java/com/alarmtalk/app/ui/app/AlarmTalkApp.kt:102 `var planGateDialog by remember { mutableStateOf<PlanGateDialogState?>(null) }`.
- 대입: `app/src` 전체(main/dev/prod/debug/test/androidTest) grep 결과 대입은 딱 셋이고 **모두 `= null`** — AlarmTalkApp.kt:349 / :761 / :764. 비-null 대입 경로 없음.
- 생성자: `PlanGateDialogState` 는 레포 어디서도 생성되지 않는다. 참조는 선언(AlarmTalkAppHelpers.kt:175-181, title/confirmLabel 모두 nullable 커스터마이즈 필드)과 :102 의 타입 파라미터 둘뿐.
- 따라서 AlarmTalkApp.kt:755-768(주장은 755-767 이라 했으나 닫는 중괄호가 768 — 사소한 오차) 의 `planGateDialog?.let { PlanGateDialog(...) }` 블록은 실행되지 않는다.
- 문자열: `r3app_plan_gate_confirm` 의 유일한 소스 참조는 AlarmTalkApp.kt:759(죽은 블록 안)이다. 리소스는 세 로케일에 살아 있으나 고아다 — values/strings.xml:827, values-en/strings.xml:799, values-ja/strings.xml:807. 살아 있는 게이트는 별개 키 `r3dlg_plan_gate_title`/`r3dlg_plan_gate_confirm` 을 쓴다(PlanGateDialog.kt:37-38 기본값).

【놓친 경로 없음 — 다만 컴포저블 자체는 살아 있다】
`PlanGateDialog` 컴포저블(ui/components/PlanGateDialog.kt:32)은 죽지 않았다. 실사용 호출부 둘:
- ui/editor/AlarmEditorScreen.kt:1651 — `VoiceGateReason` 3분기(LOGIN_REQUIRED/PLAN_REQUIRED/SYSTEM_VOICE_LIMIT)로 title·message·confirmLabel·onRedeemCode 를 갈라 넘기고 로컬 `voicePlanGateOpen` 으로 제어.
- ui/voices/VoiceProfileManagementPanel.kt:1457 — `voices_create_paid_title`/`voices_create_paid_notice` + 로컬 `voicePlanGateOpen`.
주장도 이 점을 부정하지 않았다(죽은 것은 최상위 상태·상태 클래스·문자열 하나뿐). 즉 사용자에게 빠진 화면은 없다.

【iOS 확인】
- Views/Common/PlanGateDialog.swift 는 총 114줄이고 `PlanGateState`(:4-38)와 `PlanTier`(:45-114)만 들어 있다. 파일에 View·ViewModifier 정의가 없다(grep: struct/func/extension 라인이 :4,:26,:65,:78,:97 뿐).
- `PlanGateState` 는 이 파일 밖 어느 Swift 파일에서도 참조되지 않는다 → :3 의 주석 "View modifier 들이 sheet item 으로 사용" 은 실제와 다르다(주장대로).
- `PlanTier` 는 살아 있다: VoiceShareAccess.swift:7,10 / AlarmTalkApp.swift:307 / Views/Settings/BillingPanel.swift:33-34,75 / BillingPanelComponents.swift:12,186 / Services/IAP/SubscriptionManager.swift:31,192 / SubscriptionProduct.swift:24,33,50 등.
- iOS 최상위 플랜 게이트 부재도 사실이다 — 게이트는 로컬 상태다: Views/Voices/VoiceProfileManagementPanel.swift:37 `@State private var planGateOpen`, :181 시스템 `.alert`, :301/:307 에서 true.

【CLAUDE.md 예외 해당 없음】
AlarmKit 제약도, 플랫폼 표준(iOS 시스템 .alert)도 아니다. 이건 양 앱 공통의 잔재 코드이고, iOS 의 로컬 `.alert` 게이트 자체는 오히려 규약이 허용한 플랫폼 표준이라 문제가 아니다.

【심각도】
주장 스스로 "직접적인 사용자 영향은 없다" 고 적었고 코드로도 그렇다 — 실행되지 않는 블록이라 렌더링·상태·성능 어디에도 영향이 없다. 실질 위험은 유지보수뿐이다: (1) 새 게이트를 이 상태에 연결하면 아무것도 안 뜬다, (2) 게이트 문구를 :759 에서 고치면 실제 화면(r3dlg_* 키)에 반영되지 않는다. P3 이 적정이며, 이보다 높게 잡았다면 과장이다.

</details>

### ☐ [ringing] iOS: 진동을 '없음'으로 꺼도 포그라운드 울림 때 햅틱이 울린다

**안드로이드**: apps/android-native/.../alarm/RingingService.kt:521-525 startVibration — `if (patternName == VibrationPatterns.NONE) { Log.i(...); return }` 로 즉시 빠진다. 호출부 :221-222 도 알람의 vibrationPattern 을 그대로 넘긴다.

**iOS**: apps/ios-native/AlarmTalk/AlarmKitViewModel.swift:287-293 fireForegroundRingHaptic() 은 인자가 없고 record 를 보지 않는다 — `UIApplication.shared.applicationState == .active` 만 확인하고 무조건 `UINotificationFeedbackGenerator().notificationOccurred(.warning)`. 호출부 :258 도 조건 없이 부른다. 반면 편집기에는 진동 on/off 토글이 있고 끄면 `.none` 이 저장된다(Views/Editor/AlarmEditorSheet.swift:541-545, 요약 행은 :231 에서 '꺼짐' 으로 표시).

**사용자 영향**: '진동 꺼짐'으로 저장해 둔 알람인데, 앱을 열어 둔 상태에서 그 알람이 울리면 폰이 한 번 진동한다. 설정 화면은 '꺼짐'이라고 말하고 있어 표시와 동작이 어긋난다(회의 중 등 진동을 명시적으로 끈 상황에서 문제가 된다).

**고칠 방향**: fireForegroundRingHaptic() 에 record 를 넘겨 `record.vibrationPatternEnum != .none` 일 때만 발화시킨다. VibrationPatternPicker.swift 가 이미 '실제 알람 진동은 시스템이 소유한다'고 정직하게 안내하고 있으므로, 우리가 직접 내는 이 한 번의 햅틱만큼은 사용자 선택을 따라야 한다.

<details><summary>반증 검증 결과</summary>

코드로 확인됨 — 반증 실패. (1) 인용 줄 전부 실재하고 주장대로다: apps/ios-native/AlarmTalk/AlarmKitViewModel.swift:287-293 fireForegroundRingHaptic() 은 인자가 없고 record 를 안 본다 — `guard UIApplication.shared.applicationState == .active else { return }` 뒤 무조건 `UINotificationFeedbackGenerator().notificationOccurred(.warning)`. 호출부 :252-258 은 `if didEnterAlerting { if let record = store.recordByAlarmKitID(kitID) { store.markRinging(...); fireForegroundRingHaptic()` 로, record 가 바로 스코프에 있는데도 진동 게이트가 없다. 편집기 토글은 Views/Editor/AlarmEditorSheet.swift:541-545 `set: { draft.vibrationPattern = $0 ? .default : .none }`, 요약 행은 :231 `subtitle: draft.vibrationPattern == .none ? "꺼짐" : ...`, 저장은 :1823 `vibrationPattern: draft.vibrationPattern.rawValue`. `.none` 케이스는 AlarmEnums.swift:100-118 에 존재. 안드로이드 원본은 alarm/RingingService.kt:521-525 에서 `if (patternName == VibrationPatterns.NONE) { Log.i(...); return }` 로 즉시 빠지고 호출부 :220-222 가 알람 값을 그대로 넘긴다. 토글 의미도 동일(ui/editor/AlarmEditorScreen.kt:1439-1441, :1528-1530 — `if (it) DEFAULT else NONE`).
(2) 다른 처리 경로 없음: *.swift 전수 grep 결과 울림 시각 햅틱은 AlarmKitViewModel.swift:291 하나뿐이고, vibrationPatternEnum 소비처는 Views/Editor/AlarmEditDraft.swift:85(편집기 프리필)뿐. VibrationHapticPreview.play 는 픽커 미리듣기(Views/Editor/VibrationPatternPicker.swift:89, Views/Editor/AlarmSettingsPanes.swift:157)로 사용자가 직접 누를 때만 난다.
(3) CLAUDE.md 예외 아님 — 우리가 직접 발사하는 우리 코드이고, 게이트에 쓸 값(record)이 이미 손에 있다.
(4) 다만 사용자 영향은 과장 — P3 로 조정. 발사되는 건 연속 진동이 아니라 `.warning` 1회(짧은 두 번 탭)이고, 안드로이드의 `repeat = true` 웨이브폼(RingingService.kt:533)과 성격이 다르다. 포그라운드 `.active` 일 때만, ring 당 1회만 난다(didEnterAlerting 스냅샷 멱등성) — 알람이 울리는 전형적 상황(잠금/백그라운드)에선 아예 안 난다. 결정적으로 iOS 에서 '진동 꺼짐' 은 이 줄을 고쳐도 무진동이 되지 않는다: docs/ios/BRIEF.md:292 "AlarmKit 이 노출하지 않는 것: 알람별 볼륨·페이드인·진동 패턴", docs/ios/분석/03-플랫폼제약.md:133 "AlarmKit 은 볼륨도 햅틱도 노출하지 않고" — 울림 진동은 시스템 alert 소유라 주장이 든 '회의 중' 시나리오의 진동은 이 햅틱이 아니라 AlarmKit 이 낸다. 추가로 AlarmKit 전체화면 alert 표시 중 앱이 `.active` 를 유지하는지는 정적으로 확인 불가라 실제 도달 빈도가 더 낮을 수 있다(다만 바로 아래 in-app voice fallback :274-278 이 포그라운드 도달을 전제하므로 발사 가능성 자체는 있다). 수정은 :258 을 `if record.vibrationPatternEnum != .none` 으로 감싸는 한 줄이면 안드로이드 startVibration 과 계약이 같아진다.

</details>

### ☐ [screens-flow] 웰컴 프로모 게이트에 준비 신호 3개(versionChecked·accountStatusChecked·showVoiceSetup)가 빠져 있다

**안드로이드**: apps/android-native/.../ui/app/AlarmTalkApp.kt:409-433 — 프로모 판정은 키와 가드 양쪽에 `versionChecked`, `accountStatusChecked`, `pendingDeletion`, `consentStatusChecked`, `showConsentScreen`, `consentUnsupported`, `showVoiceSetup`, `permissionGateRequest` 를 전부 넣는다. 주석(:399-408)이 이유를 적어 뒀다 — 응답 전 기본값 `false` 가 '아니오' 와 구분되지 않아 1회 플래그를 태우고, 뒤늦게 차단 화면이 덮으면 사용자는 본 적도 없이 잃는다.

**iOS**: apps/ios-native/AlarmTalk/Views/Root/RootView.swift:169-193 — `blockingGateActive` 는 `versionGate.updateRequired || !isAuthenticated || pendingDeletion || showConsentScreen` 뿐이고, `evaluateWelcomePromo()` 의 가드는 `consentStatusChecked` 하나다. AppVersionGate.swift:16-42 에는 `versionChecked` 에 해당하는 준비 신호가 없고(응답 전 `updateRequired` 는 기본값 false), AuthViewModel.swift:77·509-524 의 `pendingDeletion` 도 `/auth/me` 응답 전엔 기본값 false 이며 `accountStatusChecked` 축이 없다. 목소리 받기 게이트(`voiceSetupDone == false`)는 `blockingGateActive` 에도 promoGateKey(:175-177)에도 들어 있지 않다.

**사용자 영향**: 콜드 스타트에서 동의 상태만 먼저 도착하면 웰컴 프로모가 떠 **계정당 1회 플래그를 태운다.** 뒤늦게 강제 업데이트/탈퇴 유예 화면이 그 위를 덮으면 사용자는 프로모 코드를 등록할 기회를 영영 잃는다(PromoPromptStore 는 계정 단위라 재설치해도 안 돌아온다). 또 '목소리를 받고 있어요' 다운로드 화면 위에 프로모가 겹쳐 뜬다.

**고칠 방향**: `AppVersionGate` 에 성공·실패 모두 true 로 올리는 `checked` 를 추가하고, AuthViewModel 에 `accountStatusChecked`(refreshUser 완료 신호, 세션 정리에서 false 로 되돌림)를 만든다. `blockingGateActive` 에 `consentUnsupported` 와 `voiceSetupDone != true` 를 더하고, 두 신호를 promoGateKey 에도 넣어 응답 도착 후 재평가되게 한다.

<details><summary>반증 검증 결과</summary>

셋 중 **하나만 성립**한다. 인용 줄은 전부 실재하지만, 주장이 내세운 "1회 플래그를 태우고 뒤늦은 차단 화면이 덮어 영영 잃는다" 는 메커니즘은 두 축에서 반증된다.

## 1) 인용 확인 (모두 실재)
- 안드로이드 `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/app/AlarmTalkApp.kt:409-433` — 키(`:410-421`)와 가드(`:422-432`) 양쪽에 `versionChecked`·`accountStatusChecked`·`pendingDeletion`·`consentStatusChecked`·`showConsentScreen`·`consentUnsupported`·`permissionGateRequest`·`showVoiceSetup` 전부 들어 있음. 주석 `:396-408` 도 주장대로.
- iOS `apps/ios-native/AlarmTalk/Views/Root/RootView.swift:169-171` `blockingGateActive = versionGate.updateRequired || !auth.isAuthenticated || auth.pendingDeletion || auth.showConsentScreen`, `:175-177` promoGateKey = `userID|consentStatusChecked|blockingGateActive`, `:185-193` 가드는 `consentStatusChecked` 하나. `AppVersionGate.swift:16-17` 에 `versionChecked` 상당 신호 없음(publish 는 `updateRequired`·`storeURLString` 둘뿐). `AuthViewModel.swift:77` `pendingDeletion = false` 기본값, `accountStatusChecked` 축 없음(전 파일 grep 무결과).

## 2) accountStatusChecked 축 — **반증됨(순서로 이미 닫혀 있다)**
iOS 는 세션이 생기는 **모든** 경로에서 `/auth/me` 를 **먼저 await 한 뒤** 동의 확인을 부른다:
- `AuthViewModel.swift:261-266` `restoreSession()` → `await refreshUser()` → `await checkConsentStatus()`
- `:332-334`(Apple 로그인), `:390-392`(이메일 로그인) 동일 순서
`consentStatusChecked = true` 가 되는 지점은 `checkConsentStatus` 내부 `:790`·`:797` 뿐이고, `pendingDeletion` 은 그보다 앞선 `:523`(`refreshUser` 성공 시) 에서 확정된다. 즉 **`consentStatusChecked` 가 `accountStatusChecked` 역할을 겸한다** — 응답 전 기본값 false 로 프로모가 새어 나갈 창이 구조적으로 없다. 안드로이드가 별도 플래그를 둔 이유는 반대다: `MainViewModelAuthActions.kt:376-391` 의 `checkAccountStatus` 가 `viewModelScope.launch` 로 **fire-and-forget** 이라 동의 확인과 경쟁하기 때문이다(`AlarmTalkApp.kt:440-446` 에서 세 개를 나란히 호출). iOS 는 structured await 라 그 경쟁이 없다. 예외 경로는 `registerWithEmail`(`:418-420`, `refreshUser` 없이 동의 확인만) 하나인데, 방금 만든 계정은 `pending_deletion` 이 될 수 없다.

## 3) versionChecked 축 — 코드 사실은 맞으나 **현재 도달 불가(잠재적)**
- 백엔드 `packages/backend/src/lib/app-version.ts:49-58` — iOS 정책 `minSupported: 1`, `latest: 1`.
- `AppVersionGate.swift:37` — `updateRequired = appVersionCode >= 1 && appVersionCode < policy.minSupportedVersion`. `minSupported == 1` 이면 **어떤 빌드에서도 항상 false** 다. 뒤늦게 덮을 업데이트 화면 자체가 존재할 수 없다.
- 타이밍도 반대다: `AlarmTalkApp.swift:79-82` 의 `checkAppVersion()` 은 **한 번의 왕복**이고 `:129` 의 `restoreSession()` 보다 먼저 붙는 `.task` 이며, 동의 경로는 그 뒤 **두 번의 순차 왕복**(`/auth/me` → `/consents/status`)을 거쳐야 한다. 실패 시엔 `AppVersionGate.swift:38-41` 이 `updateRequired = false` 로 두고 재시도도 없어 '늦게 오는 차단 화면' 자체가 안 생긴다.
→ App Store 출시 후 `minSupported` 를 올리는 날 살아나는 **잠재 결함**이지, 지금 사용자에게 닿는 버그가 아니다.

## 4) showVoiceSetup 축 — **인정(단 손실이 아니라 겹침)**
`RootView.swift:169-171`·`:176` 어디에도 `voiceSetupDone` 이 없다. 동의를 마치면 `blockingGateActive` 가 true→false 로 뒤집혀 promoGateKey 가 바뀌고 `:113 .task(id:)` 가 재실행되는데, 그 시점 `voiceSetupDone == false`(`DefaultVoicePreferenceStore.swift:74-76` — 신규 계정은 chosen·skipped 둘 다 없음)라 `:96-100` 이 `VoiceSetupView` 를 그리고 있다. 그 위에 `:114-138` 프로모 오버레이가 얹힌다. **레이스가 아니라 신규 가입 100% 에서 결정적으로 재현**된다. 겹치는 화면은 스톡 클립 다운로드 화면(`Views/Onboarding/VoiceSetupView.swift:33` "알람에 쓸 목소리를 받고 있어요", `:82-88` 6초 뒤 탈출구, `:60-65` 실패 시 '다시 시도')이라, 스크림이 그 탈출구/재시도 버튼을 가린다. 안드로이드는 `AlarmTalkApp.kt:415`(키)·`:432`(가드)로 밀어 두었다가 준비가 끝나면 효과가 다시 돌아 **그 다음에** 띄운다.

## 5) 예외 해당 여부 / 심각도
AlarmKit 제약도 플랫폼 표준도 아니다 — 순수 게이팅 로직이라 「다르면 iOS 가 틀린 것」에 해당한다. 다만 주장이 쓴 사용자 영향("프로모 코드 등록 기회를 영영 잃는다")은 **세 축 모두에서 성립하지 않는다**: 3)은 발화 자체가 불가능하고, 2)는 순서로 닫혀 있으며, 4)는 프로모가 **정상적으로 보이고 등록도 가능**하다(가려지는 건 프로모가 아니라 그 아래 다운로드 화면이다). 남는 실질 피해는 신규 가입 첫 화면의 레이어 겹침 + 6초 뒤 탈출구 가림이고, 탭 한 번으로 닫힌다. P1/P2 가 아니라 P3 이 맞다.

</details>

### ☐ [screens-flow] 선택 모드 [취소·삭제] 바가 목록과 함께 스크롤돼 화면 밖으로 밀려난다

**안드로이드**: apps/android-native/.../ui/alarms/AlarmListScreen.kt:160-197 — 헤더(HomeHeader ↔ AlarmSelectionBar)를 `LazyColumn` **바깥** Column 에 고정하고, 주석(:161-166)이 이유를 적어 뒀다: "스크롤해도 '다음 알람까지' 안내가 남고, 무엇보다 목록을 내린 상태에서 선택 모드에 들어가도 [취소·삭제]에 닿을 수 있다." 높이도 `heightIn(min = 48.dp)` 로 고정해 모드 전환 시 목록이 튀지 않게 했다.

**iOS**: apps/ios-native/AlarmTalk/Views/Root/MainTabsView.swift:41-51 — 탭 본문 전체가 하나의 `ScrollView` 안에 있고, Views/Alarms/AlarmsListView.swift:30-49 의 `AlarmSelectionBar`/`NextAlarmHeadline` 은 그 스크롤 콘텐츠의 첫 요소다. 고정(pinned) 처리가 없다.

**사용자 영향**: 알람이 여러 개라 목록을 내린 상태에서 행을 길게 눌러 선택 모드에 들어가면, [취소]·[삭제] 바가 화면 위쪽 스크롤 밖에 있어 보이지 않는다. 사용자는 선택 모드에 들어간 줄도 모른 채(스위치가 체크 표시로 바뀐 것만 보임) 빠져나갈 방법을 찾지 못한다 — iOS 에는 안드로이드의 뒤로가기(AlarmListScreen.kt:149)에 해당하는 탈출구도 없다.

**고칠 방향**: 헤드라인/선택 바를 ScrollView 밖으로 빼 알람 탭 상단에 고정한다(안드로이드처럼 최소 높이 48pt 로 두 상태의 높이를 맞춘다). 탭별로 헤더 슬롯을 두거나, 알람 탭만 `VStack { header; ScrollView { rows } }` 구조로 감싼다.

<details><summary>반증 검증 결과</summary>

구조적 차이는 코드로 확인됐다(인용 줄 전부 실재·주장대로). 다만 "탈출구가 없다"는 영향 서술은 코드로 반증되므로 심각도를 P3으로 낮춘다.

■ 확인된 것 (인용 검증)
1) 안드로이드 — `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/alarms/AlarmListScreen.kt:160-197`: 헤더 Box 가 `Column`(:160) 안, `LazyColumn`(:198) **바깥**에 있고 주석(:161-166)이 인용 그대로 "목록을 내린 상태에서 선택 모드에 들어가도 [취소·삭제]에 닿을 수 있다"고 적혀 있다. `heightIn(min = 48.dp)`(:174)도 인용대로 존재.
2) iOS — `apps/ios-native/AlarmTalk/Views/Root/MainTabsView.swift:41-51`: `ScrollView { VStack { currentTabContent } }` 가 탭 본문 전체를 감싼다. `currentTabContent`(:143-146)가 `AlarmsListView` 를 그리고, `apps/ios-native/AlarmTalk/Views/Alarms/AlarmsListView.swift:25-49` 에서 `AlarmSelectionBar`/`NextAlarmHeadline` 은 그 VStack 의 **첫 자식**이다 — 스크롤 콘텐츠다.
3) 고정 장치가 코드베이스 어디에도 없다: iOS 전체에 `safeAreaInset`·`ScrollViewReader`·`scrollTo`·`pinnedViews`·`scrollPosition` 이 **0건**(grep, apps/ios-native/AlarmTalk/**/*.swift). 선택 모드 진입 시 상단으로 스크롤하는 경로도 없다.
4) 오히려 iOS 주석이 사실과 반대다 — `apps/ios-native/AlarmTalk/Views/Alarms/NextAlarmHeadline.swift:28` 이 "이 헤더는 리스트 밖에 고정돼 있어 높이가 곧 목록에서 뺏는 화면이다" 라고 단언하지만, 실제로는 ScrollView 안이다. 전형적인 "안드로이드 미러" 잘못된 근거.
5) 예외 해당 없음 — AlarmKit 제약(울림 화면·음량)과도, 플랫폼 표준(.alert)과도 무관하다. 순수 레이아웃이라 iOS 가 틀린 쪽이다. `AlarmSelectionBar` 자체는 이미 `minHeight: 48`(AlarmRow.swift:318)로 안드로이드 48dp 와 맞춰 놨다 — 붙일 자리만 안 맞다.

■ 반증되는 것 (심각도 과장)
- **"빠져나갈 방법을 찾지 못한다" 는 틀렸다.** 선택 모드에서 행 본문 탭 = 선택 토글이다(`AlarmRow.swift:90` `Button(action: selectionMode ? onToggleSelected : onTap)`). 롱프레스는 **그 행 하나만** 선택하므로(`AlarmsListView.swift:131` `selectedAlarmIDs = [alarm.id]`), 방금 누른 행을 한 번 더 탭하면 집합이 비고 `selectionMode`(:151)가 false 가 되어 모드가 끝난다. 손가락이 이미 있는 그 자리가 탈출구다. 안드로이드도 동치(`ControlsAndPermissions.kt:390` `selectionMode -> onToggleSelected()`).
- **탭 이동도 탈출구다.** `selectedAlarmIDs` 는 `AlarmsListView` 의 `@State` 라 `currentTabContent` 가 다른 탭으로 갈리면 뷰가 해제되며 초기화된다 — 안드로이드의 명시적 초기화(`AlarmListScreen.kt:148`)와 결과가 같다.
- **"선택 모드에 들어간 줄도 모른다" 도 과장.** 보이는 **모든** 행의 스위치가 원/체크로 바뀌고(`AlarmRow.swift:116-134`), ＋FAB 가 사라진다(`MainTabsView.swift:66` `!alarmSelectionActive`, 신호는 `AlarmsListView.swift:74` preference). 변화가 화면 전체에 걸린다.
- **재현 조건이 좁다.** 스크롤이 생길 만큼(대략 8개 이상, 행 ≈91pt + 간격 16pt) 알람이 쌓이고 아래로 내린 상태여야 한다. 그리고 삭제 버튼이 화면 밖이므로 **오삭제 방향으로는 오히려 안전**하다 — 데이터 손실·잘못된 상태 없이 "위로 한 번 쓸어야 취소·삭제가 보인다" 가 실제 손해의 전부다.

→ 인정하되 P3(레이아웃 parity·발견성 저하, 회복 가능·비파괴적). 고치는 법은 `MainTabsView` 의 ScrollView 밖(또는 `.safeAreaInset(edge: .top)`)으로 알람 탭 헤더를 빼는 것.

</details>

### ☐ [voice-save] 고른 테마(bucket)가 알람 레코드에도 서버에도 저장되지 않아, 캐시가 사라지면 알람이 조용히 '기본 인사말' 로 바뀐다

**안드로이드**: data/AlarmEntity.kt:46-59 — `bucketId`/`bucketRotationIndex`/`bucketClipKeysJson`/`bucketClipTextsJson`/`contextVariantIndex` 를 Room 행에 영속한다. ui/editor/AlarmEditorState.kt:235-238 `toDraft` 가 `isActiveBucketAlarm()` 일 때 그 값을 실어 보내고, :194-202 는 버킷 알람도 `voiceRandomContext` 를 **떨어뜨리지 않는다**(주석이 "한 곳만 고치지 말 것" 이라고 못 박은 지점). 서버에도 network/RemoteAlarmMapper.kt:28 `bucketId = alarm.bucketId.trimmedOrNull()` 로 보내고(network/RemoteAlarmApi.kt:59-60 `bucket_id`), data/RemoteAlarmPullSyncService.kt:686 이 `remote.bucketId` 로 되읽는다. 그래서 재설치·기기 교체 후에도 테마가 살아 있다.

**iOS**: apps/ios-native/AlarmTalk/LocalAlarmRecord.swift:6-55 — bucket 관련 필드가 **하나도 없다.** 테마는 런타임 파생으로만 존재한다: Views/Editor/AlarmEditorSheet.swift:804-810 `selectedFreeBucket` 은 `selectedStockMessageID` → `voiceStudio.stockClips`(네트워크로 받은 매니페스트) 조회 결과이고, 기존 알람 재진입 시 복원은 :1149-1156 `restoreStockClipSelectionIfNeeded` 가 **`AudioCacheStore.shared.cachedURL(for: cacheKey) != nil` 일 때만** 한다. 서버 페이로드에도 없다 — AlarmTalkAPIModels.swift:321-335 `RemoteAlarmWriteRequest` 에 `bucket_id` 필드 자체가 없고 RemoteAlarmMapper.swift:122-139 도 보내지 않는다. 복원이 실패하면 무료 등급에서는 AlarmEditorSheet.swift:1179-1206 `coerceFreeVoiceTierConstraints` 가 `randomPrompt = true`, `randomContext = preset` 로 덮어쓴다.

**사용자 영향**: '날씨' 테마 알람을 다른 기기에서 pull 로 받거나(캐시 파일 없음) 캐시가 정리된 뒤 열면 테마가 사라진 채 열리고, 그대로 저장을 누르면 **고른 적 없는 '기본 인사말' 알람으로 조용히 바뀐다.** 서버 쪽 `alarms.bucket_id` 도 항상 null 이라 어느 테마였는지 복구할 근거가 남지 않는다.

**고칠 방향**: `LocalAlarmRecord` 에 `bucketId`(최소한 이것 하나)를 추가해 저장 시 `prepared` 의 클립 category 를 적고, 재진입 시 캐시 유무와 무관하게 그 값으로 `selectedFreeBucket` 을 결정한다. `RemoteAlarmWriteRequest` 에 `bucket_id` 를 추가해 push 하고(서버는 이미 alarm-helpers.ts:123-131 로 검증·저장한다), pull 에서도 되읽어 채운다. 그 전까지는 최소한 복원 실패 시 `coerceFreeVoiceTierConstraints` 가 기존 컨텍스트를 덮지 않도록 막을 것.

<details><summary>반증 검증 결과</summary>

인용된 파일:줄은 전부 실재하고 주장대로다. 다만 '사용자 영향'으로 든 두 트리거가 코드로 반증되므로 심각도를 P3로 내린다.

【확인된 것 — 구조적 파리티 갭은 진짜】
- iOS `apps/ios-native/AlarmTalk/LocalAlarmRecord.swift:6-55` 필드 전수 확인 — bucket 관련 필드가 하나도 없다. 안드로이드 `apps/android-native/app/src/main/java/com/alarmtalk/app/data/AlarmEntity.kt:46-59` 는 `bucketId`/`bucketRotationIndex`/`bucketClipKeysJson`/`bucketClipTextsJson`/`contextVariantIndex`(+`contextResolvedAtMillis`)를 Room 행에 영속한다. `ui/editor/AlarmEditorState.kt:187-202`(버킷 알람도 voiceRandomContext 유지)·`:235-238`(버킷 4종 저장)도 주장 그대로다.
- 서버 전송: iOS `AlarmTalkAPIModels.swift:321-334` `RemoteAlarmWriteRequest` 에 bucket 필드 없음, `RemoteAlarmMapper.swift:122-139` 도 안 보낸다. 안드로이드는 `network/RemoteAlarmApi.kt:59-60`(`@SerializedName("bucket_id")`) + `network/RemoteAlarmMapper.kt:28` 로 보내고 백엔드가 실제로 저장한다(`packages/backend/src/lib/migrations.ts:1174-1175`, `src/routes/alarm-mutation.ts:434/449/466/478`, 검증 `src/routes/alarm-helpers.ts:112-131`). 즉 iOS 가 만든 알람의 `alarms.bucket_id` 는 항상 null 이다.
- 런타임 파생 + 캐시 게이트: `Views/Editor/AlarmEditorSheet.swift:804-810` `selectedFreeBucket` 은 `selectedStockMessageID`(=`preparedAlarm.audioCacheKey` 의 `stock_` prefix 파생, `:105-107`) → `voiceStudio.stockClips` 매니페스트 조회다. 복원은 `:1149-1158`, 특히 `:1158 guard AudioCacheStore.shared.cachedURL(for: cacheKey) != nil else { return }` 로 캐시 파일이 살아 있을 때만 한다. 실패하면 `:1179-1230 coerceFreeVoiceTierConstraints` 가 `randomPrompt=true`/`randomContext=preset`/`ttsLanguage="ko"` 로 덮고, 저장 경로(`:1468-1497`)는 `canReuseExistingTtsAudio`(`Views/Editor/AlarmEditDraft.swift:190-239` — 저장값 voiceCategory 가 "custom" 인데 새 activeCategory 는 "morning" 이라 false)를 통과 못 해 preset TTS 를 새로 생성한다 → 테마 상실. **메커니즘 자체는 코드로 확인된다.** CLAUDE.md 예외(AlarmKit 제약 / 플랫폼 표준) 어느 쪽도 아니다.

【반증된 것 — 주장이 든 트리거 둘 다 도달 불가에 가깝다】
1. "다른 기기에서 pull 로 받거나" — **불가능하다.** iOS pull 은 받은 가족 알람만 import 한다: `RemoteAlarmPullSync.swift:139-140` + `:373-383 isReceivedRemoteCandidate`(target==나 && sender!=나). 안드로이드도 같다 — `data/RemoteAlarmPullSyncService.kt:102 allRemote.filter { it.isReceived }`. 내가 만든 알람은 양 플랫폼 모두 서버에서 되받지 않으므로 기기 교체·재설치 시나리오는 bucket_id 유무와 무관하게 존재하지 않는다. 안드로이드가 `:686` 에서 되읽는 것도 **받은 알람 한정**이고, 바로 위 `:685` 주석이 "회전 클립은 미다운로드 → 대표 클립 단일 재생 폴백" 이라고 못 박는다.
2. "캐시가 정리된 뒤" — 스윕이 막는다. `AudioCacheStore.swift:390-409 sweepStaleCache` 는 `activeCacheKeys` 에 든 키를 나이와 무관하게 건너뛰고, 유일한 호출자 `AlarmTalkApp.swift:182-186` 가 **전체 알람의 audioCacheKey** 를 넘긴다. 삭제 cascade 도 참조 카운트 기반이라 같은 스톡 클립을 여러 알람이 써도 안전하다(`LocalAlarmStore.swift:214-225` + `:62-66 countByAudioCacheKey`). 저장 위치도 App Group 컨테이너/Application Support 이지 OS 가 비우는 `Caches` 가 아니다(`AudioCacheStore.swift:468-476`). 무료 전환 강등도 스톡 알람은 제외한다(`LocalAlarmRecord.swift:99-108`, `PaidVoiceGate.swift:37-50`).
3. "복구할 근거가 남지 않는다" — 로컬에는 남는다. 저장 시 `AlarmEditorSheet.swift:1574-1590` 이 `ttsMessageId` 와 `audioCacheKey=stock_<messageId>` 를 레코드에 박고, `StockClipPrefetcher.swift:20-21/66-76/94-99` 가 정확히 그 `stock_<messageId>` 키로 무료 버킷 클립을 다시 받는다. '테마가 런타임 파생으로만 존재' 는 과장이고, 실제로 막는 건 편집기 복원 게이트가 파일 존재를 요구하는 것뿐이다.
4. "조용히" — 완전 무증상은 아니다. `selectedFreeBucket == nil` 이면 요약 행이 "불러오는 중이에요" 로 바뀐다(`Views/Editor/FreeBucketSettings.swift:34-40`).

【남는 실제 위험(그래서 refuted=false)】 캐시 파일만 사라지고 레코드는 남는 상태가 만들어지면 저장이 preset 으로 덮인다. 현실적 경로는 App Group 컨테이너 전환 정도다 — 이 브랜치 커밋 e2897e59 가 실제로 App Group 을 뺐다 되돌렸고, `AudioCacheStore.swift:468-476` 이 App Group 없을 때 Application Support 로 폴백하므로 그 사이 쓴 파일은 복귀 후 `cachedURL` 이 못 찾는다. 알람 레코드는 Documents 에 따로 있어(`LocalAlarmStore.swift:16-17`) 함께 사라지지 않는다. 빈도가 낮아 P3.

【주장이 놓친, 더 큰 별건】 iOS 의 무료 테마는 **회전 자체가 없다.** `AlarmEditorSheet.swift:813-822 selectFreeBucket` 은 그 카테고리의 `clips.first` 하나만 `selectStockClip` 으로 바인딩한다. 안드로이드는 `ui/editor/AlarmEditorScreen.kt:498-548 bindStockBucketClips` 가 variant 별 N개 클립 키·문구를 모아 `ui/editor/AlarmEditorState.kt:421-447 setBucketAudio` 로 넘기고 울릴 때마다 회전한다(`data/AlarmRepository.kt:1048-1070`, `alarm/RingingService.kt:79`). 그런데 iOS 주석 `Views/Editor/FreeBucketSettings.swift:6-8` 과 `StockClipPrefetcher.swift:9-10` 은 "클립이 알람이 울릴 때마다 순차 회전한다" 고 적어 두었다 — 없는 동작을 근거로 쓴 '안드로이드 미러' 주석이다. 사용자 체감은 이쪽(무료 알람이 매일 같은 문구)이 bucket_id 미영속보다 크다.

</details>

### ☐ [voice-save] iOS 는 자기가 만든 TTS 알람의 `voiceSource` 를 `server_tts` 로 저장한다 — 안드로이드에서 그 값은 '남에게서 받은 알람' 이라는 뜻

**안드로이드**: data/AlarmConstants.kt:267-273 `VoiceSources` = local_audio / tts_profile / server_tts. 내가 만든 TTS 알람은 항상 `TTS_PROFILE` 이다(ui/editor/AlarmEditorState.kt:380 `setGeneratedTtsAudio`, :398 `setStockClipAudio`, :432 `setBucketAudio`). `SERVER_TTS` 는 서버에서 받아온 알람 전용이고(data/RemoteAlarmPullSyncService.kt:668), 편집기는 그 값을 보면 ui/editor/VoiceAudioCard.kt:158-163 에서 `TTS_PROFILE` 로 되돌리고 `clearTtsMeta()` 로 메시지 메타를 비운다 — '내 것이 아닌 음원' 이라는 판정이다. 직전 선택 기록도 이 값을 술어로 쓴다(ui/main/MainViewModel.kt:894 `draft.voiceSource == VoiceSources.TTS_PROFILE`).

**iOS**: apps/ios-native/AlarmTalk/Views/Editor/AlarmEditorSheet.swift:1568 `merged.voiceSource = VoiceSource.serverTts.rawValue` — 내가 편집기에서 생성한 TTS 도, 스톡 클립도 전부 `server_tts` 로 저장된다. iOS 쪽 소비자는 모두 `voiceSourceEnum == .localAudio` 만 보므로(LocalAlarmRecord.swift:66-110, PaidVoiceGate.swift:28-50) 지금은 증상이 없다.

**사용자 영향**: 당장 사용자에게 보이는 증상은 없다. 다만 두 앱의 로컬 레코드 의미가 갈라져 있어, 안드로이드의 `voiceSource == tts_profile` 술어를 쓰는 로직(예: 직전 선택 기록의 녹음 제외 조건, 편집기의 '받은 알람이면 메타 비우기')을 iOS 로 이식하는 순간 **모든 알람이 조건에서 빠지거나 모든 알람이 받은 알람으로 취급된다.**

**고칠 방향**: `AlarmEditorSheet.swift:1568` 을 `VoiceSource.ttsProfile.rawValue` 로 바꾼다. `server_tts` 는 `RemoteAlarmMapper.swift:196-199` 의 pull 경로에만 남긴다(그쪽은 이미 안드로이드와 같다). 기존 행은 `voiceSource` 를 술어로 쓰는 곳이 `!= localAudio` 뿐이라 마이그레이션 없이도 안전하다.

<details><summary>반증 검증 결과</summary>

인용된 줄이 모두 실재하고 주장대로다(iOS 줄번호만 1568→실제 1575로 7줄 어긋남).

확인된 사실:
- apps/android-native/.../data/AlarmConstants.kt:267-273 VoiceSources = local_audio/tts_profile/server_tts.
- ui/editor/AlarmEditorState.kt:380(setGeneratedTtsAudio)/:398(setStockClipAudio)/:432(setBucketAudio) 모두 voiceSource = VoiceSources.TTS_PROFILE — 내가 만든 TTS·스톡·버킷은 예외 없이 tts_profile.
- data/RemoteAlarmPullSyncService.kt:668 `voiceSource = if (hasVoiceAudio) SERVER_TTS else LOCAL_AUDIO` 는 함수 buildReceivedAlarmRow(:607) 안, 즉 수신 알람 전용 빌더. grep 상 SERVER_TTS 생산자는 저장소 전체에서 이 한 곳뿐.
- ui/editor/VoiceAudioCard.kt:158-163 LaunchedEffect 가 SERVER_TTS 를 TTS_PROFILE 로 되돌리고 clearTtsMeta() 호출(:103-106 visibleVoiceSource 접기도 동일).
- ui/main/MainViewModel.kt:894 draft.voiceSource == TTS_PROFILE 이 '직접 입력 문구 기억' 술어.
- 주장이 놓친 곳: data/AlarmRepository.kt:733-736 강등 후보 필터가 origin == AlarmOrigins.LOCAL_OWNED && voiceSource == TTS_PROFILE 를 함께 본다.
- iOS: Views/Editor/AlarmEditorSheet.swift:1575 `merged.voiceSource = VoiceSource.serverTts.rawValue` (else if let prepared = voiceStudio.preparedAlarm 갈래 = 생성 TTS + 스톡 클립 저장 경로 전부). VoiceStudioViewModel.swift:472 주석도 "저장 흐름이 server_tts 로 병합" 이라고 의도를 적어 둠.
- iOS 는 수신 알람에도 같은 값을 쓴다(RemoteAlarmMapper.swift:196-198 resolveVoiceSource → .serverTts, 호출부 :44). 따라서 iOS 의 server_tts 는 내 것/받은 것을 전혀 구분하지 못하는 값이다.
- CLAUDE.md 예외 아님(AlarmKit 제약도 플랫폼 표준도 아닌 순수 로컬 레코드 값).

반증 시도가 깎아낸 부분(→ 심각도 하향):
1. 현재 증상 0 이 사실이다. iOS 의 voiceSource 소비자 전수(LocalAlarmRecord.swift:86, PaidVoiceGate.swift:39, RemoteAlarmMapper.swift:125, AlarmEditDraft.swift:203·277, AlarmEditorSheet.swift:701·1038·1069·1994·2005)가 모두 == .localAudio / != .localAudio 만 본다. .ttsProfile 과 .serverTts 를 가르는 코드는 앱 타깃에 한 줄도 없다.
2. 서버로 새지 않는다 — RemoteAlarmMapper.toRemoteRequest(:121-139)는 voiceSource 를 push 하지 않는다(voiceProfileId 동봉 여부에만 사용). 기기 간 오염 경로 없음.
3. "이식하면 깨진다" 는 이미 한 번 비껴갔다 — MainViewModel.kt:894 에 대응하는 iOS rememberChoicesUsed(AlarmEditorSheet.swift:1661-1678)는 voiceSource 가 아니라 record.voiceRandomPrompt 로 갈라진다.
4. '받은 알람' 의 실제 판별자는 양쪽 다 origin 이다(안드로이드 AlarmRepository.kt:734 origin==LOCAL_OWNED, iOS RemoteAlarmMapper.resolveOrigin:145-153 / AlarmEditDraft.swift:301). 그래서 "SERVER_TTS = 수신 알람" 은 안드로이드에서도 상관관계일 뿐 유일 의미론이 아니며, 주장의 표현은 그 점에서 과하다.

결론: 값 저장 자체의 갈라짐은 코드로 확인되어 반증 불가. 다만 사용자 증상 0, 서버 전파 없음, 수신 판별은 origin 이 담당, 기존 대응 로직은 다른 술어라 무사 — P1/P2 가 아니라 P3(잠재 일관성 결함). 수정은 AlarmEditorSheet.swift:1575 를 .ttsProfile 로 바꾸는 한 줄이면 되고 마이그레이션도 불필요하나, AlarmTalkTests/AlarmEditDraftTests.swift:28·126·507, LocalAlarmRecordCodableTests.swift:27, DynamicVoiceRefreshServiceTests.swift:162 가 serverTts 픽스처로 이 상태를 고정하고 있다.

</details>
