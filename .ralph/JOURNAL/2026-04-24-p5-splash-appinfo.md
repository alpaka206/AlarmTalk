# P5: 스플래시 스크린 + 앱 정보 섹션

## BACKLOG 항목
- 앱 스플래시 스크린 설정 — `app.json`의 splash 설정, 코랄 배경 + 앱 로고 텍스트
- 설정 화면에 "앱 정보" 섹션 (버전, 라이선스, 개인정보 처리방침 링크)

## 접근
두 항목 모두 소규모이므로 하나의 iteration에서 함께 처리.

### 스플래시 스크린
- `app.json`의 `splash.backgroundColor`를 `#FFF5F3`(warmBg) → `#FF7F6B`(coral primary)로 변경
- `android.adaptiveIcon.backgroundColor`도 동일하게 coral로 변경
- 앱 아이콘 PNG는 기존 것을 유지 (이미지 생성은 이 루프 범위 밖)

### 앱 정보 섹션 강화
- "App" 섹션의 version 행을 "Info" 섹션으로 이동 (EAS 빌드 표시 포함)
- 이용약관/개인정보처리방침/오픈소스 라이선스에 실 URL `Linking.openURL` 연결 (voicealarm.app 도메인)
- "문의하기" 행 추가 — mailto:devrel.365@gmail.com
- 앱 하단에 브랜드 푸터 (VoiceAlarm + 설명문 + 저작권 표시)
- i18n 키 3개 추가: `contactSupport`, `appDescription`, `buildNumber` (ko/en)
- 다크모드 호환: 기존 `colors` 토큰 사용으로 자동 지원

## 변경 파일
1. `apps/mobile/app.json` — splash/adaptiveIcon backgroundColor → #FF7F6B
2. `apps/mobile/app/(tabs)/settings.tsx` — 앱 정보 섹션 강화 + 푸터 + 스타일 추가
3. `apps/mobile/src/i18n/ko.json` — 3개 키 추가
4. `apps/mobile/src/i18n/en.json` — 3개 키 추가

## 검증
- `npx tsc --noEmit` 통과 (에러 없음)

## 다음 루프 주의사항
- voicealarm.app 도메인의 terms/privacy/licenses 페이지는 아직 실존하지 않음 — 배포 시 페이지 생성 필요
- 스플래시 이미지(splash-icon.png)는 기본 Expo 아이콘 — 커스텀 디자인 필요
