# 구조 감사 — 2026-09-02

PR #709 리뷰가 37회·119건까지 간 뒤, **왜 안 끝나는가**를 묻고 돌린 전면 감사 결과다.
두 워크플로(권한 구조 설계 / 구조 부채)를 병렬로 돌렸고, **모든 주장은 반증 단계를 한 번 거쳤다.**

> ⚠ **이 문서는 날짜가 박힌 스냅샷이다.** 규범이 아니다. 항목을 처리하면 체크하고,
> 규칙으로 남길 것은 `docs/spec/` 이나 `CLAUDE.md` 로 옮긴 뒤 여기서 지운다.
>
> ⚠ **체크박스를 믿지 말 것.** 이 감사가 `cleanup-audit-2026-08-01.md:98` 에서
> **거짓 완료 표시**를 찾아냈다 — `- [x]` 로 찍힌 항목의 코드가 실제로는 안 고쳐져 있었다
> (`git log -L 98,103` 으로 확인). 처리 여부는 항상 코드로 확인한다.

## 신뢰도 표기

| 표기 | 뜻 |
|---|---|
| ✅ 반증됨 | 반증 시도를 통과했다. 근거를 코드로 재확인했다 |
| ⚠ 미검증 | 조사만 하고 **반증 단계가 세션 한도로 실패**했다. 직접 확인 필요 |
| 🔻 축소됨 | 원 보고보다 범위가 줄었다(반증이 일부를 죽였다) |

---

## 0. 한 줄 요약

**규칙이 문서가 아니라 주석과 호출부에 산다.** 그래서 같은 규칙이 2~4벌로 존재하고,
한 벌을 고치면 나머지가 어긋난다 — 리뷰가 끝나지 않는 기계적 원인이다.

측정: 문서 15,756줄 vs 주석 **26,554줄**(그중 규칙을 담은 ⚠ 주석 2,038줄 / 255파일).
iOS 의 ⚠ 주석이 안드로이드의 **2.2배**(1,225 vs 553) — iOS 를 되살릴 때 안드로이드의 규칙을
공용 문서가 아니라 **iOS 주석으로 복사**했기 때문이다.

---

## 1. 권한(entitlement) 구조 — 최종 방안

### 지금 왜 새는가

권한 상태가 **같은 값의 3중 사본**으로 존재하고, 쓰는 곳이 안드로이드 9곳·iOS 8곳이다.

| `users.plan` 이 사는 곳 | 파일 |
|---|---|
| `AccessSnapshot.userPlan` | `ui/main/AccessSnapshotStore.kt` |
| `AuthSession.user.plan` (`KEY_PLAN`) | `network/AuthSessionStore.kt` — **빈 값을 `"free"` 로 강제**한다(= '모름'을 '무료'로 바꾼다) |
| `MainViewModel.storeSnapshotUserPlan` | `ui/main/MainViewModel.kt:596` |

세 사본이 '모름'을 서로 다르게 표현하는 것이 이 PR 지적의 뿌리다.

### ✅ 소유자 가드가 아예 없는 writer 2곳 (지금도 열려 있다)

| 위치 | 문제 |
|---|---|
| `MainViewModelBillingActions.kt` `refreshBillingData → applyBillingSnapshot` | `await` 뒤 곧바로 전역 발행 + `saveSubscriptionSnapshot`. **계정·세대 가드 없음** |
| `MainViewModelBillingActions.kt` `refreshShareCodeData` | 세 요청 `await` 뒤 곧바로 전역 state + 스냅샷 쓰기. **가드 없음** |

같은 파일의 `refreshBillingAfterMutation` 은 `expectedOwnerUserId` 가드를 갖고 있고,
그 KDoc 이 위험을 그대로 서술한다 — **같은 위험을 아는데 두 자리에만 안 걸려 있다.**

### 설계안 셋

