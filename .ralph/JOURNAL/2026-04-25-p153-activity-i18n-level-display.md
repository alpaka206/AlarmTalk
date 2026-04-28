# P153 — Activity endpoint i18n 정규화 + "Lv." i18n 전환

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 blocked/manual. Section 4에 따라 코드 품질 감사 실시.
발견: (1) stats.ts activity endpoint가 한국어 하드코딩 summary 반환, (2) "Lv." 접두사 하드코딩 2곳.

## 작업 내역

### 1. Backend: stats.ts activity endpoint 구조 변경
기존 `summary` 필드(한국어 하드코딩)를 `detail` 구조체로 교체:
- alarm: `{ summary: "알람 08:30" }` → `{ detail: { time: "08:30" } }`
- message: `{ summary: "텍스트..." }` → `{ detail: { text: "텍스트..." } }`
- gift: `{ summary: "선물 (pending)" }` → `{ detail: { note: null, status: "pending" } }`
- voice: `{ summary: '음성 "이름" (ready)' }` → `{ detail: { name: "이름", status: "ready" } }`

이유: summary가 한국어로 고정되어 영어 사용자에게 한국어 텍스트가 노출됨.
detail 구조체로 변경하면 클라이언트가 type + detail로 i18n 포맷팅 가능.

### 2. Backend tests: stats.test.ts 업데이트
activity 관련 테스트 5개를 `summary` → `detail` 검증으로 수정:
- 알람 활동 detail 형식
- 메시지 detail.text 50자 초과 시 자름
- 선물 note가 null이면 detail.note null
- 음성 detail 형식
- 선물 note 50자 초과 시 잘림

### 3. Mobile: "Lv." i18n 전환
- ko.json + en.json에 `character.levelDisplay: "Lv.{{level}}"` 추가
- `app/(tabs)/index.tsx` line 264: `Lv.{level}` → `t('character.levelDisplay', { level })`
- `app/character/index.tsx` line 177: 동일 전환
- i18nKeys.test.ts allowedIdentical에 `character.levelDisplay` 추가 (양 언어 동일값)

## 변경 파일 (7개)
1. `packages/backend/src/routes/stats.ts` — activity summary → detail 구조체
2. `packages/backend/test/stats.test.ts` — activity 테스트 5개 detail 검증으로 수정
3. `apps/mobile/src/i18n/ko.json` — `character.levelDisplay` 추가
4. `apps/mobile/src/i18n/en.json` — `character.levelDisplay` 추가
5. `apps/mobile/app/(tabs)/index.tsx` — Lv. → i18n
6. `apps/mobile/app/character/index.tsx` — Lv. → i18n
7. `apps/mobile/test/i18nKeys.test.ts` — allowedIdentical 추가

## 검증
- Backend typecheck: 0 errors ✅
- Mobile typecheck: 0 errors ✅
- Backend stats tests: 18/18 passed ✅
- Mobile i18n tests: 14/14 passed ✅

## 다음 루프 참고
- activity endpoint는 아직 모바일에서 미소비 (getActivity API 함수 미구현)
- 추후 홈 화면에 activity feed 통합 시 `detail` 기반으로 i18n 포맷팅 구현 필요
- 남은 하드코딩: `© 2026 VoiceAlarm` (settings), `VA-XXXX-XXXX-XXXX` / `000000` (code-register 예시) — 의도적 유지
