# 개인정보보호 컴플라이언스 작업 인수인계 (이어서 하기)

다른 환경에서 이어서 작업하기 위한 진행상황·결정·남은 작업 정리. 법적 근거 상세는
[`compliance-notes.ko.md`](./compliance-notes.ko.md) 참조.

## 현재 상태 (2026-06-05 기준)

- **이슈**: #426 (전체 체크리스트)
- **브랜치**: `feat/privacy-compliance` (base: `develop`)
- **PR**: #427 (Draft, base `develop`) — **merge는 작성자가 직접**
- **CI**: backend typecheck/test, lint, 각 패키지 test 통과. (iOS/Analyze는 무관 영역)

### 이어가는 방법
```bash
git fetch origin
git checkout feat/privacy-compliance
git pull
# 백엔드 검증
cd packages/backend
npx vitest run test/user.test.ts test/migrations.test.ts   # 54 passed
```
> 로컬에서 `npx tsc --noEmit` 시 `@voice-alarm/shared`·`@voice-alarm/voice` 모듈 미해석
> 경고가 날 수 있는데, 이는 워크스페이스 빌드 순서 이슈로 CI(루트 `npm ci`)에서는 정상이다.

## 완료 (이 PR에 포함)

| 영역 | 파일 | 내용 |
| --- | --- | --- |
| 법무 문서 | `docs/legal/compliance-notes.ko.md` | 동의/탈퇴/보존/암호화/위치 법적 근거·출처 |
| 마이그레이션 #41 | `packages/backend/src/lib/migrations.ts` | `user_consents`, `users.deletion_*`, `retained_billing_records` |
| 계정 삭제 라이브러리 | `packages/backend/src/lib/account-deletion.ts` | `purgeUserAccount`, `pseudonymizeBillingForRetention`, `pseudonymizeUserId` |
| API/라우트 | `packages/backend/src/routes/user.ts` | 동의 기록·조회, 탈퇴 유예/철회 엔드포인트 |
| cron | `packages/backend/src/index.ts` | 유예 경과 계정 영구파기 + 결제기록 가명보존 |
| 처리방침 | `docs/legal/privacy-policy.ko.md` | GPS 미수집·30일 유예·5년 가명보존 반영 |

### 추가된 API 스펙 (모두 `/api` 하위, authMiddleware 적용)
- `POST /api/user/consents` — body `{ consents: [{ type, version?, agreed }] }`
  - `type` ∈ `terms` | `privacy` | `marketing` | `age14` (그 외 400 `INVALID_CONSENT_TYPE`)
  - `version` 기본 `'1'`, `agreed` true/1/'1' → 동의
- `GET /api/user/consents` — `{ consents: [{ consent_type, policy_version, agreed, agreed_at }] }` (유형별 최신)
- `POST /api/user/me/deletion` — 탈퇴 신청 → `deletion_status='pending_deletion'`, `purge_at = now + 30일`
- `DELETE /api/user/me/deletion` — 유예 내 철회 → `active` 복구
- `DELETE /api/user/me` (기존) — 즉시 hard delete. 내부적으로 `purgeUserAccount` 재사용.

### 결정 사항 (변경 시 합의)
- 탈퇴 유예 **30일** — `user.ts`의 `DELETION_GRACE_DAYS`
- 동의: 필수 = `terms`, `privacy` / 선택 = `marketing` / 필수 = `age14`(만14세 이상)
- 만 14세 미만 가입 불가 (법정대리인 동의 절차 미도입)
- 5년 보존: 결제·구독 기록만, 가명키 `SHA-256(user_id + PASSWORD_PEPPER)`로 분리보관
- 비밀번호 일방향(bcrypt) 유지, 고유식별정보·카드원번호 미수집

## 남은 작업 (별도 PR 권장 — 네이티브는 빌드 검증 필요)

### A. 가입 동의 UI + 연동
- [ ] 웹(랜딩/웹앱) 회원가입에 필수/선택 동의 체크박스 + 약관·처리방침 링크
- [ ] Android `ui/auth/AuthScreen.kt` 동의 체크박스
- [ ] iOS `AuthViewModel`/가입 플로우 동의
- [ ] 가입 직후 `POST /api/user/consents` 호출로 동의 기록 (terms/privacy 필수, marketing 선택, age14)

### B. GPS 제거 + 도시 선택기 (KR/US/JP)
- [ ] Android `location/WeatherLocationProvider.kt` 제거, `AndroidManifest.xml`의 `ACCESS_FINE/COARSE_LOCATION` 권한 제거
- [ ] `ui/editor/AlarmSettingsCard.kt` / 설정의 "현재 위치 가져오기" UI 제거
- [ ] 국가→도시 선택기: KR/US/JP 국가 선택 시 해당 도시 드롭다운 (웹·Android·iOS 공통)
- [ ] 도시 데이터셋 추가 위치 결정(예: `packages/shared`) — 백엔드 `dynamic-prompt-settings`는 이미 country/city 문자열 수용
- [ ] iOS 위치 권한 코드 있으면 제거 확인

### C. 설정 화면 링크
- [ ] Android `ui/settings/SettingsScreen.kt`, iOS `Views/Settings/SettingsView.swift`에 이용약관/처리방침/계정삭제 링크
- [ ] 앱 내 동의 내역 열람(`GET /api/user/consents`), 탈퇴 유예 상태 안내

### D. 탈퇴 유예 클라이언트 연동
- [ ] 앱 "회원 탈퇴"를 즉시 `DELETE /me` 대신 `POST /me/deletion`(유예)로 전환 검토
- [ ] 유예 중 로그인 시 자동 철회(또는 안내) 정책 — 현재 백엔드 미구현, 합의 후 추가

### E. 랜딩/약관 동기화
- [ ] `apps/landing/app/[locale]/account-deletion/page.tsx`에 30일 유예 반영(ko/en/ja)
- [ ] `docs/legal/terms-of-service.ko.md` 약관 본문 보강 검토

### F. 확인 필요 — "진짜 알람/실제 알람" 문구
일괄 삭제 보류 중. 의미상 필요한 본문("알람이 실제로 울리는 순간…")이 섞여 있어,
제거 대상 표현 범위를 확정한 뒤 정리한다. 후보 파일:
`docs/legal/terms-of-service.ko.md`, `README.md`, `README.ko.md`, `AGENTS.md`,
`docs/manual/README*.md`, `apps/.../PermissionGate.kt`, `apps/ios-native/.../VoiceStudioViewModel.swift`

## 참고: 기존 코드 위치
- 가입/로그인: `packages/backend/src/routes/auth.ts` (register `:204`, login `:281`)
- 탈퇴 API: `packages/backend/src/routes/user.ts`
- 동적문구(날씨/운세): `packages/backend/src/lib/dynamic-prompt-settings.ts`
- Android 위치: `apps/android-native/.../location/WeatherLocationProvider.kt`
- 설정: Android `ui/settings/SettingsScreen.kt`, iOS `Views/Settings/SettingsView.swift`
- 랜딩 법무: `apps/landing/app/[locale]/{privacy,terms,account-deletion}/page.tsx`, 문서 `docs/legal/*.md`
