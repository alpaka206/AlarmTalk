# 백엔드 리뷰 findings (2026-06)

`packages/backend` 정밀 리뷰에서 나온 correctness/보안/최적화 항목 정리.
**이 문서는 운영 중인 백엔드의 동작 변경 결정을 사용자가 내릴 수 있도록 남기는 기록**이다.
파일·라인 참조는 작성 시점 기준이며, 코드가 바뀌면 라인은 어긋날 수 있으니 내용으로 찾을 것.

상태 표기:
- ✅ **이번 정리에서 수정 완료** (테스트로 검증)
- ⚠️ **결정 필요** — 동작/제품 의도가 걸려 있어 보류, 사용자 판단 대기
- 📝 **권장** — 안전하지만 범위가 있어 별도 작업 권장

---

## ✅ 이미 수정됨 (이번 정리)

| 항목 | 내용 | 커밋 |
|---|---|---|
| 레이트리밋 우회 | 키 산정에서 위조 가능한 `x-forwarded-for` 제거, `cf-connecting-ip`만 신뢰 | `fix(backend): 레이트리밋·인증 미들웨어…` |
| 인증 insert 레이스 | 최초 인증 시 `users` 자동 생성을 `ON CONFLICT DO NOTHING`으로 멱등화 | 〃 |
| PII 로깅 | 매 요청 `sub/email` `console.log` 제거, 실패만 구조적 로깅 | 〃 |
| 미실행 테스트 | `vitest include`에 안 잡히던 `src/middleware/*.test.ts` 6개 정리(중복 5 삭제, `cors` 살려서 `test/`로 이동) | `test(backend): 실행되지 않던…` |

---

## ⚠️ 결정 필요 (High)

### F1. 스케줄러: cron 주기와 정시(UTC) 정확매칭 불일치 + 시간대
- **파일**: `src/lib/scheduler.ts` (`shouldAlarmFire`/`formatHHmm`), `src/index.ts`(`scheduled`), `wrangler.toml`(`crons = ["*/5 * * * *"]`)
- **현상**:
  1. cron이 **5분 주기**인데 `shouldAlarmFire`는 `alarm.time === formatHHmm(now)` **정확-분 매칭**. 따라서 분이 5의 배수가 아닌 알람(예: `07:23`)은 푸시 경로로 **영영 발사되지 않음**. (`test/scheduler.test.ts`가 "분 부분일치 거절"을 명시 → 정확매칭은 의도된 설계, cron 주기와의 불일치가 문제.)
  2. `formatHHmm`은 `getUTCHours/Minutes`, 요일은 `getUTCDay`. 알람 `time`은 클라이언트가 보낸 값이 **변환 없이** 저장됨(`alarm-mutation.ts` insert, 컬럼은 `TEXT`). 클라이언트가 로컬시각을 그대로 보내면 KST 기준 최대 9시간 어긋남.
- **중요 맥락**: 실제 알람 **울림은 온디바이스**(Android `AlarmManager`/iOS `AlarmKit`)라 이 cron 푸시는 **보조 경로**(가족/대상 알람 알림 등). 그래서 버그가 잠복해 있었음. `docs/tech/README.md`도 한때 "푸시는 no-op"이라 적었으나 현재 코드는 firing 알람에 `sendAlarmPush`를 호출함.
- **확인 필요**: 앱 클라이언트가 `time`을 **로컬 HH:mm 그대로** 보내는지 **UTC로 변환**해 보내는지에 따라 (2)의 실제 영향이 갈림. (Android/iOS 알람 생성 코드 교차검증 예정.)
- **제안**: (a) cron을 `* * * * *`로 바꾸거나 정확매칭을 ±윈도로 완화, (b) 알람마다 타임존/오프셋을 저장하거나 `time`을 UTC로 정규화, 또는 절대 `next_fire_at` 타임스탬프 저장 후 `WHERE next_fire_at <= now` 조회. cron 주기를 분 단위로 올리면 Workers subrequest/비용 영향 검토 필요.

### F2. Google 로그인: `email_verified` 미검증 + email로 기존계정 병합
- **파일**: `src/lib/oauth.ts`(`verifyGoogleIdToken`), `src/routes/auth.ts`(google 플로우)
- **현상**: `tokeninfo`로 `iss/aud/exp`만 확인하고 `email_verified`를 보지 않음. 다운스트림에서 `WHERE google_id = ? OR email = ?`로 기존 계정과 매칭/병합 → **미인증 이메일**을 가진 토큰으로 타인 계정에 연결될 여지. 또한 `GOOGLE_CLIENT_ID`가 비어 있으면 `aud` 검증을 건너뜀.
- **제안**: email을 식별 키로 쓰기 전에 `email_verified === true` 강제, `expectedClientId` 미설정 시 하드 실패, 가능하면 Apple처럼 로컬 JWKS RS256 검증으로 전환(지연/안정성도 개선).
- **상태**: 리뷰 지적 사항. 적용 전 google 플로우 정밀 확인 필요(⚠️).

### F3. 같은 시각 중복 알람 방지가 백엔드에 없음
- **현상**: Android는 `AlarmRepository.requireUniqueTime`/`AlarmDao.countAtTime`으로 같은 시각 1개를 클라이언트에서 강제하지만, **백엔드는 동일 `time` 알람 생성을 막지 않음**. iOS도 미확인.
- **요구사항(제품)**: 같은 시각 알람이 이미 있으면 새로 추가 시 **기존 교체** 또는 **모달 안내**.
- **작업**: 별도 태스크로 진행(백엔드 충돌 감지 + iOS 동일 정책 + UX 통일).