| | A. EntitlementLedger | B. 티켓/영수증 | C. Entitlement 한 장 |
|---|---|---|---|
| 한 줄 | 쓰기 창구를 하나로. 판정기는 그대로 | 서버가 `paid_until` 을 접어 주고 클라는 불변 레코드 2개 | 서버가 `Entitlement` 한 장을 계산해 내려줌 |
| 판정 사다리 | **남는다**(2언어 미러링 지속) | 클라 3분기로 축소 | **클라에서 사라짐**(1줄) |
| 없어지는 가드 | 창구 안으로 이동 | RMW 락 2개 + 계정 재확인 14곳 | 이름 있는 가드 25개 중 **15개** |
| 서버 변경 | 없음 | `users.paid_until` 컬럼 + 미들웨어 | 신규 엔드포인트 + 계산 |
| 최대 위험 | 단일 창구가 단일 실패점 | `paid_until` 한 곳 누락 = 그룹 5명 통째로 잠김 | 서버 버그 하나로 **전 사용자** 클론 알람 잠김 |

> ⚠ 설계 심사(judge) 3개 중 1개가 세션 한도로 실패했고, 남은 심사에 설계안이 2개만 전달됐다
> (스크립트 슬라이싱 문제). **아래 권고는 내가 세 안을 직접 읽고 낸 것**이지 심사 합의가 아니다.

### 권고 — **B/C 혼합**

1. **서버가 `Entitlement`(tier + goodUntil + reason)를 계산해 내려준다.**
   근거: `UPDATE users SET plan` 쓰기 8곳이 **전부 서버 안**이고, 5분 크론이 이미
   `reconcileStoreBeforeExpiry` 로 스토어와 대조한다(`index.ts:332`). 서버가 이미 다 안다.
2. **클라는 계정 키로 통째 캐시하고 `goodUntil` 만 읽는다.** 사다리·TTL 상수·스토어 판정이 사라진다.
3. **단, C 의 `lockPaidVoice`(되돌릴 수 없는 잠금 판단)는 서버로 넘기지 않는다.**
   그건 서버 버그 하나가 전 사용자 피해가 되는 유일한 지점이고, 지금 클라의 보수적 조건
   (`storeEntitlementChecked` + 남은 구독 행 확인)이 실제 방파제였다.
4. **콜드 스타트 '모름' 완화**: 세션의 `users.plan` 은 즉답용으로 남긴다(C 의 최대 약점 보완).

**RevenueCat 은 지금 도입하지 않는다** — 유료 권한이 생기는 경로 5개 중 **4개가 영수증이 없고**
(초대·선물·프로모·관리자 부여), 한 결제가 다른 계정 4명에게 권한을 준다. RevenueCat 은
스토어 층(문제의 ~1/3)만 대체하면서 매출 1%와 2,500줄 마이그레이션을 요구한다.

---

## 2. 통합됐어야 하는데 갈라진 것

### ✅ 2-1. 문구 종류 판정식 — 철자 3벌 / 자리 8곳 (양 앱 모두) · 위험 high

`CLAUDE.md` 는 「자리는 **일곱**이다 … **철자까지 같아야 한다**」고 못 박았지만 실제로는
자리가 여덟이고 철자가 셋이다. 그리고 **셋은 실제로 다른 질문**이다:

| 철자 | 질문 | 정의 |
|---|---|---|
| `!isActiveBucketAlarm()` | 울릴 때 클립을 쓰는가 | `AlarmEditorState.kt:281` — 첫 줄이 `playMode == ALARM_ONLY` 를 거른다 |
| `!hasBucketMessageChoice()` | 지금 클립이 묶여 있는가 | `AlarmEditorState.kt:300` — `audioCacheKey` 가 살아 있어야 true |
| `selectedBucket == null` | 고른 종류가 무엇인가 | `AlarmEditorScreen.kt:931` — 주석이 「A·B 는 쓸 수 없다」고 이유를 적어 둠 |

세 질문 중 **하나만 이름을 갖고 나머지는 호출부마다 손으로 조립**된다.
그래서 주석이 자기 아랫줄과 어긋난 곳이 둘: `VoiceAudioCard.kt:622`, `AlarmEditorScreen.kt:1846`.

- 🔻 원 보고의 「iOS 는 1벌이라 이 문제가 없다」는 **틀렸다** — iOS 도 손조립 3곳
  (`AlarmEditorSheet.swift:482` 등).
- 🔻 원 보고의 「봇 리뷰가 한 번도 못 잡았다」도 **틀렸다** — PR #660 등에서 잡았다(영어 산문이라 심볼 grep 에 안 걸렸을 뿐).

