# P37: 도달 불가 음성 화면 네비게이션 연결

**날짜**: 2026-04-24
**BACKLOG 항목**: 자가 생성 — P36에서 발견한 unreachable routes 연결

## 접근

P36 네비게이션 테스트에서 `/voice/diarize`와 `/voice/picker`가 완전히 구현되어 있으나 어디에서도 `router.push()`로 연결되지 않은 것을 발견. voices.tsx의 "음성 추가" 메뉴에 두 옵션을 추가하여 사용자가 접근 가능하게 함.

## 변경 파일

| 파일 | 변경 |
|------|------|
| `app/(tabs)/voices.tsx` | 음성 추가 메뉴에 "통화 녹음에서 추출" (diarize) + "화자 분리" (picker) 옵션 2개 추가 |
| `src/i18n/ko.json` | `voices.diarize`, `voices.diarizeDesc`, `voices.speakerPicker`, `voices.speakerPickerDesc` 4키 추가 |
| `src/i18n/en.json` | 동일 4키 추가 |
| `test/navigationRoutes.test.ts` | `allowedUnreachable` 배열 제거 — 이제 모든 라우트가 도달 가능 |

## 설계 결정

- **메뉴 순서**: 직접 녹음 → 파일 업로드 → 통화 녹음 추출 → 화자 분리. 단순한 것부터 복잡한 것 순서로 정렬.
- **이모지 선택**: 📞 (통화 녹음), 👥 (화자 분리) — iOS/Android 모두 렌더링 잘 됨.
- **console.warn 마이그레이션 검토**: `index.ts` scheduled handler와 `fcm.ts` mock의 `console.warn`은 이미 구조화 JSON 출력. 라우트 컨텍스트가 없어 `logRouteError`가 적용되지 않음. 현행 유지.

## 검증

- mobile typecheck: 0 errors
- backend typecheck: 0 errors
- navigationRoutes.test.ts: 10/10 통과
- a11y-audit.test.ts: 30/30 통과 (i18n 동기화 포함)

## 다음 루프

BACKLOG 자가 생성 풀에 새 항목 추가 필요. 후보:
- 모바일 컴포넌트 테스트 확장 (voices.tsx add menu 동작 테스트)
- voice/diarize, voice/picker 다크모드 검증 (이미 createStyles 적용됨 — 확인 완료)
- 미사용 export 감사 (dead code 탐지)
