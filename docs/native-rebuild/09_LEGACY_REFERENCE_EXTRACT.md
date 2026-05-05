# Legacy Mobile Reference Extract

이 문서는 `apps/mobile` React Native/Expo 앱을 나중에 삭제하기 전에 보존해야 할 제품/도메인 정보를 추출한 공용 참조 문서다.

레거시 앱의 알람 런타임은 사용하지 않는다. 특히 `alarmRinger.ts`, `notifeeAlarms.ts`, Expo notification 기반 알람, server cron/push 기반 알람 아이디어는 네이티브 제품으로 이식하지 않는다. 아래 내용은 UX, 문구, API 계약, 디자인 토큰, 도메인 개념만 보존한다.

## 보존 원칙

- Android/iOS 네이티브 알람은 OS-native scheduler와 로컬 DB/로컬 오디오만으로 울린다.
- 서버, R2, ElevenLabs, Perso는 알람 전에 오디오를 만들고 내려받는 경로에만 있다.
- 알람 울림 시점에는 네트워크 fetch, push, cron, legacy React Native runtime이 없다.
- `apps/mobile`은 삭제 전까지 참고용이다. 기능의 정답은 네이티브 구현과 backend API 계약이다.

## 삭제해도 되는 레거시 런타임

다음 코드는 제품 방향과 맞지 않으므로 보존 대상이 아니다.

- `apps/mobile/src/services/alarmRinger.ts`
  - silent audio loop와 JS timer로 알람 시각을 감시하는 방식.
  - 앱 프로세스/JS runtime 생존에 의존하므로 네이티브 알람 제품에서는 폐기.
- `apps/mobile/src/services/notifeeAlarms.ts`
  - React Native notification/full-screen intent 기반 예약.
  - 네이티브 Android의 `AlarmManager`, `BroadcastReceiver`, `ForegroundService`, `RingingActivity`가 대체.
- `apps/mobile/app/alarm/ringing.tsx`
  - RN 화면 참고만 가능. 실제 울림 화면은 Android `RingingActivity`, iOS AlarmKit 결과에 따른 native screen.
- Expo notification, FCM/APNs, server cron 기반 알람 트리거.

## 제품 구조 참조

레거시 앱의 큰 UX 구조는 다음 정도만 보존한다.

| 영역 | 레거시 경로 | 네이티브 적용 |
| --- | --- | --- |
| 홈 | `(tabs)/index` | 다음 알람, 오늘 메시지, 빠른 시작, 캐릭터 요약 |
| 알람 | `(tabs)/alarms`, `alarm/create`, `alarm/edit` | 로컬 알람 CRUD, 검색, 다음 알람 countdown |
| 음성 | `(tabs)/voices`, `voice/record`, `voice/upload`, `voice/[id]` | 음성 프로필 생성/조회/삭제, ready/processing/failed 상태 |
| 메시지 | `(tabs)/compose`, `message/create`, `message/[id]`, `library` | TTS 메시지 생성, 프리셋/직접 입력, 보관함 |
| 사람들 | `people`, `family-alarm/create`, `friend/[id]` | 초대 코드, 가족/연인 연결, 공유 음성 선택 |
| 성장 | `character` | 알람 완료 이벤트 기반 XP, streak, stats |
| 결제/코드 | `subscription`, `code-register`, `gift/received` | 플랜, 선물 코드, 초대 코드 통합 등록 |
| 설정 | `settings` | 계정, 알람 권한, 가족 알람 수신 허용, 캐시 관리 |

## 네이티브가 유지할 핵심 플로우

### 알람 생성/수정

- 시간: `HH:mm`
- 반복: 요일 배열, 비어 있으면 1회성
- 빠른 반복: 매일, 평일, 주말
- 스누즈: off 또는 분 단위
- 진동: `default`, `strong`, `none`
- 재생 모드:
  - `alarm_only`: 기본 알람음만
  - `voice_only`: 로컬 캐시된 음성만
  - `alarm_voice`: 기본 알람음으로 깨운 뒤 dismiss 시 음성 1회 재생
- 음성 소스:
  - 로컬 녹음
  - 로컬 파일 선택
  - 서버 TTS 결과를 저장한 로컬 파일
  - 공유 허용된 가족/연인 음성으로 만든 서버 TTS 결과
- 저장 시점에 로컬 오디오 준비가 끝나야 한다. 울림 시점에 다운로드하지 않는다.
- 같은 음성 프로필, 텍스트, 카테고리, 언어, provider 조합은 cache key로 재사용한다.

### 음성 프로필

- 상태: `processing`, `ready`, `failed`
- 개인 플랜 제한 기본값: 2개
- 등록 방법:
  - 직접 녹음
  - 오디오 파일 업로드
  - 통화 녹음/파일에서 화자 분리 후 선택
