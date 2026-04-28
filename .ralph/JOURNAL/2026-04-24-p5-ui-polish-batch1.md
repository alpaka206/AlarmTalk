# P5: UI 폴리시 Batch 1 — SafeAreaView 패딩 + 빈 상태 CTA

## 작업 항목
BACKLOG P5 — SafeAreaView 패딩 일관 적용 + 빈 상태 UI 일관성

## SafeAreaView + 하단 패딩 (2개 파일 수정)

### 감사 결과
- Home (index.tsx): paddingBottom 120 ✅
- Alarms (alarms.tsx): paddingBottom **없음** ❌ → 100 추가
- Voices (voices.tsx): ScrollView paddingBottom **없음** ❌ → 100 추가
- People (people.tsx): paddingBottom 100 ✅
- Settings (settings.tsx): paddingBottom 120 ✅
- 탭바 높이: 85px (가이드라인 준수) ✅

### 변경 파일
1. `app/(tabs)/alarms.tsx` — list 스타일에 `paddingBottom: 100` 추가
2. `app/(tabs)/voices.tsx` — ScrollView contentContainerStyle에 `paddingBottom: 100` 추가

## 빈 상태 CTA 버튼 (4개 파일 수정)

### 감사 결과 (변경 전)
- Alarms: emoji + message + CTA ✅ (이미 완전)
- Voices: emoji + message, CTA ❌ → 추가
- Library: emoji + message, CTA ❌ → 추가
- People (friends/members/requests): emoji + message + hint, CTA 없음 → 친구/멤버 세그먼트는 위에 입력 UI가 이미 있으므로 CTA 불필요
- Home 최근 메시지: 빈 상태 자체가 없음 ❌ → 추가

### 변경 파일
1. `app/(tabs)/voices.tsx` — 빈 상태에 "음성 녹음" CTA 버튼 추가 (→ /voice/record)
2. `app/library/index.tsx` — 빈 상태에 "메시지 만들기" CTA 버튼 추가 (→ /message/create, 즐겨찾기 탭에서는 숨김)
3. `app/(tabs)/index.tsx` — 최근 메시지 섹션: libraryItems가 없을 때 빈 상태 메시지 표시
4. `src/i18n/ko.json` — `library.createMessage`, `home.noMessages` 키 추가
5. `src/i18n/en.json` — 동일

## 검증
- Mobile typecheck: ✅ 통과

## 다음 루프
P5 다크모드 검증 또는 카드 스타일 일관성 점검.
