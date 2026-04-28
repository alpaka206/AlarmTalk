# VoiceAlarm Project Context

## 프로젝트 설명
소중한 사람의 음성을 클론하여 알람/응원 메시지를 보내주는 앱.
통화 녹음 → 화자 분리 → 음성 클론 → TTS → 알람/푸시에 활용.

## 기술 스택
- App: React Native (Expo) + expo-dev-client
- Backend: Turso DB + Cloudflare Workers
- AI: Perso.ai API (1차) + ElevenLabs API (보조)

## 핵심 규칙
- 실제 서비스 수준의 UX (감성적이면서 직관적인 톤)
- API 키는 절대 클라이언트에 노출하지 않음 (서버 프록시 필수)
- 알람은 OS 네이티브에 가깝게 정확해야 함
- 오디오 파일은 디바이스 로컬에 캐싱 (오프라인 재생 가능)
- 모바일 퍼스트 (웹은 보조)
- 한국어 기본 UI, 영어 지원
- 에러 핸들링 + 로딩/빈 상태 UI 모두 구현
- 개인정보(음성 데이터) 보안 최우선

## 모노레포 구조
- apps/mobile - React Native (Expo) 앱
- packages/backend - Cloudflare Workers API