**조치**: `AlarmEditorState` 에 세 질문을 각각 **이름 있는 프로퍼티**로 노출하고 8자리를 전부 교체.
조립식 `!voiceRandomPrompt && …` 가 호출부에 남지 않는 것이 합격 기준. iOS 도 같이.

### ✅ 2-2. 유료 플랜 판정 사다리 2벌 + 플랜 키 목록 4벌 · 위험 high

`packages/shared` 는 「백엔드·클라 공용 계약」인데 **플랜 상수가 하나도 없다**
(`grep -rn 'personal|couple|family|plus' packages/shared/src` → 0건). 계약을 둘 자리가 비어서 네 벌이 생겼다.

**이미 갈라진 증거**: 안드로이드 `PlatformAndLabelUtils.kt:285` 의 planType 목록에만
`individual`·`plus`·`couple` 이 있는데, DB CHECK 상 `plan_type` 은 `free|personal|family` 뿐이라
**도달 불가능한 가지**다(`migrations.ts:276`).

**조치**: 유료 플랜 키 집합을 `packages/shared` 로 올리고 백엔드가 재수출. 두 앱 상수에
「shared 가 원본」 주석 + 값 일치 테스트. 안드로이드의 죽은 가지 3개는
`SELECT DISTINCT plan_type FROM plans` 로 prod 확인 후 제거.

### 🔻 2-3. 세션 가드 — 실제로 남은 창은 한 자리 · 위험 high

원 보고는 「6벌」이라 했으나 반증 결과 ViewModel 쪽은 이미 이름 있는 헬퍼 둘로 접혀 있다
(`responseStillBelongsToRequester` 6자리, `saveSessionPreservingCurrentToken` 2자리).
**실제로 창이 남은 곳은 `VoiceAccessSyncWorker` 의 `stillSameSession` 한 자리뿐.**

### ✅ 2-4. 크로스플랫폼 검사 그물이 한 방향만 본다 · 위험 low

`scripts/check-cross-platform-refs.py:55` 가 `IOS.rglob("*.swift")` 로 **Swift 주석만** 검사한다.
안드로이드 주석이 iOS·백엔드를 잘못 인용해도 CI 가 못 잡는다(위 2-1 의 틀린 주석 둘이 그 예).

### 🔻 2-5. `messageBelongsToCaller` ↔ `GET /tts/messages/:id/audio` · 위험 medium

손으로 쓴 SQL 2벌이고 **일치를 보는 테스트가 없다**. 쓰기 갈래 3 / 읽기 갈래 4로 다르고,
공유되는 것은 `isPaidVoicePlan` 헬퍼 하나뿐. (갈래 수가 다른 것 자체는 의도로 확인됨.)

---

## 3. iOS ↔ Android 분기 (의도된 예외 제외)

| # | 내용 | 원본 | 위험 |
|---|---|---|---|
| ✅ 3-1 | iOS 가 **유료 클론의 사전렌더 버킷을 '무료 테마'로 기억**한다. 안드로이드가 Codex #660 에서 갈라 둔 분기가 iOS 에 없다 (`AlarmEditorSheet.swift:2473`, `:2630`) | Android | low |
| ✅ 3-2 | iOS `selectedBucketDraft` 가 **2값 열거형**(`medication`·`weather`)이라 클론 테마(greeting/love/fortune)를 못 담는다 → 저장된 클론 테마 알람을 다시 열면 요약 행이 '직접 입력' (`FreeBucketSettings.swift:16-19`) | Android | **medium** |
| ✅ 3-3 | `AlarmEditDraft.carryOverNonEditableFields` 가 '알람' 모드 저장에도 버킷 3종을 **조건 없이** 이어받는다. 안드로이드는 null 로 떨군다 (`AlarmEditDraft.swift:355-363`) | Android | low |
| ✅ 3-4 | 타임휠 감속 곡선·튕김 계수가 두 앱에서 갈라졌고, **스펙 표는 어느 쪽과도 안 맞는다**(옛 안드로이드 값) | — | none |
| 🔻 3-5 | iOS 에 `accountStatusChecked` 준비 신호가 없다 — 1회성 오버레이가 `await` 순서에만 기댄다 | Android | low |
| ✅ 3-6 | `alarm-editor.md` 「회귀 테스트」 6항목이 **전부 iOS**. 안드로이드는 원본인데 휠 정착·스냅 테스트가 없다(계측 테스트는 통틀어 1개) | — | none |

