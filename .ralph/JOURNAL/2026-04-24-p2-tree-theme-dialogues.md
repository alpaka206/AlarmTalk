# P2: 나무 테마 대사 강화

## 작업 항목
BACKLOG P2 — 나무 테마 강화: 스트릭 관련 나무 메타포 대사 업데이트

## 접근
1. `character.ts`의 DIALOGUES를 각 스테이지당 4→7개로 확장, 나무 성장 메타포 추가
2. STREAK_DIALOGUES 계층 구조 신규 추가 (1일/3일/7일/30일/90일 스트릭별 대사)
3. `pickStreakAwareDialogue(stage, streak, rng)` 함수 신규 — 40% 확률로 스트릭 대사, 60% 확률로 기존 스테이지 대사
4. 캐릭터 화면에서 `pickRandomDialogue` → `pickStreakAwareDialogue`로 교체

## 변경 파일
- `apps/mobile/src/lib/character.ts` — DIALOGUES 확장 + STREAK_DIALOGUES + pickStreakAwareDialogue
- `apps/mobile/app/character/index.tsx` — pickStreakAwareDialogue 사용으로 변경
- `apps/mobile/test/character.test.ts` — 대사 수 4→7 반영 + pickStreakAwareDialogue 테스트 4개 추가

## 대안 검토
- i18n으로 대사를 옮기는 방안 검토했으나, 대사는 캐릭터 성격 표현이므로 코드 내 하드코딩이 적절. 다국어 대사가 필요할 때 i18n 이전 가능.

## 검증
- Mobile typecheck: ✅ 통과
- Backend typecheck: ✅ 통과
- character.test.ts: 28/28 통과

## 능력치 이름 나무 테마 확인
i18n에 이미 적용됨:
- ko: 뿌리 깊이 / 줄기 튼튼함 / 잎 무성함
- en: Root Depth / Trunk Strength / Leaf Density
추가 작업 불필요.

## 다음 루프 참고
P2 나무 테마 대사 강화 완료. P3 (R2 스토리지 + FCM 푸시)로 진행.
