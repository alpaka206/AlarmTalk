# P86 — notes.test.ts 테스트 커버리지 강화 + error_code 검증

## 선택한 항목
BACKLOG 고갈 → 테스트 커버리지 감사 수행: notes.ts (221줄, 4개 엔드포인트)가 24개 테스트에서 error_code 검증 누락, sendNotePush 호출 검증 미수행, sender name 폴백 미테스트, sent 엔드포인트 페이지네이션 미테스트 발견.

## 접근

### 문제 분석
1. POST /notes의 7개 에러 응답에서 `error_code` 필드 미검증
2. PATCH /notes/:id/read의 3개 에러 응답에서 `error_code` 미검증
3. `sendNotePush` 호출 여부, 인자, locale 미테스트
4. sender name → email → 'Someone' 3단계 폴백 로직 미테스트
5. GET /notes/sent 페이지네이션 파라미터 미테스트
6. 경계값 테스트 부족 (text 정확히 500자, 공백만 입력, limit 0/음수)

### 구현
1. **vi.hoisted() 도입**: `mockSendNotePush`를 vi.hoisted로 선언하여 vi.mock factory에서 참조 가능하게 함
2. **error_code 검증 추가** (기존 10개 테스트 강화):
   - POST: USER_NOT_FOUND, RECEIVER_REQUIRED, TEXT_REQUIRED, TEXT_TOO_LONG, SELF_NOTE, RECEIVER_NOT_FOUND, NOT_SAME_GROUP
   - PATCH: USER_NOT_FOUND, NOTE_NOT_FOUND, FORBIDDEN
3. **sendNotePush 검증 3건**:
   - 기본 ko locale + 올바른 인자(db, receiverId, noteId, senderName, locale)
   - Accept-Language: en → locale 'en' 전달
   - sender name null → email 폴백, name+email 모두 null → 'Someone' 폴백
4. **경계값 테스트 4건**:
   - text 정확히 500자 → 201 성공
   - receiver_id 공백만 → RECEIVER_REQUIRED
   - text 공백만 → TEXT_REQUIRED
   - limit 0 → 기본값 20 (0은 falsy)
5. **GET /notes/sent 페이지네이션 3건**:
   - limit/offset 적용 확인
   - limit max 100 클램핑
   - limit 음수 → 1 클램핑

## 변경 파일 (1개)
1. `packages/backend/test/notes.test.ts` — vi.hoisted 도입, error_code 검증 10건 강화, 신규 테스트 10건 추가

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 테스트: backend 833/833 (820 → 833, +13), mobile 662/662 (변동 없음)
