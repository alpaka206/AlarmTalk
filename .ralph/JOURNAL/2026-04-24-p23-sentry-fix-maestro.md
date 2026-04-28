# P23: Sentry 타입 안전성 수정 + Maestro E2E 테스트 플로우

**날짜**: 2026-04-24
**BACKLOG 항목**: 빌드 복구 (sentry typecheck 에러) + 자가 생성 (모바일 E2E 테스트)

## 1. Sentry 타입 안전성 수정

### 문제
P22에서 추가한 Sentry 연동 코드에서 `as never` 캐스트로 typecheck를 우회했으나, 후속 빌드에서 에러 발생:
- `c.set('sentry' as never, sentry)` — sentry.ts:19
- `c.get('sentry' as never)` — index.ts:142

### 수정
1. `types.ts` — `SentryClient` 인터페이스 추가 + `AuthVariables`에 `sentry: SentryClient` 추가
2. `sentry.ts` — `import Toucan from 'toucan-js'` → `import { Toucan } from 'toucan-js'` (named export)
3. `sentry.ts` — `c.set('sentry' as never, sentry)` → `c.set('sentry', sentry)`
4. `index.ts` — `new Hono<{ Bindings: Env }>()` → `new Hono<AppEnv>()` (Variables 타입 포함)
5. `index.ts` — `c.get('sentry' as never)` + 3줄 타입 캐스트 → `c.get('sentry')` + 1줄 호출

### 변경 파일 (3개)
| 파일 | 변경 |
|------|------|
| `packages/backend/src/types.ts` | SentryClient 인터페이스 + AuthVariables.sentry 추가 |
| `packages/backend/src/middleware/sentry.ts` | named import + as never 제거 |
| `packages/backend/src/index.ts` | AppEnv 타입 사용 + sentry 타입 캐스트 제거 |

## 2. Maestro E2E 테스트 플로우

### 생성 파일 (7개)
| 파일 | 내용 |
|------|------|
| `.maestro/config.yaml` | 실행 순서 설정 |
| `.maestro/01-onboarding.yaml` | 온보딩 4페이지 스와이프 |
| `.maestro/02-login.yaml` | 이메일/비밀번호 로그인 |
| `.maestro/03-tab-navigation.yaml` | 4탭 순환 네비게이션 |
| `.maestro/04-create-alarm.yaml` | 알람 생성 플로우 |
| `.maestro/05-voice-management.yaml` | 음성 프로필 관리 |
| `.maestro/06-profile-dropdown.yaml` | 프로필 드롭다운 + 설정 |

### 설계 결정
- Maestro 선택 이유: YAML 기반으로 설치 없이 플로우 정의 가능, Expo 지원 우수
- 한국어 UI 텍스트 기반 매칭 (accessibilityLabel 활용)
- `optional: true` 사용하여 UI 변동에 탄력적 대응
- regex 패턴으로 동적 텍스트 매칭

## 검증

- Backend typecheck: 0 errors
- Mobile typecheck: 0 errors
- Backend tests: 647/647 passed
- Maestro 플로우: 문법 검증만 (실행은 에뮬레이터 필요)

## 다음 루프

BACKLOG 업데이트. 남은 자가 생성 후보: 앱 아이콘 디자인.
