# R3: 코드 등록 시스템

**날짜**: 2026-04-24
**BACKLOG 항목**: R3 (코드 등록 시스템 — "받은 선물" → "코드 등록" 변환)

## 접근

기존에 분리되어 있던 이용권 코드(POST /billing/redeem)와 가족 초대 코드(POST /family/invites/:code/accept)를 하나의 통합 엔드포인트로 묶었다.

### 설계 결정

**통합 엔드포인트 방식 선택**: 프론트에서 코드 형식 판별 후 두 API를 분기 호출하는 대신, 백엔드에 `POST /code/register` 통합 엔드포인트를 만들었다.
- 이유: BACKLOG 스펙이 "코드 타입 판별 (백엔드)"를 명시
- 기존 `/billing/redeem`과 `/family/invites/:code/accept`는 그대로 유지 (하위 호환)
- 로직 중복이 발생하지만, 통합 엔드포인트는 프론트에게 단일 인터페이스를 제공하는 가치가 있음

**gift/received.tsx 보존**: BACKLOG에는 "리네임"으로 되어 있지만, gift 시스템(선물 수신/수락)과 code 등록은 완전히 다른 기능이므로 별도 화면으로 분리. gift/received는 그대로 유지하여 기존 기능 보존.

### 백엔드 변경

1. `routes/code.ts` 신규 — `POST /code/register` 통합 엔드포인트
   - VA-XXXX-XXXX-XXXX 형식 → voucher 로직 (subscription 생성 + user plan 업데이트)
   - 6자리 숫자 → invite 로직 (plan_group_members 가입 + invite 사용 처리)
   - 에러 코드 통일: CODE_REQUIRED, CODE_NOT_FOUND, CODE_ALREADY_USED, CODE_EXPIRED, CODE_REVOKED, SELF_ISSUED, ALREADY_MEMBER, GROUP_FULL, INVALID_FORMAT
2. `index.ts` — `api.route('/code', codeRoutes)` 등록

### 프론트엔드 변경

1. `api.ts` — `registerCode()` 함수 + `CodeRegisterResult` 타입 (voucher/invite 유니온)
2. `app/code-register/index.tsx` 신규 — 코드 등록 화면
   - 단일 텍스트 입력 + 자동 코드 타입 감지 뱃지
   - useMutation으로 등록 + 성공/에러 상태
   - 코드 종류 안내 도움말 카드
   - 다크모드 + 접근성 라벨
3. `ProfileDropdown.tsx` — 라우트 `/gift/received` → `/code-register` 변경
4. `_layout.tsx` — `code-register/index` Stack.Screen 추가

### i18n

ko/en 각 18키 추가: `codeRegister.*` (title, subtitle, inputLabel, placeholder, register, typeVoucher, typeInvite, voucherSuccess, inviteSuccess, voucherSuccessDetail, inviteSuccessDetail, unknownError, helpTitle, helpVoucherTitle, helpVoucherDesc, helpInviteTitle, helpInviteDesc)

## 변경 파일

| 파일 | 변경 |
|------|------|
| `packages/backend/src/routes/code.ts` | 신규: 통합 코드 등록 엔드포인트 |
| `packages/backend/src/index.ts` | codeRoutes import + route 등록 |
| `apps/mobile/src/services/api.ts` | registerCode, CodeRegisterResult 타입 |
| `apps/mobile/app/code-register/index.tsx` | 신규: 코드 등록 화면 |
| `apps/mobile/src/components/ProfileDropdown.tsx` | 라우트 변경 |
| `apps/mobile/app/_layout.tsx` | code-register Stack.Screen 추가 |
| `apps/mobile/src/i18n/ko.json` | codeRegister.* 18키 |
| `apps/mobile/src/i18n/en.json` | 동일 |

## 검증

- backend `npx tsc --noEmit` — 0 errors
- mobile `npx tsc --noEmit` — 0 errors

## 다음 루프 주의사항

- R4 (메시지 작성 탭)가 다음 우선순위
- gift/received.tsx는 아직 존재함 — R5 정비에서 필요 여부 판단 후 정리
- 코드 등록 성공 시 useAppStore의 plan 상태가 자동 갱신되지 않음 — userProfile 쿼리 invalidation은 했으나, zustand store의 plan은 별도 갱신 필요할 수 있음
