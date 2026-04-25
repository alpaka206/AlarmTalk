# P176: noUnusedLocals/noUnusedParameters 활성화 + dead code 정리

## BACKLOG 항목
TypeScript 엄격 모드 강화 (any 제거, 타입 보강) — section 4 후보

## 접근
`noUnusedLocals`와 `noUnusedParameters`를 backend+mobile tsconfig에 활성화하여 dead code를 컴파일 타임에 감지하도록 설정. 활성화 전 dry-run으로 11개 이슈 확인 후 모두 수정.

## 수정 내역

### Source files (3)
1. `app/player.tsx` — `WAVEFORM_BAR_GAP` unused import 제거
2. `app/subscription/index.tsx` — `plan` destructuring에서 제거 (isAuthenticated만 사용)
3. `src/lib/alarmCountdown.ts` — `TFunction` unused type import 제거

### Test files (8)
4. `test/i18nKeys.test.ts` — `rel()` 미사용 함수 제거
5. `test/libraryScreen.test.ts` — `isConnected` 파라미터 `_isConnected`로 명시
6. `test/PeopleSkeletonCard.test.tsx` — `View` unused import 제거
7. `test/presetMessageSection.test.ts` — `PresetCategory` unused type import + `currentText` param `_currentText`로 명시
8. `test/profileDropdown.test.ts` — `PlanType` unused type 제거
9. `test/sentry.test.ts` — `initSentry` unused import 제거 (require로 동적 접근)
10. `test/settingsScreen.test.ts` — `PlanType` unused type 제거

### Config (2)
11. `packages/backend/tsconfig.json` — noUnusedLocals + noUnusedParameters 추가
12. `apps/mobile/tsconfig.json` — 동일

### Docs (1)
13. `README.md` — 백엔드 테스트 수 1245→1379 업데이트

## 검증
- Backend tsc --noEmit: 0 errors
- Mobile tsc --noEmit: 0 errors
- Backend vitest: 1379 passed
- Mobile jest: 1970 passed

## 다음 루프 참고
- 잔여 BACKLOG 항목 모두 외부 의존성 (Sentry DSN, 앱 아이콘 에셋)
- section 4에서 새 항목 생성 필요
