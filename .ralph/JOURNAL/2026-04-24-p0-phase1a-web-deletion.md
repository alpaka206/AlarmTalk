# P0 Phase 1-A: packages/web 삭제

## 집은 항목
BACKLOG P0 Phase 1-A: packages/web 삭제 + 관련 참조 정리

## 접근
모노레포에서 web 패키지와 모든 관련 참조를 완전히 제거. 기획서 방향(모바일 퍼스트, 웹 불필요)에 맞춰 정리.

## 변경 파일 목록

### 삭제
- `packages/web/` — 전체 디렉토리 삭제
- `.github/workflows/deploy-web.yml` — 웹 배포 워크플로우 삭제

### 수정
- `package.json` — `"web"` 스크립트 제거
- `eslint.config.js` — `packages/web/src/**` 패턴 제거
- `.github/workflows/ci.yml` — typecheck matrix에서 `packages/web` 제거, test matrix에서 `packages/web` 항목 제거
- `.github/dependabot.yml` — `/packages/web` 섹션 삭제
- `CLAUDE.md` — web 기술 스택 줄, packages/web 디렉토리 줄 삭제
- `ARCHITECTURE.md` — 시스템 다이어그램에서 Web 박스 제거, 디렉토리 구조에서 packages/web 제거, 배포 섹션에서 deploy-web.yml 제거
- `README.md` — mermaid 다이어그램에서 Web 노드 제거, 모노레포 구조에서 web 줄 삭제, 기술 스택 테이블에서 웹 행 삭제, 개발 서버/타입체크/빌드 섹션에서 web 명령어 제거, 배포 테이블/URL에서 웹 삭제
- `.github/CONTRIBUTING.md` — web dev 명령어 삭제
- `packages/backend/src/index.ts` — CORS ALLOWED_ORIGINS에서 web origin 4개 삭제 (`voice-alarm.pages.dev`, `voicealarm.pages.dev`, `voice-alarm-web.pages.dev`, `main.voice-alarm-web.pages.dev`), localhost:5173도 삭제 (Vite 개발 서버용)
- `packages/backend/src/middleware/cors.test.ts` — ALLOWED_ORIGINS에서 web origin 제거, 테스트 케이스를 mobile origin(`localhost:8081`, `exp://localhost:8081`)으로 업데이트

### 유지 (판단)
- `packages/backend/src/lib/invites.ts` — `INVITE_WEB_HOST` + `buildInviteWebUrl()` 유지. 이유: 초대 링크 공유 시 웹 URL은 유니버설 링크/앱스토어 리디렉션 용도로 여전히 유효함. 웹 대시보드와는 별개 기능.
- `packages/backend/test/invites.test.ts` — 위 함수가 유지되므로 테스트도 유지.

## 검증 결과
- `npx tsc --noEmit` (backend) — 통과
- `npx tsc --noEmit` (mobile) — 통과
- `vitest run cors.test.ts` — 6/6 통과
- `vitest run invites.test.ts` — 8/8 통과
- `npm run lint` — 0 errors, 83 warnings (모두 기존 경고)

## 다음 루프 주의사항
- Phase 1-A 완료. 다음은 Phase 1-B (Pretendard 폰트 적용) 또는 Phase 1-C (탭 축소).
- Phase 1-B는 이미 이전 커밋(4711217)에서 완료된 것으로 보임. git log 확인 필요.
- `invites.ts`의 `INVITE_WEB_HOST`는 향후 랜딩 페이지/유니버설 링크 호스트로 변경 검토 가능.
