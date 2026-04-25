# P130 — App Store / Google Play 메타데이터 준비

## 선택한 항목
BACKLOG P124 "App Store / Google Play 메타데이터 준비"

## 작업 내역

### store.config.json 생성
EAS Metadata 포맷의 `apps/mobile/store.config.json` 생성. 양대 스토어 출시에 필요한 메타데이터를 한국어/영어 이중 언어로 작성.

### Apple App Store 메타데이터
- **title**: VoiceAlarm / 보이스알람
- **subtitle**: "Wake up to a loved one's voice" / "사랑하는 사람의 목소리로 일어나세요"
- **description**: 서비스 정체성(음성 클론 알람) + 주요 기능 8개 + 무료/유료 플랜 설명
- **keywords**: 10개씩 (영어/한국어)
- **categories**: LIFESTYLE, UTILITIES
- **advisory**: 전체 이용가 (모든 항목 NONE)
- **review contact**: 사용자 이메일 (devrel.365@gmail.com)

### Google Play 메타데이터
- **defaultLanguage**: ko-KR
- **title**: 30자 이내 (스토어 제한 준수)
- **shortDescription**: 80자 이내 (스토어 제한 준수)
- **fullDescription**: Apple과 동일 내용
- **category**: LIFESTYLE
- **contentRating**: ALL_AGES
- **pricing**: free (인앱 결제 별도)

### placeholder URL
- privacyPolicyUrl, supportUrl, marketingUrl → `voicealarm.app` 도메인으로 설정
- 실 배포 전 사용자가 실제 URL로 교체 필요
- review.phone → placeholder, 사용자가 실제 번호로 교체 필요

## 변경 파일 (1개, 신규)
1. `apps/mobile/store.config.json` — EAS Metadata 스토어 설정

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- JSON 문법 유효성 확인 (Write 성공)

## 다음 루프 참고
- `eas metadata:push`로 실제 스토어 반영 가능 (사용자가 Apple/Google 계정 연동 후)
- 스크린샷, 앱 프리뷰 영상은 별도 준비 필요 (자동화 불가, 실 디바이스 캡처 필요)
- privacy policy / support 페이지 실제 호스팅 필요
- review.phone 실제 번호 교체 필요
- BACKLOG 잔여 미완료: 앱 아이콘+스플래시 (이미 자산 존재, 디자인 검증만 필요), Sentry DSN (blocked)
