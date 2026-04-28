# P4: 알람 정확도 강화

## 작업 항목
BACKLOG P4 — 알람 정확도 강화

## 발견된 버그 및 수정

### 버그 1: 반복 알람에 categoryIdentifier 누락 (심각)
- **위치**: `apps/mobile/src/services/notifications.ts` — syncAlarmNotifications
- **증상**: 매일(DAILY) 알람에만 `categoryIdentifier: ALARM_CATEGORY`가 있고, 주간 반복(WEEKLY) 알람에는 없었음
- **영향**: 반복 알람 수신 시 스누즈/끄기 버튼이 표시되지 않음
- **수정**: notification content를 한 번 구성하여 daily/weekly 모두 공유하도록 리팩토링

### 버그 2: Dismiss 액션이 플레이어 화면을 여는 문제 (중간)
- **위치**: `apps/mobile/app/_layout.tsx` — notification response listener
- **증상**: 사용자가 알람 "끄기" 버튼 탭 → actionId가 DISMISS_ACTION이지만 핸들링 안 됨 → messageId가 있으므로 플레이어 화면으로 이동
- **수정**: `if (actionId === DISMISS_ACTION) return;` 추가 + DISMISS_ACTION import

### 개선 3: 권한 미부여 시 알람 예약 방지
- **위치**: `apps/mobile/src/services/notifications.ts` — syncAlarmNotifications
- **내용**: 알람 예약 전 `getPermissionsAsync()` 체크 추가. 권한 없으면 조기 반환.

## 판단: alarmPlayback.ts는 현재 상태 유지
- 음성 URL은 mock URI(asset:///)를 사용 중 — R2 배포 전이므로 올바른 상태
- R2 다운로드 엔드포인트 추가는 P3 배포 이후 작업 (현재 wrangler deploy 미완)
- 위 weekday 매핑(0→1, N→N+1)은 JS Sunday=0 → Expo Sunday=1 변환이 정확함

## 변경 파일 (2개)
1. `apps/mobile/src/services/notifications.ts` — categoryIdentifier 통합 + 권한 체크
2. `apps/mobile/app/_layout.tsx` — DISMISS_ACTION 핸들링 추가

## 검증
- Mobile typecheck: ✅ 통과

## 다음 루프
P4 오프라인 캐싱 검증으로 진행.
