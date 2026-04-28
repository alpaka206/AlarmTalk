# P80 — 모바일 error_code 처리 시스템

## 선택한 항목
BACKLOG 고갈 → 백엔드-모바일 계약 감사 → P68-P71에서 추가한 164+ error_code가 모바일에서 전혀 사용되지 않는 갭 발견.

## 접근
1. 백엔드 전체 라우트에서 사용 중인 error_code를 수집 (80+ 고유 코드)
2. 사용자에게 의미 있는 비즈니스 로직 에러 40개를 선별하여 i18n 키 매핑
3. ApiError 클래스 확장으로 기존 코드에 대한 하위 호환성 유지
4. 화면별 통합은 별도 후속 작업으로 분리 (이번은 인프라만)

### 대안: 화면별 통합까지 한번에
한 iteration에 화면 수정까지 하면 변경 범위가 너무 커짐. 인프라 계층만 먼저 놓는 것이 "작게, 완성된 단위" 원칙에 부합.

## 변경 파일 (4개)
1. `apps/mobile/src/services/api/core.ts` — ApiError에 `errorCode: string | null` 필드 추가
2. `apps/mobile/src/lib/apiErrors.ts` — 신규: error_code → i18n 매핑 유틸 (getApiErrorMessage, getErrorCode)
3. `apps/mobile/src/i18n/ko.json` — `apiError.*` 46키 추가
4. `apps/mobile/src/i18n/en.json` — `apiError.*` 46키 추가
5. `apps/mobile/test/apiErrors.test.ts` — 신규: 33 tests

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 테스트: mobile 658/658 통과 (625 → 658, +33)
- 기존 apiCore.test.ts 22/22 통과 (ApiError 하위 호환 확인)

## 다음 루프 참고
- 화면에서 실제로 `getApiErrorMessage(err, t)`를 호출하는 통합 작업이 필요
- 주요 대상: 알람 생성, 음성 관리, 코드 등록, 친구 요청 화면의 catch 블록
- 현재 대부분의 화면은 `Alert.alert('오류', error.message)` 또는 Toast로 generic 에러 표시 → error_code 기반 메시지로 교체 가능
