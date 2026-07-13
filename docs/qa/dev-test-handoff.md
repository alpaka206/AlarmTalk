# Dev 테스트 핸드오프

> 세션 재개용 라이브 문서. 마지막 갱신 **2026-07-13(세션3)**. 상태가 바뀌면 이 파일을 갱신/정리한다.
> (다른 컴퓨터에서도 `git pull` 후 이 문서를 읽으면 바로 이어서 진행 가능.)
> **⬇︎ 재개하면 이 "세션3 전체 현황" 블록부터 읽을 것. 아래 세션2/이전 블록은 히스토리(참고용).**

---

# 📍 2026-07-13 세션3 — 전체 작업 현황 & 남은 계획 (단일 진실 소스)

무엇이 이미 개발됐고 무엇이 안 됐는지 한 곳에 정리. **재설명 없이 이 표만 보면 됨.**

## 0. 브랜치 / PR 지도 (지금 어디에 뭐가 있나)

| 브랜치 | 내용 | 상태 |
|---|---|---|
| `develop` | 최신 통합. 아래 PR들 머지됨 | dev 백엔드 자동배포됨 |
| ├ #536 default-voice-sheet | 직접입력 미터링(백+표시), 문구모델 개편, 운동→약 | ✅ 머지 |
| ├ #537 faster-family-alarm-delivery | **이름과 달리** 실제론 "가족 수신 인앱 스낵바"만(14줄) | ✅ 머지 |
| ├ #538 ringing-screen-and-tags | 울림화면 문구표시·노브 화살표, 태그 스트립, 편집기 대개조(타임피커박스 제거·상단바 제거·취소\|저장·받을사람 CTA), 홈 빈상태 | ✅ 머지 |
| ├ #539 display-text-tag-hardening | `deriveAlarmDisplayText` 전면 태그 스트립 | ✅ 머지 |
| └ #540 fortune-save-icon | 운세/날씨 저장 CTA 앞 이모지 제거 | ✅ 머지 |
| **`feat/clone-voice-prerender`** (**PR #541**) | **#4 사전렌더 전체** (백+클라) | 🟡 푸시됨·코드리뷰 Round3 진행중·**머지 대기** |
| `wip/handoff-samples-20260713` | 이 핸드오프 노트+`sampleimage/` 백업 | 🔵 유실방지 백업(PR 아님, 무시 가능) |

---

## 0.5 큰 그림 — 사용자가 원한 것 & 왜 이렇게 만들었나 (의도·결정 근거)

> 나중에 재설명 없이도 "무엇을 하려 했고 왜 이렇게 바꿨는지"를 알 수 있게 원문·근거를 남긴다.

**전체 비전:** 음성 알람 앱을 "목소리가 깨워주는" 경험으로. 유료 사용자가 가족/지인 목소리를 클론해서, **매일 상황에 맞는 문구**(날씨·운세·사랑·약)를 **그 목소리로** 들려준다. 프리셋(기본 인사)은 목소리별 사전 렌더된 기본값이고, 편집기에서 고르는 문구는 직접입력 + 동적문구.

**#4 사전렌더 — 사용자가 원한 것(원문 그대로):**
- *"목소리 선택시 만들어져야하는데 기본 기상 알람 소리(목소리 미리듣기로 보여줄거 1개) 날씨에 맞는거, 운세 미리해서, 사랑(너무 많지는 않아도 됨) 약은(약 먹을 시간이다. 건강 챙겨라. 오늘 하루도 힘내자) 이런식으로 조금만 있어도 될거같아."*
- *"말투는 고정이 아니라 호칭과 관계를 보고 그에 맞게 되도록"*
- *"날씨는 좀 더 자세하게 맑음/흐림/비/눈/미세먼지 이런식으로 하고 지역을 받은게 있으므로 그거 토대로 날씨 파악해서 맞는걸로 매칭해서 진행, 그리고 모든 말투는 딱딱하지 않고 실제 사람이 말하는것처럼 자연스러우면서 열심히 알아본채로"*
- *"어차피 날씨들에 대한거 다 만들어두고 반복이면 전날 22시든 그리고 생성할때든 받아둔 위치를 토대로 gemini가 날씨를 예측하고 그거에 해당하는 오디오로 알람을 맞춰주면 되잖아"*
- *"안정적으로 되는 방법으로 해봐봐 출시 전이라 지금은 괜찮아"* / *"운세 날씨 저런식으로 다 하면 되잖아? 앞으로 그렇게 해"*(미루지 말고 끝까지 구현)

**왜 이렇게 결정했나(설계 근거):**
- **왜 "사전 렌더"(미리 다 만들어두기)?** ElevenLabs TTS를 발사 시점에 부르면 Workers CPU 한계·네트워크 의존으로 불안정. 미리 렌더해 두면 발사는 **오프라인 로컬 재생**(검증된 무료버킷 경로 재사용)이라 안정적. → 사용자 "안정적으로".
- **왜 날씨/운세=매칭(절대 인덱스), 사랑/약=로테이션(순차)?** 날씨·운세는 "그날 상황에 맞는 하나"를 골라야 해서 조건→인덱스 매칭. 사랑·약은 맞고 틀림이 없어 순차 회전으로 다양성만.
- **왜 날씨를 서버(open-meteo)에서 분류?** 기기가 날씨 API 직접 호출·키관리하는 부담 없이, **받아둔 지역**으로 서버가 준비창(발사 전)에 조건 확정. → 사용자 "지역 토대로 예측해서 매칭". 운세는 사주 기반 결정적이라 기기 계산으로 충분(서버 왕복 불필요).
- **왜 날씨 8종(nice/rain/snow/dust/cloud/fog/heat/cold)?** 사용자가 "맑음/흐림/비/눈/미세먼지" 수준의 구체성 요구 → 거기에 안개·폭염·한파 추가.
- **왜 Vertex 톤 적응 생성?** 고정 문구는 어색. 관계/호칭을 반영해 자연스럽게. → 사용자 "말투는 관계·호칭 보고, 실제 사람처럼 자연스럽게".
- **왜 문구-음성 정합(`bucketClipTextsJson`)?** 매칭 버킷에서 오디오는 '비 와요'인데 잠금화면 문구가 다른 variant면 어긋남 → **같은 인덱스의 문구**를 저장해 화면·소리 일치(2차 리뷰 지적).
- **왜 `!familyAlarmMode` 가드?** 가족 알람에 발신자 로컬 클립을 붙이면 수신자 기기엔 그 파일이 없어 **무음**. 그래서 가족 알람은 클론버킷 대상에서 제외(1차 리뷰가 놓쳐 회귀 발생 → 2차에서 수정).
- **왜 유료만·월 1회·앱 언어?** 사용자 결정(아래 결정 로그).

**결정 로그(AskUserQuestion 확정):** 운세=제네릭만 사전렌더 / 자격=유료 구독자 **월 1회** 확정, **앱 언어**로 / 버킷=유료에만 **날씨·운세·사랑·약**, 편집기 명칭은 "날씨/운세" / 생성=Vertex **톤 적응** / 운세 선택=**사주 매칭** / 날씨·운세 타이밍=**지금은 서버 인덱스**(준비창 확정) / 클론 소실 시=**기본 알람음으로 다운그레이드** / 남은 리뷰 지적=**전부 수정(계속 하드닝)**.

---

## 1. #4 사전렌더(유료 클론 목소리 프리셋) — ✅ **개발 완료** (머지·dev배포·실기기검증만 남음)

**"아직 개발 안 됐냐?" → 아님. 코드는 100% 완성돼 `feat/clone-voice-prerender`(PR #541)에 다 있음.** 남은 건 리뷰 클린 → 머지 → dev 배포 → 라이브 실기기 검증뿐.

**무엇을 하는 기능인가:** 유료 구독자가 목소리를 등록하면, 그 목소리 톤으로 **날씨·운세·사랑·약** 4종 프리셋 오디오를 **서버가 미리 렌더**해 두고, 앱은 알람 발사 때 **네트워크 없이 오프라인**으로 그 목소리 클립을 재생한다(무료 버킷 재생 경로 재사용). 말투는 관계/호칭에 맞게 Vertex가 적응 생성.

**동작 원리(중요):**
- **날씨/운세 = 매칭 버킷**(절대 인덱스 선택). 날씨=지역 기반 open-meteo 분류 8종(`nice/rain/snow/dust/cloud/fog/heat/cold`), 운세=사주+발사일 결정적 해시 테마 5종(`luck/caution/wealth/health/relationship`).
- **사랑/약 = 로테이션 버킷**(순차 %N).
- 날씨 인덱스는 준비창(발사 전)에 `/tts/prerender-variant` 워커가 지역으로 예측·확정. 운세 인덱스는 기기에서 결정적 계산.
- **발사 파이프라인(RingingService/AlarmReceiver)은 전혀 안 건드림** — 무료 버킷과 같은 경로.

**백엔드 조각(전부 develop 아님, feat 브랜치):**
- `packages/backend/src/lib/stock-clips.ts` — `generateStockClip`(클론 소유자 치환), `generatePrerenderClipText`(톤 적응), 큐(enqueue/claim/mark), `findMissingStockTargets`, `CLONE_WEATHER_CONDITIONS`(8), `CLONE_FORTUNE_THEMES`(5), seed.
- `packages/backend/src/routes/tts.ts` — `/tts/prerender-variant`(날씨/운세 인덱스 resolve, 실패시 null), `resolvePrerenderWeatherIndex`, weather code NaN 가드.
- `packages/backend/src/index.ts` — cron 드레인(실패 클립 skip·계속, `*/5`), `packages/backend/src/lib/vertex-translate.ts` — `generatePrerenderClipText`.
- 트리거: 목소리 ready 훅 → cron 배치 렌더. 확정=유료 구독자 월1회, 앱 언어로 렌더.
- 테스트: prerender-variant 21개 + 전체 vitest **1293 통과**.

**클라 조각(feat 브랜치):**
- 오프라인 소비: `AlarmRepository.resolveBucketClipLocalUri`(무료버킷 경로 재사용), `AlarmEntity.bucketVariantIndex()`(운세=기기해시/날씨=서버인덱스/그외=로테이션 공유 헬퍼).
- 문구-음성 정합: `bucketClipTextsJson`(Room v19) 왕복 저장 → `RingingActivity`가 오디오와 같은 인덱스의 **문구**를 잠금화면에 표시(날씨 '비와요' 음성 ↔ 문구 일치).
- 편집기: `hasCompleteCloneBucket`(날씨8·운세5 완전세트 요구), 저장 시 클론버킷 시도(`!familyAlarmMode` 가드=가족 무음 회귀 방지), `bindStockBucketClips`.
- 언어소스: `deviceAppVoiceLanguage`=앱 리소스 `configuration.locales[0]`(편집기와 동일 소스), 클론 생성/수정 시 서버에 언어 전송.
- 매니페스트: Alarms/Voices 탭 진입 시 `loadStockClips(forceReload=true)`(세션 중 생성된 클론클립 반영).
- due 게이트: `resolveDueCloneBucketVariants` 12h staleness + (country,city) 중복제거.

**남은 것:**
1. 🟡 코드리뷰 Round3 클린까지 수정 반복(진행중, 이 세션 백그라운드).
2. PR #541 → develop 머지(사용자가) → dev 자동배포.
3. **라이브 실기기 검증**: dev 배포 후 실제 클론 목소리 등록 → cron이 4버킷 렌더(ElevenLabs/Gemini 라이브) → 유료계정 편집기에서 날씨/운세/사랑/약 선택 저장 → **오프라인(비행기모드)** 발사 시 그 목소리 클립 재생 + 잠금화면 문구 일치.

---

## 2. #10 가족 알람 즉시/빠른 배달 — ❌ **미개발** (인앱 스낵바만 머지됨)

**"아직 개발 안 됐냐?" → 진짜 즉시배달(푸시)은 안 됨.** #537 "faster-family-alarm-delivery"는 이름과 달리 **인앱 스낵바 14줄**("상대가 맞춘 알람 N개 도착")만 넣은 것.

**현재 배달 메커니즘(조사 완료):**
- 수신자는 **오직 pull 동기화**로만 받음. push(FCM) 배달 경로 **없음**.
- Android: `RemoteAlarmSyncScheduler.kt:23` **15분 주기** WorkManager pull 워커 + `runOnce()` 즉시 pull + **알람 탭 진입 시 `syncNow()`**(`AlarmTalkApp.kt:332`) 즉시 pull. → **앱을 열고 알람탭 들어가면 사실상 즉시**, 백그라운드면 최대 15분(+WorkManager 지연).
- 백엔드: 가족 알람 생성(`family-alarm.ts`)은 **DB INSERT만**, 수신자에게 아무 신호 안 보냄. 수신자 기기가 `GET /api/alarm` 폴링할 때 `target_user_id` 매칭으로 발견(`alarm-query.ts:72`).
- FCM 인프라: 백엔드 `lib/fcm.ts`는 있으나 **end-to-end 죽어있음** — (a) 가족알람 생성 시 호출 안 함, (b) **Android에 FCM 클라이언트 자체가 없음**(firebase 의존성·google-services.json·FirebaseMessagingService 전무), (c) **푸시토큰 등록 엔드포인트 없음**(`INSERT INTO push_tokens` 전무). `sendAlarmPush` 유일 호출처는 예약 cron(울릴 시각 알람 푸시)뿐 — 이것도 토큰이 안 채워져 no-op.

**즉시 배달을 진짜로 하려면(옵션, 결정 필요):**
- **옵션 A — FCM 풀 배선(제대로):** Android에 firebase-messaging + google-services.json 추가 → FirebaseMessagingService·`onNewToken` → 토큰 등록 엔드포인트 신설(`INSERT INTO push_tokens`) → 가족알람 생성 시 `sendAlarmPush(수신자)` 호출 → 수신 시 즉시 pull. **가장 확실하지만 인프라(Firebase 프로젝트·서비스계정 시크릿·스토어 설정) 필요.**
- **옵션 B — 포그라운드 즉시성 강화(가벼움):** 앱이 포그라운드로 돌아올 때(ON_RESUME 전역) 무조건 `runOnce()` pull. 백그라운드 즉시는 여전히 안 되지만 "열면 바로"가 더 촘촘해짐. #537 커밋이 race/배터리 우려로 미룬 부분.
- **옵션 C — 폴백 주기 단축:** 15분 → WorkManager 최소도 15분이라 큰 개선 없음. expedited work도 제약 큼. 실효성 낮음.
- **현실 판단:** 진짜 "즉시"는 옵션 A(FCM)만 됨. 지금은 "앱 열면 즉시, 백그라운드는 15분 폴백"이 최선. 출시 전 우선순위 결정 필요.

**관련 파일:** `sync/RemoteAlarmSyncScheduler.kt`, `sync/RemoteAlarmSyncWorker.kt`, `data/RemoteAlarmPullSyncService.kt`, `ui/main/MainViewModelAuthActions.kt`(syncNow), `routes/family-alarm.ts`, `routes/alarm-query.ts`, `lib/fcm.ts`, `index.ts`.

---

## 3. #13 / #18 울림 화면(RingingActivity) 실기기 라이브 검증 — ⏳ **기기 대기(18시 이후만)**

- 코드는 #538로 머지됨(문구 표시·노브 화살표·전체화면 인텐트). **실기기에서 실제 알람 발사로 RingingActivity가 잠금화면 위에 뜨는지**만 미검증(`am start`는 exported=false로 차단, 실제 발사 필요).
- **사용자 규칙: 18시 이전엔 알람 울리게 하지 말 것.** 설정까지는 OK, 발사는 18시 이후.
- 무음·무진동 발사법: A32 알람볼륨0 + 진동패턴 OFF로 생성 → `adb shell am broadcast -a com.alarmtalk.app.action.ALARM_TRIGGER --es com.alarmtalk.app.extra.ALARM_ID <id> -n com.alarmtalk.app.dev/com.alarmtalk.app.alarm.AlarmReceiver`. 로컬 id는 `adb exec-out run-as ... cat databases/voice-alarm.db` → python sqlite3.

## 4. 확인 필요(코드상 해결됐으나 실기기 재확인 권장)

- **"내 알람 맞추기"가 가족모드로 열리던 버그** → 코드상 **해결됨**. `AlarmTalkApp.kt:521`이 "내 알람 맞추기"에서 `startCreateAlarm(familyTargetMode = false)` 명시. 나머지 분기(:537 가족, :766 nav arg→familyAlarmMode)도 정합. #538 편집기 개조에서 정리된 것으로 보임. 실기기 1회 재확인만.

## 5. 재개 절차

1. `git checkout feat/clone-voice-prerender && git pull` → 이 문서 다시 읽기.
2. 코드리뷰 Round3 결과 확인(이 세션 백그라운드) → 지적 수정 → 빌드+테스트 → 커밋(한국어)·푸시.
3. 리뷰 클린 + CI green → 사용자가 PR #541 머지 → dev 배포.
4. dev 배포 후 #4 라이브 실기기 검증(위 1번 "남은 것").
5. 그 다음 #10(즉시배달 옵션 결정) / #13·#18(18시 이후 울림 검증).

**빌드/adb 주의(이 PC):** 소켓 WSAEFAULT(10014)로 Gradle데몬·adb 간헐 실패 → 재시도. adb 다운 시 라온 보안드라이버 정지(`Stop-Service AnySign4PC Launcher, MagicLine4NXSVC, 'RAON K', WizveraPMSvc` + `sc stop KingsNET`/`TNXNET_SVR`) 후 `adb start-server`. K2 캐스케이드 시 clean 재빌드. 상세=메모리 `reference_winsock_wsaefault_build_workaround`.

---

# 🛠 개발 스펙(남은 구현) — 파일별 상세

> "무엇을, 어디를, 왜, 어떻게" 다 적어 재설명 없이 바로 착수 가능하게. QA(위)와 별개로 **코드로 만들어야 하는 것**만.

## A. #10 가족 알람 즉시/빠른 배달 — **가장 큰 남은 개발** (미착수)

**목표(사용자 의도):** 발신자가 가족에게 알람을 맞추면 수신자 기기에 **가능한 즉시** 반영. 지금은 수신자가 앱을 열어 알람탭에 들어가야(또는 최대 15분 백그라운드 폴백) 받음 → 백그라운드에서도 빨리.

**왜 지금 안 되나(근본):** push 경로가 없음. 배달은 100% pull(15분 주기 + 포그라운드 syncNow). 백엔드 `fcm.ts`는 있으나 (a) 가족알람 생성 시 미호출, (b) Android FCM 클라 없음, (c) 토큰 등록 엔드포인트 없음 → E2E 죽어있음.

### 옵션 A — FCM 풀 배선 (진짜 즉시, 인프라 필요) **[권장: 출시 전후]**

*파일별 구현 순서:*
1. **Firebase 프로젝트 준비(외부):** 콘솔에서 프로젝트 생성 → Android 앱 2개 등록(`com.alarmtalk.app.dev`, `com.alarmtalk.app`) → `google-services.json` 2개 확보. flavor별 배치(`app/src/dev/google-services.json`, `app/src/prod/…` 또는 루트+flavor 처리). **⚠️ 시크릿 파일 — .gitignore 확인, CI secret 주입.**
2. **`apps/android-native/build.gradle`(root):** `classpath 'com.google.gms:google-services:4.4.x'`. **`app/build.gradle`:** `apply plugin: 'com.google.gms.google-services'` + `implementation 'com.google.firebase:firebase-messaging-ktx'`(BoM 권장).
3. **`AlarmTalkMessagingService`(신규, `com.alarmtalk.app.fcm`):** `FirebaseMessagingService` 상속.
   - `onNewToken(token)` → 인증 세션 있으면 서버 `POST /api/push/register` 호출(토큰 등록). 세션 복원/로그인 시점(`MainViewModelAuthActions`)에도 현재 토큰 재등록.
   - `onMessageReceived(msg)` → data payload `{type:"family_alarm"}` 확인 → `RemoteAlarmSyncScheduler.runOnce(context)` 즉시 pull(기존 경로 재사용, `RemoteAlarmPullSyncService`가 upsert + `notifyReceivedAlarm`).
   - `AndroidManifest.xml`에 `<service ... INTENT_FILTER com.google.firebase.MESSAGING_EVENT>` 등록.
4. **백엔드 토큰 등록 엔드포인트(신규):** `routes/push.ts` `POST /api/push/register`(auth 필수) → `INSERT INTO push_tokens(user_id, token, platform, updated_at) ON CONFLICT(token) DO UPDATE`. 스키마는 이미 `migrations.ts:365`에 존재(테이블만 있고 INSERT 경로가 없던 것). zod 바디 검증, `?`-바인딩(규약).
5. **가족알람 생성 시 푸시(핵심 배선):** `routes/family-alarm.ts` 알람 INSERT 성공 후 `sendAlarmPush(env, 수신자userId, {type:"family_alarm", alarmId})` 호출 — **data-only payload**(알림표시는 클라가 pull 후 `notifyReceivedAlarm`으로). `c.executionCtx.waitUntil(...)`로 논블로킹. `family-alarm.ts:153-178`(문자), `:343-360`(음성) 두 경로.
6. **시크릿:** `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_PROJECT_ID`(dev/prod) → `.dev.vars.{dev,prod}` + `npm run secrets:sync:{dev,prod}`. 미설정이면 `fcm.ts`가 `MOCK_SEND` 로그만(안 깨짐).
7. **검증:** 두 폰 — S23(발신)→A32(수신, 백그라운드/화면꺼짐) 알람 설정 시 A32에 수 초 내 시스템 알림 + Room 반영.

*주의:* 배터리 최적화/Doze에서 data-only는 지연될 수 있음 → 필요 시 `priority:high`. FCM 실패해도 15분 pull 폴백이 살아있어 **안전한 점진 강화**(사용자 "안정적으로").

### 옵션 B — 포그라운드 즉시성 강화 (가벼움, 인프라 0) **[권장: 지금 당장]**

- `AlarmTalkApp`/Application에 `ProcessLifecycleOwner.get().lifecycle` 옵저버 → `ON_RESUME`(앱이 포그라운드 복귀)마다 `RemoteAlarmSyncScheduler.runOnce()`. 지금은 "알람탭 진입 시"만 즉시 pull(`AlarmTalkApp.kt:332`) → **어느 탭/화면에서 복귀해도** 즉시 pull로 확장.
- 스팸 방지 throttle(예: 최근 30초 내 skip). #537 커밋이 race/배터리 우려로 미룬 부분 — throttle로 해소.
- 백그라운드 즉시는 여전히 안 됨(그건 옵션 A 필요). 하지만 "열면 바로"가 훨씬 촘촘.

### 옵션 C — 폴백 주기 단축: **비권장.** WorkManager 주기 최소 15분, expedited도 제약 커 실효 낮음.

**결론:** 옵션 B를 먼저(즉시·저위험), 옵션 A는 Firebase 셋업 되면. 진짜 "백그라운드 즉시"는 A만 가능.

---

## B. #4 사전렌더 — 코드리뷰 Round3 수정 현황(feat 브랜치)

**✅ 수정·푸시 완료(커밋 1ebc0ee6·fc8eed14·daa205a2):**
- [양쪽] due-gate 무한재호출 → 전용 컬럼 contextResolvedAtMillis(Room v20) 무조건 갱신 (+무관편집 리셋도 차단)
- [자체리뷰] 라이브 NaN 가드 완화(code 단독 아님) / cold 임계 라이브와 일치(≤12)
- [Codex] 유료 버킷 alarm 동기화 거부(INVALID_BUCKET_ID) → 검증기 PAID_BUCKET_CATEGORIES 허용 **(중요)**
- [Codex] 사전렌더 저각성 태그 → 드롭(안 깨우는 알람 클립 방지)
- [Codex] cron 큐 중복 렌더 → messages 조건부 INSERT(NOT EXISTS)
- [Codex] 미래 알람 오늘날씨 스냅샷 → 준비창 48h 필터
- [자체리뷰 CONFIRMED] 빈/공백 버킷문구가 잠금화면 문구를 통째 소실 → isNotBlank 폴백
- [자체리뷰 CONFIRMED cleanup] 언어매핑 중복 → data.appVoiceLanguageOf 단일화(양쪽 위임)

**❌ 최종 리뷰가 기각(REFUTED, 손댈 필요 없음):**
- 저장 시 contextVariantIndex 소실(702) — 버킷 알람은 voiceRandomPrompt=false 라 재저장 경로가 안 탐(내가 넣은 전달은 무해).
- 매 탭진입 forceReload(327) — 60s tabRefreshThrottleMs 로 이미 스로틀됨.

**⬜ 남음(다음 세션 — 발사/표시 경로라 18시 이후 실기기 검증 병행 필요):**
- [CONFIRMED] 미해결 날씨가 index 0='맑음' 폴백(AlarmEntity:169) — 비 오는데 '맑음' 재생 가능. 준비창
  48h 필터로 완화됐으나 근본은 미해결 시 발사 폴백 정책 결정(라이브 폴백/무매칭). 발사경로+기기검증.
- [CONFIRMED] 텍스트/음성 폴백 불일치(RingingActivity:529 / AlarmRepository:559) — 변형N 클립이 캐시에
  없을 때 오디오는 첫 클립 폴백, 텍스트는 정확 인덱스 → resolveBucketClip 이 (uri,text) 쌍 반환하게 리팩터.
- [PLAUSIBLE] 운세 자정 스트래들·워커 동시성 레이스 — 발사 때 인덱스 1회 스냅샷 공유가 근본(위와 함께).
- [PLAUSIBLE cleanup] 클라 8/5 하드코딩 — 매니페스트 개수 유도 or 서버가 count 전달.

<details><summary>원 지적 상세(9건)</summary>

2차 하드닝 커밋(`5857da3f`)이 새 버그를 만든 것들. 여러 파인더가 독립 지적 → 실화:
1. `AlarmRepository.kt:750` **due-gate 무한 재호출**: `updateContextVariantIndex`를 인덱스가 *바뀔 때만* 호출 → 날씨 안정 시 `updatedAtMillis` 안 올라가 매 워커틱마다 open-meteo 재호출(12h 스로틀 무력화, 배터리·API 429 위험). → **해결 시 인덱스 동일해도 타임스탬프(또는 별도 resolved_at) 무조건 갱신**.
2. `AlarmEditorScreen.kt:702` **저장 시 인덱스 소실**: `bindStockBucketClips(cat, profileId)`가 `contextVariantIndex=null` 기본값 → `setBucketAudio`가 덮어씀 → 해결됐던 날씨 알람 재저장 시 0(맑음)으로 리셋. → **저장 경로에서 `editor.contextVariantIndex` 전달**.
3. `RingingActivity.kt:529` / `AlarmRepository.kt:559` **폴백 문구-음성 어긋남**: 오디오는 클립 없으면 첫 클립 폴백, 텍스트는 정확 인덱스 → 폴백 시 화면·소리 불일치. → **텍스트도 실제 재생된 인덱스로 폴백**(발사 때 인덱스 1회 계산해 오디오·텍스트 공유가 근본).
4. `tts.ts:386` **NaN 가드가 라이브 죽임**: `loadWeatherSignalInput`의 `!Number.isFinite(code)→null`이 라이브 `wake_weather` 경로도 타 → weather_code 없고 강수/기온만 있어도 날씨멘트 전부 소실. → **code 없으면 기온/강수 기반 분류로 폴백**(prerender에서만 엄격).
5. `tts.ts:480` **cold 임계 divergence**: 라이브 buildWeatherSignal은 `maxTemp<=12`도 cold인데 prerender resolver는 `<=5`만 → 6~12°C에서 '맑음' 오재. → **cold 임계 라이브와 일치(≤12)**.
6. `AlarmEntity.kt:166` **운세 자정 스트래들**: fortune 인덱스를 `LocalDate.now()`로 오디오·텍스트가 각각 독립 계산 → 자정 직전 발사 시 테마 불일치. (희귀) → 발사 때 인덱스 1회 스냅샷 공유로 근본 해결(위 3과 동일 뿌리).
7. `MainViewModelVoiceActions.kt:487` **언어매핑 중복**: `supportedAppVoiceLanguage`(ui.editor) 재구현 — ui.main에서 import 불가라 inline했으나 확장 시 한쪽만 갱신 위험. → **공용 위치(core/data)로 매핑 추출해 양쪽이 공유**.
8. `AlarmEditorScreen.kt:423` **8/5 하드코딩**: 클라 개수 리터럴이 백엔드 상수와 이중화(백엔드 테스트는 TS만 검증). 백엔드가 9종 되면 클라 8 고정 → 세트 비교 실패로 버킷 조용히 미부착. → **배달된 클립셋에서 개수 유도(max variant+1)**.
9. `AlarmTalkApp.kt:327` **매 탭진입 forceReload**: 홈/보이스 탭 누를 때마다 전체 매니페스트 재fetch. → **이벤트기반(클론 확정 후에만) 또는 throttle**.

</details>

---

## 2026-07-13 세션2 — Part 2 구현·코드리뷰수정·실기기 QA (자율 진행)

**adb 복구법(재확인)**: 재부팅/winsock reset 로 안 됨. 원인=라온 보안 드라이버. 관리자로
`Stop-Service AnySign4PC Launcher, MagicLine4NXSVC, 'RAON K', WizveraPMSvc` + `sc stop KingsNET` `sc stop TNXNET_SVR` → 즉시 `adb start-server` 성공. (메모리 `reference_winsock_wsaefault_build_workaround` 갱신됨)

**커밋(feature/default-voice-sheet, 전부 빌드+vitest 1262 통과)**:
- `63251d6`~`c2ca6d8` 미터링(백+표시), `87cdde2` 운동→약, `8e2a0b9` 30분 안내 개선,
  `02289b6` 등록 확인창, `6fbe7d1` **코드리뷰 지적 수정**(미터링 정합성·확인창 라이프사이클),
  `7172d94` **직접입력 '(남은/총)' 선택기 표시**(Toast 노이즈 제거).
- 코드리뷰(xhigh, 27에이전트): 확정 5·유력 3 전부 수정. 미터링 결제자 허위429/월경계 환불/
  그룹만료누수, 등록 삭제-원장리셋, 확인창 코루틴취소·감지타이밍 등.

**실기기 QA 결과(두 폰: S23=김규원 가족관리자, A32=rel dev 구성원)**:
- ✅ **운동→약**: 문구 선택기 = 기상+날씨/기상+운세/사랑/**약**/직접입력 (운동 없음) — 확인.
- ✅ **직접 입력 다이얼로그·생성**: 입력→저장→/tts/generate 생성 성공.
- ✅ **가족 알람 조용시간 방지**(사용자가 말한 "동일시간 방지" 엣지): 상대 조용시간(평일09:00-18:30)
  안 시간 선택 시 빨간 경고 "상대가 이 시간에는 알람을 받지 않도록 해뒀어요" + **저장 버튼 비활성**.
- ✅ 앱 전 화면 렌더·크래시 없음.
- ⚠️ **`(남은/총)` 카운트·미터링 429**: 백엔드 미터링이 **dev 미배포**(feature 브랜치)라 앱에서
  `/tts/manual-quota` 404 → 카운트 미표시. **develop 머지→dev 자동배포 후** 표시/작동됨(코드·유닛 정상).
- 🔴 **가족 알람 배달 안 됨(조사 필요)**: S23에서 rel dev에게 알람 설정("설정했어요") 성공했으나,
  A32(rel dev) 로컬 Room(voice-alarm.db)에 **수신 알람(origin=received_remote) 미출현**. 앱오픈·
  pull-refresh·**강제 WorkManager(job 888)** 모두 시도해도 A32엔 자기 알람 1개(local_owned)뿐.
  클라 전송경로(`submitDraft`→`onSave(targetUserId=recipient)`)는 정상·이번세션 미변경 → **백엔드/dev
  동기화 계층 이슈**. 감사문서(family-alarm-audit)의 수신자-정지 이슈와 별개(그건 배달됨을 전제).
  → 배달이 안 돼 RING E2E(무음·무진동)까지는 미검증. 배달 원인 규명(백엔드 create 반영/pull 반환) 필요.
- 30분 게이트 문구(제 개선)는 rel dev 조용시간이 근접시간을 다 덮어 실기기 재현 불가(빌드검증됨).

**즉시 울림 테스트법(배달 복구 후)**: A32 무음=알람볼륨0 ✓, 무진동=알람 진동패턴 OFF로 생성
(했음), 로컬 알람id로 `adb shell am broadcast -a com.alarmtalk.app.action.ALARM_TRIGGER --es
com.alarmtalk.app.extra.ALARM_ID <id> -n com.alarmtalk.app.dev/com.alarmtalk.app.alarm.AlarmReceiver`.
로컬 id는 run-as sqlite(기기엔 sqlite3 없음→`adb exec-out run-as ... cat databases/voice-alarm.db`
로 뽑아 python sqlite3).

**깨어나서 할 것(우선순위)**:
1. 🔴 **가족 알람 배달 갭 조사** — 왜 rel dev 에게 배달 안 되는지(백엔드 create 반영 여부/pull 반환).
2. feature/default-voice-sheet → develop **PR·머지 → dev 배포** 후 미터링 `(남은/총)`·429·원장리셋 실기기 검증.
3. 배달 복구되면 가족알람 RING E2E(무음·무진동) 마무리.

---

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
