# P5: 알람 진동 패턴 선택

## BACKLOG 항목
- 알람 생성 시 진동 패턴 선택 (기본/강하게/없음) — `expo-haptics` 활용

## 접근
풀스택 구현: DB 마이그레이션 → 백엔드 API → 프론트엔드 타입/폼/UI → i18n.

### 백엔드
- **마이그레이션 15** (`alarm-vibration-pattern`): alarms 테이블에 `vibration_pattern TEXT NOT NULL DEFAULT 'default' CHECK(...)` 컬럼 추가
- **alarm.ts 라우트**: POST/PATCH 에 `vibration_pattern` 필드 추가 (body 타입, 유효성 검증, INSERT/UPDATE, normalizeAlarmRow)
- 유효값: `'default' | 'strong' | 'none'`

### 프론트엔드
- **types.ts**: `VibrationPattern` 타입 + `Alarm` 인터페이스에 `vibration_pattern?` 필드 추가
- **alarmForm.ts**: `AlarmFormInput.vibrationPattern` + `AlarmCreatePayload.vibration_pattern` 추가, `buildCreatePayload`에서 전달
- **api.ts**: `createAlarm`, `updateAlarm` 파라미터에 `vibration_pattern` 추가
- **create.tsx**: 진동 패턴 3개 선택 UI (스누즈와 동일 칩 스타일), expo-haptics 미리보기
- **edit.tsx**: 동일 UI + 기존 알람 데이터에서 vibration_pattern 로드
- **expo-haptics** 설치: 선택 시 Medium/Heavy 임팩트 피드백 (none은 무진동)

### i18n
- ko: 진동, 기본, 강하게, 없음
- en: Vibration, Default, Strong, None

## 변경 파일
1. `packages/backend/src/lib/migrations.ts` — 마이그레이션 15 추가
2. `packages/backend/src/routes/alarm.ts` — VIBRATION_PATTERNS, 유효성검증, CRUD, normalizeAlarmRow
3. `apps/mobile/src/types.ts` — VibrationPattern 타입 + Alarm 인터페이스
4. `apps/mobile/src/lib/alarmForm.ts` — AlarmFormInput/AlarmCreatePayload + buildCreatePayload
5. `apps/mobile/src/services/api.ts` — createAlarm/updateAlarm 파라미터
6. `apps/mobile/app/alarm/create.tsx` — 진동 UI + Haptics import + selectVibration
7. `apps/mobile/app/alarm/edit.tsx` — 동일 진동 UI + 기존값 로드 + mutation 타입 수정
8. `apps/mobile/src/i18n/ko.json` — vibration 키 4개
9. `apps/mobile/src/i18n/en.json` — vibration 키 4개
10. `apps/mobile/package.json` — expo-haptics 설치

## 검증
- Backend: `npx tsc --noEmit` 통과
- Mobile: `npx tsc --noEmit` 통과

## 다음 루프 주의사항
- expo-haptics는 실 디바이스/에뮬레이터에서만 동작 (웹에서는 무시됨)
- 알람 노티피케이션의 실제 진동 패턴 반영은 `syncAlarmNotifications` 쪽 추후 연동 필요
- expo-notifications의 vibrationPattern 옵션과 연동하면 OS 레벨 진동 가능
