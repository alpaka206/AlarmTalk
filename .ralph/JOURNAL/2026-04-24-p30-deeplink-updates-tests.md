# P30: deepLink + updates 테스트 커버리지

**날짜**: 2026-04-24
**BACKLOG 항목**: 자가 생성 — P28(deepLink) + P29(updates) 신규 모듈 테스트

## 접근

P28에서 만든 `deepLink.ts`와 P29에서 만든 `updates.ts`에 대한 유닛 테스트를 작성. 기존 테스트 패턴(jest mock, 직접 import)을 따른다.

## 생성 파일

| 파일 | 테스트 수 |
|------|----------|
| `test/deepLink.test.ts` | 23 (parseDeepLink 20 + createDeepLink 3) |
| `test/updates.test.ts` | 7 (__DEV__/web 가드, update flow, error handling) |

### deepLink 테스트 커버리지
- 비-voicealarm scheme 거부
- 빈 path 거부
- code 라우트 (with/without 코드)
- alarm 라우트 (create, id, 기본)
- voice 라우트 (record, upload, id, 기본)
- note 라우트 (create, id, 기본)
- message 라우트 (create, id, 기본)
- 단순 라우트 5개 (people, settings, character, library, player)
- public 라우트 (onboarding)
- 미등록 경로 fallback
- createDeepLink (params 없이, params 포함, URL 인코딩)

### updates 테스트 커버리지
- __DEV__ 모드 스킵
- web 플랫폼 스킵
- 업데이트 없음 → fetch 호출 안 됨
- 업데이트 있음 + isNew → Alert 표시
- 업데이트 있지만 isNew=false → Alert 미표시
- 네트워크 에러 → silent catch
- "지금 업데이트" 버튼 → reloadAsync 호출

## 검증

- mobile `npx jest` — 316/316 passed (기존 286 + 신규 30)
- typecheck — 0 errors

## 다음 루프

BACKLOG 자가 생성 풀이 비었으므로 섹션 4에서 새 항목 생성 필요.
