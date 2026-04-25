# P152 — dub/translate i18n 정리 + 비즈니스 로직 추출/테스트 36개 추가

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 blocked/manual. Section 4에 따라 "코드 품질 + 테스트 커버리지" 카테고리에서 선택.
코드 감사 실시 → dub/translate.tsx에서 하드코딩 문자열 + 추출 가능한 비즈니스 로직 발견.

## 작업 내역

### 1. i18n 하드코딩 수정
- `dub/translate.tsx` line 196: 하드코딩 `beta` 텍스트 → `t('dub.experimentBadge')` 전환
- ko.json + en.json에 `dub.experimentBadge: "beta"` 추가
- i18nKeys.test.ts allowedIdentical에 `dub.experimentBadge` 추가 (양 언어 동일값 허용)

### 2. 비즈니스 로직 추출
인라인 소스 언어 배열 + 유효성 검증 + 상태 판별 로직을 `src/lib/dubHelpers.ts`로 추출:
- `SOURCE_LANGUAGES` 상수 (ko/en/ja/zh, 네이티브 스크립트 이름)
- `filterTargetLanguages(languages, sourceLanguage)` — 소스 언어를 타겟 목록에서 제외
- `validateDubStart(target, source)` — 번역 시작 전 유효성 검증
- `getDubPhase(dubStatus, isPending)` — idle/processing/ready/failed 상태 결정
- `shouldSaveAudio(result)` — audio_base64 + result_message_id 존재 확인

translate.tsx에서 이 함수들을 import하여 사용하도록 리팩토링.

### 3. 단위 테스트 36개 추가
`test/dubTranslateScreen.test.ts`:
- SOURCE_LANGUAGES: 5 tests (개수, 코드 목록, 비어있지 않은 이름/코드, 중복 없음)
- filterTargetLanguages: 7 tests (소스 제외, undefined/빈 배열, experiment 보존, 단일 항목)
- validateDubStart: 6 tests (빈 타겟, 동일 언어, 정상 케이스)
- getDubPhase: 10 tests (idle/processing/ready/failed 조합, 우선순위)
- shouldSaveAudio: 8 tests (null/undefined/빈문자열/정상 조합)

## 변경 파일 (6개)
1. `apps/mobile/src/lib/dubHelpers.ts` — 신규, 순수 비즈니스 로직 5개 추출
2. `apps/mobile/app/dub/translate.tsx` — dubHelpers import 사용 + "beta" i18n 전환
3. `apps/mobile/src/i18n/ko.json` — `dub.experimentBadge` 추가
4. `apps/mobile/src/i18n/en.json` — `dub.experimentBadge` 추가
5. `apps/mobile/test/i18nKeys.test.ts` — allowedIdentical 추가
6. `apps/mobile/test/dubTranslateScreen.test.ts` — 신규, 36 tests

## 검증
- Backend typecheck: 0 errors ✅
- Mobile typecheck: 0 errors ✅
- 신규 테스트: 36/36 passed ✅
- 전체 테스트: 1926/1926 passed (1890 → 1926, +36) ✅

## 다음 루프 참고
- dubHelpers.ts는 순수 함수만 포함, native module 의존성 없음 → 테스트 용이
- translate.tsx의 폴링/재생 로직은 React Hook + native module에 결합되어 별도 추출 어려움
- 미테스트 스크린 잔여 5개 (voice/upload, voice/[id], voice/diarize, voice/picker, family-alarm/create) — 대부분 로직 밀도 낮음
