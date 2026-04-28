# P5: 카드 스타일 일관성 통일

## 작업 항목
BACKLOG P5 — 카드 컴포넌트 스타일 일관성 (BorderRadius.lg, shadow 토큰, Spacing.md 간격 통일)

## 접근 방식
전체 앱의 카드 스타일을 감사(audit)하여 기존 home/alarms 카드 패턴과 동일하게 맞춤.

### 기존 표준 패턴 (home/alarms)
```
borderRadius: BorderRadius.lg,
shadowColor: colors.shadow,
shadowOffset: { width: 0, height: 2 },
shadowOpacity: 1,
shadowRadius: 6,
elevation: 2,
marginBottom: Spacing.md,
```

### 발견된 불일치 6건 + 수정
1. **people.tsx** `personCard` — shadow 추가, marginBottom sm→md
2. **people.tsx** `inviteCard` — shadow 추가, marginBottom sm→md
3. **voices.tsx** `profileCard` — shadow 추가, marginBottom sm→md
4. **settings.tsx** `card` — shadow 추가
5. **CoupleView.tsx** `card` — shadow 추가 (방금 만든 컴포넌트)
6. **FamilyMemberRow.tsx** `card` — shadow 추가, marginBottom sm→md
7. **PeopleSkeletonCard.tsx** `card` — shadow 추가, marginBottom sm→md

### 추가 수정
- settings.tsx 스누즈 피커: `borderRadius: 12` → `BorderRadius.md`, `paddingHorizontal: 12` → `Spacing.md - 4`, `paddingVertical: 4` → `Spacing.xs`

## 변경 파일 (6개)
1. `apps/mobile/app/(tabs)/people.tsx`
2. `apps/mobile/app/(tabs)/voices.tsx`
3. `apps/mobile/app/(tabs)/settings.tsx`
4. `apps/mobile/src/components/CoupleView.tsx`
5. `apps/mobile/src/components/FamilyMemberRow.tsx`
6. `apps/mobile/src/components/PeopleSkeletonCard.tsx`

## 검증
- Mobile typecheck: ✅ 통과
- Backend typecheck: ✅ 통과 (변경 없음)

## 다음 작업
P5 알람 시간 설정 UI 개선 또는 홈 화면 레이아웃 정리
