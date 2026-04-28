# P47: 모바일 번들 사이즈 모니터링 (의존성 + 소스 감사 테스트)

**날짜**: 2026-04-25
**BACKLOG 항목**: 자가 생성 풀 — "모바일 번들 사이즈 모니터링 (expo export 후 JS bundle 크기 측정 + 기준선 테스트)"

## 접근

`expo export`는 전체 빌드 환경이 필요하여 CI/무인 환경에서 불안정. 대신 **정적 감사 테스트**를 작성하여 번들 품질을 보장:
- 의존성 수 예산 (production ≤40, devDeps ≤15)
- 금지 패키지 목록 (moment, lodash, axios, firebase 등 14개)
- 미사용 의존성 감지 (import 분석)
- 소스 파일 크기 예산 (단일 파일 ≤1200줄, 전체 ≤700KB)
- barrel re-export 제한 (≤3)
- import 위생 (node_modules 직접 참조, React 중복 import)
- i18n 키 규모 검증 (300~3000 leaf keys)
- lib/ 순환 의존성 감지 (DFS cycle detection)
- 에셋 크기 검증 (폰트 <5MB, 이미지 <1MB)
- 스테일 에셋 감지

## 변경 파일 (1개)

| 파일 | 변경 내용 |
|------|----------|
| `apps/mobile/test/bundleAudit.test.ts` | 신규 — 15 tests (4 describe groups) |

## 초기 실패 → 기준선 조정

초기 실행 시 4건 실패:
1. **미사용 의존성**: `expo`, `expo-crypto`, `expo-file-system`, `react-native-reanimated`, `react-native-screens` — Expo 네이티브 플러그인으로 암묵적 사용 → allowedUnused에 추가
2. **파일 줄 수 제한 600→1200**: 8개 파일이 600줄 초과 (최대 alarm/create.tsx 1147줄) — 향후 리팩토링 대상이지만 기준선은 현실 반영
3. **전체 소스 크기 500KB→700KB**: 실측 544KB — 여유 포함 700KB로 설정
4. **i18n 키 수**: 중첩 구조라 top-level은 46개 → `countLeafKeys` 재귀 함수로 변경, 실측 732 leaf keys

## 검증

- mobile `npx tsc --noEmit` — 0 errors
- backend `npx tsc --noEmit` — 0 errors
- mobile tests — 466/466 passed (기존 451 + P47 15)
- backend tests — 672/672 passed (vitest)

## 현재 기준선 (regression guard)

| 메트릭 | 현재값 | 예산 |
|--------|--------|------|
| Production deps | 31 | ≤40 |
| DevDeps | 6 | ≤15 |
| App screens | ~25 | 10~40 |
| 최대 파일 줄 수 | 1147 | ≤1200 |
| 전체 소스 크기 | 544KB | ≤700KB |
| i18n leaf keys | 732 | 300~3000 |
| Barrel re-exports | 0 | ≤3 |
| 순환 의존성 | 0 | 0 |

## 다음 루프

자가 생성 풀 항목 전부 소진. 다음 후보:
- alarm/create.tsx 1147줄 → 컴포넌트 분할 리팩토링
- alarm/edit.tsx, index.tsx 등 대형 파일 분할
- ADR (Architecture Decision Records) 작성
