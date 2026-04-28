# P133 — i18n 키 검증 테스트 + 누락 번역 키 수정

## 선택한 항목
BACKLOG 미완료 항목 모두 manual/blocked. Section 4에 따라 "TypeScript 엄격 모드 강화" 카테고리의 일환으로 i18n 키 정합성 검증 선택.

## 작업 내역

### 1. i18nKeys.test.ts (14 tests)

**i18n — locale parity (6 tests)**
- ko.json / en.json 최상위 네임스페이스 일치 검증
- 양방향 키 존재 검증 (ko→en, en→ko)
- 리프 키 개수 일치
- 빈 문자열 값 탐지 (ko, en 각각)

**i18n — interpolation parity (1 test)**
- `{{variable}}` 보간 변수가 양쪽 locale에서 동일한지 검증

**i18n — key usage validation (4 tests)**
- 소스 코드의 모든 `t('key')` 호출이 ko.json에 존재하는지
- 소스 코드의 모든 `t('key')` 호출이 en.json에 존재하는지
- 최소 200개 이상의 고유 키가 사용되는지 (현재 ~350+)
- 4단계 이상 중첩 키 금지

**i18n — value quality (3 tests)**
- ko 값이 실수로 영어로 남아있는 경우 탐지
- HTML 태그 포함 값 금지
- 배열 값(sentences 등) 길이 일치 검증

### 2. 발견된 버그: `common.close` 누락
- `ProfileDropdown.tsx:107`에서 `t('common.close')` 사용
- ko.json / en.json 모두 해당 키 없음 → 폴백으로 키 문자열 그대로 표시되는 상태
- **수정**: ko.json에 `"close": "닫기"`, en.json에 `"close": "Close"` 추가

## 변경 파일 (3개)
1. `apps/mobile/test/i18nKeys.test.ts` (신규 — 14 tests)
2. `apps/mobile/src/i18n/ko.json` (common.close 추가)
3. `apps/mobile/src/i18n/en.json` (common.close 추가)

## 검증
- 신규 테스트: 14/14 통과
- typecheck: backend 0 errors, mobile 0 errors
- 기존 테스트 영향 없음

## 다음 루프 참고
- i18n 검증이 CI에서도 자동 실행됨 — 앞으로 번역 키 누락 시 바로 탐지
- 동적 키(`t(variable)`, 템플릿 리터럴)는 정적 분석 한계로 검증 불가 — 수동 점검 필요
- 앱 아이콘 + 스플래시는 이미 커스텀 디자인 완료 상태 → BACKLOG 체크 가능
