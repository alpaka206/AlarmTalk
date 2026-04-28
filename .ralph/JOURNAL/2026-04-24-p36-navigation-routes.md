# P36: 네비게이션 라우트 유효성 검증 테스트

**날짜**: 2026-04-24
**BACKLOG 항목**: 자가 생성 — 네비게이션 라우트 유효성 검증

## 접근

BACKLOG 자가 생성 풀 잔여 항목(API 벤치마크, 번들 사이즈)이 모두 런타임 환경 의존적이므로 대안으로 선택. Expo Router의 file-system routing 기반으로 router.push() 대상과 실제 라우트 파일 간 정합성을 정적 분석.

## 생성 파일

| 파일 | 내용 |
|------|------|
| `test/navigationRoutes.test.ts` | 10 tests — 라우트 매핑, 도달성, 동적 파라미터, Stack.Screen, deepLink |

## 추가 수정

| 파일 | 변경 |
|------|------|
| `voice/record.tsx` | `_LEVEL_BAR_COUNT` 미사용 상수 삭제 |
| `NotificationBell.tsx` | `FontSize` 미사용 import 삭제 |

## 발견 사항

- `/voice/diarize`: Stack.Screen 등록되어 있으나 router.push()로 직접 네비게이션하는 곳 없음. 현재는 도달 불가능한 화면 → `allowedUnreachable`에 추가. 추후 음성 업로드/녹음 플로우에서 연결 필요.
- `/voice/picker`: 동일 — 도달 불가능한 화면.
- `/(tabs)` 그룹 네비게이션: `router.replace('/(tabs)')`는 Expo Router의 유효한 패턴이므로 그룹 프리픽스로 처리.

## 검증

- mobile typecheck: 0 errors (--noUnusedLocals --noUnusedParameters 포함)
- backend typecheck: 0 errors
- mobile tests: 392/392 (기존 382 + P36 10)
- backend tests: 653/653

## 다음 루프

BACKLOG 자가 생성 풀 소진. 새 항목 생성 필요 — 네비게이션 도달 불가 화면 연결 작업이 자연스러운 다음 단계.
