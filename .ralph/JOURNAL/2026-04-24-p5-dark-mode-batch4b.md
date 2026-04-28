# P5: 다크모드 스택 화면 마이그레이션 Batch 4-B (최종)

## 작업 항목
BACKLOG P5 — 다크모드 Batch 4-B: 나머지 스택 화면 6개 `Colors.light` → `useTheme()` + `createStyles(colors)` 전환

## 접근 방식
Batch 4-A 패턴 동일 적용 + 2가지 특수 케이스 처리.

### 특수 케이스
1. **onboarding.tsx (모듈 스코프 상수)**: `ONBOARDING_PAGES` 배열이 모듈 스코프에서 `Colors.light.background/surfaceVariant`를 참조. 컴포넌트 내부로 이동 후 `useMemo()`로 감싸서 `colors` 변수 사용. `useState` import에 `useMemo` 추가.

2. **player.tsx (WaveformBar 서브 컴포넌트)**: 모듈 스코프의 `WaveformBar` 함수 컴포넌트가 inline `Colors.light.primary/primaryLight`와 `styles.waveformBar` 참조.
   - `useTheme()` 훅을 WaveformBar 내부에 추가하여 `colors` 접근
   - `styles.waveformBar` (색상 무관, 구조적 스타일만)를 인라인 `{ width, borderRadius }` 로 교체하여 스코프 문제 해결
   - `getBackgroundColor()`의 `Colors.light.background` 폴백은 컴포넌트 내 `colors.background`로 자연 전환

## 변경 파일 (6개)
1. `apps/mobile/app/voice/record.tsx` — 21개 참조 제거
2. `apps/mobile/app/voice/picker.tsx` — 19개 참조 제거 (import 순서 상이: `BorderRadius, Colors, ...`)
3. `apps/mobile/app/message/[id].tsx` — 18개 참조 제거
4. `apps/mobile/app/onboarding.tsx` — 12개 참조 제거 (모듈 상수 → useMemo 이동)
5. `apps/mobile/app/voice/upload.tsx` — 12개 참조 제거
6. `apps/mobile/app/player.tsx` — 11개 참조 제거 (WaveformBar useTheme + 인라인 스타일)

## 검증
- Mobile typecheck: ✅ 통과
- Backend typecheck: ✅ 통과
- **전체 모바일 앱 `Colors.light` 참조: 0개** — 다크모드 마이그레이션 완료

## 다크모드 마이그레이션 전체 요약
| 배치 | 대상 | 파일 수 | 참조 수 |
|------|------|---------|---------|
| 인프라 | ThemeColorScheme, useTheme, Settings 토글 | 3 | - |
| Batch 1 | 탭 화면 5개 | 5 | ~110 |
| Batch 2 | 스택 화면 4개 | 4 | ~135 |
| Batch 3 | 공용 컴포넌트 9개 | 9 | ~47 |
| Batch 4-A | 큰 스택 화면 6개 | 6 | ~176 |
| Batch 4-B | 나머지 스택 화면 6개 | 6 | ~93 |
| **합계** | | **33+** | **~561** |

## 다음 작업
P5 나머지 항목: 커플 뷰 개선, 카드 스타일 일관성, 알람 시간 설정 UI, 접근성 점검
