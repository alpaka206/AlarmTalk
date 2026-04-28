# R2: 알람 설정 리빌드

**날짜**: 2026-04-24
**BACKLOG 항목**: R2 (알람 설정 리빌드)

## 접근

### 백엔드 변경
1. **마이그레이션 17**: `alarms` 테이블에 `wake_mode` + `voice_profile_id` 컬럼 추가
   - `wake_mode`: `sound_then_voice` (기본) / `voice_only`
   - `voice_profile_id`: 이미 존재했지만 마이그레이션에서 명시적 추가 (idempotent)
2. **alarm.ts 라우트**: `WAKE_MODES` 상수 + `WakeMode` 타입 + POST/PATCH 검증·저장·응답에 `wake_mode` 추가
3. **프리셋 메시지 API**: 이미 `/tts/presets`에 구현되어 있음 (static data file) — 추가 작업 불필요

### 프론트엔드 변경
1. **alarmForm.ts**: `WakeMode` 타입, `AlarmFormInput.wakeMode`, `AlarmCreatePayload.wake_mode` 추가
2. **types.ts**: `WakeMode` 타입, `Alarm.wake_mode` 추가
3. **api.ts**: `createAlarm`, `updateAlarm` params에 `wake_mode` 추가
4. **alarm/create.tsx**: `wakeMode` 상태 + 깨우기 방식 선택 UI (TTS 모드일 때만 표시)
5. **i18n**: `wakeMode`, `soundThenVoice`, `voiceOnly` 3키 추가 (ko/en)

## 스코프 결정

R2 BACKLOG에는 "음성 캐싱", "프리셋 메시지 UI", "최근 사용 메시지" 등도 있지만,
한 iteration에서 너무 많은 변경을 하지 않기 위해 핵심(wake_mode + voice toggle)만 구현.
나머지는 R2 추가 iteration 또는 R5 정비에서 진행.

## 변경 파일

| 파일 | 변경 |
|------|------|
| `packages/backend/src/lib/migrations.ts` | 마이그레이션 17: wake_mode, voice_profile_id |
| `packages/backend/src/routes/alarm.ts` | WAKE_MODES, WakeMode, POST/PATCH에 wake_mode 지원 |
| `apps/mobile/src/lib/alarmForm.ts` | WakeMode 타입, 폼·페이로드에 wakeMode 추가 |
| `apps/mobile/src/types.ts` | WakeMode 타입, Alarm.wake_mode 추가 |
| `apps/mobile/src/services/api.ts` | createAlarm, updateAlarm에 wake_mode 추가 |
| `apps/mobile/app/alarm/create.tsx` | wakeMode 상태 + 깨우기 방식 선택 UI |
| `apps/mobile/src/i18n/ko.json` | alarmCreate.wakeMode/soundThenVoice/voiceOnly 3키 |
| `apps/mobile/src/i18n/en.json` | 동일 |

## 검증

- backend `npx tsc --noEmit` — 0 errors
- mobile `npx tsc --noEmit` — 0 errors

## 다음 루프 주의사항

- alarm/edit.tsx에도 wake_mode UI를 추가해야 함 (현재 create만 구현)
- 음성 캐싱, 프리셋 메시지 선택 UI는 미구현
- R5 정비에서 alarm/edit 동기화 + 미구현 R2 항목 처리
