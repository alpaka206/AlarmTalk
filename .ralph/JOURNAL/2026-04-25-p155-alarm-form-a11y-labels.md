# P155 — 알람 생성/편집 폼 접근성 레이블 누락 보완

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 4에 따라 접근성 강화 작업 수행.
전체 앱 스캔 결과, `alarm/create.tsx`와 `alarm/edit.tsx`에서 mode/wakeMode 라디오 버튼 8개에 `accessibilityLabel` 누락 발견.

## 작업 내역

### 전체 앱 접근성 감사
- `apps/mobile/app/` + `apps/mobile/src/components/` 전체 파일을 대상으로 `<TouchableOpacity|Pressable>` 요소 수 vs `accessibilityLabel` 수 비교
- 결과: `alarm/create.tsx` (21개 중 17개) + `alarm/edit.tsx` (18개 중 14개) — 총 8개 누락
- 나머지 모든 파일은 `accessibilityLabel` 완전 충족

### 수정 (8개 레이블 추가)
**alarm/create.tsx** (4개):
1. 재생 모드: TTS 라디오 — `accessibilityLabel={t('alarmCreate.ttsMode')}`
2. 재생 모드: 알람소리 라디오 — `accessibilityLabel={t('alarmCreate.soundOnlyMode')}`
3. 깨우기 방식: 소리+음성 라디오 — `accessibilityLabel={t('alarmCreate.soundThenVoice')}`
4. 깨우기 방식: 음성만 라디오 — `accessibilityLabel={t('alarmCreate.voiceOnly')}`

**alarm/edit.tsx** (4개):
동일 패턴 — 재생 모드 2개 + 깨우기 방식 2개

### 전체 앱 확인
- 수정 후 재스캔: 모든 파일에서 `<TouchableOpacity|Pressable>` 수 == `accessibilityLabel` 수 완전 일치
- `accessibilityRole` 역시 모든 파일에서 완전 일치 확인

## 변경 파일 (2개)
1. `apps/mobile/app/alarm/create.tsx` — 4개 accessibilityLabel 추가
2. `apps/mobile/app/alarm/edit.tsx` — 4개 accessibilityLabel 추가

## 검증
- Backend typecheck: 0 errors
- Mobile typecheck: 0 errors
- 전체 앱 a11y 감사: 100% 커버리지 (모든 터치 요소에 accessibilityRole + accessibilityLabel 존재)

## 다음 루프 참고
- 접근성 레이블은 이제 앱 전체에서 완전 커버됨
- 다음 접근성 작업으로는 `accessibilityHint` 추가, 스크린 리더 네비게이션 순서 최적화, 고대비 모드 검증 등 가능
