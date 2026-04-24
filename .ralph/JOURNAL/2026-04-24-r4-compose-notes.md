# R4: 메시지 작성 탭 + 쪽지 시스템

**날짜**: 2026-04-24
**BACKLOG 항목**: R4 (메시지 작성 탭)

## 접근

compose 탭 스캐폴드를 실 기능으로 구현. 알람 보내기는 기존 family-alarm/create로 연결, 쪽지는 새로 구현.

### 백엔드 변경

1. **마이그레이션 18**: `notes` 테이블 (id, sender_id, receiver_id, text, audio_url, read_at, created_at) + 인덱스 2개
2. **routes/notes.ts** 신규:
   - `POST /notes` — 쪽지 전송 (receiver_id + text, 가족 그룹 멤버 간에만 허용, 500자 제한)
   - `GET /notes/received` — 받은 쪽지 목록 (pagination)
   - `GET /notes/sent` — 보낸 쪽지 목록 (pagination)
   - `PATCH /notes/:id/read` — 읽음 처리 (수신자만)
3. `index.ts` — notesRoutes 등록

### 프론트엔드 변경

1. **compose.tsx** 전면 리빌드:
   - 알람 보내기 카드 → `/family-alarm/create` 네비게이션
   - 쪽지 보내기 카드 → `/note/create` 네비게이션
   - 받은 쪽지 FlatList 인라인 (미읽음 카운트 뱃지, unread dot, 카드 border 구분)
2. **note/create.tsx** 신규:
   - 가족 그룹 멤버 목록에서 수신자 선택 (chip UI)
   - 텍스트 입력 (multiline, 500자 제한, 글자 수 표시)
   - useMutation으로 전송 + 성공 토스트 + 자동 뒤로가기
3. **api.ts** — sendNote, getReceivedNotes, getSentNotes, markNoteRead + 타입 정의
4. **_layout.tsx** — `note/create` Stack.Screen 등록

### 설계 결정

- **TTS 미구현**: Perso.ai 블록 상태이므로 audio_url은 항상 null. 텍스트만 저장. TTS 연동은 API 사용 가능 시 별도 구현.
- **받은 쪽지 인라인 표시**: 별도 스택 화면 대신 compose 탭에 FlatList로 인라인 표시. 쪽지 수가 많아지면 "전체 보기" 화면 분리 가능 (R5에서 필요 시).
- **가족 그룹 검증**: POST /notes에서 sender와 receiver가 같은 plan_group에 속하는지 SQL JOIN으로 검증. 친구 간 쪽지는 지원하지 않음 (스펙대로).

## 변경 파일

| 파일 | 변경 |
|------|------|
| `packages/backend/src/lib/migrations.ts` | 마이그레이션 18: notes 테이블 |
| `packages/backend/src/routes/notes.ts` | 신규: POST/GET/PATCH 쪽지 API |
| `packages/backend/src/index.ts` | notesRoutes import + route 등록 |
| `apps/mobile/src/services/api.ts` | sendNote, getReceivedNotes, getSentNotes, markNoteRead |
| `apps/mobile/app/(tabs)/compose.tsx` | 전면 리빌드 (네비게이션 + 받은 쪽지 목록) |
| `apps/mobile/app/note/create.tsx` | 신규: 쪽지 작성 화면 |
| `apps/mobile/app/_layout.tsx` | note/create Stack.Screen 추가 |
| `apps/mobile/src/i18n/ko.json` | note.* 9키 + compose.inbox/noNotes 2키 |
| `apps/mobile/src/i18n/en.json` | 동일 |

## 검증

- backend `npx tsc --noEmit` — 0 errors
- mobile `npx tsc --noEmit` — 0 errors

## 다음 루프 주의사항

- R5 (정비 + 테스트)가 다음 우선순위
- compose 탭의 받은 쪽지에서 개별 쪽지 탭하면 읽음 처리 + 상세 보기가 아직 없음
- TTS 변환은 Perso.ai 연결 시 별도 구현 필요
- 보낸 쪽지 목록 UI도 미구현 (필요 시 R5에서 추가)
