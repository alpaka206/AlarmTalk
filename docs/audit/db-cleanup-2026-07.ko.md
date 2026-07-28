# DB·백엔드 정리 감사 (2026-07-28)

출시 전 스키마 정리를 위한 실측 기반 감사. 외부 AI가 작성한 감사 지시문의 주장을
**현재 코드·실 DB 기준으로 재검증**한 결과와, 실행 가능한 정리 계획을 담는다.

기준 커밋: `2193832e` (브랜치 `chore/drop-dead-tables`)
스키마 단일 출처: `packages/backend/src/lib/migrations.ts` (#1~#79)

---

## 0. 가장 중요한 전제 오류

외부 감사 지시문은 **"기존 사용자 데이터를 절대 유실하면 안 된다"**를 전제로
expand → dual-write → shadow-read → backfill → reconciliation → cutover →
observation → contract 의 12단계와 Gate 0~7 승인 체계를 요구한다.

이 전제는 이 프로젝트에 **해당하지 않는다**. `CLAUDE.md` 기준 prod DB는 **출시 전
초기화 예정**이며 back-compat/grandfather 부담이 없다(하드 브레이킹 OK).

따라서 그 지시문의 핵심 산출물 상당수는 이 프로젝트에서 **순비용**이다:

| 지시문 요구 | 이 프로젝트에서의 판단 |
|---|---|
| dual-write / shadow-read 계층 | **불필요** — 보존할 운영 데이터가 없다 |
| backfill runner + checkpoint + quarantine | **불필요** — 재구축이 더 싸고 안전하다 |
| blue/green DB cutover | **불필요** — 초기화가 곧 cutover |
| `CanonicalEntitlementService` + mismatch 원장 | **과잉** — 실측 불일치 0건 (§2) |
| Gate 0~7 승인 체계 | **과잉** — dev DB 마이그레이션 성공 여부로 충분 |
| schema_v2.sql 별도 작성 | **불필요** — `migrations.ts` 가 이미 신규 DB를 만든다 (§5 테스트로 보증) |

정리의 실제 제약은 하나뿐이다: **dev DB는 실기기 QA 데이터가 살아있고 `develop`
머지 시 자동 마이그레이션이 돈다.** 즉 마이그레이션은 파괴적이어도 되지만
**실패해서는 안 된다.**

---

## 1. 지시문 주장별 검증 결과

### 1-1. 이미 처리된 항목 (지시문이 낡음)

| 주장 | 실제 |
|---|---|
| `dub_jobs` 제거 검토 | 마이그레이션 **#79에서 이미 DROP** |
| 캐릭터/성장 테이블 | **#77에서 이미 DROP** |
| iOS 앱 제거 | `apps/ios-native` **이미 삭제됨** (커밋 9f427c69) |
| `notes`·`friendships`·`gifts`·`voice_speakers` | **#79에서 이미 DROP** |
| `users.picture`·`last_active_at` | **#79에서 이미 DROP** |
| `/api/init-db` 노출 위험 | **이미 안전** — timing-safe 비교 + 시크릿 미설정 시 fail-closed + 실패 시 404(오라클 없음). `index.ts:99-114` |

### 1-2. 사실과 다른 항목

| 주장 | 실제 |
|---|---|
| `voice_profiles.perso_voice_id` 제거 검토 | **`migrations.ts`에 없는 컬럼.** 단 dev/prod 실 DB에는 존재 — 아래 §4 드리프트 참조 |
| `users.plan` 을 걷어내고 entitlement 서비스로 통일 | `users.plan`은 **페이월이 신뢰하는 출처**다(`manual-tts-quota.ts:21`). 실측 불일치 **0건**(dev/prod). 의도된 비정규화이며 유지가 맞다 |
| `message_library` 제거 후보 | **살아있다.** 앱이 호출하는 `GET /tts/messages`가 이 테이블로 "저장한 문구"를 필터링한다(`tts.ts:1652-1658`, 저장은 `tts.ts:1477`) |
| PortOne 잔재 정리 | 코드에는 **없다**. 주석 2곳과 `store_transactions.provider` CHECK 리터럴뿐 |

### 1-3. 정확히 짚은 항목

- **사용자 식별자 혼재** — 실재하며 이번 감사 최대 리스크 (§3)
- Apple/iOS DB·코드 잔재 — 실재 (§2-A)
- `alarms.speaker_id` — 참조 테이블이 이미 사라진 dangling (§2-A)
- `plan_group_invites` — 생성 경로가 앱에서 죽음 (§2-B)
- `voucher_codes`의 `status`/`used_at`/`redeemed_by_user_id` ↔ `voucher_redemptions` 중복
- 가족 알람 legacy quiet 컬럼(#29) ↔ `family_alarm_quiet_windows`(#30) 중복
- `_kst` 뷰 — 런타임 사용 **0곳** (순수 운영 조회용)

---

## 2. 실측 데이터 (2026-07-28, `scripts/db-inventory.ts`)

|  | dev | prod |
|---|---|---|
| 마이그레이션 | #79 | **#78** (#79 미배포) |
| 테이블 / 뷰 / 인덱스 | 32 / 22 / 62 | 37 / 27 / 77 |
| users | 11 | 44 |
| alarms | 18 | 12 |
| messages | 245 | 192 |
| generated_audio_assets | 209 | 190 |
| `integrity_check` / `foreign_key_check` | ok / 0 | ok / 0 |

### 2-A. 데이터가 0인 제거 후보 (dev·prod 양쪽)

| 객체 | dev | prod | 앱 호출 |
|---|---|---|---|
| `users.apple_id` | 0 | 0 | 없음 |
| `subscriptions.apple_transaction_id` / `_original_` / `_product_id` | 0 | 0 | 없음 |
| `push_tokens` platform=`ios` | 0 | 0 | — |
| `store_transactions` provider=`apple`/`portone` | 0 | 0 | — |
| `alarms.speaker_id` | 0 | 0 | **앱이 보내지 않음** |
| `alarms.raw_audio_url` / `raw_audio_duration_ms` | 0 | 0 | DTO엔 있으나 실제 전송 0 |
| `raw_alarm_uploads` | 0 | 0 | `/alarm/source` **미호출** |
| `plan_group_invites` | 0 | 0 | 생성 경로 없음 |
| `voice_profiles.avatar_url` | 0 | 0 | 없음 |
| `voice_profiles.voice_gender` / `speech_formality` | 5 / 5 | 0 / 0 | `speech_style`(#66)로 대체 |

### 2-B. Android가 호출하지 않는 백엔드 표면

Retrofit 인터페이스 전수(9개 파일) 기준 — 앱이 부르는 엔드포인트에 **없는** 것:

- `GET /library`, `PATCH /library/:id/favorite`, `DELETE /library/:id` (`routes/library.ts`)
  — 단 **테이블 `message_library`는 유지**(§1-2)
- `POST /alarm/source` (`routes/alarm-source.ts`)
- `POST /auth/apple`, `POST /billing/apple/*`
- 가족 초대권(INV-) **생성** 엔드포인트 (`routes/family-invite.ts`)
  — 소비(`/code/register`)는 살아있으나 생산자가 없다

### 2-C. 중복 구조 (source of truth 미확정)

| 중복 | 권장 출처 |
|---|---|
| `users.family_alarm_quiet_days`/`_start`/`_end` (#29) ↔ `family_alarm_quiet_windows` (#30) | **windows** — legacy 3컬럼은 dev/prod 전부 기본값(커스텀 0건) |
| `voucher_codes.status`/`used_at`/`redeemed_by_user_id` ↔ `voucher_redemptions` | `max_uses>1`이면 원장(`voucher_redemptions`)이 출처, 나머지는 캐시 |
| `users.plan` ↔ `subscriptions` | **`users.plan` 유지** — 페이월이 읽는 캐시, 실측 불일치 0건 |

---

## 3. 정합성 버그: 사용자 식별자 혼재 (P1)

가장 심각한 발견. 데이터 삭제보다 **먼저** 처리해야 한다.

### 현재 구조

- `middleware/auth.ts`가 컨텍스트에 **두 개의 식별자**를 심는다:
  - `userId` = JWT `sub` (`google_id ?? apple_id ?? id`)
  - `userIdPK` = `users.id`
- 조회는 삼중 OR: `WHERE google_id = ? OR apple_id = ? OR id = ?` (`auth.ts:80`)
- 사용 빈도: `userId` 54곳 / `userIdPK` 47곳 — **같은 파일 안에서도 혼재**
  (`alarm-mutation` 4:4, `tts` 6:6, `voice-profile` 11:12)
- 테이블마다 저장하는 키가 다르다: `alarms`·`voice_profiles`·`voice_uploads`·
  `raw_alarm_uploads`는 **sub**, `messages`·`subscriptions`·`push_tokens`·
  `user_consents`·`generated_audio_assets` 등은 **PK**

### 왜 지금은 안 터지는가

정상 가입 경로에서 `users.id == google_id == JWT sub`이 우연히 성립하기 때문이다.

- 구글 최초 가입: `userId = googleId` 로 INSERT (`auth.ts:657`)
- 이메일 가입: `google_id = id` 로 INSERT (`auth.ts:460`) ← **비밀번호 계정에
  google_id를 채우는 안티패턴**
- 실측: dev 11명 중 9명, prod 44명 중 43명이 `id == google_id`

### 어긋남을 만드는 유일한 경로

`POST /auth/google` 이 `WHERE google_id = ? OR email = ?` 로 기존 행을 찾아
(`auth.ts:620-628`) **`google_id`만 덮어쓰고 `id`는 UUID로 유지**한 뒤,
JWT `sub`을 **googleId**로 발급한다(`auth.ts:667`).

재현 시나리오:
1. 이메일+비밀번호 가입 → `users.id = UUID_A`, `google_id = UUID_A`
2. 같은 이메일로 구글 로그인 → 같은 행 매칭, `google_id = <구글숫자sub>`로 UPDATE
3. 발급 JWT `sub = <구글숫자sub>` ≠ `users.id`
4. 이후 `get('userId')`를 쓰는 라우트는 구글숫자sub로, `userIdPK`를 쓰는 라우트는
   UUID_A로 조회 → **같은 사용자가 라우트에 따라 다른 데이터를 본다**

영향 범위(방어적 폴백이 없는 곳):
- `WHERE google_id = ?` 단독 조회 8곳 → 구독·가족그룹·코드등록·프로필수정이
  **조용히 0행 반환**
- `account-deletion.ts:147` — `voice_uploads`를 `userPk` 단독으로 지우는데 쓰기는
  sub(`voice-upload.ts:170`) → **탈퇴 시 행 잔존**

**현재 실 데이터에 어긋난 계정은 0건**(dev/prod 모두). 잠재 버그이며, 코드가 이미
이를 인지하고 `viewerIds()`·`ownerIds()`·방어적 `OR` 조인 10곳으로 우회하고 있다.

### 적용한 수정 (커밋 `b05c6c19`)

- JWT `sub` 을 모든 로그인 경로에서 `users.id` 로 통일
- 신규 구글 가입도 서버 생성 UUID 를 PK 로 사용 (`users.id` 가 외부 provider 식별자에
  종속되지 않게)
- 이메일 가입은 `google_id` 를 NULL 로 (구글 계정 식별자 전용 공간 오염 제거)
- 단일 `WHERE google_id = ?` 조회 8곳 → `WHERE id = ?`
- 미들웨어의 사용자 자동 생성 → 401. 이 경로는 계정이 파기됐다는 뜻인데, 자동 생성이
  남은 토큰으로 탈퇴 계정을 되살리고 `google_id = id` 인 행을 다시 만들어 규약을 깨뜨렸다

**강제 재로그인은 필요 없다.** 기존 구글 계정은 `users.id == google_id` 라 sub 값이
바뀌지 않고, 기존 이메일 계정은 원래 `sub = users.id` 였다. 처음엔 `token_epoch` bump 가
필요할 것으로 봤으나, 실 데이터 분포를 확인한 결과 불필요했다.

미들웨어의 `OR google_id = ?` 는 갈라진 상태에서 발급된 토큰을 위한 한시적 폴백으로
남겼다(토큰 만료 주기가 한 번 지나면 제거 — §9).

---

## 4. 스키마 드리프트

`migrations.ts`를 빈 DB에 전부 적용한 결과와 실 DB를 비교한다
(`test/schema-fresh.test.ts`, `SCHEMA_DIFF_ENV_FILE=... npx vitest run`).

| 대상 | 드리프트 |
|---|---|
| dev | **1건** — `voice_profiles.perso_voice_id`가 원격에만 존재 |
| prod | 28건 — 위 1건 + #79 미배포분(테이블 5·컬럼 2·인덱스 15·뷰 5) |

`perso_voice_id`는 커밋 `6f092a0c`가 **이미 적용된 마이그레이션 #1의 본문을 수정**해
지웠기 때문에 생겼다. 원장(`_migrations`)은 id만 보므로 재실행되지 않아 실 DB에는
컬럼이 남았고, 신규 DB에는 없다.

→ 출시 전 prod 초기화 시 자동 소멸. **별도 조치 불필요.** 다만 "적용된 마이그레이션
본문은 수정하지 않는다"는 규약을 지켜야 하며, `test/schema-fresh.test.ts`가 앞으로
이 클래스의 회귀를 잡는다.

---

## 5. 추가된 도구

| 파일 | 역할 |
|---|---|
| `packages/backend/scripts/db-inventory.ts` | 읽기 전용 인벤토리 — 스키마 전수·행수·NULL 분포·정합성·정리 판단용 프로브. 개인정보 값은 출력하지 않는다(count/distinct만) |
| `packages/backend/test/schema-fresh.test.ts` | 신규 DB 회귀 가드 — 전체 체인 적용·재실행 멱등·`integrity_check`·`foreign_key_check`·**깨진 뷰 없음**·DROP된 테이블 잔재 없음. `SCHEMA_DIFF_ENV_FILE` 지정 시 원격 드리프트 비교 |

"깨진 뷰 없음" 검사가 특히 중요하다. libSQL의 `ALTER TABLE DROP COLUMN`은 스키마의
**모든 뷰를 검증**하므로, 참조 테이블이 사라진 `_kst` 뷰가 하나라도 남으면 이후 모든
DROP COLUMN 마이그레이션이 실패한다 — 실제로 #77이 캐릭터 테이블만 지우고 뷰를 남겨
#79의 ALTER가 깨졌었다(#79 주석).

---

## 6. 최대 발견: alarms 인덱스 유실 (성능 회귀)

데드 스키마를 찾다가 더 급한 걸 찾았다. `alarms` 의 의도된 인덱스 8종
(#1 `idx_alarms_user`/`_target`/`_message`/`_active`, #5 `_voice_profile`/`_speaker`,
#19 `_user_active`/`_target_active`)이 **마이그레이션 #22·#23 의 테이블 재작성
(`DROP TABLE alarms` → RENAME)에 함께 소멸**했고, 두 마이그레이션 모두 재생성 문장을
넣지 않았다. 이후 추가된 `idx_alarms_bucket`(#54)만 남았다.

dev·prod 실측:
```
alarms 인덱스: sqlite_autoindex_alarms_1, idx_alarms_bucket   (양쪽 동일)
EXPLAIN QUERY PLAN
  WHERE user_id = ? AND is_active = 1  →  SCAN alarms
  WHERE target_user_id = ?             →  SCAN alarms
```

앱이 가장 자주 부르는 `GET /api/alarm` 을 포함해 **모든 알람 조회가 full scan** 이다.
행이 12~18개인 지금은 안 보이지만 출시 규모에서는 그대로 문제가 된다.

→ 마이그레이션 #80 에서 실제 쿼리 술어에 맞춰 4개만 복구했다. `user_id`/`target_user_id`
단독 인덱스는 복합 인덱스의 선행 컬럼으로 커버되므로 다시 만들지 않는다(쓰기 비용만 는다).

---

## 7. 적용한 변경

| 마이그레이션 | 내용 |
|---|---|
| **#80** | alarms 인덱스 4종 복구 (위 §6) |
| **#81** | `_kst` 뷰 27종 전면 제거 — 런타임 read 0곳, 유지 비용만 컸다 |
| **#82** | Apple 컬럼 4종 + 인덱스 3종 제거 (인덱스 선행 DROP 필수) |
| **#83** | `alarms.speaker_id`, `users.family_alarm_quiet_days/_start/_end`, `voice_profiles.voice_gender/speech_formality/avatar_url`, `plan_group_invites` 테이블 제거 |

코드:
- Apple/iOS 로그인·결제 경로 전면 제거 (백엔드 16파일 + shared + Android + 환경변수 6종)
- 가족 알람 조용시간 저장을 `quiet_windows` JSON 하나로 일원화 (API 계약은 유지)
- 가족 초대권 서브시스템 제거 (가족 합류는 이용권 INV- 코드로 일원화)
- 앱 미호출 `/library` 라우트 제거 (테이블 `message_library` 는 유지 — §1-2)
- `alarms.speaker_id` 배관 제거
- **JWT `sub` 을 `users.id` 로 통일** (§3) — 강제 재로그인 불필요

**CHECK 제약은 손대지 않았다.** `push_tokens.platform` 의 `'ios'`,
`store_transactions.provider` 의 `'apple'`·`'portone'` 은 그대로 둔다 — 변경하려면
테이블 재작성이 필요한데, 쓰는 코드가 이미 없어 허용 목록에 남겨두는 비용이 0 이다.

---

## 8. 검증

| 항목 | 결과 |
|---|---|
| `npm run typecheck` | PASS |
| `npm test` | **79 files / 1318 passed / 64 skipped / 0 failed** |
| `npx eslint packages/backend/src` | 0 errors (기존 warning 1건) |
| 신규 DB 생성 (`test/schema-fresh.test.ts`) | PASS — 체인 적용·멱등·integrity·FK·깨진 뷰 없음 |
| dev(#79) 스키마 복제본 리허설 | **PASS** — #80~#83 적용 성공 |
| prod(#78) 스키마 복제본 리허설 | **PASS** — #79~#83 적용 성공 |

리허설은 원격의 **스키마와 마이그레이션 원장만** 로컬 임시 DB 로 복제해 미적용분을
거기서 돌린다. 원격에는 읽기만 하고 개인정보는 내려받지 않는다.

```
SCHEMA_DIFF_ENV_FILE=.dev.vars.prod npx vitest run test/schema-fresh.test.ts
```

---

## 9. 남은 후보 (미적용)

아래는 조사에서 "앱 미호출"로 확인됐지만 이번에 손대지 않았다.

| 대상 | 왜 남겼나 |
|---|---|
| `POST /alarm/source` + `raw_alarm_uploads` + `alarms.raw_audio_url/_duration_ms` | 배선은 완결돼 있고(업로드→추적→GC→탈퇴정리) 데이터만 0건이다. 제거하면 `audio-retention` 의 R2 삭제 로직을 함께 건드려야 해서 위험 대비 이득이 작다. 향후 기능 예정이면 그대로 두는 편이 낫다 |
| `GET /alarm/tick`, `GET /alarm/:id`, `DELETE /alarm/:id/decline`, `GET /tts/presets`, `DELETE /tts/messages/:id`, `GET /voice/:id`, `GET /voice/:id/stats`, `PATCH /user/plan`, `POST /billing/redeem`, `POST /family/alarms` | 앱 Retrofit 전수에 없어 호출자가 없다. 라우트 제거는 DB 정리와 독립이라 별도로 처리하는 편이 리뷰하기 쉽다. 특히 `PATCH /user/plan` 은 유료 음성을 하드삭제해 "해지 후 30일 보관" 정책과 어긋나므로 우선 검토 대상 |
| `voucher_codes.status/used_at/redeemed_by_user_id` | `voucher_redemptions` 와 중복이지만 `billing-query` 가 읽고 있어 응답 계약이 걸린다 |
| `users.plan` | 페이월이 신뢰하는 출처이고 실측 불일치 0건 (§1-2) |
| 미들웨어의 `OR google_id = ?` 폴백 | 통일 이전에 발급된 토큰용. 토큰 만료 주기가 한 번 지나면 제거 |

---

## 10. 테스트 기준선

작업 전: `83 files / 1448 passed / 63 skipped / 0 failed`
작업 후: `79 files / 1318 passed / 64 skipped / 0 failed`

파일·케이스가 준 것은 제거한 기능(Apple 로그인·결제, 가족 초대권, `/library`,
`speaker_id`)의 테스트가 함께 사라졌기 때문이다. 남은 기능의 테스트는 전부 통과한다.
