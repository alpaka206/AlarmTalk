# P16: 모바일 유틸 테스트 커버리지 확장 (Batch 2)

**날짜**: 2026-04-24
**BACKLOG 항목**: 자가 생성 — 모바일 유틸/서비스 테스트 커버리지 확장

## 접근

P10에서 `formatLastSeen`과 `offlineCache` 테스트를 추가했으나 (30 tests), 여전히 순수 로직 모듈 3개가 미테스트 상태였다. 전체 모바일 테스트 커버리지 분석 후 testable한 pure-function 모듈을 선별하여 테스트 추가.

## 변경 파일

| 파일 | 변경 | 테스트 수 |
|------|------|-----------|
| `test/authFormValidation.test.ts` (신규) | login/register 모드별 validation 엣지케이스 | 14 tests |
| `test/waveform.test.ts` (신규) | generateWaveform 결정론성/범위 + formatTime 엣지케이스 | 15 tests |
| `test/presets.test.ts` (신규) | PRESET_CATEGORIES 무결성 + getCategoryLabel + DAYS_OF_WEEK | 9 tests |

## 테스트 상세

### authFormValidation (14 tests)
- login: 유효 입력, 빈 이메일, 공백 이메일, 빈 비밀번호, name 비워도 통과, 짧은 비밀번호 통과
- register: 유효 입력, 빈 name, 공백 name, 8자 미만 비밀번호, 정확히 8자, 빈 이메일, 빈 비밀번호

### waveform (15 tests)
- generateWaveform: barCount 정확성, 0~1 범위, 0.15 최소값, 결정론적, 다른 seed→다른 결과, 빈 seed, 한글 seed
- formatTime: 0ms, 1초, 59초, 1분, 1분30초, 61분1초, 소수점 버림, 0패딩

### presets (9 tests)
- PRESET_CATEGORIES: 8개, 필드 존재, 고유 key, 빈 메시지 없음, 순서, i18nKey 접두어
- getCategoryLabel: t 함수 호출, 전체 카테고리 동작
- DAYS_OF_WEEK: 7일, 일요일 시작

## 검증

- mobile typecheck: 0 errors
- backend typecheck: 0 errors
- mobile tests: 206/206 (기존 168 + 신규 38)
- backend tests: 596/596

## 설계 결정

- `useAppStore`(Zustand + AsyncStorage)는 무거운 mocking이 필요하여 이번 iteration에서 제외. 다음 루프에서 진행 가능.
- hooks (useAuth, useTheme, useToast, useNetworkStatus)도 React 런타임 의존이 높아 별도 iteration으로 분리.
- 순수 함수 모듈 우선 커버: 비용 대비 효과가 가장 높은 접근.

## 다음 루프

미테스트 모듈 남은 것:
- `useAppStore.ts` (Zustand store — AsyncStorage mock 필요)
- hooks 4개 (useAuth, useTheme, useToast, useNetworkStatus — React 런타임 mock 필요)
- services 4개 (auth, api, audio, notifications — 외부 의존 mock 필요)
