# Compose 탭: 쪽지 읽음 처리 구현

**날짜**: 2026-04-24
**BACKLOG 항목**: 알려진 이슈 — compose 탭 쪽지 읽음 처리

## 접근

compose.tsx의 `renderNoteItem`이 View로만 감싸져 있어 탭 불가능했다. TouchableOpacity로 변경하고, 미읽음 쪽지를 탭하면 `markNoteRead` API를 호출하여 읽음 처리.

## 변경 사항

### compose.tsx
- `useQuery` → `useQuery + useMutation + useQueryClient` import
- `markNoteRead` API import
- `readMutation` 추가 — `markNoteRead` 호출 + `notes-received` 쿼리 무효화
- `handleNotePress` 콜백 — 미읽음이면 읽음 처리
- `renderNoteItem`의 `View` → `TouchableOpacity` 전환
- `numberOfLines={2}` 제거 — 탭 시 전체 텍스트 보이도록
- `accessibilityLabel` 추가 (`compose.noteFrom` i18n 키 사용)

### i18n
- `compose.noteFrom`: "{{name}}님의 쪽지" / "Note from {{name}}"

## 설계 결정

- **별도 상세 화면 대신 인라인 확장**: 쪽지 상세 화면을 만드는 것보다, 카드를 탭하면 읽음 처리 + numberOfLines 제거로 전체 텍스트 표시하는 것이 이 단계에서 적절. 상세 화면은 오디오 재생이 구현된 후에 추가하는 것이 합리적 (audio_url이 아직 항상 null).
- **낙관적 업데이트 미적용**: 쪽지 읽음은 비파괴적이고 즉시 반영되므로, invalidateQueries로 충분.

## 변경 파일

| 파일 | 변경 |
|------|------|
| `app/(tabs)/compose.tsx` | 읽음 처리 mutation + 탭 핸들러 + a11y |
| `src/i18n/ko.json` | 1키 추가 |
| `src/i18n/en.json` | 1키 추가 |

## 검증

- mobile `npx tsc --noEmit` — 0 errors
- backend — 변경 없음

## 다음 루프

R2 세부사항 전부 완료, compose 읽음 처리 완료. 자가 생성 풀에서 다음 항목 선택.
