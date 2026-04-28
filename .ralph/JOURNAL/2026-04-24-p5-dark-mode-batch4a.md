# P5: 다크모드 스택 화면 마이그레이션 Batch 4-A

## 작업 항목
BACKLOG P5 — 다크모드 Batch 4-A: 큰 스택 화면 6개 `Colors.light` → `useTheme()` + `createStyles(colors)` 전환

## 접근 방식
Batch 1-3에서 확립한 패턴을 큰 스택 화면 6개에 적용.

### 특이 케이스 처리
1. **gift/received.tsx (서브 컴포넌트)**: `SkeletonGiftCard`와 `SkeletonGiftList`가 모듈 스코프의 `styles` 참조. `createStyles` 전환 후 모듈 스코프에 `styles`가 사라지므로, `dynStyles: ReturnType<typeof createStyles>` prop을 추가하여 부모 컴포넌트에서 전달하도록 변경. Batch 3의 PeopleSkeletonCard 패턴과 일관.

### 인라인 JSX 컬러 참조
- `placeholderTextColor={Colors.light.textTertiary}` → `{colors.textTertiary}` (message/create 2곳, family-alarm/create 2곳, voice/diarize 1곳)
- `<ActivityIndicator color={Colors.light.primary}` → `color={colors.primary}` (dub/translate 2곳, family-alarm/create 1곳, voice/[id] 1곳)
- 모두 컴포넌트 스코프의 `colors` 변수로 정상 바인딩 확인

## 변경 파일 (6개)
1. `apps/mobile/app/message/create.tsx` — 53개 참조 제거
2. `apps/mobile/app/dub/translate.tsx` — 30개 참조 제거
3. `apps/mobile/app/family-alarm/create.tsx` — 25개 참조 제거
4. `apps/mobile/app/voice/diarize.tsx` — 23개 참조 제거
5. `apps/mobile/app/voice/[id].tsx` — 23개 참조 제거
6. `apps/mobile/app/gift/received.tsx` — 22개 참조 제거 (서브 컴포넌트 dynStyles 패턴 적용)

## 검증
- Mobile typecheck: ✅ 통과
- Backend typecheck: ✅ 통과
- 6개 파일 `Colors.light` 참조: 0개

## 남은 작업
P5 다크모드 Batch 4-B: 나머지 스택 화면 6개 (~93개 Colors.light 참조)
- voice/record (21), voice/picker (19), message/[id] (18)
- onboarding (12), voice/upload (12), player (11)
- friend/[id] — 이미 0개 (이전 배치에서 처리 완료)
