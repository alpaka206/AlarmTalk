# P170 — voice-profile + push 엣지 케이스 테스트 확장

## 선택한 항목
BACKLOG P170: voice-profile 라우트 엣지 케이스 테스트 확장 + notification(push) 라우트 테스트 커버리지 추가

## 접근
기존 테스트 커버리지를 분석하여 미검증 경로를 식별:
- voice-profile: 7개 엔드포인트 × 다양한 입력 조합에서 경계값/타입/폴백 미검증 케이스 발견
- push: 2개 엔드포인트에서 비문자열 타입 입력, 경계값, SQL 패턴 미검증

### voice-profile 추가 테스트 (13개)
**GET / pagination edge cases (3)**:
- `limit=abc` → NaN → 기본값 50 폴백
- `limit=-5` → Math.max(-5,1) → 1 클램핑
- `offset=abc` → NaN → 기본값 0

**PATCH name edge cases (4)**:
- name 필드 누락 → undefined → '' → 400
- name: null → '' → 400
- name 1자 경계 → 통과
- name 앞뒤 공백 trim 후 저장 검증

**POST /clone edge cases (2)**:
- count=0 → 정상 생성
- non-Error throw → detail='Unknown error'

**DELETE force edge cases (3)**:
- force=false → !== 'true' → 409
- force=TRUE → 대소문자 구분 → 409
- force=true + elevenlabs_voice_id → 외부 삭제 + cascade 전체 경로

**GET /family edge case (1)**:
- placeholders 수 = 가족 멤버 수 검증

### push 추가 테스트 (8개)
**POST /token (6)**:
- token 숫자 → 빈 문자열 → 400
- platform null → '' → INVALID_PLATFORM
- platform boolean → '' → INVALID_PLATFORM
- 빈 JSON body → INVALID_TOKEN_LENGTH
- 500자 경계값 → 정상 등록
- ON CONFLICT upsert SQL 포함 확인

**DELETE /token (2)**:
- token 숫자 → '' → TOKEN_REQUIRED
- token trim 후 DELETE 쿼리 전달 검증

## 변경 파일
1. `packages/backend/test/voice-profile.test.ts` — 13 tests 추가 (47→60)
2. `packages/backend/test/push.test.ts` — 8 tests 추가 (14→25) + 3 edge case describe 블록
3. `README.md` — 백엔드 테스트 수 1210→1231
4. `.ralph/STATE.md` — P170 완료 기록
5. `.ralph/BACKLOG.md` — P170 체크, P171 후보 갱신

## 검증
- `vitest run test/voice-profile.test.ts` → 60 passed ✅
- `vitest run test/push.test.ts` → 25 passed ✅
- `vitest run` (전체) → 1231 passed, 58 files ✅
- `tsc --noEmit` → backend 0 errors, mobile 0 errors ✅

## 다음 루프 참고
- alarm-mutation 44개는 충분하나 통합 테스트 수준 확장 가능
- dub/translate 라우트 엣지 케이스도 후보
- Sentry/앱 아이콘은 여전히 blocked (외부 설정 필요)
