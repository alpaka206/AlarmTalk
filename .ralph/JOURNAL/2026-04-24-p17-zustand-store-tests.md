# P17: useAppStore Zustand 스토어 테스트

**날짜**: 2026-04-24
**BACKLOG 항목**: 자가 생성 — useAppStore Zustand 스토어 테스트 (AsyncStorage mock)

## 접근

BACKLOG 전 항목 완료 후 자가 생성 풀에서 "useAppStore Zustand 스토어 테스트" 선택. P16 저널에서 다음 아이템으로 추천된 항목이기도 함.

Zustand 스토어는 `useAppStore.getState()`로 React 없이 직접 테스트 가능. AsyncStorage는 in-memory mock으로 대체하여 persist 로직 검증.

## 변경 파일

| 파일 | 변경 | 테스트 수 |
|------|------|-----------|
| `test/useAppStore.test.ts` (신규) | 전체 스토어 액션 + 상태 + AsyncStorage 연동 | 32 tests |

## 테스트 상세 (32 tests)

### 초기 상태 (1)
- 모든 기본값 올바른지 검증

### setAuth (3)
- 토큰/userId 설정, AsyncStorage 저장, 덮어쓰기

### clearAuth (2)
- 상태 초기화, AsyncStorage removeItem 호출

### setPlan (4)
- free/plus/family 각각 설정

### voiceProfiles (5)
- setVoiceProfiles 전체 교체, addVoiceProfile 앞에 추가, removeVoiceProfile ID 제거, 존재하지 않는 ID/빈 배열 엣지케이스

### setPlaying (2)
- ID→isPlaying=true, null→isPlaying=false

### completeOnboarding (2)
- 플래그 설정 + AsyncStorage 저장

### incrementTtsCount (2)
- 1 증가, 여러 번 호출 누적

### setDefaultSnoozeMinutes (2)
- 분 변경 + AsyncStorage 문자열 저장

### setDarkMode (3)
- 활성화, 비활성화, true/false 문자열 저장

### loadPersistedState (6)
- 전체 복원, 기본값 폴백, 토큰만 존재, onboarding false, snooze 비정상 값(NaN), dark_mode 비정상 문자열

## 검증

- mobile typecheck: 0 errors
- backend typecheck: 0 errors
- mobile tests: 238/238 (기존 206 + 신규 32)

## 다음 루프

미테스트 모듈 남은 것:
- hooks 4개 (useAuth, useTheme, useToast, useNetworkStatus — React 런타임 mock 필요)
- services 4개 (auth, api, audio, notifications — 외부 의존 mock 필요)
