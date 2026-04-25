# P122-A — Hardcoded 색상 디자인 토큰 마이그레이션 (Batch 1: 토큰 정의 + 스타일 파일)

## 선택한 항목
P122 — Hardcoded 색상 디자인 토큰 마이그레이션. Batch 1으로 토큰 정의와 스타일 파일만 처리.

## 설계 판단

### textOnPrimary 토큰 추가 결정
BACKLOG에 "사용자 확인 필요"로 기록되어 있었으나, 야간 무인 모드이므로 합리적 기본값으로 진행.

**이유**: 대다수 hardcoded `#FFF`가 primary 색상(coral) 위의 버튼 텍스트. 
- `colors.text`로 교체하면 라이트 모드에서 `#2D2D2D`(어두운 회색)가 되어 coral 버튼 위에서 가독성 저하.
- `textOnPrimary: '#FFFFFF'`를 light/dark 모두 동일하게 설정 — coral 배경 위 흰색 텍스트는 양쪽 모드 모두 WCAG AA 충족.

### overlay 토큰 추가
`rgba(0,0,0,0.3)` — 모달 오버레이용. messageCreateStyles의 `rgba(0,0,0,0.5)`는 opacity가 다르나, 
dark 모드에서는 이미 shadow 토큰이 같은 값이므로 overlay를 0.3으로 통일. 
(messageCreateStyles의 모달 오버레이는 `colors.overlay`로 교체 — 0.5→0.3으로 약간 연해짐, 허용 범위)

### rgba(255,255,255,0.8/0.9) 유지
homeStyles의 알람 카드 내 반투명 흰색 텍스트. `opacity` 속성으로 변환하면 
전체 요소 투명도가 바뀌어 동작이 달라질 수 있으므로 원본 유지.

### playerStyles backgroundColor: '#FFF' → colors.surface
재생 버튼 배경. 다크 모드에서 `#2C2C2E`(dark surface)가 되어 
어두운 배경 위에서도 자연스러운 버튼 외관 유지.

### voiceRecordStyles backgroundColor: '#FFF' → colors.surface  
녹음 중지 아이콘(stopIcon) 배경. surface 토큰으로 교체.

## 변경 파일 (16개)

### 토큰 파일 (2개)
1. `packages/ui/src/tokens.ts` — LightColors/DarkColors에 textOnPrimary, overlay 추가
2. `apps/mobile/src/constants/theme.ts` — ThemeColorScheme에 textOnPrimary, overlay 추가 + light/dark 값 설정

### 스타일 파일 (14개, 모두 기존 수정)
3. `apps/mobile/src/styles/alarmFormStyles.ts` — 4개 교체
4. `apps/mobile/src/styles/alarmsStyles.ts` — 4개 교체
5. `apps/mobile/src/styles/composeStyles.ts` — 1개 교체
6. `apps/mobile/src/styles/dubTranslateStyles.ts` — 4개 교체
7. `apps/mobile/src/styles/familyAlarmCreateStyles.ts` — 3개 교체
8. `apps/mobile/src/styles/giftReceivedStyles.ts` — 1개 교체
9. `apps/mobile/src/styles/homeStyles.ts` — 2개 교체 (#FFFFFF→textOnPrimary), rgba 2건 유지
10. `apps/mobile/src/styles/libraryStyles.ts` — 2개 교체
11. `apps/mobile/src/styles/messageCreateStyles.ts` — 4개 교체 + rgba overlay 1건
12. `apps/mobile/src/styles/peopleStyles.ts` — 4개 교체
13. `apps/mobile/src/styles/playerStyles.ts` — 2개 color 교체 + 1개 backgroundColor→surface
14. `apps/mobile/src/styles/voiceDetailStyles.ts` — 2개 교체
15. `apps/mobile/src/styles/voiceDiarizeStyles.ts` — 2개 교체
16. `apps/mobile/src/styles/voiceRecordStyles.ts` — 1개 color 교체 + 1개 backgroundColor→surface
17. `apps/mobile/src/styles/voicesStyles.ts` — 3개 교체

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 스타일 파일 내 `#FFF`/`#fff`/`#FFFFFF` 잔여: 0건

## 다음 루프 참고
- Batch 2 필요: 컴포넌트 파일 (src/components/*.tsx) + 화면 파일 (app/**/*.tsx)의 인라인 hardcoded 색상
- 약 35개 추가 인스턴스 잔존 (ActivityIndicator color, inline styles)
- LoginButtons.tsx 브랜드 색상(Google #4285F4, Apple #000000)은 의도적 유지