> 반증에서 죽은 것 2건: iOS `bucketCategoryForSave()` 판정식 차이(피해 재현 안 됨),
> 「유료 판정 두 함수가 다른 필드를 본다」(비교 대상이 틀렸음).

---

## 4. 스펙 드리프트

| # | 내용 |
|---|---|
| ✅ 4-1 | `plan-gates.md` 와 `billing-lifecycle.md` 가 **정반대**를 말했다(응답 없음 = 무료 / = 모름) → **PR #709 de2a1dbf 로 이미 수정됨** |
| ✅ 4-2 | `docs/README.md:29`(코드가 이긴다) vs `docs/spec/README.md:20`(구현이 틀린 것) — **두 진입 문서가 반대**. 미수정 |
| ✅ 4-3 | `alarm-editor.md:79-82` 이 **이미 없앤** '끌 때까지 반복' 스위치를 요구하고, 구현 지도가 존재하지 않는 `VoiceRepeatSelector` 를 가리킨다(저장소 전체 히트 1 = 그 스펙 줄) |
| ✅ 4-4 | `voice-and-message.md:573` 이 존재하지 않는 심볼 `prerenderPendingVoiceIds` 를 가리킨다. 원인 확정: 커밋 `5d9254d3` 이 `notReadyVoiceIds` 로 개명하며 스펙만 안 고침 |
| ✅ 4-5 | `CLAUDE.md:117` 알럿 반경 **14dp** vs 코드 34dp / `CLAUDE.md:231` 액션 **52dp** vs 코드 48dp. 코드 주석은 "14 로 되돌리지 말 것"이라고 명시 |
| ✅ 4-6 | `IosAlertDialog.kt` **헤더 주석이 같은 파일 본문과 6항목에서 반대**(radius 14 vs 34, 폭 300 vs 320, 액션 44 vs 48 …) |
| ✅ 4-7 | 판정기 주석이 「우선순위 **네 단**」이라 적고 **다섯 개를 나열**한다 — 안드로이드(`PlatformAndLabelUtils.kt:199`)가 더 나쁘다(같은 블록 안 자기모순). iOS 는 4개 세고 4개 적었으나 2단이 빠짐 |
| ✅ 4-8 | `billing-lifecycle.md:234` 의 "아래 기한"이 **가리키는 절이 없다**. TTL·`isAutoRenewing` 이 이 문서에 0건인데 두 앱 구현은 서로 다르다 |
| 🔻 4-9 | `alarm-editor.md` §4-1 알럿 표에 '입력이 있는 알럿' 갈래가 빠져 그 규칙이 `CLAUDE.md` 에만 산다 |

---

## 5. 정리 후보 — DB

> ⚠ **prod DB 리셋 금지. 되돌릴 수 없는 DDL 은 dev 먼저.** 다음 마이그레이션 번호는 **#108**(최신 #107).