- 녹음 가이드:
  - 최소 10초
  - 권장 30초~1분
  - 예시 문장:
    - 안녕하세요, 오늘 하루도 좋은 하루 되세요.
    - 점심 잘 챙겨 먹고, 오후도 힘내세요.
    - 오늘도 고생 많았어, 이제 푹 쉬어.
    - 사랑해, 항상 건강하고 행복해.
    - 내일도 좋은 일만 가득할 거야, 파이팅!

### 메시지/TTS

- 입력 방식:
  - 프리셋 메시지
  - 직접 입력, 최대 200자 기준
- 생성 후:
  - 미리듣기
  - 알람에 사용
  - 친구/가족에게 보내기 또는 선물하기
- 이미 생성된 동일 메시지는 재사용한다.
- 서버 응답 audio는 앱 private storage에 저장하고 `localAudioUri`와 `audioCacheKey`만 울림 경로에서 사용한다.

### 소셜/가족

- 초대 코드는 6자리 코드 UX를 유지한다.
- 코드 등록은 voucher와 invite를 같은 입력 화면에서 처리한다.
- 가족/연인 연결 후에도 상대 음성은 공유 허용 상태에서만 알람에 쓴다.
- 가족 알람 전송 UX:
  - 수신자 선택
  - 기상 시간
  - 메시지
  - 반복 요일
  - 알람 수신 허용 멤버만 대상

### 캐릭터/성장

- 알람 완료 후 로컬 이벤트 큐에 먼저 기록하고 네트워크 가능 시 sync한다.
- 이벤트:
  - `alarm_completed`
  - `alarm_snoozed`
  - `family_alarm_received`
  - `friend_invited`
  - `streak_bonus_7`
  - `streak_bonus_30`
  - `streak_bonus_90`
- 레거시 캐릭터 단계:
  - `seed`, `sprout`, `tree`, `bloom`
- 현재 제품 기획 단계와 매핑:
  - Egg -> seed
  - Chick -> sprout
  - Chicken -> tree
  - Golden -> bloom
- 능력치 UI 이름은 네이티브 제품에서는 기획 이름을 우선한다:
  - 성실함, 건강, 꾸준함, 숙면

## 디자인 토큰

`packages/ui/src/tokens.ts`와 `apps/mobile/src/constants/theme.ts`에서 추출한 값이다. 네이티브 Android/iOS 디자인 토큰의 기준값으로 사용한다.

### 컬러

| 토큰 | Light | Dark | 용도 |
| --- | --- | --- | --- |
| primary | `#E8B341` | `#F0C25C` | 머스타드, sunrise/따뜻함 |
| primaryLight | `#F2C669` | `#F5D387` | primary 밝은 상태 |
| primaryDark | `#C9982C` | `#D8A93D` | primary 눌림/강조 |
| secondary | `#2D3E5C` | `#7B8FB5` | deep navy, 신뢰 |
| accent | `#C97B5C` | `#D89677` | terracotta, 감성 강조 |
| background | `#FBF8F2` | `#1F1B14` | 앱 배경 |
| surface | `#FFFFFF` | `#2A251D` | 카드/패널 |
| surfaceVariant | `#F5EFE0` | `#332C22` | 보조 표면 |
| text | `#2C2620` | `#F0EBE0` | 본문 |
| textSecondary | `#6B6358` | `#A89F8F` | 보조 텍스트 |
| textTertiary | `#9C9080` | `#7A7165` | 약한 텍스트 |
| border | `#EAE3D2` | `#3A332A` | 구분선 |
| success | `#5C8A6B` | `#7FA88B` | 성공 |
| warning | `#D89A2C` | `#E0AB42` | 경고 |
| error | `#B84A3D` | `#D86F5E` | 오류 |
| textOnPrimary | `#2C2620` | `#1F1B14` | primary 위 텍스트 |
| overlay | `rgba(31, 27, 20, 0.5)` | `rgba(0, 0, 0, 0.6)` | 오버레이 |

### 간격/타입

| 그룹 | 값 |
| --- | --- |
| spacing | xs `4`, sm `8`, md `16`, lg `24`, xl `32`, xxl `48` |
| radius | sm `8`, md `12`, lg `16`, xl `24`, full `9999` |
| fontSize | xs `11`, sm `13`, md `15`, lg `17`, xl `20`, xxl `28`, hero `34` |
| fontFamily | Pretendard Regular, Medium, SemiBold, Bold |
| fontWeight | normal `400`, medium `500`, semibold `600`, bold `700` |

## 보존할 주요 문구

### 온보딩

- 누구의 목소리를 듣고 싶나요?
- 매일 따뜻한 메시지가 찾아와요
- 소중한 목소리로 하루를 시작하세요
- 매일 아침, 나만의 나무가 자라요

