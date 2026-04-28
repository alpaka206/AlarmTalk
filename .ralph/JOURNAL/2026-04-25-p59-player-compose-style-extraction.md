# P59 — player/compose 스타일 추출 + compose 날짜 로캘 수정

## 선택한 항목
자가 생성: BACKLOG 완전 소진 상태. 남은 대형 화면 파일 스타일 추출 진행 (ADR-011 패턴).

## 접근
P50~P54에서 확립한 `createXxxStyles(colors)` 패턴으로 2개 화면 스타일 추출:
- player.tsx (486→344줄, -29%) — 플레이어 화면
- compose.tsx (381→207줄, -46%) — 메시지 작성 탭

추가로 compose.tsx의 `toLocaleDateString()` 호출에 `getDateLocale()` 누락 버그 수정 (P55에서 도입한 패턴).

## 핵심 결정
- player.tsx의 웨이브폼 상수 (WAVEFORM_BAR_COUNT, WAVEFORM_HEIGHT 등)를 스타일 파일로 이동 후 re-export.
  이유: 이 상수들은 스타일 정의에도 사용되므로, 스타일 모듈의 자체 완결성을 위해 함께 이동.
  컴포넌트 로직에서는 import로 참조.

## 대안 검토
- 상수를 별도 constants 파일로 분리 → 과도한 파편화. 스타일과 상수가 밀접하므로 스타일 파일에 배치.
- compose.tsx의 날짜는 별도 포맷 유틸로 분리 → 한 줄 변경으로 해결 가능, 불필요.

## 변경 파일
1. `src/styles/playerStyles.ts` 신규 (154줄)
2. `src/styles/composeStyles.ts` 신규 (177줄)
3. `app/player.tsx` 리팩토링 (486→344줄)
4. `app/(tabs)/compose.tsx` 리팩토링 (381→207줄) + getDateLocale() 적용

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 테스트: mobile 466/466 통과
- compose.tsx `toLocaleDateString()` → `toLocaleDateString(getDateLocale())` 수정

## 다음 루프 참고
- 스타일 미추출 잔여 화면: voice/diarize.tsx (413L), voice/[id].tsx (398L), voice/record.tsx (396L), gift/received.tsx (383L), family-alarm/create.tsx (359L)
- 이 중 voice 3개를 다음 배치로 묶으면 효율적
