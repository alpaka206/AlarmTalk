# P15: EAS 빌드/서브밋 설정 강화 + 스토어 메타데이터 준비

**날짜**: 2026-04-24
**BACKLOG 항목**: 자가 생성 — App Store / Google Play 스토어 등록 준비

## 접근

BACKLOG 고갈 후 "App Store / Google Play 스토어 등록 준비" 선택. EAS Build는 이미 설정되어 있으나 Submit(자동 제출) 설정과 프로덕션 필드가 누락되어 있었음.

## 변경 파일

| 파일 | 변경 |
|------|------|
| `packages/backend/src/routes/voice.ts` | 스테일 TODO 삭제 (R2 스토리지 이미 통합됨 — getStorage() 함수가 R2 우선 사용 중) |
| `apps/mobile/eas.json` | submit 섹션 추가 (iOS App Store + Google Play internal track), autoIncrement 프로덕션, appVersionSource, env 변수 |
| `apps/mobile/app.json` | runtimeVersion (appVersion 정책), updates URL (EAS Update), ios.buildNumber, android.versionCode, ITSAppUsesNonExemptEncryption |
| `apps/mobile/store/listing.json` | **신규** — 스토어 리스팅 메타데이터 (ko/en 제목·설명·키워드, 카테고리, 스크린샷 사이즈 가이드) |

## 설계 결정

- **runtimeVersion `appVersion` 정책**: app.json의 version을 그대로 런타임 버전으로 사용. OTA 업데이트 호환성 관리에 가장 단순한 방식.
- **EAS Submit iOS**: `appleId`는 사용자 이메일 설정. `ascAppId`와 `appleTeamId`는 placeholder — App Store Connect 등록 후 교체 필요.
- **EAS Submit Android**: `internal` 트랙 + `draft` 상태로 설정 — 사용자가 수동으로 검토 후 프로모션.
- **autoIncrement**: 프로덕션 빌드에서 buildNumber/versionCode 자동 증가.
- **ITSAppUsesNonExemptEncryption: false**: HTTPS만 사용하므로 수출 규제 대상 아님. App Store 제출 시 매번 묻는 팝업 방지.
- **스토어 메타데이터**: JSON 포맷으로 구조화 — 향후 자동화 스크립트 또는 Fastlane 연동 가능.

## 검증

- backend `npx tsc --noEmit` — 0 errors
- mobile `npx tsc --noEmit` — 0 errors

## 사용자 조치 필요 항목

1. `eas.json` submit.production.ios: `ascAppId`와 `appleTeamId` 실제 값으로 교체
2. `eas.json` submit.production.android: `google-service-account.json` 파일 생성 (Google Play Console → API 액세스)
3. `store/listing.json`의 privacyPolicyUrl, supportUrl 실제 도메인으로 교체
4. 스크린샷 5장 준비 (home, alarm_create, voice_management, character_growth, family_messaging)
5. OTA 업데이트 사용 시 `expo-updates` 패키지 설치 필요: `npx expo install expo-updates`

## 다음 루프

스토어 등록 준비 완료. BACKLOG 자가 생성 풀에서 다음 항목 선택.
