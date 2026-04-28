# P0 Phase 1-B-2 Batch 2: fontWeight→fontFamily 마이그레이션

## 작업 항목
BACKLOG P0 Phase 1-B-2 — Batch 2 (탭 화면 + 중형 화면 10개 파일)

## 변경 파일 (10개, 68개 fontWeight 변환)

### 탭 화면 (5개, 39건)
1. `app/(tabs)/index.tsx` — 1건 ('700' → bold)
2. `app/(tabs)/people.tsx` — 13건 ('700'×2 bold, '600'×10 semibold, '500'×1 medium)
3. `app/(tabs)/voices.tsx` — 7건 ('700'×4 bold, '600'×3 semibold)
4. `app/(tabs)/alarms.tsx` — 11건 ('700'×5 bold, '600'×5 semibold, '300'×1 regular)
5. `app/(tabs)/settings.tsx` — 7건 ('700'×2 bold, '600'×5 semibold, inline 포함)

### 중형 화면 (5개, 29건)
6. `app/family-alarm/create.tsx` — 5건 ('600'×4 semibold, '500'×1 medium)
7. `app/library/index.tsx` — 5건 ('700'×2 bold, '600'×2 semibold, '500'×1 medium)
8. `app/player.tsx` — 5건 ('700'×1 bold, '600'×4 semibold)
9. `app/friend/[id].tsx` — 7건 ('700'×5 bold, '600'×2 semibold, `as const` 제거 포함)
10. `app/message/[id].tsx` — 7건 ('700'×1 bold, '600'×5 semibold, '500'×1 medium)

## 접근
- `FontFamily` import를 각 파일에 추가 (기존 theme import에 병합)
- `fontWeight: 'N'` → `fontFamily: FontFamily.xxx`로 1:1 대체, fontWeight 라인 삭제
- '300' (alarms.tsx의 alarmTime) → FontFamily.regular (Pretendard에 light/thin 없음)
- '700' as const (friend/[id].tsx) → FontFamily.bold + as const 제거

## 검증
- Mobile typecheck: ✅ 통과
- Backend typecheck: ✅ 통과
- 10개 파일 fontWeight 잔여: 0건

## 진행 상황
- Batch 1 (10개 파일): ✅ 완료 (이전 루프)
- Batch 2 (10개 파일): ✅ 완료 (이번 루프)
- Batch 3 (9개 파일): 미완료 — 다음 루프에서 진행

## 다음 루프
Batch 3 (나머지 9개 파일) 진행:
alarm/edit, alarm/create, voice/picker, voice/[id], voice/record, voice/diarize, dub/translate, message/create, gift/received
