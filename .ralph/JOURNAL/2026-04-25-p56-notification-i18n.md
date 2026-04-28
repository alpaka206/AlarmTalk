# P56 — 알림 채널/액션 버튼 i18n 전환

## 선택한 항목
자가 생성: notifications.ts 하드코딩 한국어 10건 → i18n 전환

## 배경
notifications.ts에 Android 알림 채널 이름/설명 8건 + 알람 액션 버튼 2건이 한국어로 하드코딩.
i18n 키는 이미 `settings.channel*`로 존재했지만 실제 채널 생성 코드에서 사용하지 않고 있었음.

## 접근
- 채널/카테고리 생성 코드가 모듈 최상위 side effect로 실행 → i18n 초기화 이전에 실행됨
- `configureNotificationChannels(t: TFunction)` 함수로 래핑하여 lazy 초기화로 전환
- `_layout.tsx`의 useEffect에서 i18n 준비 후 호출

## 대안 검토
- i18next의 `t()` 직접 import → 모듈 로드 시점에 i18n 미초기화 가능성 있어 기각
- 하드코딩 유지 → i18n 일관성 위배, 영어 사용자에게 한국어 채널명 노출

## 변경 파일
1. `src/services/notifications.ts` — top-level side effect → `configureNotificationChannels(t)` 함수, `TFunction` import 추가
2. `app/_layout.tsx` — `configureNotificationChannels` import + useEffect에서 호출
3. `src/i18n/ko.json` — `notification.snoozeAction`, `notification.dismissAction` 2키 추가
4. `src/i18n/en.json` — 동일 2키 추가

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 테스트: mobile 466/466, a11y-audit 30/30 (i18n ko↔en 동기화 확인)

## 다음 루프 참고
- ProfileDropdown `'한국어'` / dub/translate `'한국어'` — 이들은 언어 endonym으로 의도적 하드코딩이므로 i18n 대상 아님
- 남은 하드코딩 한국어: alarmPlayback.ts TODO 관련 mock URL 코멘트뿐 (Perso API 블록됨)
- 대형 파일 후보: backend family.ts (834줄), voice.ts (589줄), alarm.ts (536줄)
