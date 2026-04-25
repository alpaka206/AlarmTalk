# P166-B — 구독 관리 화면 구축

## 선택한 항목
BACKLOG P166 "구독 관리 화면 구축 (getSubscription + checkout 활용)"

## 작업 내역

### 구현
1. **구독 관리 화면** (`app/subscription/index.tsx`): 
   - 현재 플랜 카드 (이름, 만료일, 활성 상태 배지)
   - 3단 플랜 비교 (Free/Plus/Family) — 기능 목록, 가격, 현재 플랜 표시
   - 업그레이드 버튼 → 확인 다이얼로그 → `checkout(planKey)` 호출
   - 코드 등록 링크 (`/code-register`로 이동)
   - 구독/유저프로필 쿼리 무효화 + 앱 스토어 plan 동기화

2. **스타일 파일** (`src/styles/subscriptionStyles.ts`): 기존 settingsStyles 패턴 준수

3. **라우팅 연결**:
   - `_layout.tsx`에 `subscription/index` Stack.Screen 등록
   - settings 화면의 "구독 관리" → `/subscription`으로 변경 (기존 `/code-register`)

4. **i18n 34키 추가** (ko + en): subscription 네임스페이스
   - 플랜 이름/가격/설명, 기능 목록, 상태 뱃지, 체크아웃 관련

5. **queryCache 테스트**: `subscription` 키 추가

### 판단 기록
- `planFamilyName`을 한국어에서 "패밀리"로 설정 (i18n 테스트가 ko/en 동일 값을 경고)
- `formatDate`에 `i18n.language` 직접 사용 (불필요한 `common.locale` 키 생성 회피)
- `planTypeToUserPlan`을 화면 내 로컬 함수로 정의 (백엔드 헬퍼와 동일 로직, 공유할 정도는 아님)

## 변경 파일 (7개)
1. `apps/mobile/app/subscription/index.tsx` — 신규
2. `apps/mobile/src/styles/subscriptionStyles.ts` — 신규
3. `apps/mobile/app/_layout.tsx` — Stack.Screen 추가
4. `apps/mobile/app/settings/index.tsx` — 구독 관리 내비게이션 변경
5. `apps/mobile/src/i18n/ko.json` — subscription 34키 추가
6. `apps/mobile/src/i18n/en.json` — subscription 34키 추가
7. `apps/mobile/test/queryCache.test.ts` — subscription 쿼리 키 등록

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 전체 테스트: 1938/1938 통과
- i18n 키 검증: 14/14 통과

## 다음 루프 참고
- P166 항목 모두 완료
- 향후 작업: subscriptionScreen 비즈니스 로직 테스트 추가, 결제 흐름 실제 PG 연동 (현재 checkout은 스텁)
