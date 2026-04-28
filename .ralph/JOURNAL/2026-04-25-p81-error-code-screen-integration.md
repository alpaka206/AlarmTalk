# P81 — error_code 화면 통합 (getApiErrorMessage 마이그레이션)

## 선택한 항목
BACKLOG 고갈 → P80에서 만든 error_code→i18n 매핑 인프라를 실제 화면에 통합.

## 접근
P80에서 `src/lib/apiErrors.ts`에 error_code 기반 `getApiErrorMessage(error, t)`를 만들었으나, 모든 화면이 여전히 `src/types.ts`의 구버전 `getApiErrorMessage(err, fallback)` 사용 중이었음.

1. `src/lib/apiErrors.ts`에 optional `fallback` 3번째 파라미터 추가 — error_code 매칭 실패 시 컨텍스트별 폴백 메시지 유지
2. 12개 파일의 import를 `src/types` → `src/lib/apiErrors`로 전환
3. 19개 call site에서 `(err, t('key'))` → `(err, t, t('key'))` 시그니처 변경
4. 3개 추가 파일(picker, voice/[id], EmailPasswordForm)의 raw catch 블록도 새 유틸로 전환
5. `src/types.ts`에서 구버전 함수 삭제
6. 4개 신규 테스트 (fallback 동작 검증)

### 대안: 폴백 없이 error_code만 사용
error_code가 없는 에러(네트워크 오류 등)에서 "알 수 없는 오류"만 표시되어 UX 저하. 3번째 파라미터로 컨텍스트별 폴백을 유지하는 것이 안전함.

### LoginButtons.tsx 스킵 이유
OAuth/로컬 인증 에러는 백엔드 API 에러가 아니므로 getApiErrorMessage 적용 대상 아님.

## 변경 파일 (16개)
1. `src/lib/apiErrors.ts` — fallback 파라미터 추가
2. `src/types.ts` — 구버전 getApiErrorMessage 삭제
3. `app/(tabs)/alarms.tsx` — import 전환 + 2 call site
4. `app/(tabs)/voices.tsx` — import 전환 + 1 call site
5. `app/alarm/create.tsx` — import 전환 + 2 call site
6. `app/alarm/edit.tsx` — import 전환 + 1 call site
7. `app/dub/translate.tsx` — import 전환 + 1 call site
8. `app/gift/received.tsx` — import 전환 + 2 call site
9. `app/library/index.tsx` — import 전환 + 1 call site
10. `app/message/create.tsx` — import 전환 + 2 call site
11. `app/people/index.tsx` — import 전환 + 2 call site
12. `app/voice/diarize.tsx` — import 전환 + 2 call site
13. `app/voice/upload.tsx` — import 전환 + 1 call site
14. `app/voice/record.tsx` — import 전환 + 1 call site
15. `app/voice/picker.tsx` — 신규 import + 2 raw catch → getApiErrorMessage
16. `app/voice/[id].tsx` — 신규 import + 1 raw catch → getApiErrorMessage
17. `src/components/EmailPasswordForm.tsx` — 신규 import + 1 raw catch → getApiErrorMessage
18. `test/apiErrors.test.ts` — 4 신규 테스트

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 테스트: mobile 662/662 통과 (658 → 662, +4)

## 다음 루프 참고
- `src/types.ts`의 `getApiErrorMessage`는 완전 제거됨 — 어디서도 import하지 않음
- LoginButtons.tsx의 OAuth 에러는 별도 처리 유지 (백엔드 API 에러 아님)
- 화면별 error_code 활용은 완료 — 백엔드가 error_code를 반환하면 i18n 메시지로 자동 표시
- family-alarm/create.tsx, character/index.tsx 등 일부 화면은 이미 toast 패턴이지만 getApiErrorMessage를 사용하지 않을 수 있음 → 확인 필요
