# P121 — 접근성(A11y) 개선

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 4에 따라 "앱 접근성 강화" 선택.
주요 컴포넌트에 누락된 accessibilityRole, accessibilityLabel, accessibilityLiveRegion 추가.

## 작업 내역

### 1. Toast.tsx — accessibilityRole="alert" + accessibilityLiveRegion="polite"
- 토스트 알림은 스크린 리더 사용자에게 자동으로 읽혀야 함
- `polite` 선택: 현재 읽기 중인 내용 방해하지 않음

### 2. OfflineBanner.tsx — accessibilityRole="alert" + accessibilityLiveRegion="assertive"
- 네트워크 끊김은 즉시 인지해야 하므로 `assertive` 사용
- 테스트 추가: `OfflineBanner.test.tsx`에 접근성 검증 1건

### 3. PeopleSkeletonCard.tsx — accessibilityRole="progressbar" + accessibilityLabel
- 로딩 상태를 스크린 리더가 인식하도록 progressbar 역할 부여
- `useTranslation` import 추가하여 `t('common.loading')` 라벨 사용
- 테스트 추가: `PeopleSkeletonCard.test.tsx`에 접근성 검증 1건
- i18n mock 추가 (react-i18next)

### 4. alarms.tsx — 제목에 accessibilityRole="header" 추가
- 스크린 리더 헤딩 탐색 지원

### 5. compose.tsx — 제목에 accessibilityRole="header" 추가
- 스크린 리더 헤딩 탐색 지원

### 6. FamilyMemberRow.tsx — accessibilityLabel 추가
- 멤버 카드에 `{displayName}, {role}` 형식의 접근성 라벨 추가
- 비대화형 카드지만 스크린 리더가 멤버 정보를 읽을 수 있어야 함

### 7. i18n — common.loading 키 추가
- ko.json: `"loading": "불러오는 중..."`
- en.json: `"loading": "Loading..."`

## 변경 파일 (8개)
1. `apps/mobile/src/components/Toast.tsx` — a11y props 추가
2. `apps/mobile/src/components/OfflineBanner.tsx` — a11y props 추가
3. `apps/mobile/src/components/PeopleSkeletonCard.tsx` — a11y props + useTranslation 추가
4. `apps/mobile/src/components/FamilyMemberRow.tsx` — accessibilityLabel 추가
5. `apps/mobile/app/(tabs)/alarms.tsx` — 제목 header 역할
6. `apps/mobile/app/(tabs)/compose.tsx` — 제목 header 역할
7. `apps/mobile/src/i18n/ko.json` — common.loading 키
8. `apps/mobile/src/i18n/en.json` — common.loading 키

### 테스트 파일 (2개 수정)
9. `apps/mobile/test/OfflineBanner.test.tsx` — 접근성 테스트 1건 추가
10. `apps/mobile/test/PeopleSkeletonCard.test.tsx` — 접근성 테스트 1건 + i18n mock 추가

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 신규/수정 테스트: 13/13 통과
- 전체 빌드 무영향

## 다음 루프 참고
- ProfileDropdown 메뉴 divider에 `accessibilityRole="none"` 추가 가능 (LOW)
- hardcoded 색상 (#fff, #FFFFFF) → 디자인 토큰 마이그레이션은 별도 작업 필요 (24+ 인스턴스)
- 새 `textOnPrimary` 토큰 추가 여부는 사용자 확인 필요 (디자인 가이드라인 "새 컬러 추가 금지" 제약)
