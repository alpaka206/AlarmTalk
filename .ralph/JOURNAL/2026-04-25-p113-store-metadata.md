# P113 — App Store / Google Play 스토어 등록 메타데이터 준비

## BACKLOG 항목
P4 Notion 동기화 3건 완료 + BACKLOG 고갈 → "App Store / Google Play 스토어 등록 준비" 선택.

## 접근
1. **P4 Notion 동기화**: Notion MCP 도구 미사용 (auth만 존재, write 미지원). 마크다운 fallback으로 `docs/P4_NOTION_SYNC.md` 생성. 기획서의 기술 스택/로드맵/현재 이슈 3섹션을 현재 구현 상태에 맞게 작성.

2. **P113 스토어 메타데이터**: `docs/STORE_LISTING.md` 생성. 실제 App Store Connect / Google Play Console 제출에 필요한 모든 텍스트 메타데이터 포함:
   - 앱 기본 정보 (카테고리: Lifestyle, 등급: 4+, 가격: 무료)
   - 한국어/영어 스토어 설명 (짧은 + 전체 + 키워드 + What's New)
   - 스크린샷 가이드 (7장 구성, 디바이스별 해상도)
   - 개인정보 처리방침 요약 (iOS Privacy Labels + Android Data Safety)
   - iOS/Android 심사 가이드 (AI 음성 클론 관련 심사 대응 포인트 포함)
   - 출시 전 체크리스트 12항목

## 변경 파일
- `docs/P4_NOTION_SYNC.md` (신규) — Notion 기획서 동기화 가이드
- `docs/STORE_LISTING.md` (신규) — 스토어 등록 메타데이터
- `.ralph/BACKLOG.md` (수정) — P4 Notion 3건 완료 표시 + P113 추가/완료
- `.ralph/STATE.md` (수정) — 현재 상태 갱신

## 검증 결과
- 코드 변경 없음 (문서만 추가) — typecheck 불필요
- 기존 빌드 상태 유지 (0 errors)

## 판단 기록
- expo-web-browser: OAuth에서 사용 중 → 유지
- @sentry/react-native: sentry.ts + ErrorBoundary에서 사용 중 → 유지
- 모바일 src 내 `any` 0건, `as unknown as` 0건 — 코드 품질 문제 없음
- BACKLOG 완전 소진. 남은 미완료 항목: iOS/Android 렌더링 확인(수동), wrangler deploy(사용자 직접)

## 다음 루프 참고
- BACKLOG에 코드 작업이 없음. 다음 루프는 section 4 목록에서 선택 필요
- 후보: README 업데이트, 앱 아이콘 설정, E2E 테스트 구성, 성능 최적화
- 개인정보 처리방침/이용약관 페이지: GitHub Pages 또는 Cloudflare Pages로 호스팅 가능 (별도 레포 또는 docs/ 활용)
