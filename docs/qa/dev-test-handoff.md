# Dev 테스트 핸드오프

> 세션 재개용 라이브 문서. 마지막 갱신 **2026-06-24**. 상태가 바뀌면 이 파일을 갱신/정리한다.
> (다른 컴퓨터에서도 `git pull` 후 이 문서를 읽으면 바로 이어서 진행 가능.)

## 지금 상태 — 폰 QA 대기 중
회원가입/배포 개선 일괄 작업 완료. 사용자가 폰에서 테스트 후 결과를 보고할 예정.
- PR **#500**(인증 개선) · **#501**(init-db 시크릿 dev/prod 분리) → `develop` 머지 완료.
- dev 백엔드 배포 **green**, 마이그레이션 **#52까지 적용**. dev `/api/auth/email-code` 신규 동작 확인됨(200 + debug_code).
- 두 테스트폰에 최신 dev APK 설치됨(아래 변경 전부 포함). **APK = 현재 develop 앱 코드와 일치**(이후 develop 변경은 워크플로 yaml·문서뿐).
- 다음: 폰 테스트 결과 보고 받으면 → 아래 체크리스트/파일 위치 기준으로 수정·재빌드·재설치.

## 변경 요약 + 코드 위치
1. **랜딩 다크모드 액센트 코랄→브랜드 블루**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/auth/LandingScreen.kt` (다크 분기 `accent = scheme.primary`)
2. **비밀번호 정책(영문+숫자 필수, 8~128자)**: 서버 `packages/shared/src/schemas/auth.ts` `PasswordSchema`; 클라 표시·검증 `apps/android-native/.../ui/auth/AuthScreen.kt`(`PasswordRules`, `passwordPolicyValid`). 규칙: 8자 이상 / 영문·숫자 포함 / 일치.
3. **중복·소셜 이메일 가입 차단·안내**: 서버 `packages/backend/src/routes/auth.ts` `classifyExistingAccount` → `/auth/email-code`·`/auth/register`가 **409**(`AUTH_EMAIL_TAKEN`=비번계정, `AUTH_EMAIL_SOCIAL`+`provider`=소셜). 클라 매핑 `apps/android-native/.../ui/main/MainViewModelAuthActions.kt` `duplicateEmailMessage`, 로그인 자동전환 `apps/android-native/.../ui/app/AlarmTalkApp.kt` `authRedirectToLogin`. ⚠️ 가입여부 노출 = account enumeration 트레이드오프(의도, `/api/auth/*` rate-limit 으로 완화). 로그인 라우트는 기존 generic 유지.
4. **dev migrate 404 수정 + init-db 시크릿 dev/prod 분리**: `.github/workflows/deploy-backend.yml`, `packages/backend/scripts/run-remote-migrations.ts`.

## 폰 테스트 체크리스트
- [ ] 랜딩(다크모드): 액센트 = 브랜드 블루(코랄 아님)
- [ ] 회원가입 비번: "8자 이상 / 영문·숫자 포함 / 비밀번호 일치" 3규칙 표시, 영문+숫자 없으면 가입 버튼 비활성
- [ ] 이메일 인증: dev엔 RESEND 미설정 → 인증코드가 **앱 토스트로 표시**(예 "인증 코드: 123456"), 그 코드 입력해 가입 진행(실제 메일 발송 X)
- [ ] 중복 이메일 가입 시도: 비번계정 → "이미 가입된 이메일… 로그인" + **로그인 화면 자동 전환** / 구글계정 → "구글로 가입된 이메일…" 안내

## 남은 follow-up
- [ ] **`INIT_DB_SECRET_PROD`를 GitHub Repository Actions secret으로 등록** (현재 repo secrets에 안 보임 — Environment secret으로 넣었으면 배포 잡이 못 읽음). prod 배포 시 prod 워커에도 동일 값 `.dev.vars.prod` + `npm run secrets:sync:prod`. (지금 prod 배포 안 하니 당장 영향 없음)
- [ ] (선택) signup enumeration 노출이 부담되면 "이메일 인증 통과 후에만 가입여부 노출"하는 절충안으로 변경 가능.

## 테스트 수정 후 재빌드/재설치
```
apps\android-native\gradlew.bat -p apps\android-native :app:assembleDevDebug
adb -s R3CW300EZBA install -r apps/android-native/app/build/outputs/apk/dev/debug/app-dev-debug.apk
adb -s RF9R40323AP install -r apps/android-native/app/build/outputs/apk/dev/debug/app-dev-debug.apk
```