| # | 대상 | 확신 | DROP 위험 | 비고 |
|---|---|---|---|---|
| 5-1 | `subscriptions` 의 apple 컬럼 3개 + partial 인덱스 2개 | high | low | 🔻 **DROP 하지 말 것 — 우선 주석.** #82 가 뺐고 **#96(4주 전)이 iOS 되살리기 일부로 의도적으로 되살렸다.** 지금 지우면 같은 컬럼의 **세 번째 왕복**. 소유자가 #96 의 의도 폐기를 확정한 뒤에만 |
| 5-2 | `users.deletion_requested_at` | high | **high** | 🔻 **유지 결정이 이미 문서화돼 있다** — `cleanup-audit-2026-08-01.md` 의 「탈퇴 신청 시각 = 처리 이력 증빙이므로 유지」. 개인정보보호법 21조 기산점 |
| 5-3 | `generated_audio_assets.mime_type` | high | low | 캐시 히트마다 SELECT 해서 버린다. `audio_format`→MIME 이 1:1 하드코딩이라 재구성 가능. DEFAULT 있어 1릴리스 |
| 5-4 | `generated_audio_assets.model_id` / `language` | high | medium | 쓰기 전용. **NOT NULL 이라 2릴리스**(재작성 → INSERT 축소) |
| 5-5 | `voice_uploads.size_bytes` / `duration_ms` | high | medium | 쓰기 전용(응답값은 DB 가 아니라 storage 에서 온다 — `voice-upload.ts:186-195`). 재작성 시 **인덱스 3개 + FK 를 손으로 복원**해야 함 |
| 5-6 | `idx_voice_profiles_lru` | high | low | 주석이 광고하는 가속을 못 한다(`ORDER BY (last_used_at IS NULL) DESC …` 와 안 맞음). **감사 대장 :98 이 거짓 완료로 찍혀 있다 — 대장도 같이 정정** |
| 5-7 | `idx_retained_billing_pseudonym` | medium | none | 🔻 논거 정정: pseudonym 은 `SHA-256(userId:salt)` **결정론적**이라 재계산 조회가 가능하다(= 법무·CS 질의의 모양). '앞으로도 생길 이유가 없다'는 틀림 |
| 5-8 | `idx_voucher_codes_status` | medium | none | 21개 접근 지점 전수 확인, status 단독 술어 0건 |
| 5-9 | `promo_code_redemptions.redeemed_at` | high | low | 쓰기 전용. ⚠ **`voucher_redemptions.redeemed_at` 은 살아 있다**(`plan-groups.ts:110-124` 가 어느 가족 구독을 채택할지 고르는 정렬) — 헷갈리면 조용한 결제 버그 |

### ⚠ DB 작업 전 반드시 알 것 — CI 블로커

`scripts/check-insert-not-null.py`(`.github/workflows/ci.yml:91`, 필수 체크)는 required 컬럼을
**마지막 `CREATE TABLE` 본문**에서 뽑고 `ALTER TABLE … RENAME TO` 만 추적한다 —
**`DROP COLUMN` 을 전혀 반영하지 않는다.** 테이블 재작성을 건너뛰고 `DROP COLUMN` + INSERT 축소만 하면
런타임은 멀쩡한데 **lint 가 빨개진다**. 5-4·5-5 가 여기 해당.

### 역방향 — 술어로 쓰는데 인덱스가 없는 것

- `paid_voice_retention.delete_after` — `WHERE delete_after <= ?` 풀스캔인데 크론이 **하루 288회** 돈다
- `voucher_codes.redeemed_by_user_id` — 탈퇴 시 UPDATE 술어

---

## 6. 정리 후보 — 코드 ⚠ 미검증

> ⚠ **이 레인의 반증 단계가 세션 한도로 실패했다.** 아래는 조사만 된 것이라
> **직접 확인 후 처리**할 것. 특히 「일부러 왕복시키는 값」(iOS 진동 패턴, `wake_mode` 계약,
> `voiceRepeat`)과 혼동하지 말 것.

- 화자 분리(diarization) 잔재 — `AlarmAudioStore`
- `isPaidVoiceEntitledNow`(호출부 0), `hasPaidVoiceAccess`(서버와 다른 `individual` 포함)
- `AlarmTalkApp` 잠금 이펙트의 죽은 지역변수 `plan`·`access`
- iOS `PlanTier.bestKnown` — B/C 설계 채택 시 삭제 대상(호출부 5)
- 안드로이드 `VoiceUpload` 모델의 미사용 필드 **6개**(`upload.id` 만 쓰인다)

---

## 7. 문서화 재설계 제안

### 진단

구조는 이미 잘 설계돼 있다(`AGENTS.md` 는 포인터 전용, `docs/README.md` 는 인덱스,
`docs/spec/` 은 단일 출처). 문제는 **규칙이 그 구조 안에 안 산다**는 것:

1. `CLAUDE.md` 511줄 중 18개 절의 **~10개가 동작 규칙** → 규약상 `docs/spec/` 소속인데 중복돼 있다
   (`직전 선택 유지` → CLAUDE.md 1 + spec 2곳 / `재생 방식` → CLAUDE.md 1 + spec 4곳).
   정작 2개 절(`동의 화면`, `1회성 오버레이`)은 포인터만 둔다 — **패턴을 알면서 일관 적용 안 함**.
