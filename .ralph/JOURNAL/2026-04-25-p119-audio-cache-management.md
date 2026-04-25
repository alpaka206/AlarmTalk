# P119 — 오디오 캐시 관리 (자동 정리)

## 선택한 항목
BACKLOG 고갈 — Section 4 "성능 프로파일링 + 최적화" 카테고리에서 새 항목 추가.
기존 오디오 캐시는 파일 저장만 하고 정리/삭제 기능이 없어 디바이스 저장 공간이 무한 증가하는 프로덕션 결함.

## 작업 내역

### 1. audio.ts 캐시 관리 함수 추가 (3개)
- `getCachedAudioFiles()` — 캐시 디렉토리의 모든 파일을 메타데이터(이름, 경로, 크기, 수정시간)와 함께 반환
- `cleanupAudioCache(maxSizeBytes)` — 총 캐시 크기가 제한(기본 200MB) 초과 시 가장 오래된 파일부터 삭제. 삭제 실패 시 건너뛰고 계속 진행.
- `clearAudioCache()` — 모든 캐시 파일 삭제 (설정에서 사용자가 수동 삭제 시 사용)

### 2. FileInfo 인터페이스 확장
- `modificationTime?: number` 필드 추가 — expo-file-system이 실제 반환하는 필드. 파일 나이 기반 eviction에 사용.

### 3. 앱 시작 시 자동 정리
- `_layout.tsx`에서 `ensureAudioDir().then(() => cleanupAudioCache())` 호출 추가
- 앱 시작마다 200MB 초과 시 자동으로 오래된 캐시 정리

### 4. 테스트 추가 (12개)
- `getCachedAudioFiles` (4 tests): 정상 목록, 빈 디렉토리, 존재하지 않는 파일 건너뛰기, modificationTime 폴백
- `cleanupAudioCache` (5 tests): 제한 이하 미삭제, 오래된 순 삭제, 다수 파일 삭제, 삭제 실패 허용, 정확히 제한 크기
- `clearAudioCache` (3 tests): 전체 삭제, 빈 캐시, 부분 실패 허용

## 변경 파일 (2개 수정, 0개 신규)
1. `apps/mobile/src/services/audio.ts` — FileInfo 확장 + getCachedAudioFiles + cleanupAudioCache + clearAudioCache 추가
2. `apps/mobile/app/_layout.tsx` — 앱 시작 시 cleanupAudioCache 호출 추가
3. `apps/mobile/test/audio.test.ts` — 12 tests 추가

## 검증
- 전체 테스트: mobile 1024/1024 (58 suites) — 기존 1012 + 12 신규
- typecheck: backend 0 errors, mobile 0 errors

## 판단 근거
- Section 4 항목 중 "성능 프로파일링 + 최적화" 선택
- 오디오 캐시 무한 증가는 실 서비스에서 가장 먼저 문제가 될 이슈 (특히 저용량 디바이스)
- 200MB 제한은 오디오 파일 특성상 합리적 (MP3 기준 약 2000~4000개 파일)
- LRU eviction (modificationTime 기반) — 가장 최근에 접근한 파일을 보존

### 5. 설정 화면 캐시 삭제 기능 연결 (P120)
- `settings/index.tsx`의 "캐시 삭제" 버튼이 Alert만 표시하고 실제 삭제를 하지 않던 버그 수정
- clearAudioCache import + Alert에 취소/삭제 버튼 추가 + 삭제 후 setCacheSize(0)

## 다음 루프 참고
- 캐시 관리 기능 완전 구현됨: 자동 정리(200MB) + 수동 삭제(설정 화면)
- 향후 고려: 캐시 크기 제한을 사용자 설정 가능하게 하거나, 삭제 완료 토스트 메시지 추가