---

## ⚠️ 결정 필요 (Medium)

### F4. 친구 알람 스팸 벡터
- **파일**: `src/routes/alarm-mutation.ts`
- **현상**: `target_user_id`로 타인에게 알람 생성 시 친구/그룹 관계만 확인. 수락된 친구가 타인에게 **무제한 알람**을 만들 수 있음(스팸). 제품 의도 확인 필요(관계별 명시적 opt-in / 개수 제한 등).

### F5. 계정 열거(account enumeration)
- **파일**: `src/routes/friend.ts`(이메일로 친구 추가 시 존재/부재 응답 분기), `src/routes/auth.ts`(`/auth/email-code` `AUTH_EMAIL_TAKEN`)
- **현상**: 인증된 사용자가 임의 이메일의 가입 여부를 응답 코드로 알아낼 수 있음. 균일 응답 또는 사용자별 rate-limit 권장.

### F6. 에러 detail 클라이언트 노출
- **파일**: `src/routes/auth.ts`(google/apple/me의 `detail` 반환), 기타
- **현상**: 상위 검증 오류 텍스트가 클라이언트로 새어 공격 보조(서명 불일치 vs audience 불일치 구분 등). 안정적 `error_code`만 반환하고 `detail`은 서버 로깅만 권장.

### F7. Apple nonce 미요구(레거시 호환 창)
- **파일**: `src/lib/oauth.ts`/`src/routes/auth.ts`
- **현상**: 클라이언트가 raw nonce를 안 보내면 경고만 하고 통과(토큰에 nonce 클레임이 있을 때만 거절). nonce 없는 Apple 토큰은 재생(replay) 방어 없이 수락. 마이그레이션 창 종료 후 nonce 필수화 + `jti` 사용기록 권장.

---

## 📝 권장 (안전하지만 범위 있음)

### F8. TTS/바우처 일일한도 TOCTOU
- **파일**: `src/routes/tts.ts`(`daily_tts_count` 읽기 → 생성 → +1 증가가 분리)
- **현상**: 무료 사용자의 동시 요청이 한도 검사를 모두 통과해 유료 AI 호출 비용이 한도를 초과해 발생할 수 있음.
- **제안**: 생성 **전에** 원자적으로 슬롯 예약 — `UPDATE users SET daily_tts_count = daily_tts_count + 1 WHERE (id=? OR google_id=?) AND daily_tts_count < :limit` 후 `rowsAffected`로 한도 판정, 생성 실패 시 보정(-1). 비용 경로라 신중한 테스트 필요.

### F9. bodyLimit는 Content-Length만 검사
- **파일**: `src/middleware/bodyLimit.ts`
- **현상**: chunked 업로드(`Content-Length` 부재)면 검사를 건너뜀. `voice-upload`는 바이트 재검사가 있으나 JSON 라우트는 무방비. 스트림 읽으며 한도 적용 또는 본문 있는 메서드에서 `Content-Length` 부재 거절 권장.

### F10. 엔타이틀먼트 fail-open
- **파일**: `src/routes/voice-upload.ts`(`hasPaidVoiceAccess`), `src/routes/tts.ts`, `src/routes/alarm-mutation.ts`
- **현상**: `userIdPK`가 비면 유료 접근을 **허용(true)** 으로 폴백. auth 내부 best-effort 필드에 결제 게이트가 묶임. 미해석 시 **거부(fail-closed)** 또는 verified sub로 직접 plan 조회 권장.

### F11. `/voice/diarize` 유료검사 전 본문 버퍼링
- **파일**: `src/routes/voice-upload.ts`
- **현상**: 엔타이틀먼트 검사 전에 업로드를 `arrayBuffer()`로 다 읽음 → 무료 사용자가 서버 버퍼링을 유발. 검사 후 읽기로 순서 변경 권장.

### F12. isolate-단위 in-memory 상태
- **파일**: `src/middleware/rateLimit.ts`(`store`), `src/lib/r2-storage.ts`(`counter`)
- **현상**: Workers는 isolate가 여러 개라 60req/분 한도가 isolate 수만큼 느슨함. R2 오브젝트 키의 `Date.now()_counter`는 isolate 간 충돌 가능. 엄격한 전역 한도는 Durable Objects/KV, 키는 `crypto.randomUUID()` 권장.

### F13. `/api/init-db` 비프로덕션 무인증 + 에러메시지 노출
- **파일**: `src/index.ts`
- **현상**: 비프로덕션은 시크릿 없이 호출 가능, `fromId/toId` 정수 미검증, 에러 `message` 클라이언트 노출. 전 환경 시크릿 요구 + 입력 검증 + 일반 메시지 권장.

---

## 검증된 비이슈(non-issue)
- SQL은 일관되게 파라미터 바인딩. `alarm-mutation` PATCH의 동적 컬럼은 **고정 allowlist** 조합이라 주입 불가.
- `voucher_redemptions UNIQUE(voucher_id,user_id)`로 동일 사용자 중복 사용 DB 레벨 차단.
- 스케줄러 `repeat_days` JSON 파싱은 try/catch + 정수 필터로 가드됨.
- Apple JWKS 검증은 RS256 + kid 강제, 미스 시 재조회로 견고.
