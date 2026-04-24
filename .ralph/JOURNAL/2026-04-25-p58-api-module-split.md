# P58 — 모바일 api.ts 도메인 분할 (771→barrel+8 모듈)

## 선택한 항목
자가 생성: `services/api.ts` 771줄 → 8개 도메인 모듈 + barrel index로 분할

## 접근
api.ts는 15개 이상 API 도메인이 하나의 파일에 있어 탐색과 유지보수가 어려웠다.
도메인별로 의미 있는 단위로 묶어 분할:

1. **core.ts** (~93줄) — ApiError, request/get/post/patch/del 인프라
2. **voice.ts** (~195줄) — Voice Profile + Upload + Speaker + TTS + Dub
3. **alarm.ts** (~63줄) — Alarm CRUD + Push Token
4. **social.ts** (~104줄) — Friend + Gift + Notes
5. **user.ts** (~69줄) — User + Stats + Library
6. **billing.ts** (~56줄) — Billing + Code Registration
7. **family.ts** (~90줄) — Family Group + Invite + Family Alarm
8. **character.ts** (~83줄) — Character + XP + Streak
9. **index.ts** (~100줄) — barrel re-export

## 핵심 결정
- `api.ts` → `api/index.ts` 변환으로 **32개 소비자 파일의 import 경로 변경 불필요** (TypeScript가 디렉토리 모듈 자동 해석)
- Voice + TTS + Dub를 하나로 묶음 (모두 음성/오디오 도메인)
- Alarm + Push를 하나로 묶음 (알람이 푸시를 트리거)
- Friend + Gift + Notes를 social로 묶음 (사용자 간 상호작용)
- User + Stats + Library를 user로 묶음 (개인 데이터)

## 대안 검토
- 15개 개별 파일 → 대부분 20줄 미만으로 과도한 분산
- 2~3개 대형 파일 → 원래 문제(큰 파일)가 재현됨
- 현재 8개 = 각 파일 50~200줄로 적정 크기

## 변경 파일
1. `services/api.ts` 삭제 (771줄)
2. `services/api/core.ts` 신규 (93줄)
3. `services/api/voice.ts` 신규 (195줄)
4. `services/api/alarm.ts` 신규 (63줄)
5. `services/api/social.ts` 신규 (104줄)
6. `services/api/user.ts` 신규 (69줄)
7. `services/api/billing.ts` 신규 (56줄)
8. `services/api/family.ts` 신규 (90줄)
9. `services/api/character.ts` 신규 (83줄)
10. `services/api/index.ts` 신규 (100줄)

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 테스트: mobile 466/466 통과
- 소비자 import 변경: 0건 (barrel re-export로 호환성 유지)

## 다음 루프 참고
- 중복 "Family Group / Family Alarm API" 섹션 헤더 정리 완료 (분할 과정에서 자연 제거)
- backend voice.ts (589줄), alarm.ts (536줄)도 분할 후보이나 현재 허용 범위
