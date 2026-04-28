# P25: README 현행화 + stale TODO 정리

**날짜**: 2026-04-24
**BACKLOG 항목**: 자가 생성 — 문서화 (README 현행화)

## 발견 경위

BACKLOG의 미완료 항목이 모두 외부 의존성(에뮬레이터/Notion/시크릿)으로 blocked. 자가 생성 풀에서 "문서화" 선택.
README.md가 프로젝트 현행 상태와 크게 괴리되어 있음을 확인:
- 인증 방식: Google OAuth/Apple Sign-In → JWT + email/password (bcrypt)
- 결제: RevenueCat → 이용권 코드 스텁
- 탭 구조: 미반영 (4탭 + 프로필 드롭다운)
- API: 6개 그룹만 기재 → 실제 16개 그룹
- 아키텍처 다이어그램: R2, Sentry, FCM 미반영

## 변경 사항

### 1. README.md 전면 재작성

| 섹션 | 변경 |
|------|------|
| 아키텍처 다이어그램 | R2 Storage, Sentry 추가. FCM "(TODO)" → 실구현 반영 |
| 모노레포 구조 | docs/, .maestro/, store/ 폴더 추가 |
| 기술 스택 | 인증 JWT+bcrypt, 푸시 FCM, 모니터링 Sentry, 폰트 Pretendard, 테스트 Vitest/Jest/Maestro 추가 |
| 앱 구조 | 4탭 (홈/음성/알람/메시지) + 헤더 (알림벨+프로필) 섹션 신규 |
| 환경변수 | JWT_SECRET, PASSWORD_PEPPER 추가. 백엔드/모바일 분리 |
| API 엔드포인트 | 6개 → 16개 그룹 (인증, 캐릭터, 가족, 쪽지, 코드, 푸시, 통계, 결제, 더빙) |
| 핵심 기능 | 캐릭터 시스템, 가족 플랜, 코드 등록, 오프라인 지원 추가 |
| 테스트 현황 | 백엔드 647, 모바일 286, E2E 6플로우 |
| 설계 문서 | docs/R6-* 6개 문서 링크 추가 |
| 삭제 | .env.example 참조 (파일 미존재), Google OAuth/Apple Sign-In, RevenueCat |

### 2. packages/voice/src/VoiceStorage.ts — stale TODO 정리

- `// TODO: real object storage integration (R2 / S3 / local filesystem)` 
- → `// Production: R2VoiceStorage (packages/backend/src/lib/r2-storage.ts). This in-memory impl is for dev/test fallback.`

## 변경 파일

| 파일 | 변경 |
|------|------|
| `README.md` | 전면 재작성 (현행 상태 반영) |
| `packages/voice/src/VoiceStorage.ts` | stale TODO → 현행 설명으로 교체 |

## 검증

- backend `npx tsc --noEmit` — 0 errors
- mobile `npx tsc --noEmit` — 0 errors

## 다음 루프

BACKLOG 잔여 자가 생성 후보: 앱 아이콘 설정 (adaptive icon config). 또는 코드 품질 추가 감사.
