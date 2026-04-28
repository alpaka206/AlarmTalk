# P160 — 설정 화면 비활성 UI 수정 + 알림 기본설정 스토어

## 선택한 항목
P157 완료 후 추가 QA. 설정 화면에서 5개 비활성/하드코딩 UI 발견.

## 작업 내역

### 1. useAppStore 알림 기본설정 추가
- `alarmNotifications: boolean` (기본 true) — 알람 알림 수신 여부
- `messageNotifications: boolean` (기본 true) — 메시지 알림 수신 여부
- `setAlarmNotifications`, `setMessageNotifications` setter 추가
- AsyncStorage 영속화 ('alarm_notifications', 'message_notifications')
- `loadPersistedState`에서 복원 (기본값: true — 'false' 명시 시에만 비활성)

### 2. 설정 화면 수정 (5건)
1. **알람 알림 Switch**: `value={true}` → `value={alarmNotifications}` + `onValueChange={setAlarmNotifications}`
2. **메시지 알림 Switch**: 동일 패턴
3. **플랜 관리**: `onPress={() => {}}` → `onPress={() => router.push('/code-register')}`
4. **음성 품질**: dead `onPress={() => {}}` 제거 (읽기 전용 정보)
5. **언어 설정**: `onPress={() => {}}` → `onPress={() => i18n.changeLanguage(...))`

### 3. 추가 import
- `useRouter` from expo-router
- `i18n` from useTranslation (destructured)

## 변경 파일 (2개)
1. `apps/mobile/src/stores/useAppStore.ts` — 알림 기본설정 2필드 + setter 2개 + 영속화
2. `apps/mobile/app/settings/index.tsx` — 5개 비활성 UI 수정

## 검증
- Mobile typecheck: 0 errors ✅
- 기존 테스트 영향 없음 (settingsScreen.test.ts에 알림 Switch 참조 없음)

## 다음 루프 참고
- 알림 기본설정은 로컬 저장만 (FCM 서버 구독 해제는 미구현 — FCM 자체가 mock 상태)
- 실 FCM 연동 시 서버 측에서도 토픽 구독/해제 구현 필요
