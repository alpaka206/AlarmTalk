# P29: expo-updates OTA 업데이트 체크 로직

**날짜**: 2026-04-24
**BACKLOG 항목**: 자가 생성 풀 → expo-updates OTA 업데이트 체크 로직

## 접근

앱 시작 시 EAS Update 서버에서 새 버전이 있는지 확인하고, 있으면 Alert로 사용자에게 즉시 업데이트 또는 나중에 선택을 제공한다.

### 대안 검토
- **매번 강제 업데이트**: 사용자 경험 저하, 네트워크 불안정 시 앱 사용 불가 → 불채택
- **백그라운드 자동 다운로드 + 다음 cold start에 적용**: UX는 좋으나 사용자가 업데이트 여부를 인지 못함 → 현 단계에서는 명시적 Alert 채택
- **Alert 기반 opt-in 업데이트**: 사용자가 선택, 실패 시 silent → 채택

## 설계 결정

- **`__DEV__` 가드**: 개발 모드에서는 OTA 체크 비활성 (expo-updates는 dev에서 동작하지 않음)
- **Platform.OS === 'web' 가드**: 웹에서는 불필요
- **Silent catch**: 네트워크 에러, 업데이트 서버 미응답 등 모든 실패를 무시. 업데이트 체크 실패가 앱 사용을 막으면 안 됨.
- **Alert.alert**: 파괴적 작업은 아니지만 앱 재시작을 수반하므로 Alert이 적절. Toast는 액션 버튼을 지원하지 않음.
- **i18n**: 4키 (title, message, now, later) ko/en 추가

## 생성/변경 파일

| 파일 | 변경 |
|------|------|
| `src/services/updates.ts` (신규) | checkForOTAUpdate(t) — 체크 + 다운로드 + Alert |
| `app/_layout.tsx` | import + useEffect 내 호출 추가 |
| `src/i18n/ko.json` | update.* 4키 추가 |
| `src/i18n/en.json` | update.* 4키 추가 |

## 검증

- mobile `npx tsc --noEmit` — 0 errors
- backend `npx tsc --noEmit` — 0 errors

## 다음 루프

BACKLOG 자가 생성 풀 전체 완료. 섹션 4 가이드라인에 따라 새 항목을 생성해야 한다.
