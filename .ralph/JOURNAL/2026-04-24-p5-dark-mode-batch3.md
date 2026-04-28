# P5: 다크모드 컴포넌트 마이그레이션 Batch 3

## 작업 항목
BACKLOG P5 — 다크모드 Batch 3: 공용 컴포넌트 9개 `Colors.light` → `useTheme()` + `createStyles(colors)` 전환

## 접근 방식
Batch 1-2에서 확립한 패턴을 공용 컴포넌트 9개에 동시 적용.

### 특이 케이스 처리
1. **ErrorBoundary.tsx (클래스 컴포넌트)**: React 에러 바운더리는 클래스 컴포넌트여야 하므로 훅 직접 사용 불가. 에러 UI를 `ErrorFallback` 함수형 컴포넌트로 추출하여 `useTheme` 적용, 클래스에서는 이를 렌더링하도록 변경.
2. **PeopleSkeletonCard.tsx (서브 컴포넌트)**: `SkeletonRow` 서브 컴포넌트에 `dynStyles` prop으로 전달하여 훅 중복 호출 방지.
3. **QueryStateView.tsx (다중 export)**: 3개 컴포넌트(`LoadingView`, `ErrorView`, `EmptyView`) 각각 독립적으로 `useTheme` 사용. 테마 무관 스타일은 `staticStyles`로 분리.
4. **LoginButtons.tsx**: `Colors.light` 참조 없음 (Google/Apple 브랜드 색상만 사용). 마이그레이션 불필요, 스킵.

## 변경 파일 (9개)
1. `apps/mobile/src/components/Toast.tsx` — 1개 참조 제거
2. `apps/mobile/src/components/OfflineBanner.tsx` — 1개 참조 제거
3. `apps/mobile/src/components/ErrorBoundary.tsx` — 5개 참조 제거, ErrorFallback 추출
4. `apps/mobile/src/components/FamilyMemberRow.tsx` — 11개 참조 제거
5. `apps/mobile/src/components/EmailPasswordForm.tsx` — 12개 참조 제거 (placeholderTextColor 포함)
6. `apps/mobile/src/components/PeopleSkeletonCard.tsx` — 5개 참조 제거
7. `apps/mobile/src/components/StateView.tsx` — 4개 참조 제거
8. `apps/mobile/src/components/QueryStateView.tsx` — 4개 참조 제거
9. `apps/mobile/src/components/MiniWaveformPlayer.tsx` — 4개 참조 제거 (인라인 color 포함)

## 검증
- Mobile typecheck: ✅ 통과
- Backend typecheck: ✅ 통과
- 컴포넌트 폴더 `Colors.light` 참조: 0개

## 남은 작업
P5 다크모드 Batch 4: 나머지 스택 화면 13개 (~271개 Colors.light 참조)
- family-alarm/create (25), dub/translate (30), player (11), friend/[id] (2)
- gift/received (22), onboarding (12), message/create (53), message/[id] (18)
- voice/diarize (23), voice/picker (19), voice/[id] (23), voice/record (21), voice/upload (12)
