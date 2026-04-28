# P5: 알람 시간 설정 UI 개선

## 작업 항목
BACKLOG P5 — 알람 시간 설정 UI 개선

## 변경 내용

### 1. AM/PM 표시 추가
- 시간 피커 상단에 "오전/오후" (AM/PM) 라벨 표시
- 24시간 기준으로 hour < 12면 오전, 아니면 오후

### 2. "알람까지 남은 시간" 표시
- 시간 피커 하단에 "7시간 32분 후에 울려요" 형태의 헬퍼 텍스트 추가
- `getTimeUntilAlarm()` 유틸리티를 `alarmForm.ts`에 추가
- 0시간/0분 경우에 대한 별도 포맷 문자열 처리

### 3. 하드코딩 한국어 → i18n 전환 (7개 문자열)
- "재생 모드" → `alarmCreate.playMode`
- "TTS" → `alarmCreate.ttsMode`
- "원본" → `alarmCreate.soundOnlyMode`
- "음성 프로필" → `alarmCreate.voiceProfile`
- "원본 재생 모드는 등록된 음성 프로필이 필요해요." → `alarmCreate.voiceProfileRequired`
- "원본 재생 모드에서는 음성 프로필을 지정해야 합니다." → `alarmCreate.voiceProfileHint`
- create.tsx + edit.tsx 양쪽 모두 적용

### 4. 터치 타겟 확대
- timeArrow 스타일에 `minWidth: 44, minHeight: 44` 추가 (디자인 가이드 준수)
- `justifyContent: 'center', alignItems: 'center'` 추가로 화살표 중앙 정렬

### 5. 접근성 라벨 추가
- 4개 화살표 버튼에 `accessibilityLabel` + `accessibilityRole="button"` 추가
- 시간 올리기/내리기, 분 올리기/내리기

### i18n 키 추가 (17개, ko/en)
- alarmCreate: playMode, ttsMode, soundOnlyMode, voiceProfile, voiceProfileRequired, voiceProfileHint
- alarmCreate: am, pm, alarmIn, alarmInMinutes, alarmInHours
- alarmCreate: hourUp, hourDown, minuteUp, minuteDown

## 변경 파일
1. `apps/mobile/src/i18n/ko.json` — 17개 키 추가
2. `apps/mobile/src/i18n/en.json` — 17개 키 추가
3. `apps/mobile/src/lib/alarmForm.ts` — `getTimeUntilAlarm()` 함수 추가
4. `apps/mobile/app/alarm/create.tsx` — AM/PM, 남은시간, i18n, 터치타겟, 접근성
5. `apps/mobile/app/alarm/edit.tsx` — 동일 개선사항 적용

## 검증
- Mobile typecheck: ✅ 통과

## 미해결 (별도 작업)
- `alarmForm.ts`의 validateAlarmForm()에 하드코딩 한국어 에러 메시지가 남아 있음 (i18n 함수 전달 또는 에러 키 반환 방식으로 리팩토링 필요)
- `alarmPlayback.ts`의 reason 문자열도 한국어 하드코딩 (내부 로그 용도이므로 우선순위 낮음)

## 다음 루프
P5 홈 화면 레이아웃 정리 또는 접근성 점검.