### 홈/알람

- 소중한 사람의 목소리가 기다리고 있어요
- 아직 설정된 알람이 없어요
- 소중한 사람의 목소리로 알람을 설정해보세요
- 다음 알람까지
- 시간, 음성, 메시지로 검색
- 알람 설정 완료! 매일 소중한 목소리로 깨워드릴게요.

### 음성/메시지

- 소중한 사람의 목소리를 등록하세요
- 음성 클론이 생성되고 있어요. 잠시 후 사용할 수 있습니다.
- 누구의 목소리로?
- 음성 메시지 생성
- 알람에 사용
- 먼저 음성을 등록해주세요

### 가족/연결

- 내 사람들
- 초대코드 발급
- 알람 수신 허용
- 가족 알람 보내기
- 가족에게 따뜻한 알람이 전달되었어요.

## 프리셋 메시지

카테고리 key는 backend/frontend/native 모두 동일하게 유지한다.

| key | 라벨 | 메시지 |
| --- | --- | --- |
| `morning` | 아침 | 좋은 아침이야, 오늘도 화이팅! / 일어나~ 오늘도 좋은 하루 보내자! / 굿모닝! 오늘 하루도 힘내! |
| `lunch` | 점심 | 점심 잘 챙겨 먹어, 맛있는 거 먹어! / 밥 먹었어? 꼭 챙겨 먹어! / 점심시간이다! 맛있는 거 먹고 오후도 파이팅! |
| `afternoon` | 오후 | 오후도 힘내, 조금만 더 파이팅! / 오후 슬럼프? 커피 한 잔 하고 힘내! / 조금만 더 하면 끝이야, 화이팅! |
| `evening` | 저녁 | 오늘도 고생 많았어, 수고했어! / 퇴근 축하해! 오늘 하루도 잘 보냈어! / 고생했어, 이제 편하게 쉬어! |
| `night` | 밤 | 오늘 하루도 잘 보냈어, 푹 자! / 잘 자, 좋은 꿈 꿔! / 내일도 좋은 하루 될 거야, 굿나잇! |
| `cheer` | 응원 | 넌 할 수 있어, 믿어! / 힘들어도 포기하지 마, 항상 응원해! / 넌 정말 대단한 사람이야! |
| `love` | 사랑 | 사랑해, 항상 고마워! / 네가 있어서 행복해! / 보고 싶어, 빨리 보자! |
| `health` | 건강 | 약 챙겨 먹었어? / 물 많이 마셔! 건강 챙겨! / 오늘 스트레칭 했어? 몸 좀 풀어! |

## API 계약 요약

모바일 앱에서 쓰던 API surface다. 구현의 최종 기준은 `packages/backend/src/routes/*`와 테스트다.

### Auth

| Method | Path | 목적 |
| --- | --- | --- |
| POST | `/api/auth/register` | 이메일 회원가입 |
| POST | `/api/auth/login` | 이메일 로그인 |
| GET | `/api/auth/me` | 현재 사용자 |

보호된 요청은 `Authorization: Bearer <token>`을 사용한다. 401 발생 시 로컬 토큰과 auth 상태를 정리한다.

### Alarm

| Method | Path | 목적 |
| --- | --- | --- |
| GET | `/api/alarm` | 알람 목록 |
| GET | `/api/alarm/:id` | 알람 상세 |
| POST | `/api/alarm` | 알람 생성 |
| PATCH | `/api/alarm/:id` | 알람 수정/활성 상태 변경 |
| DELETE | `/api/alarm/:id` | 알람 삭제 |
| POST | `/api/alarm/source` | 원본 알람 오디오 업로드 |

알람 payload 필드:

- `time`
- `repeat_days`
- `snooze_minutes`
- `message_id`
- `mode`: `tts` 또는 `sound-only`
- `wake_mode`: `sound_then_voice` 또는 `voice_only`
- `vibration_pattern`: `default`, `strong`, `none`
- `voice_profile_id`
- `speaker_id`
- `raw_audio_url`
- `raw_audio_duration_ms`
- `target_user_id`

네이티브에서는 backend 호환성을 위해 이 필드를 이해하되, 로컬 DB에는 native alarm contract를 우선 저장한다.

### Voice/TTS

