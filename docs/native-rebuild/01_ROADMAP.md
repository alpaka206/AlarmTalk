# Native Rebuild Roadmap

## Phase 1: Android Alarm Engine

Goal: Android 실기기에서 알람앱의 핵심 신뢰성을 먼저 검증한다.

완료 기준:

- 1-5분 뒤 테스트 알람 생성
- AlarmManager 정확 알람 등록
- foreground/background에서 울림
- 화면 꺼짐/잠금화면에서 울림
- Doze/idle 상태에서 울림
- full-screen ringing 화면 표시
- 기본 알람음 반복 재생
- 진동 반복
- dismiss
- snooze
- 재부팅 후 BootCompletedReceiver로 재등록

## Phase 2: Android Local Alarm App

Goal: 네트워크 없이 동작하는 로컬 알람앱을 완성한다.

완료 기준:

- Room/DataStore 로컬 저장
- 알람 목록/생성/수정/삭제
- 반복 요일
- 스누즈 설정
- 진동 설정
- 알람만 / 음성만 / 알람 + 음성
- 로컬 오디오 경로 저장
- 앱 재시작 후에도 스케줄 유지

## Phase 3: Android Audio + Voice

Goal: 보이스 알람의 오디오 흐름을 완성한다.

완료 기준:

- 앱 내 녹음
- 파일 업로드
- 30초 제한/crop
- 원본 음성 알람
- TTS 오디오 다운로드/캐싱
- 알람 설정 시점에 오디오 로컬 준비
- 비행기 모드에서도 예약된 보이스 알람 울림

## Phase 4: Backend Integration

Goal: 기존 Cloudflare Workers 백엔드를 네이티브 앱에 연결한다.

완료 기준:

- env 기반 API URL 설정
- 로그인/회원가입
- 알람 CRUD sync
- 음성 프로필 조회
- perso.ai voice clone
- TTS 생성
- 생성된 오디오 로컬 캐싱
- 서버 장애/오프라인 상태에서도 기존 예약 알람은 울림

## Phase 5: Social Voice Sharing

Goal: 가족/연인 연결과 보이스 공유를 붙인다.

완료 기준:

- 6자리 초대 코드 발급
- 코드 입력/수락
- 연결된 사용자 목록
- 상대방 보이스 공유
- 권한 검증
- 공유 보이스로 만든 알람도 로컬 캐싱 후 울림

## Phase 6: Character, Streak, Billing

Goal: 사용 지속성과 수익화 기능을 붙인다.

완료 기준:

- 알람 완료 이벤트
- 스트릭
- XP
- 알/병아리/닭/황금닭 성장
- 무료/개인/커플/가족 플랜 제한
- 선물 코드

## Phase 7: iOS Native Implementation

Goal: SwiftUI + AlarmKit 기반으로 iOS parity를 구현한다.

완료 기준:

- AlarmKit PoC 결과 문서화
- 1회/반복 알람
- 스누즈/dismiss
- 가능한 범위의 커스텀 로컬 음성 알람
- iOS 제약에 맞춘 UX 조정

