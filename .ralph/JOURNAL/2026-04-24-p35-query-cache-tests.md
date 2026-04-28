# P35: React Query 캐시 전략 테스트

**날짜**: 2026-04-24
**BACKLOG 항목**: React Query 캐시 전략 테스트 (자가 생성 풀)

## 접근

React Query 사용 현황을 전수 조사하여 정적 분석 기반 회귀 방지 테스트를 작성. 런타임 렌더 테스트가 아닌 소스코드 패턴 검증 방식 (a11y-audit와 동일 전략).

## 발견 및 수정한 버그 (3건)

| 파일 | 이슈 | 수정 |
|------|------|------|
| `family-alarm/create.tsx` | `queryKey: ['user-profile']` — settings/ProfileDropdown은 `['userProfile']` 사용. 코드 등록 후 invalidateQueries가 이 화면에 전파되지 않음 | `['userProfile']`로 통일 |
| `note/create.tsx` | 동일 이슈 | `['userProfile']`로 통일 |
| `friend/[id].tsx` | `queryKey: ['receivedGifts']` — gift/received는 `['gifts-received']` 사용. 선물 수락 후 optimistic update가 이 화면에 전파되지 않음 | `['gifts-received']`로 통일 |

## 생성 파일

| 파일 | 내용 |
|------|------|
| `test/queryCache.test.ts` | 36 tests — 7 describe groups |

## 테스트 구조

1. **QueryClient defaults** (4): staleTime 30s, retry 2, no custom gcTime, Provider wrapping
2. **쿼리 키 일관성** (10): 9개 주요 쿼리 함수의 키 일관성 + 전체 첫 번째 세그먼트 일관성
3. **enabled 가드** (2): 탭 화면 isConnected 필수, 스택 화면은 네비게이션 보호로 허용
4. **뮤테이션 캐시 무효화** (8): 알람/음성/쪽지/친구/라이브러리/코드/알람생성/음성녹음 무효화 검증
5. **오프라인 캐시 통합** (7): AsyncStorage 캐시 키 4개, 탭별 로드/저장 패턴, 폴백 패턴
6. **쿼리 키 레지스트리** (2): 알려진 키 목록 vs 소스 일치, 네이밍 혼용 방지
7. **recentPresets 캐시** (3): 최대 5개 제한, 중복 제거, 최신 우선

## 설계 결정

- **정적 분석**: 렌더 기반 테스트 대신 파일 I/O로 소스를 읽고 정규식으로 검증. 외부 의존성(React, QueryClient 등) 불필요.
- **enabled 가드 허용 목록**: 스택 화면은 네비게이션이 인증을 강제하므로 `enabled` 없어도 안전. 탭 화면만 엄격 검증.
- **동적 키 허용**: `['library', filter]` 같은 동적 두 번째 세그먼트는 정상. 첫 번째 세그먼트만 일관성 검증.

## 검증

- mobile typecheck: 0 errors
- backend typecheck: 0 errors
- mobile tests: 382/382 (기존 346 + P35 36)
- backend tests: 653/653

## 다음 루프

BACKLOG "자가 생성 가능 풀" 남은 항목:
- 백엔드 API 응답 시간 벤치마크 테스트
- 모바일 번들 사이즈 모니터링
