# P0 Phase 1-B: Pretendard 폰트 적용

## 집은 항목
BACKLOG P0 Phase 1-B: Pretendard 폰트 적용

## 접근
커밋 4711217은 문서(BACKLOG.md, PROMPT.md)만 업데이트한 상태 — 실제 폰트 구현은 미착수.
이번 루프에서 실제 폰트 다운로드, 로딩, 토큰 업데이트, 핵심 화면 적용을 수행.

### 대안 검토
- **전체 앱 fontWeight→fontFamily 일괄 변환**: 30개 파일, 196개 변경점 — 메가 커밋 금지 규칙에 위배. 기각.
- **Text.defaultProps 글로벌 패치**: React 19에서 deprecated. 기각.
- **커스텀 AppText 래퍼 컴포넌트**: 좋은 접근이지만 모든 Text 사용처 마이그레이션 필요. 후속 작업으로 적합.
- **fontForWeight 유틸리티 + 점진적 마이그레이션**: 채택. 핵심 화면(홈, 탭바)만 이번 루프에서 변환, 나머지는 backlog.

## 변경 파일 목록

### 신규
- `apps/mobile/assets/fonts/Pretendard-Regular.otf` — Pretendard v1.3.9
- `apps/mobile/assets/fonts/Pretendard-Medium.otf`
- `apps/mobile/assets/fonts/Pretendard-SemiBold.otf`
- `apps/mobile/assets/fonts/Pretendard-Bold.otf`

### 수정
- `apps/mobile/app/_layout.tsx` — `useFonts()` + `SplashScreen.preventAutoHideAsync()` 추가. 폰트 로드 완료까지 스플래시 유지, 로드 실패 시 시스템 폰트로 폴백(null 반환 후 splash 해제).
- `apps/mobile/app/(tabs)/_layout.tsx` — tabLabel `fontWeight:'600'` → `fontFamily: FontFamily.semibold`
- `apps/mobile/app/(tabs)/index.tsx` — 홈 화면 11개 fontWeight → fontFamily 변환 (greeting, statCount, nextAlarm, cheerTitle, sectionTitle, actionLabel 등)
- `apps/mobile/src/constants/theme.ts` — `FontFamily` 상수 + `fontForWeight()` 유틸리티 함수 추가
- `packages/ui/src/tokens.ts` — `FontFamily` 토큰에 Pretendard 변형 추가, `fontForWeight()` 함수, `FontFamilyKey` 타입 추가
- `packages/ui/src/index.ts` — `fontForWeight`, `FontFamilyKey` re-export 추가
- `apps/mobile/package.json` — `expo-font`, `expo-splash-screen` 의존성 추가
- `apps/mobile/app.json` — `expo-font` 플러그인 자동 추가됨 (expo install)

## 검증 결과
- `npx tsc --noEmit` (backend) — 통과
- `npx tsc --noEmit` (mobile) — 통과

## 다음 루프 주의사항
- **나머지 28개 파일의 fontWeight→fontFamily 마이그레이션은 미완료**. BACKLOG에 "Phase 1-B-2: 전체 앱 fontWeight 마이그레이션" 항목 추가함. 단, P0 Phase 1-C (탭 축소)가 우선순위 높으므로 1-C를 먼저 진행하라.
- `fontForWeight()` 유틸리티가 `theme.ts`와 `packages/ui/tokens.ts` 양쪽에 존재. 향후 모바일 앱이 `@voice-alarm/ui`를 의존성으로 추가하면 theme.ts의 중복을 제거 가능.
- 폰트 로드 실패 시 `fontError`가 truthy → 앱은 시스템 폰트로 폴백 (splash 숨김 후 정상 렌더링). 명시적 에러 UI 없음 — 의도적 선택.
- `expo-splash-screen`의 `preventAutoHideAsync()`는 모듈 레벨에서 호출 (컴포넌트 외부). Expo 공식 권장 패턴.
