# Dev 테스트 핸드오프

> 세션 재개용 라이브 문서. 마지막 갱신 **2026-07-13**. 상태가 바뀌면 이 파일을 갱신/정리한다.
> (다른 컴퓨터에서도 `git pull` 후 이 문서를 읽으면 바로 이어서 진행 가능.)

## 2026-07-13 — 음성 개편 Part 2 착수: 미터링·문구모델 완료(커밋), 등록/사전렌더는 재부팅 대기

**이 PC adb 다운(중요)**: `socketpair: Bad address`(winsock 손상)로 adb 데몬 자체가 기동 실패 → 실기기 설치·탭 검증 불가. `netsh winsock reset` **이미 걸어둠(exit 0)**, **재부팅하면 복구**. gradlew 빌드·vitest 는 정상이라 컴파일/유닛 검증은 계속 가능. 두 폰(R3CW300EZBA·RF9R40323AP)은 연결돼 있고 재부팅만 하면 바로 설치 가능.

**이번 세션 커밋(feature/default-voice-sheet, 빌드/테스트 검증 완료)**:
- `63251d6` **직접 입력 TTS 월 미터링 백엔드** — migration 58 `manual_tts_usage`(pool_key,usage_month 원자 카운터), `lib/manual-tts-quota.ts`(한도 personal 30/couple 50/family 100, 풀=plan_group_id 공유 or 본인PK, upsert…WHERE used<limit RETURNING 예약·실패시 환불), `/tts/generate` 캐시미스 뒤 예약·429 `MANUAL_TTS_QUOTA_EXCEEDED`·성공시 `manual_quota` 첨부. 단위 12개+전체 1259 통과. 무료 수동입력은 기존 `FREE_PLAN_PRESET_ONLY` 게이트로 이미 차단.
- `c2ca6d8` **미터링 표시 + 조회 엔드포인트** — `GET /tts/manual-quota`(남은횟수 조회, 소비X), 클라 `TtsGenerateResponse.manualQuota` 파싱, 저장 성공시 "이번 달 N회 남음"·429 전용 문구(ko/en/ja).
- `87cdde2` **문구 선택기 운동→약** — 유료 picker=날씨·운세·사랑·약·직접입력. 약은 동적모드 없어 고정 프리셋으로 라우팅(category=medication→백엔드가 randomContext를 preset로 정규화→medication 프리셋 문구). 백엔드 변경 불필요.

**실기기 체크리스트(재부팅 후)**:
- [ ] 유료 계정: 편집기 문구 선택기에 '운동' 없고 '약' 있음 → 약 선택 저장 시 "약 먹을 시간이에요…" 계열 재생
- [ ] 유료 계정: 직접 입력으로 문구 생성 반복 → 성공 토스트에 "이번 달 N회 남음" 카운트다운, 한도 초과 시 "…횟수를 다 썼어요" 안내(생성 차단)
- [ ] 무료 계정: 직접 입력/동적 문구 여전히 유료 게이트(변화 없어야 함)

