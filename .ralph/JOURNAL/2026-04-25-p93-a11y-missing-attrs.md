# P93 — 모바일 접근성 누락 속성 보강

## 선택한 항목
BACKLOG 잔여 항목 없음 (모두 blocked/manual). Section 4에 따라 "앱 접근성 강화" 선택.

## 접근
전체 앱 화면(`app/` + `src/components/`)에 대해 접근성 감사를 실행.
- TouchableOpacity/Pressable에 `accessibilityRole`, `accessibilityLabel` 누락 여부 검사
- TextInput에 `accessibilityLabel` 누락 여부 검사

### 발견한 문제
1. **`app/message/[id].tsx`** — 5개 TouchableOpacity 버튼에 accessibilityRole + accessibilityLabel 완전 누락
   - voiceBadge (음성 프로필 이동)
   - playButton (재생/정지)
   - alarmButton (알람으로 설정)
   - translateButton (번역)
   - giftButton (새 메시지 만들기)
2. **`app/people/index.tsx`** — TextInput(친구 추가 이메일 입력)에 accessibilityLabel 누락

### 수정 내역
- 기존 i18n 키(`messageDetail.voice`, `messageDetail.play`/`stop`, `messageDetail.useForAlarm`, `messageDetail.translate`, `messageDetail.createAnother`, `friends.addPlaceholder`)를 활용하여 새 i18n 키 추가 없이 해결

## 변경 파일 (2개)
1. `apps/mobile/app/message/[id].tsx` — 5개 버튼에 accessibilityRole="button" + accessibilityLabel 추가
2. `apps/mobile/app/people/index.tsx` — TextInput에 accessibilityLabel 추가

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 신규 i18n 키 불필요 (기존 키 재활용)

## 다음 루프 참고
- 나머지 앱 화면은 접근성 속성 완비 상태
- Tab 아이콘은 Expo Router의 `title` 옵션이 자동으로 accessibilityLabel을 부여하므로 별도 처리 불필요
