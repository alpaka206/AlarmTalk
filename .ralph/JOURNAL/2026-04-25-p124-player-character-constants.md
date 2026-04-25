# P124 — player.tsx 그라데이션 팔레트 + character 나무 갈색 상수 분리

## 선택한 항목
BACKLOG P124에서 두 개 소규모 리팩토링:
1. player.tsx 시간대 그라데이션 팔레트 → 별도 상수 파일 분리
2. character/index.tsx #8B5E3C (나무 갈색) → 상수 분리

## 접근 방식
- CLAUDE.md의 "새 컬러 추가 금지 — 기존 토큰만 사용" 제약 때문에 tokens.ts에 추가하지 않음
- 대신 도메인별 상수 파일을 `src/constants/` 디렉토리에 생성 (기존 presets.ts, theme.ts와 동일 패턴)
- 인라인 리터럴을 named constant로 교체하여 의도 명확화

## 변경 파일 (4개, 신규 2개 + 수정 2개)
1. `apps/mobile/src/constants/player.ts` — 신규: TIME_OF_DAY_BACKGROUNDS, TIME_OF_DAY_EMOJIS
2. `apps/mobile/src/constants/character.ts` — 신규: TREE_BROWN
3. `apps/mobile/app/player.tsx` — getBackgroundColor(), getEmoji()에서 상수 import 사용
4. `apps/mobile/app/character/index.tsx` — StatBar color prop에서 TREE_BROWN 상수 사용

## 검증
- typecheck: mobile 0 errors
- 기존 테스트에 영향 없음 (테스트에서 해당 색상값 직접 참조 없음)

## 다음 루프 참고
- P124 잔여 항목: 앱 아이콘, Sentry(blocked), App Store 메타데이터, 성능 프로파일링
- 앱 아이콘 + 스플래시 스크린이 다음 우선순위로 적절 (실제 에셋 생성 가능)
