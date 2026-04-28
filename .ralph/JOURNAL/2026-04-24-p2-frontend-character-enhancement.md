# P2: 프론트엔드 캐릭터 화면 강화

- **BACKLOG 항목**: P2 프론트엔드: 캐릭터 화면 강화
- **이슈**: #174

## 변경 사항

### 1. API 타입 확장 (`apps/mobile/src/services/api.ts`)
- `CharacterStreak`, `CharacterStats`, `StreakAchievement` 인터페이스 추가
- `CharacterResponse`에 `streak`, `stats`, `achievements` 필드 추가 (백엔드 응답과 일치)
- `CharacterGrantResponse.grant`에 `milestone_grants` 선택적 필드 추가
- `XpEvent`에 `streak_bonus_7/30/90` 이벤트 추가
- `grantCharacterXp` 페이로드에 `local_date` 필드 추가

### 2. 캐릭터 화면 강화 (`apps/mobile/app/character/index.tsx`)
- **스트릭 뱃지**: 🔥 N일 연속 기상 + 최장 기록 표시
- **마일스톤 배지**: 🌱(7일) / 🌳(30일) / 🌸(90일) — 달성 시 활성화, 미달성 시 반투명
- **능력치 바**: 뿌리 깊이(갈색) / 줄기 튼튼함(초록) / 잎 무성함(코랄) — 수평 바 형태
- `fontWeight` → `fontFamily` (FontFamily 토큰) 마이그레이션
- 모든 텍스트 i18n 키로 전환

### 3. 홈 캐릭터 위젯 (`apps/mobile/app/(tabs)/index.tsx`)
- 스트릭 > 0 일 때 🔥 N 카운트 표시 (widgetStreak 스타일, warning 컬러)

### 4. i18n 키 추가
- `ko.json`: `character.*` 17개 키 추가
- `en.json`: `character.*` 17개 키 추가

## 검증
- `packages/backend` typecheck: ✅ 통과
- `apps/mobile` typecheck: ✅ 통과

## 설계 판단
- 능력치 바의 max 값은 세 능력치 중 최대값 기준 (최소 10) — 상대적 비교 가능
- 마일스톤 배지 이모지는 나무 성장 테마에 맞춰 🌱/🌳/🌸 사용 (기획서 패턴과 일치)
- StatBar 컴포넌트를 파일 내부에 인라인 정의 (현재 이 화면에서만 사용)
