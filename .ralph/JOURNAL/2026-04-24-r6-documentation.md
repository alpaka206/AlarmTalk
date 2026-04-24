# R6: 프로젝트 문서화

**날짜**: 2026-04-24
**BACKLOG 항목**: R6 (Notion 문서화 → 마크다운 대체)

## 접근

Notion MCP 도구는 OAuth 인증이 필요하여 야간 무인 모드에서 사용 불가. BACKLOG 지시대로 `docs/` 폴더에 마크다운으로 생성.

## 생성 파일

| 파일 | 내용 | 분량 |
|------|------|------|
| `docs/R6-A_PROJECT_OVERVIEW.md` | 서비스 소개, 핵심 가치, 타겟 유저, 주요 기능 6개 카테고리, 화면 흐름도, 사용자 시나리오 5개 | ~200줄 |
| `docs/R6-B_REQUIREMENTS.md` | 기능 요구사항 (FR 7그룹, 50+ 항목), 비기능 요구사항 (NFR 5그룹), 제약사항 | ~180줄 |
| `docs/R6-C_ARCHITECTURE.md` | 기술 스택 다이어그램, 시스템 아키텍처 (4개 흐름도), 모노레포 구조, 데이터 흐름 | ~230줄 |
| `docs/R6-D_API_REFERENCE.md` | 전체 API 레퍼런스 (65+ endpoints, 18개 그룹), 인증, 에러 코드, 요청/응답 스키마 | ~350줄 |
| `docs/R6-E_DATABASE_SCHEMA.md` | 22 테이블 전체 컬럼 정의, ER 다이어그램, 인덱스, 마이그레이션 히스토리 | ~350줄 |
| `docs/R6-F_ROADMAP.md` | 완료 작업 요약, 현재 상태, 향후 계획 (단기/중기/장기), 기술 부채 | ~120줄 |

## 추가 변경

이 iteration에서 R5 잔여 항목도 처리:
- `app/(tabs)/index.tsx`: 홈 액션카드 `/gift/received` → `/code-register` 변경 (이모지 🎁→🔑, i18n 키 변경)
- `src/i18n/ko.json`, `en.json`: `home.codeRegister` 키 추가

## 설계 결정

- **Notion 대신 마크다운**: Notion MCP OAuth 인증은 사용자 인터랙션 필요 → 자율 모드에서 불가. 마크다운은 git 추적 가능하고 사용자가 나중에 Notion에 복사 가능.
- **문서 구조**: R6-A~F 각각 독립 파일로 분리. Notion 페이지 구조와 1:1 대응되도록 설계.
- **API 레퍼런스**: routes/*.ts 파일에서 실제 엔드포인트를 전수 추출. mock/stub 상태도 명시.
- **DB 스키마**: migrations.ts에서 전체 CREATE TABLE + ALTER TABLE 추출. 텍스트 기반 ER 다이어그램 포함.

## 검증

- mobile `npx tsc --noEmit` — 0 errors
- backend `npx tsc --noEmit` — 0 errors
- 문서 파일은 typecheck 대상 아님

## 다음 루프

R0~R6 전체 완료. BACKLOG "자가 생성 가능 풀"에서 다음 항목을 선택해야 함.
후보: 모바일 E2E 테스트, 성능 최적화, Sentry 연동, 앱 아이콘 디자인.
