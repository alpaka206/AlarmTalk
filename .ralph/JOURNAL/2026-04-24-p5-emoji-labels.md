# P5: 이모지 점검 + 한국어/영어 레이아웃 + P6: TypeScript 엄격 모드

## BACKLOG 항목
- 이모지가 단독으로 정보를 전달하는 곳에 텍스트 라벨 병기 확인

## 접근

앱 전체 (~35개 .tsx 파일) 스캔 완료. 대부분의 이모지 사용은 이미 적절히 처리됨:
- 빈 상태 이모지: 모두 하단에 텍스트 설명 병기
- 액션 카드 이모지: 모두 텍스트 라벨 병기
- 탭 아이콘: 탭 라벨 존재
- 캐릭터/스트릭: accessibilityLabel 존재
- 즐겨찾기 하트: accessibilityLabel 존재
- message/create 카테고리: 라벨 텍스트 + accessibilityLabel 모두 존재
- friend/[id] 통계: 텍스트 + accessibilityLabel 존재

### 발견된 문제 (2건)

**1. library/index.tsx — 카테고리 뱃지 이모지 (line 198)**
- 메시지 카드 헤더에 카테고리 이모지가 단독 표시 (텍스트 없음, accessibilityLabel 없음)
- 스크린리더 사용자가 카테고리 정보를 알 수 없음
- **수정**: accessibilityLabel에 번역된 카테고리명 추가, 부모 카드 accessibilityLabel에도 카테고리 포함

**2. library/index.tsx — 카테고리 필터 칩 (line 276, 279)**
- 필터 칩의 텍스트와 accessibilityLabel이 영어 키 이름 ("morning", "lunch") 그대로 표시
- 한국어 모드에서도 "morning"으로 표시되는 i18n 누락
- **수정**: i18n 키 10개 추가 (9개 카테고리 라벨 + 1개 a11y 배지), 번역된 카테고리명 사용

**3. player.tsx — 카테고리 이모지 (line 261)**
- 순수 장식용 이모지 (배경 그라데이션으로 카테고리 전달). accessibilityElementsHidden 추가.

## 변경 파일 (4개)
1. `apps/mobile/app/library/index.tsx` — getCategoryLabel 함수 추가, 카테고리 뱃지 a11y, 필터 칩 i18n, 카드 a11y 보강
2. `apps/mobile/app/player.tsx` — 장식용 이모지 accessibilityElementsHidden 추가
3. `apps/mobile/src/i18n/ko.json` — library.category* 9키 + a11yCategoryBadge 1키
4. `apps/mobile/src/i18n/en.json` — 동일 10키

## 검증
- `npx tsc --noEmit` 통과 (mobile)

---

## 한국어/영어 전환 레이아웃 점검

앱 전체 스캔하여 영어 텍스트가 30-50% 길어지는 상황에서 레이아웃 깨짐 위험이 있는 곳을 점검했다.

### 발견 및 수정 (4건)

**1. people.tsx — 세그먼트 컨트롤 텍스트**
- "멤버/친구/요청" vs "Members/Friends/Requests" + 뱃지 카운트
- `flex: 1`로 공간 분배하지만 텍스트 줄바꿈 가능
- **수정**: `numberOfLines={1}` 추가

**2. alarm/create.tsx — 퀵 선택 칩 행**
- "매일/평일/주말" (2글자) vs "Daily/Weekdays/Weekends" (5~8글자, 4배)
- 좁은 화면에서 3개 칩이 한 줄에 안 들어갈 수 있음
- **수정**: `quickDays` 스타일에 `flexWrap: 'wrap'` 추가

**3. alarm/edit.tsx — 동일 퀵 선택 칩**
- create.tsx와 동일 패턴
- **수정**: `flexWrap: 'wrap'` 추가

**4. FamilyMemberRow.tsx — 이름 + 역할 뱃지 행**
- 긴 영어 이름이 역할 뱃지를 밀어냄 (예: "Alexander" + "Owner" 뱃지)
- **수정**: name에 `numberOfLines={1}` + `flexShrink: 1` 추가

### 위험 없는 것으로 확인된 패턴
- 탭바 라벨: Expo Router BottomTab이 자동 truncate 처리
- 홈 액션 카드: `width: '47%'` + `flexWrap: 'wrap'` — 충분한 여유
- 알람 메타/모드 뱃지: 수직 배치라 줄바꿈 무관
- 빈 상태 UI: 중앙 정렬 + 전체 폭 — 문제 없음
- CoupleView: 이미 `numberOfLines={1}` 적용됨

## 변경 파일 (총 8개, 이모지+레이아웃 합산)
1. `apps/mobile/app/library/index.tsx` — 카테고리 뱃지 a11y, 필터 칩 i18n
2. `apps/mobile/app/player.tsx` — 장식 이모지 a11y
3. `apps/mobile/src/i18n/ko.json` — 카테고리 i18n 10키
4. `apps/mobile/src/i18n/en.json` — 카테고리 i18n 10키
5. `apps/mobile/app/(tabs)/people.tsx` — 세그먼트 텍스트 numberOfLines
6. `apps/mobile/app/alarm/create.tsx` — quickDays flexWrap
7. `apps/mobile/app/alarm/edit.tsx` — quickDays flexWrap
8. `apps/mobile/src/components/FamilyMemberRow.tsx` — name numberOfLines + flexShrink

## 검증
- `npx tsc --noEmit` 통과 (mobile)

---

## P6: TypeScript 엄격 모드 강화

### 결과
- **Backend tsconfig**: `strict: false` → `strict: true` 전환. `npx tsc --noEmit --strict` 결과 에러 0건이어서 즉시 적용.
- **`any` 전수 조사**: 백엔드 0건, 모바일 0건.
- **`unknown` 검토**: 40건+ — 모두 요청 바디 입력 검증 경계면에서 올바르게 사용 중.
- **`@ts-expect-error`**: test 2건 — 의도적 잘못된 입력 테스트.

### 변경 파일 (1개)
- `packages/backend/tsconfig.json` — `strict: true`

## 변경 파일 총합 (9개)
1. `apps/mobile/app/library/index.tsx` — 카테고리 뱃지 a11y, 필터 칩 i18n
2. `apps/mobile/app/player.tsx` — 장식 이모지 a11y
3. `apps/mobile/src/i18n/ko.json` — 카테고리 i18n 10키
4. `apps/mobile/src/i18n/en.json` — 카테고리 i18n 10키
5. `apps/mobile/app/(tabs)/people.tsx` — 세그먼트 텍스트 numberOfLines
6. `apps/mobile/app/alarm/create.tsx` — quickDays flexWrap
7. `apps/mobile/app/alarm/edit.tsx` — quickDays flexWrap
8. `apps/mobile/src/components/FamilyMemberRow.tsx` — name numberOfLines + flexShrink
9. `packages/backend/tsconfig.json` — strict: true

## 다음 루프 주의사항
- P5+P6 BACKLOG 완료. 자가 생성 풀에서 "백엔드 테스트 커버리지 확장"을 다음 작업으로 권장.
- iOS/Android 양쪽에서 영어 전환 시 시각적 확인 필요 (코드 레벨에서는 완료)
