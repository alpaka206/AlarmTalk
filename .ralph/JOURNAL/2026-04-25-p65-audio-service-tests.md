# P65 — Audio 서비스 유닛 테스트

## 선택한 항목
BACKLOG 고갈 → 자가 생성: 미테스트 모바일 서비스 커버리지 확장

## 선택 이유
BACKLOG 전체 완료. audio.ts (170줄, 11개 exported 함수)는 앱 핵심 기능(음성 녹음/재생/캐싱)을 담당하면서 테스트 커버리지가 0이었음. expo-av + expo-file-system 모킹이 복잡하여 이전 루프에서 스킵되었으나, jest.requireMock 패턴으로 해결.

## 접근
expo-av, expo-file-system/legacy, react-native를 jest.mock으로 인라인 모킹. jest.mock 팩토리에서 외부 변수 참조 시 TDZ 이슈가 발생하므로 모든 mock을 인라인 jest.fn()으로 정의하고, import 후 jest.requireMock()으로 참조 획득.

### 핵심 발견 — Jest mock 변수 참조 이슈
jest.mock 팩토리 내에서 파일 스코프 변수를 참조하면, jest 호이스팅으로 인해 해당 변수가 아직 초기화되지 않은 상태에서 참조됨. `mock` 접두사 변수는 jest가 특별 처리하지만, import 호이스팅 때문에 여전히 undefined일 수 있음. 해결: mock 함수를 팩토리 내 인라인으로 정의하고, `jest.requireMock()`로 참조를 획득하는 패턴이 안정적.

### 테스트 28건
- getLocalAudioPath: 경로 생성 3건 (기본 mp3, 커스텀 포맷, 특수문자)
- ensureAudioDir: 디렉토리 생성 2건 (미존재시 생성, 존재시 스킵)
- setupAudioSession: 오디오 모드 설정 1건
- requestMicPermission: 권한 결과 2건 (부여/거부)
- startRecording: 녹음 시작 3건 (인스턴스 생성, 미터링 옵션, 세션 설정 순서)
- stopRecording: 녹음 중지 3건 (정상, ms→s 변환, 0ms)
- saveAudioLocally: 로컬 저장 3건 (mp3, 커스텀 포맷, 디렉토리 자동 생성)
- isAudioCached: 캐시 확인 3건 (존재/미존재/커스텀 포맷)
- playAudio: 재생 1건 (오디오 모드 + Sound.createAsync)
- deleteLocalAudio: 삭제 3건 (존재시 삭제/미존재시 스킵/커스텀 포맷)
- getAudioCacheSize: 캐시 크기 4건 (합계/빈 디렉토리/null size/미존재 파일)

## 변경 파일
1. `apps/mobile/test/audio.test.ts` 신규 (221줄, 28 tests)

## 검증
- typecheck: mobile 0 errors, backend 0 errors
- 테스트: mobile 625/625 통과 (기존 597 + P65 28), backend 672/672 통과

## 다음 루프 참고
- 남은 미테스트 서비스: auth.ts (토큰 관리/소셜 로그인 — useAuth.test.ts에서 일부 커버됨)
- 남은 미테스트 컴포넌트: CoupleView, MiniWaveformPlayer, LoginButtons, FamilyMemberRow — 모두 UI 의존성 높아 순수 로직 추출 한계
- jest.requireMock 패턴이 expo 네이티브 모듈 테스트의 표준 접근법으로 확인됨