**남은 클러스터(#4 사전렌더 / #5 등록 미리듣기·확인·삭제 / #6 등록 관계·말투·호칭) — 재부팅+dev배포 후 진행**:
서로 얽혀 있고 (a) 실기기 탭 검증 또는 (b) dev 배포+라이브 ElevenLabs/Gemini 가 있어야 안정 완결됨. 블라인드 대량 구현은 지양. 정확한 통합 지점(구현 즉시 착수용):
- **#4 사전렌더**: `lib/stock-clips.ts` `generateStockClip`(現 is_system=1 하드게이트: `listSystemVoices` SQL·행 owner=SYSTEM_VOICE_LIBRARY_USER_ID)을 is_system=0(클론)까지 확장 — messages/generated_audio_assets 행 `user_id`=실소유자, R2 key owner도. 트리거 = `voice-profile.ts:911` ready 훅(동기, waitUntil 없음) → cron(`index.ts:267~`, `*/5`)에 `findMissingStockTargets`+소량 `generateStockClip` 배치 신설. `/tts/stock-clips`(tts.ts:1318)·`/messages/:id/audio`(1150)에 소유권(`m.user_id IN(?,?)`) 스코프. 날씨/운세는 **유한 variant 세트를 직접 설계**해 category+variant 로 사전 저장(現 스키마 variant 지원O, 날씨조건 컬럼X). 무료=기본+날씨+약, 유료=기본+날씨+운세+사랑+약. 무료 '날씨' 버킷은 이 사전렌더가 있어야 노출됨(現 `FreeBucketOrder=[morning,medication]` 유지 중).
- **#5 등록 미리듣기/확인/삭제**: `VoiceProfileManagementPanel.kt`(2스텝 Source→Details) 클론 성공(`MainViewModelVoiceActions.kt:186` onSuccess) 직후 필수 미리듣기(그 목소리로 기본 모닝콜 재생)+유지/삭제. 삭제=기존 `deleteVoiceProfile`. 확인시 월변경 예약=migration 57 `voice_profile_change_ledger`(voice-profile.ts:46 reserve/mark 재사용) + #4 프리셋 렌더 트리거.
- **#6 등록 관계/말투/호칭**: 짧은 관계 목록 선택+말투 예시 재생+호칭 직접입력. 백엔드 필드 이미 있음(relationship_label·listener_title·voice_gender·speech_formality, migration 53).

## 지금 상태 (2026-07-12) — 홈 개선 일괄 완료(미커밋), 알람 편집기 디자인 리뷰 진행 중

**미커밋 변경(홈 UX 일괄, 두 테스트폰에 설치·검증 완료)** — feature/default-voice-sheet 브랜치 워킹트리:
1. 홈 헤더: "다음 알람 오전 6:00" → 상대시간 "13시간 4분 후에 울려요."(분 경계 자동 갱신, ICU MeasureFormat, ko/en/ja 자동) — `HomeComponents.kt`
2. 알람 카드 날짜 줄에 목소리 이름("7월 13일 (월) · 아담 목소리") — `ControlsAndPermissions.kt`(AlarmRow voiceName 파라미터), `AlarmListScreen.kt`(resolve)
3. 홈 헤더 타이포 headlineLarge 로 타 탭과 통일
4. AlarmRow 스와이프 삭제: 하드컷 스냅 → Animatable 스프링 정착(놓는 속도 이어받기 `initialVelocity`, 플릭은 속도 부호 우선, 코너 22→0dp 연속 변형)
5. FAB 등장/퇴장 AnimatedVisibility(scale 0.85+fade, 퇴장 120ms), 히어로 카드 눌림 스케일(`wakerPressScale` 토큰 신설, WakerDesign.kt)
6. 빈 상태 히어로 카드 재구성: 3줄→2줄(상황 라벨 삭제), →원형 → FAB 와 동일한 + 원형, 텍스트 블록과 + 세로 중앙 정렬(2단 구도), 카피 "듣고 싶은 목소리가 깨워줘요."
7. 진동 패턴 라벨 한글화(ko "Basic call"→"기본" 등, ja 카타카나) + `AlarmSettingsCard.kt` VibrationOptions 하드코딩 영어 제거(vibrationLabel 경유)
8. dead string 정리: hs_status_next_alarm, hs_start_now, hs_empty_card_label, hs_empty_card_helper_voice(도입 후 제거)
9. `.claude/skills/`에 emil-design-eng·apple-design 스킬 설치(웹→Compose 번역 노트 첨부)

**알람 편집기 디자인 리뷰 — 워크플로 완료 + Tier-1 적용·검증(미커밋)**: 5관점×적대검증 워크플로(39 에이전트, 29 채택/1 기각) 결과 중 고임팩트·저위험 4건을 적용하고 A32 실기기에서 검증함:
1. **섹션 헤더 통일**: dead code였던 `EditorSectionTitle`(titleMedium/Bold/onBackground로 재튜닝)로 '재생 방식'·'세부 설정'·'알람에서 들을 목소리' 통일(전엔 목소리 헤더만 작은 SemiBold). AlarmEditorScreenComponents/AlarmEditorControls/AlarmSettingsCard/VoiceAudioCard.
2. **타임휠 좌우 정렬**(3에이전트가 "붕 뜬 느낌 근본원인"): 8dp 인셋 제거→24dp 거터 정렬(AlarmEditorScreen item을 editorHorizontalPadding Box로 감쌈, AlarmTimePicker Surface .padding(8) 제거). 폭 32dp 축소를 내부 Row padding 22→12·간격 16→12로 정확히 상쇄해 숫자 컬럼 60dp 보존(12:59 클리핑 없음 확인).
3. **'랜덤 문구 사용' 맨몸 토글**(5에이전트 최다 지적): 이웃(아담·랜덤설정)과 같은 tinted 카드(surfaceVariant@0.45, WakerChipShape)에 담고 부제 `editor_random_prompt_use_hint`="알람마다 어울리는 문구를 골라 읽어줘요."(ko/en/ja) 추가 → 3카드 일관 리듬.
4. **세부 모달 카드 보더**: SnoozeOptionSection(4모달 공용 옵션그룹) + 3개 '사용 중' 카드에 wakerCardBorder() 추가 → near-black 배경에서 경계 분리.
+ 앞서 진동 패턴 라벨 한글화도 포함.

**백로그 2차 적용(2026-07-12, 사용자 지적 2건 + 나머지 — 미커밋, A32 검증)**:
- **선택 컨트롤 크기 통일**(사용자 지적 "내부/밖 고르는 크기 다름"): `OptionChips`(목소리/녹음·파일, M3 FilterChip·초록·작음)를 새 공용 `EditorSegmentedSelector`(AlarmEditorControls.kt, PlayModeChip 재사용)로 교체 → 바로 위 '재생 방식'과 폭·높이·파란 선택색 완전 일치. (OptionChips는 여기서만 쓰여 안전)
- **세부설정 pane 슬라이드 전환**(사용자 지적 "다른 덴 밑에서 올라오는데 이 창은 하드컷"): `when(settingsDetailPanel)`을 `AnimatedVisibility`(우→좌 slideIn/우 slideOut, EditorPaneEasing=CubicBezier(0.16,1,0.3,1))로 감쌈 + lastDetailPanel 기억으로 exit 중 내용 유지. **판단**: 세부설정은 옵션 여럿(진동 11개 등)이라 전체화면 드릴인이 맞고, 짧은 픽(테마·수신자·목소리 3~수개)은 기존 바텀시트 유지 — 상호작용 유형별 분리가 정석. 하드컷만 문제였어서 슬라이드로 해결. (전면 바텀시트 통일 원하면 별도 결정)
- **눌림 물성** `wakerPressScale`: AlarmSettingRow(리플 interactionSource 공유)·PlayModeChip·DayTextChip·VoiceProfileSelector에 적용. VoiceProfileSelector는 indication=null→LocalIndication 복원.
- **폴리시**: 진동 off '끔'→'꺼짐'(ko, 다시 울림과 통일) / 섹션 간격 16→20dp(그룹핑) / 하단 여백 12→24dp.

**3차 적용(2026-07-12, 사용자 지적 2건)**:
- **'음성'→'목소리' 통일**: 편집기 세그먼트만 '음성'이고 요약(label_play_mode_*)은 이미 '목소리'였음(내부 불일치). editor_play_mode_alarm_voice '알람+음성'→'알람+목소리', editor_play_mode_voice_only '음성'→'목소리', editor_voice_output_title '음성 소리'→'목소리', 코치 본문까지 ko/ja 일괄(en은 이미 voice로 일관). "알람 + 목소리" 세그먼트 클리핑 없음 확인. (음성메시지·음성AI·생체정보 등 다른 기능/법적 문구의 '음성'은 유지)
- **세부 모달 라디오 행 높이**: SnoozeRadioRow heightIn 48→56dp, vertical padding 6→8dp(진동 11개·다시 울림 등 공용) → 촘촘하던 리스트가 삼성/토스식 여유 간격으로.

**4차 적용(2026-07-12, 녹음/파일 정리 — 사용자 결정)**:
- **알람 설정의 '파일' 제거, '녹음'만 유지**: 판단 결과 파일(임의 audio/* 디코드·크롭)이 불안정 핵심이고 TTS/녹음과 가치 중복 → 편집기 로컬오디오에서 VoiceCaptureModeSelector·VoiceFileControls 제거, VoiceRecordControls만 렌더(VoiceAudioCard.kt). 소스 세그먼트 라벨 '녹음/파일'→'녹음'. **'목소리 만들기'(음성 클로닝)의 파일/영상 업로드는 그대로 유지**(사용자 명시). 기존 파일 알람은 미리듣기/삭제로 하위호환(prod DB 어차피 초기화). 저장차단·빈상태 문구도 파일 언급 제거(ko/en/ja).
- **녹음 후 버튼 정리**: '듣기'→'미리듣기', 미리듣기·지우기 버튼 앞 아이콘 제거(텍스트 전용). 녹음 타일의 마이크 아이콘은 녹음 액션이라 유지.

**5차 적용(2026-07-12, 문구 기능 전면 개편 — Part 1/2 중 Part 1 완료, 미커밋)**:
사용자 비전: preset(기본 인사말)을 목소리별 사전 렌더 기본값으로 두고, 편집기 문구 선택은 직접 입력 + 동적 문구만.
- **토글 → 단일 '문구' 선택기**: '랜덤 문구 사용' 토글 제거. 카드는 `MessageModeSummaryRow`("문구 · [직접 입력 문구/기본 인사말/컨텍스트]" · 변경) 하나. (VoiceAudioCard.kt)
- **문구 종류 정리**: preset·식사(meal)·취침(sleep) 선택지에서 제거, '직접 입력' 추가·**맨 아래 배치**. 최종: 기상+날씨/기상+운세/운동/사랑/직접 입력. (EditorMessageContexts, AlarmEditorControls.kt / RandomPromptContexts 는 normalize·기본값용으로 존치)
- **preset 은 보이지 않는 기본값**: 새 알람은 여전히 voiceRandomPrompt=true+preset(사전 렌더 경로 보존, SystemVoices.presetGeneratedAudio/isFreeSystemPresetRequest 안 깨짐). 카드엔 '기본 인사말'로 표기, 목록엔 없음.
- **직접 입력 → 입력 다이얼로그**: 누르면 날씨·운세처럼 `ManualMessageDialog`(문구 입력) 팝업. 확인 시 voiceRandomPrompt=false+voiceText 반영(applyRandomPromptSettings manual 분기, RandomPromptSettingsResult.manualText 추가). 카드 인라인 필드 제거.
- **pane 정리**: 제목 '랜덤 문구 설정'→'문구', 상단 안내문(editorp_random_intro) 제거, 각 문구 설명(RandomPromptContextDescription) 제거, '문구 종류' 섹션 라벨 제거(SnoozeOptionSection title 옵셔널화), 저장 버튼 Save 아이콘 제거.
- 카피: 직접 입력 placeholder '음성 메시지'→'문구', editor_msg_* 신규(문구/직접 입력/기본 인사말) ko/en/ja.

**Part 2 (유료 클론 목소리 preset 사전 렌더 — 백엔드, 미착수)**: 목소리 등록 시 preset 문구를 그 목소리 말투로 미리 생성·저장해 모든 목소리가 사전 렌더 경로를 쓰게 한다. 조사한 훅 포인트:
- 생성 완료 지점: `voice-profile.ts` status→'ready'(elevenlabs_voice_id set, ~L913). 여기서 preset 클립 생성 작업을 트리거.
- 문구 풀: `lib/tts-presets.ts`(`loadTtsPresets`, category별 messages), preset 선택은 `tts.ts pickRandomPresetText`. 저장은 messages `is_preset=1` + `generated_audio_assets`(voice_profile_id별) + R2 `VOICE_BUCKET`.
- 클라 인식: `SystemVoices.kt presetGeneratedAudio`/`MainViewModelVoiceActions.isFreeSystemPresetRequest`가 지금은 **시스템 목소리**만 사전렌더로 인식 → 유료 클론 목소리도 인식하도록 확장(audioCacheKey `stock_`/신규 키 규칙).
- 난이도: N클립×ElevenLabs TTS 비동기 생성(Workers CPU 한계 → 큐/waitUntil 또는 최초 사용 시 생성+캐시), 스토리지, 목소리 생성 UI 진행표시, preset 문구 풀 버저닝. **billing/유료 목소리 인접 + dev 자동배포**라 신중 필요 — 별도 집중 작업 권장(꼬리 붙이기 부적합).
Part 1 은 이와 완전 호환(붙기 전까진 유료 목소리 preset 이 실시간 TTS로 현행 동작, 안 깨짐).

**아직 남은 백로그(판단 필요, 저우선)**:
- VoiceRepeatChoice(목소리 모달 반복) secondaryContainer 색 드리프트, 셰브론 vs '변경' 어포던스 혼용, alpha 매직넘버(0.38~0.55) 토큰화, 모달 '사용 중' primary 강조 과함.
- (선택) 세부설정 pane 전면 바텀시트 통일(현재는 슬라이드 드릴인으로 해결, 상호작용 유형별 분리 유지).
전체 워크플로 결과: `스크래치패드/tasks/wz7uosxei.output`(JSON, adopted 29건 구현 스케치).

**빌드/환경 주의(이 PC)**: 소켓 bind/listen 간헐 WSAEFAULT(10014) — Gradle 데몬·adb 가 자주 실패. 우회: 성공까지 재시도 루프(스크래치패드 `build_dev.cmd`, WMI 로 세션 밖 실행 + `build.log` 폴링, **실행 전 build.log 삭제 필수**(스테일 DONE 레이스)). 설치 후 `md5sum` 해시 대조로 스테일 APK 방지. K2 캐스케이드(같은 모듈 무더기 Unresolved) 시 clean 재빌드. 자세한 건 메모리 `reference_winsock_wsaefault_build_workaround` 참조. 근본 해결 후보: 재부팅/`netsh winsock reset`.

---

## (이전) 2026-06-24 상태 — 폰 QA 대기 중
회원가입/배포 개선 일괄 작업 완료. 사용자가 폰에서 테스트 후 결과를 보고할 예정.
- PR **#500**(인증 개선) · **#501**(init-db 시크릿 dev/prod 분리) → `develop` 머지 완료.
- dev 백엔드 배포 **green**, 마이그레이션 **#52까지 적용**. dev `/api/auth/email-code` 신규 동작 확인됨(200 + debug_code).
- 두 테스트폰에 최신 dev APK 설치됨(아래 변경 전부 포함). **APK = 현재 develop 앱 코드와 일치**(이후 develop 변경은 워크플로 yaml·문서뿐).
- 다음: 폰 테스트 결과 보고 받으면 → 아래 체크리스트/파일 위치 기준으로 수정·재빌드·재설치.

## 변경 요약 + 코드 위치
1. **랜딩 다크모드 액센트 코랄→브랜드 블루**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/auth/LandingScreen.kt` (다크 분기 `accent = scheme.primary`)
2. **비밀번호 정책(영문+숫자 필수, 8~128자)**: 서버 `packages/shared/src/schemas/auth.ts` `PasswordSchema`; 클라 표시·검증 `apps/android-native/.../ui/auth/AuthScreen.kt`(`PasswordRules`, `passwordPolicyValid`). 규칙: 8자 이상 / 영문·숫자 포함 / 일치.
3. **중복·소셜 이메일 가입 차단·안내**: 서버 `packages/backend/src/routes/auth.ts` `classifyExistingAccount` → `/auth/email-code`·`/auth/register`가 **409**(`AUTH_EMAIL_TAKEN`=비번계정, `AUTH_EMAIL_SOCIAL`+`provider`=소셜). 클라 매핑 `apps/android-native/.../ui/main/MainViewModelAuthActions.kt` `duplicateEmailMessage`, 로그인 자동전환 `apps/android-native/.../ui/app/AlarmTalkApp.kt` `authRedirectToLogin`. ⚠️ 가입여부 노출 = account enumeration 트레이드오프(의도, `/api/auth/*` rate-limit 으로 완화). 로그인 라우트는 기존 generic 유지.
4. **dev migrate 404 수정 + init-db 시크릿 dev/prod 분리**: `.github/workflows/deploy-backend.yml`, `packages/backend/scripts/run-remote-migrations.ts`.

## 폰 테스트 체크리스트
- [ ] 랜딩(다크모드): 액센트 = 브랜드 블루(코랄 아님)
- [ ] 회원가입 비번: "8자 이상 / 영문·숫자 포함 / 비밀번호 일치" 3규칙 표시, 영문+숫자 없으면 가입 버튼 비활성
- [ ] 이메일 인증: dev엔 RESEND 미설정 → 인증코드가 **앱 토스트로 표시**(예 "인증 코드: 123456"), 그 코드 입력해 가입 진행(실제 메일 발송 X)
- [ ] 중복 이메일 가입 시도: 비번계정 → "이미 가입된 이메일… 로그인" + **로그인 화면 자동 전환** / 구글계정 → "구글로 가입된 이메일…" 안내

## 남은 follow-up
- [ ] **`INIT_DB_SECRET_PROD`를 GitHub Repository Actions secret으로 등록** (현재 repo secrets에 안 보임 — Environment secret으로 넣었으면 배포 잡이 못 읽음). prod 배포 시 prod 워커에도 동일 값 `.dev.vars.prod` + `npm run secrets:sync:prod`. (지금 prod 배포 안 하니 당장 영향 없음)
- [ ] (선택) signup enumeration 노출이 부담되면 "이메일 인증 통과 후에만 가입여부 노출"하는 절충안으로 변경 가능.

## 테스트 수정 후 재빌드/재설치
```
apps\android-native\gradlew.bat -p apps\android-native :app:assembleDevDebug
adb -s R3CW300EZBA install -r apps/android-native/app/build/outputs/apk/dev/debug/app-dev-debug.apk
adb -s RF9R40323AP install -r apps/android-native/app/build/outputs/apk/dev/debug/app-dev-debug.apk
```
