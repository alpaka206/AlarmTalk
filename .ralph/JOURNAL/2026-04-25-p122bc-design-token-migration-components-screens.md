# P122-B/C — Hardcoded 색상 디자인 토큰 마이그레이션 (Batch 2: 컴포넌트 + Batch 3: 화면)

## 선택한 항목
P122 Batch 2 (컴포넌트 파일) + Batch 3 (화면 파일) — 한 iteration에 모두 처리.

## 설계 판단

### 모든 #FFF/#fff/#FFFFFF → colors.textOnPrimary
컴포넌트와 화면 파일의 hardcoded 흰색은 모두 primary(coral) 버튼 위 텍스트 또는 ActivityIndicator 색상.
`colors.textOnPrimary` (#FFFFFF, light/dark 동일)로 교체.

### LoginButtons.tsx 브랜드 색상 유지
Google (#FFFFFF bg, #4285F4, #3C4043, #DADCE0) 및 Apple (#000000, #FFFFFF) — OAuth 가이드라인에 따라 테마 독립적 유지.
이 파일은 `useTheme` 미사용이므로 동적 스타일 전환 불필요.

### ProfileDropdown.tsx rgba(0,0,0,0.3) → colors.overlay
Batch 1에서 정의한 overlay 토큰 활용. `shadowColor: '#000'`은 RN 표준 패턴이므로 유지.

### voice/picker.tsx 에러 색상 교체
`#F87171` (border) → `colors.error`, `#B91C1C` (text) → `colors.error`
비표준 에러 색상을 테마 토큰으로 통일. 다크모드에서 자동 적용됨.

### note/create.tsx 3건 (BACKLOG 원래 2건 기록 → 실제 3건)
ActivityIndicator + chipAvatarTextSelected + sendButtonText 모두 교체.

## 변경 파일 (23개)

### Batch 2: 컴포넌트 (10개)
1. EmailPasswordForm.tsx — ActivityIndicator + submitText (2건)
2. ErrorBoundary.tsx — retryText (1건)
3. NotificationBell.tsx — badgeText (1건)
4. OfflineBanner.tsx — text (1건)
5. PresetMessageSection.tsx — ActivityIndicator + categoryLabelActive + presetGenerateText (3건)
6. QueryStateView.tsx — retryText (1건)
7. StateView.tsx — actionText (1건)
8. Toast.tsx — toastText (1건)
9. CoupleView.tsx — avatarText + alarmBtnText (2건)
10. ProfileDropdown.tsx — backdrop overlay (1건)

### Batch 3: 화면 (12개)
11. code-register/index.tsx — ActivityIndicator + registerButtonText (2건)
12. alarm/edit.tsx — ActivityIndicator + saveText (2건)
13. alarm/create.tsx — ActivityIndicator + targetTextActive + emptyMessageBtnText + createText (4건)
14. note/create.tsx — ActivityIndicator + chipAvatarTextSelected + sendButtonText (3건)
15. friend/[id].tsx — actionButtonText (1건)
16. voice/upload.tsx — ActivityIndicator + submitText (2건)
17. voice/picker.tsx — primaryText + errorCard borderColor + errorText (3건)
18. voice/record.tsx — ActivityIndicator (1건)
19. voice/diarize.tsx — 2x ActivityIndicator (2건)
20. message/create.tsx — ActivityIndicator (1건)
21. message/[id].tsx — playButtonText (1건)
22. dub/translate.tsx — ActivityIndicator (1건)

### 미변경 (의도적)
- LoginButtons.tsx — 브랜드 색상 (Google/Apple) 유지
- ProfileDropdown.tsx shadowColor: '#000' — RN 표준 shadow 패턴

## P123 — 접근성 누락 보완 (같은 iteration)
- EmailPasswordForm.tsx 로그인/회원가입 탭에 `accessibilityLabel` 추가
- 전체 앱 TouchableOpacity/Pressable 149개 중 accessibilityLabel 190개 — 잔여 누락 없음 확인

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 스타일 파일 내 hardcoded 흰색: 0건 잔여
- 컴포넌트 파일 내 hardcoded 흰색: LoginButtons 3건만 잔여 (의도적)
- 화면 파일 내 hardcoded 흰색: 0건 잔여 (player.tsx #FFF0E6는 피치 색상, 다른 용도)

## 다음 루프 참고
- P122 완료. BACKLOG에서 다음 항목 선택.
- player.tsx의 gradient 팔레트 (#FFF0E6, #FFD9C4 등)는 시간대별 배경 그라데이션용으로 의도적 유지.
