# P180 — i18n 미사용 키 정리 + 역방향 검증 테스트 추가

## 선택한 항목
BACKLOG 미완료 항목 전부 blocked/manual. Section 4에 따라 코드 품질 개선 — i18n 미사용 키 정리.

## 배경
P179에서 `common.back`이 미사용 상태로 발견됨. 역방향 검증(key→code)이 없어서 미사용 키가 누적될 수 있었음.

## 작업 내역

### 1. 미사용 i18n 키 감사
- 전체 ko.json 키(867개)를 소스 코드 참조와 대조
- `extractLiteralKeys` 함수가 배열 요소 패턴(`'key.subkey',`)을 놓치는 문제 발견 → 개선
- 동적 키 5개 식별 (template literal로 구성): `alarmCreate.vibration*` (3), `dub.selectLanguage`, `dub.sameLanguage`
- `home.activityType*` (4)도 동적이나 개선된 regex가 잡아냄

### 2. 미사용 키 39개 삭제 (ko.json + en.json 양쪽)
| 네임스페이스 | 삭제 키 수 | 예시 |
|---|---|---|
| alarmCreate | 3 | emptyMessage, selectMessage, selectMessageTitle |
| common | 2 | back, send |
| dub | 2 | jobs, noJobs |
| friendProfile | 1 | a11yBack |
| friends | 4 | myFriends, pendingRequests, sendSuccessTitle, title |
| giftReceived | 1 | acceptSuccessTitle |
| home | 1 | receivedGifts |
| library | 2 | subtitle, title |
| messageCreate | 5 | giftSentTitle, later, savedDesc, savedTitle, setAlarm |
| messageDetail | 3 | category, createdAt, setAsAlarm |
| people | 3 | manage, noInvites, revoked |
| settings | 3 | deleteAccountSuccess, deleting, languageKorean |
| voiceDiarize | 2 | analyzeErrorTitle, nameRequiredTitle |
| voiceRecord | 2 | inputRequiredTitle, tooShortTitle |
| voiceUpload | 1 | inputRequiredTitle |
| voices | 4 | callRecord, callRecordDesc, registered, searchPlaceholder |

### 3. i18nKeys.test.ts 개선
- `extractLiteralKeys`: mapRe(`/:\s*'key'/g`) → bareRe(`/'key.subkey'/g`)로 개선. 배열 요소, 상수 할당 등 더 많은 패턴 캐치.
- `DYNAMIC_KEY_PREFIXES` 상수 추가: 동적 키 패턴 4개 등록
- "no dead keys in ko.json (reverse validation)" 테스트 추가 (15번째 테스트)
- `allowedIdentical` 세트에서 삭제된 `settings.languageKorean` 제거

## 변경 파일 (3개)
1. `apps/mobile/src/i18n/ko.json` — 39개 미사용 키 삭제
2. `apps/mobile/src/i18n/en.json` — 39개 미사용 키 삭제
3. `apps/mobile/test/i18nKeys.test.ts` — extractLiteralKeys 개선 + 역방향 검증 테스트 추가

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- i18nKeys tests: 15/15 통과 (신규 1개 포함)

## 다음 루프 참고
- 향후 미사용 키 발생 시 역방향 검증 테스트가 즉시 탐지함
- 새 i18n 키 추가 시 반드시 소스 코드에서 참조해야 테스트 통과
- 동적 키 추가 시 `DYNAMIC_KEY_PREFIXES`에 패턴 등록 필요
