# 백엔드 리뷰 findings (2026-06)

> **히스토리 기록 — 최신 상태는 각 항목의 `2026-07-15 상태` 스탬프 참조.**

`packages/backend` 정밀 리뷰(2026-06)에서 나온 correctness/보안/최적화 항목 정리.
**이 문서는 운영 중인 백엔드의 동작 변경 결정을 사용자가 내릴 수 있도록 남기는 기록**이다.
파일·라인 참조는 스탬프 시점 기준이며, 코드가 바뀌면 라인은 어긋날 수 있으니 내용으로 찾을 것.

상태 표기(2026-07-15 스탬프):
- ✅ **수정** — 코드로 해소 확인
- **소멸/무효** — 대상 코드·기능 자체가 제거돼 이슈가 사라짐
- **종결** — 의도된 트레이드오프로 확정(코드에 명기)
- **유지** — 여전히 유효, 재확인 완료

---

## ✅ 이미 수정됨 (2026-06 정리)

| 항목 | 내용 | 커밋 |
|---|---|---|
| 레이트리밋 우회 | 키 산정에서 위조 가능한 `x-forwarded-for` 제거, `cf-connecting-ip`만 신뢰 | `fix(backend): 레이트리밋·인증 미들웨어…` |
| 인증 insert 레이스 | 최초 인증 시 `users` 자동 생성을 `ON CONFLICT DO NOTHING`으로 멱등화 | 〃 |
| PII 로깅 | 매 요청 `sub/email` `console.log` 제거, 실패만 구조적 로깅 | 〃 |
| 미실행 테스트 | `vitest include`에 안 잡히던 `src/middleware/*.test.ts` 6개 정리(중복 5 삭제, `cors` 살려서 `test/`로 이동) | `test(backend): 실행되지 않던…` |

---

## High

