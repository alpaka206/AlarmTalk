# Agent Instructions

AlarmTalk은 OS 네이티브 **목소리 알람 앱**이다. 네이티브 리라이트는 완료되었고, 이 리포의 체크아웃된 코드가 단일 진실이다.

작업 전 필독:

- `CLAUDE.md` — 빌드/배포/보안 규약, 디자인 토큰 등 작업 노트
- `docs/README.md` — 문서 인덱스 (`docs/standards/README.md`에 코딩·git 컨벤션)
- `docs/qa/dev-test-handoff.md` — 진행 중 작업·테스트 체크리스트 (세션 재개 시 먼저)

## 모노레포 구조

- `packages/backend` — Cloudflare Workers + Hono + Turso(libSQL). 라우트 `src/routes`, 마이그레이션 `src/lib/migrations.ts`.
- `packages/shared` — zod 스키마. 백엔드·클라이언트 공용 계약.
- `packages/voice` — 보이스 프로바이더 어댑터 계층(백엔드에서 사용).
- `packages/ui` — 공용 디자인 토큰.
- `apps/android-native` — Kotlin/Compose. **운영 중인 메인 클라이언트**, dev/prod flavor.
- `apps/ios-native` — SwiftUI. **미운영·보류**(CI는 workflow_dispatch 전용). develop 머지 OK, 릴리스 전 Mac 빌드 검증.
- `apps/landing` — 웹 랜딩.

## 알람 불변 규칙

- AlarmTalk은 진짜 알람 앱이다. 알림/리마인더 앱이 아니다.
- **알람 발사 경로는 전부 로컬**: `AlarmManager` + 로컬 DB 상태 + 로컬 오디오 파일. 푸시, 서버 cron, 실시간 네트워크에 의존하지 말 것.
- FCM data-only 푸시는 가족 알람 **배달 동기화**용일 뿐, 발사 경로가 아니다.
- 알람 엔진 변경은 실기기에서 검증한다. 로그인·소셜·빌링 확장이 검증된 알람 엔진을 약화시키면 안 된다.

## 배포

- `develop` 푸시(=PR 머지) → dev 백엔드 자동배포 + DB 마이그레이션.
- `main` → prod 자동배포(빌링 테스트용). 출시 전 prod DB 초기화 예정이라 하위호환 불필요(하드 브레이킹 OK) — 단, main으로 가는 브레이킹 마이그레이션은 의식하고 진행.

## Git 규약

- 커밋 메시지 **한국어**. `Co-Authored-By: Claude` / "Generated with Claude Code" 금지.
- `develop`은 보호 브랜치(필수 체크 9개) → 직접 푸시 불가, **PR 필수**. 머지 후 코드리뷰 지적사항은 후속 수정 커밋으로 반영(코드리뷰 루프).
- 스쿼시로 구현 히스토리를 뭉개지 말 것(명시 요청 시에만).
- env 파일, 네이티브 빌드 산출물, 로그, 기기 덤프, 로컬 녹음, 테스트 아티팩트는 git에 넣지 않는다.
