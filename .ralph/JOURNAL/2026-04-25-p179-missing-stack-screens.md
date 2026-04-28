# P179 — 누락된 Stack.Screen 등록 + i18n 키 추가

## 선택한 항목
BACKLOG 미완료 항목 모두 blocked/manual. Section 4에 따라 코드 품질 감사 수행 후 발견된 네비게이션 갭 수정.

## 문제
`voice/picker.tsx`와 `friend/[id].tsx` 2개 화면이 `app/_layout.tsx`에 `Stack.Screen` 등록이 누락되어 있었다. Expo Router는 파일 기반 라우팅이므로 화면 자체는 작동하지만, 헤더 타이틀이 파일 이름으로 표시되고 presentation 스타일도 기본값으로 적용되는 문제가 있었다.

## 작업 내역

### 1. Stack.Screen 등록 추가 (app/_layout.tsx)
- `voice/picker`: headerShown=true, presentation=modal, title=screen.speakerPicker
- `friend/[id]`: headerShown=true, title=screen.friendProfile

### 2. i18n 키 추가 (ko.json + en.json)
- `screen.speakerPicker`: "화자 선택" / "Speaker Selection"
- `screen.friendProfile`: "친구 프로필" / "Friend Profile"

### 3. friend/[id].tsx 중복 UI 제거
- Stack 헤더가 뒤로가기 버튼을 제공하므로 커스텀 back 버튼 제거
- SafeAreaView → View 전환 (Stack 헤더가 safe area 처리)
- 미사용 스타일(backButton, backText) 제거
- SafeAreaView import 제거

## 변경 파일 (4개)
1. `apps/mobile/app/_layout.tsx` — Stack.Screen 2개 추가
2. `apps/mobile/app/friend/[id].tsx` — SafeAreaView→View, 커스텀 back 버튼 제거
3. `apps/mobile/src/i18n/ko.json` — screen.speakerPicker, screen.friendProfile 키 추가
4. `apps/mobile/src/i18n/en.json` — 동일

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- friendProfile + i18nKeys 테스트: 55/55 통과
- `common.back` i18n 키는 이제 코드에서 미참조 상태 (향후 정리 후보)

## 다음 루프 참고
- `common.back` i18n 키가 코드에서 미사용 상태. i18n key validation 테스트가 "코드→키" 방향만 검증하므로 (키→코드 역방향 미검증) 테스트는 통과하지만, 불필요한 키 정리 대상.
- voice/picker.tsx의 인라인 title+desc 섹션은 Stack 헤더와 약간 중복되지만, description 텍스트가 있어 의도적으로 유지.