### F1. 스케줄러: cron 주기와 정시(UTC) 정확매칭 불일치 + 시간대
- **2026-07-15 상태: 소멸** — 발사 시각 cron 알람 push 경로 자체가 제거됨(PR #548). 알람 울림은 전부 온디바이스 로컬(AlarmManager, 수신 가족알람도 pull→로컬 스케줄)이고, cron의 발사 판정은 로깅용으로만 남음(`src/index.ts` `scheduled` — "발사 시각 서버 push 는 보내지 않는다" 주석 참조). `sendAlarmPush`(fcm.ts)는 프로덕션 경로에서 미호출(테스트만). '새 가족 알람 도착' 즉시성은 **생성 시점** `sendFamilyAlarmPush`(data-only)로 처리.
- 판정 로직도 제거 전에 이미 수정돼 있었음: `src/lib/scheduler.ts`가 알람별 `timezone`(IANA, 기본 `Asia/Seoul`) 로컬 시각으로 해석 + 정확-분 매칭 대신 `CRON_WINDOW_MINUTES=5` 윈도 매칭(`wrangler.toml`의 `crons = ["*/5 * * * *"]`와 일치 강제).
- (원 지적: 5분 cron × 정확-분 매칭이라 분이 5의 배수가 아닌 알람은 푸시 경로로 발사 불가 + `time`을 UTC로 해석해 KST 최대 9시간 어긋남.)

### F2. Google 로그인: `email_verified` 미검증 + email로 기존계정 병합
- **2026-07-15 상태: ✅ 수정** — `src/lib/oauth.ts`: Google·Apple 모두 `email_verified !== true/'true'`면 email 클레임을 신뢰하지 않음(google: 144–150행, apple: 191–196행). `GOOGLE_CLIENT_ID` 미설정 시 `aud` 검증 스킵 대신 **하드 실패**(fail-closed, 132–137행).
- 잔여(선택 과제): Google 검증이 여전히 원격 `tokeninfo` 호출(로컬 JWKS RS256 전환은 미적용 — 지연/안정성 개선 여지일 뿐 보안 이슈 아님).

### F3. 같은 시각 중복 알람 방지가 백엔드에 없음
- **2026-07-15 상태: 유지(백엔드 미구현)** — 백엔드는 여전히 동일 `time` 알람 생성을 막지 않음. 클라이언트는 Android(`AlarmRepository.requireUniqueTime`/`AlarmDao.countAtTime`)에 더해 **iOS도 동일 정책 구현 완료**(`LocalAlarmStore.requireUniqueTime` — 원 지적의 "iOS 미확인"은 해소).
- **요구사항(제품)**: 같은 시각 알람이 이미 있으면 새로 추가 시 **기존 교체** 또는 **모달 안내**. 백엔드 충돌 감지는 여전히 별도 태스크.

---

## Medium

### F4. 친구 알람 스팸 벡터
- **2026-07-15 상태: 부분 완화 후 유지** — `src/routes/alarm-mutation.ts`(+`family-alarm.ts`)에 수신자 보호 게이트가 생김:
  - 수신자 **opt-in 토글** `allow_family_alarms`(기본 **꺼짐**) 미허용 시 403 `FAMILY_ALARM_DISABLED`.
  - 수신자 설정 **불가 시간(quiet time) 창** 차단(403 `FAMILY_ALARM_QUIET_TIME`).
  - 알람별 수신자 **'그만받기' opt-out**(`alarm_recipient_state.declined`, cron 발사 판정에서도 제외).
  - 관계 검증: 친구 `accepted` 또는 같은 커플/가족 그룹.
- 잔여: 허용해 둔 상대가 만들 수 있는 **알람 개수 제한은 여전히 없음**. opt-in+opt-out으로 스팸 실효성은 크게 줄었으므로 개수 제한은 필요 시 후속.

### F5. 계정 열거(account enumeration)
- **2026-07-15 상태: 종결(의도된 트레이드오프 명기)** —
  - 가입 이메일 중복 분기(`AUTH_EMAIL_TAKEN`/소셜 안내)는 "중복 이메일이면 회원가입을 막고 로그인으로 유도"라는 **제품 요구에 따른 의도된 열거 트레이드오프**로 확정, `src/routes/auth.ts` 134–138행 주석에 명시 문서화됨.
  - 로그인은 열거 안전: 미존재 계정에도 고정 더미 해시로 bcrypt 비교 수행 + 균일 응답(auth.ts 523–543행). 비밀번호 재설정도 존재 여부 비노출(278행).
  - 친구 추가(이메일 검색, `friend.ts`)의 `USER_NOT_FOUND` 분기는 기능 본질상 불가피(이메일로 상대를 찾는 기능) — 인증 필수 + 레이트리밋으로 완화. 추가 조치 안 함.

### F6. 에러 detail 클라이언트 노출
- **2026-07-15 상태: ✅ 수정** — google/apple/이메일 플로우 catch에서 `err.message`는 **서버 로깅**(`logRouteError`)과 상태코드 분류에만 내부 사용하고, 클라이언트에는 안정적 `error_code` + generic 메시지만 반환(`AUTH_GOOGLE_FAILED`/`AUTH_APPLE_FAILED` 등, auth.ts catch 블록들). auth 미들웨어 검증 실패도 코드 분류만 노출.

### F7. Apple nonce 미요구(레거시 호환 창)
- **2026-07-15 상태: 유지(레거시 창 여전히 열림)** — 클라이언트가 raw nonce를 안 보내고 토큰에도 nonce 클레임이 없으면 경고 로그만 남기고 통과(auth.ts 748–768행, oauth.ts 183–189행). 토큰에 nonce 클레임이 있는데 raw nonce가 없으면 mismatch로 거절(원 지적 대비 개선점). `jti` 재생 기록은 미구현.
- iOS 앱이 미운영(CI 제외)이라 실위험 낮음. iOS 운영 개시 전 nonce 필수화 + 재생 방어 재검토.

---

## 권장 (안전하지만 범위 있음)

### F8. TTS/바우처 일일한도 TOCTOU
- **2026-07-15 상태: 무효(대상 코드 소멸)** — 일일 TTS 한도 자체가 폐지됨(마이그레이션 **#50** `drop-daily-tts-limit-columns`: `daily_tts_count`/`daily_tts_reset_at` 컬럼 DROP). TOCTOU 대상이던 읽기→생성→증가 경로가 존재하지 않음.
- 대체 미터링(직접 입력 월 한도, `src/lib/manual-tts-quota.ts`)은 원 제안과 같은 **원자적 예약 패턴**으로 구현됨: `INSERT ... ON CONFLICT DO UPDATE ... WHERE used_count < ? RETURNING`(단일 왕복, 경합 안전) + 생성 실패 시 refund.

### F9. bodyLimit는 Content-Length만 검사
- **2026-07-15 상태: 유지** — `src/middleware/bodyLimit.ts` 그대로(25MB, `content-length` 헤더만 검사). chunked 업로드(`Content-Length` 부재)는 검사를 건너뜀. `voice-upload`는 파싱 후 바이트 재검사(`MAX_UPLOAD_BYTES`)가 있으나 JSON 라우트는 무방비. 스트림 읽으며 한도 적용 또는 본문 있는 메서드에서 `Content-Length` 부재 거절 권장(그대로 유효).

### F10. 엔타이틀먼트 fail-open
- **2026-07-15 상태: 사실상 해소(잔존 데드코드 정리 권장)** — auth 미들웨어가 구조적으로 fail-closed가 됨: 사용자 행 해석 실패 시 요청을 503 `ACCOUNT_STATUS_UNVERIFIED`로 거부하고(`src/middleware/auth.ts` 144–157행), 통과 시 `userIdPK`를 **항상** 설정(112행, 미존재 시 행 생성 후 sub 사용). 따라서 보호 라우트에서 `userIdPK`가 비는 경우는 도달 불가.
- 잔여: `!resolvedUserPk → 유료 허용` 폴백 분기가 데드코드로 남아 있음(`voice-upload.ts` `hasPaidVoiceAccess`의 `if (!resolvedUserPk) return true`, `tts.ts`·`alarm-mutation.ts`의 `!resolvedUserPk || ... || isPaidVoicePlan(...)`). 미들웨어 불변식이 깨지면 다시 fail-open이 되므로, 방어적으로 fail-closed로 뒤집는 정리 권장.

### F11. `/voice/diarize` 유료검사 전 본문 버퍼링
- **2026-07-15 상태: 소멸** — `/voice/diarize` 라우트 자체가 코드베이스에서 제거됨(`src`에 diarize 참조 없음). 참고로 현존 `/voice/upload`는 유료/동의 검사를 **`arrayBuffer()` 읽기 전에** 수행한다.

### F12. isolate-단위 in-memory 상태
- **2026-07-15 상태: 유지** — `src/middleware/rateLimit.ts`의 `store`(Map)와 `src/lib/r2-storage.ts`의 `Date.now()_counter` 오브젝트 키 모두 그대로. rateLimit 파일 헤더에 한계가 문서화돼 있음("여러 isolate에 분산되면 실제 한도는 isolate 수만큼 느슨"). 엄격한 전역 한도가 필요해지면 Durable Objects/KV, R2 키는 `crypto.randomUUID()` 권장(그대로 유효).

### F13. `/api/init-db` 비프로덕션 무인증 + 에러메시지 노출
- **2026-07-15 상태: ✅ 수정** — **모든 환경**에서 `x-init-db-secret` 헤더를 요구하고, 시크릿 미설정(의도적 비활성) 시 무조건 404. 비교는 상수시간(`timingSafeEqualStr`)으로 타이밍 오라클 차단. 에러는 서버 로깅만 하고 클라이언트엔 generic `DB init failed`만 반환(`src/index.ts` 92–140행). `/api/admin/seed-stock-clips`도 동일 게이트.
- 잔여(무해): `fromId/toId`는 `Number()` 캐스팅만 하고 정수 검증은 없으나, NaN이면 마이그레이션 범위 비교가 전부 불성립해 no-op.

---

## 검증된 비이슈(non-issue)
- SQL은 일관되게 파라미터 바인딩. `alarm-mutation` PATCH의 동적 컬럼은 **고정 allowlist** 조합이라 주입 불가.
- `voucher_redemptions UNIQUE(voucher_id,user_id)`로 동일 사용자 중복 사용 DB 레벨 차단.
- 스케줄러 `repeat_days` JSON 파싱은 try/catch + 정수 필터로 가드됨.
- Apple JWKS 검증은 RS256 + kid 강제, 미스 시 재조회로 견고.