2. 규칙이 주석에 산다(⚠ 2,038줄). 한쪽 코드 옆에 있으니 반대편은 못 본다.
3. 날짜 박힌 스냅샷이 규범 문서 옆에 있다(`parity-audit-2026-08-07.md` 1,262줄,
   `ios/PROGRESS.md` 520줄, `분석/`) — 썩으면서 오답을 준다.
4. 두 진입 문서가 반대로 말한다(4-2).

### 목표 구조

```
AGENTS.md      진입점 하나. 읽는 순서 + 작업 유형별 지도. 규칙 본문 없음(현행 유지)
CLAUDE.md      운영만 — 빌드·배포·환경·CI·커밋. 동작 규칙은 전부 spec 으로 이관
docs/
  README.md    인덱스 + "무엇이 이기는가" 를 한 번만 정의
  spec/        동작 규범(단일 출처). 도메인별 1파일 + 끝에 구현 지도
  standards/   코드 규약 — 디자인 토큰, 입력/SQL 보안, 네이밍, git
  tech/        구조 서술 — DB 스키마, API, 아키텍처
  ops/         환경·배포·시크릿
  archive/     날짜 박힌 스냅샷 격리(이 문서 포함)
```

### 한 번만 정의할 규칙 — "무엇이 이기는가"

| 종류 | 이기는 쪽 | 예 |
|---|---|---|
| **규범** — 제품이 어떻게 **동작해야** 하는가 | **스펙** | "재생 방식은 둘뿐", "미체크 ≠ 철회" |
| **서술** — 코드가 어떻게 **생겼는가** | **코드** | 함수 위치, 필드 이름 |

지금 두 진입 문서가 반대로 말하는 건 이 구분이 없어서다. 나누면 둘 다 맞다.

### 주석 처리 방침 — 삭제가 아니라 이사

| 종류 | 처리 |
|---|---|
| **규칙**("~하지 말 것", "판정식은 일곱 곳") | **spec 으로 이사**, 자리엔 한 줄 포인터 |
| **틀린 것**(4-6, 2-1 의 어긋난 주석 둘) | **삭제** |
| **왜 이 줄이 이런가**(지역적 이유·사고 이력) | **남긴다** |

전면 삭제를 권하지 않는 이유: 2,038줄에 다른 어디에도 없는 **사고 이력과 이유**가 들어 있다
("2026-08-05 실기기 재현", "Codex #685 P1"). 이 저장소의 실패는 대부분 *이유를 몰라서* 났다.

---

## 8. 권고 순서

무엇부터 하면 나머지가 쉬워지는가 기준.

1. **문서 규칙 하나 고치기** (4-2) — "무엇이 이기는가". 10분. 이게 없으면 나머지 판단이 흔들린다.
2. **스펙 드리프트 즉시 수정** (4-3 ~ 4-8) — 전부 문서·주석 수정이라 위험 0, 코드 변경 없음.
3. **`packages/shared` 에 플랜 상수** (2-2) — 작고, 권한 설계의 전제가 된다.
4. **권한 구조 B/C 혼합 착수** — 서버 `Entitlement` 계산부터. PR 을 나눠서.
5. **문구 판정식 3프로퍼티화** (2-1) — 권한과 독립이라 병행 가능.
6. **DB 정리** (5-3 → 5-9) — CI 블로커 확인 후 위험 낮은 것부터. 5-1·5-2 는 **손대지 않는다**.
7. **문서 구조 이관** — 2~5 가 끝난 뒤에 해야 옮길 내용이 확정된다.

## 부록 — 이 감사에서 실패한 것

| 실패 | 영향 |
|---|---|
| `refute:dead-client` (세션 한도) | 6절 항목이 미검증 |
| `judge:구현 비용` (세션 한도) | 설계안 비용 평가 없음 |
| 두 워크플로의 `synthesize`/`report` (세션 한도) | 이 문서는 원본 데이터를 직접 읽어 사람이 종합한 것 |
| judge 에 설계안 2/3 만 전달됨 | 설계 비교는 심사 합의가 아님 |
