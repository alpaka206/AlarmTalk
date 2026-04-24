# P13: 쪽지 상세 화면 구현

**날짜**: 2026-04-24
**BACKLOG 항목**: 자가 생성 — STATE.md 알려진 이슈 "compose 탭: 쪽지 상세 화면 미구현" 해결

## 접근

STATE.md에 기록된 알려진 이슈를 해결. compose 탭에서 쪽지를 탭하면 인라인으로 텍스트만 표시되고 mark-as-read만 수행하던 것을 개선하여, 전용 상세 화면으로 네비게이션하도록 변경.

## 변경 파일

| 파일 | 변경 |
|------|------|
| `app/note/[id].tsx` | **신규** — 쪽지 상세 화면 (발신자 아바타+이름+이메일, 날짜/시간, 메시지 전문, 오디오 섹션 future-ready) |
| `app/(tabs)/compose.tsx` | `handleNotePress` — mark-as-read + `router.push(/note/${id})` 네비게이션 추가 |
| `app/_layout.tsx` | `note/[id]` Stack.Screen 등록 |
| `src/i18n/ko.json` | `noteDetail.*` 4키 추가 (title, notFound, messageLabel, audioAvailable) |
| `src/i18n/en.json` | 동일 4키 추가 |

## 설계 결정

- **데이터 소스**: react-query 캐시 (`notes-received` 키)에서 ID로 필터. 별도 API 호출 불필요.
- **자동 읽음 처리**: `useEffect`로 화면 진입 시 자동 `markNoteRead` 호출. 이미 읽은 쪽지는 스킵.
- **오디오 섹션**: `audio_url`이 null이 아닌 경우에만 표시 (현재 항상 null이지만, TTS 연동 시 자동 활성화).
- **다크모드**: `useTheme` + `createStyles(colors)` 패턴 사용 — 기존 프로젝트 컨벤션 준수.

## 검증

- mobile `npx tsc --noEmit` — 0 errors
- backend `npx tsc --noEmit` — 0 errors

## 다음 루프

알려진 이슈 1건 해소 (쪽지 상세 화면). 자가 생성 풀에서 다음 항목 선택.