| Method | Path | 목적 |
| --- | --- | --- |
| GET | `/api/voice` | 내 음성 프로필 |
| GET | `/api/voice/:id` | 음성 상세 |
| POST | `/api/voice/clone` | 음성 복제 |
| DELETE | `/api/voice/:id` | 음성 삭제 |
| PATCH | `/api/voice/:id` | 음성 이름 변경 |
| GET | `/api/voice/family` | 공유 가족 음성 |
| POST | `/api/voice/upload` | 음성 파일 업로드 |
| POST | `/api/voice/uploads/:uploadId/separate` | 화자 분리 |
| GET | `/api/voice/uploads/:uploadId/speakers` | 화자 목록 |
| PATCH | `/api/voice/uploads/:uploadId/speakers/:speakerId` | 화자 이름 변경 |
| POST | `/api/tts/generate` | TTS 생성 |
| GET | `/api/tts/messages` | TTS 메시지 목록 |
| GET | `/api/tts/presets` | 프리셋 |
| DELETE | `/api/tts/messages/:id` | 메시지 삭제 |

### Family/Social

| Method | Path | 목적 |
| --- | --- | --- |
| GET | `/api/family/groups/current` | 현재 가족 그룹 |
| POST | `/api/family/alarms` | 가족 알람 생성 |
| POST | `/api/family/invites` | 초대 코드 발급 |
| GET | `/api/family/invites` | 초대 코드 목록 |
| POST | `/api/family/invites/:code/revoke` | 초대 코드 취소 |
| POST | `/api/family/groups/:groupId/leave` | 그룹 탈퇴 |
| POST | `/api/family/groups/:groupId/transfer-ownership` | 소유자 양도 |
| DELETE | `/api/family/groups/:groupId/members/:userId` | 멤버 제거 |
| POST | `/api/friend` | 친구 요청 |
| GET | `/api/friend/list` | 친구 목록 |
| GET | `/api/friend/pending` | 받은 친구 요청 |
| PATCH | `/api/friend/:id/accept` | 친구 요청 수락 |
| DELETE | `/api/friend/:id` | 친구 삭제 |

### Character/Billing/Code

| Method | Path | 목적 |
| --- | --- | --- |
| GET | `/api/characters/me` | 캐릭터/스트릭/스탯 |
| POST | `/api/characters/xp` | XP 이벤트 지급 |
| GET | `/api/billing/subscription` | 현재 구독 |
| POST | `/api/billing/checkout` | checkout stub |
| GET | `/api/billing/vouchers` | 발급 voucher |
| POST | `/api/code/register` | voucher/invite 통합 코드 등록 |

## 공통 도메인 모델

### VoiceProfile

- `id`
- `user_id`
- `name`
- `perso_voice_id`
- `elevenlabs_voice_id`
- `avatar_url`
- `status`
- `created_at`
- `updated_at`

### Message

- `id`
- `user_id`
- `voice_profile_id`
- `text`
- `audio_url`
- `category`
- `is_preset`
- `created_at`
- `voice_name`

### Alarm

- `id`
- `user_id`
- `target_user_id`
- `message_id`
- `time`
- `repeat_days`
- `is_active`
- `snooze_minutes`
- `mode`
- `wake_mode`
- `vibration_pattern`
- `voice_profile_id`
- `speaker_id`
- `raw_audio_url`
- `raw_audio_duration_ms`
- `message_text`
- `voice_name`
- `category`
- `sender_user_id`
- `sender_name`
- `sender_email`
- `is_family_alarm`
- `is_received_family_alarm`

## 삭제 준비 체크리스트

`apps/mobile` 삭제 전 아래가 모두 끝나야 한다.

- [ ] Android native에서 알람 CRUD, 로컬 캐싱, 실제 울림, 잠금화면 전체화면이 실기기 검증됨.
- [ ] Android native에서 음성 프로필, TTS, 로컬 녹음/파일, 공유 음성이 동작함.
- [ ] Android native에서 초대 코드, 가족/연인 연결, 코드 등록, 캐릭터, 플랜 화면이 대체됨.
- [ ] iOS AlarmKit PoC 결과가 문서화됨.
- [ ] `apps/mobile/src/i18n/ko.json`의 필요한 문구가 native string resource 또는 공용 copy 문서로 이전됨.
- [ ] `packages/ui/src/tokens.ts`의 토큰이 Android/iOS 디자인 토큰으로 이전됨.
- [ ] `apps/mobile/src/services/api/*`의 필요한 API 계약이 backend API 문서 또는 native client에 반영됨.
- [ ] `apps/mobile/test/*`에서 유효한 행동 테스트가 backend/native 테스트로 이전됨.
- [ ] `apps/mobile/.env`, build artifact, node_modules 등 로컬 파일이 git에 포함되지 않음.

## 삭제 시 순서

1. 이 문서와 native 구현을 기준으로 빠진 copy/API/토큰이 없는지 확인한다.
2. `apps/mobile`을 별도 PR에서 제거한다.
3. root README와 workspace/package script에서 `apps/mobile` 참조를 제거한다.
4. CI/Jest/Metro/Expo 관련 설정이 남아 있으면 제거한다.
5. 삭제 PR에서는 Android/iOS native와 backend 테스트만 검증한다.
