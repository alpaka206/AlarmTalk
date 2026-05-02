# Voice Alarm Native Rebuild Goal

Voice Alarm을 Android/iOS 풀 네이티브 알람 서비스로 완성한다.

최종 완료 기준은 MVP 기획서의 핵심 기능이 실제 기기에서 안정적으로 작동하는 것이다.

- 일반 알람
- 보이스 알람
- 원본 음성 알람
- 음성 프로필 등록
- 앱 내 녹음
- 파일 업로드
- 30초 이내 crop/제한 정책
- perso.ai 음성 복제
- TTS 메시지 생성
- 프리셋/랜덤 메시지
- 알람만 / 음성만 / 알람 + 음성
- 반복 요일
- 스누즈
- 진동
- 로그인/회원가입
- 백엔드 동기화
- 로컬 오디오 캐싱
- 초대 코드 기반 가족/연인 연결
- 상대방 보이스 공유
- 캐릭터 성장/스트릭/XP
- 구독 플랜/사용 제한

핵심 조건:

- 이 앱은 notification/reminder 앱이 아니라 실제 알람 앱이다.
- 알람은 push notification이나 서버 cron에 의존하지 않는다.
- 알람은 OS 네이티브 알람 메커니즘과 로컬 오디오 기반으로 동작한다.
- 울리는 시점에는 네트워크 fetch 없이 로컬 DB와 로컬 오디오만 사용한다.
- Android는 Kotlin/Jetpack Compose로 먼저 완성한다.
- iOS는 SwiftUI/AlarmKit 가능성을 초반에 검증하고, Android MVP가 안정화된 뒤 본구현한다.

