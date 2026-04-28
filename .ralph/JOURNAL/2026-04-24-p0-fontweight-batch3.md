# P0 Phase 1-B-2 Batch 3: fontWeight→fontFamily 마이그레이션 (최종)

## 작업 항목
BACKLOG P0 Phase 1-B-2 — Batch 3 (나머지 9개 파일, 최종 배치)

## 변경 파일 (9개, 71개 fontWeight 변환)

### alarm 화면 (2개, 29건)
1. `app/alarm/edit.tsx` — 12건 ('700'×4 bold, '600'×4 semibold, '200'×2 regular)
2. `app/alarm/create.tsx` — 17건 ('700'×5 bold, '600'×9 semibold, '500'×1 medium, '200'×2 regular)

### voice 화면 (4개, 25건)
3. `app/voice/picker.tsx` — 5건 ('700'×2 bold, '600'×3 semibold)
4. `app/voice/[id].tsx` — 8건 ('700'×5 bold, '600'×2 semibold, '300'×1 regular)
5. `app/voice/record.tsx` — 5건 ('700'×3 bold, '600'×1 semibold, '200'×1 regular)
6. `app/voice/diarize.tsx` — 7건 ('700'×5 bold, '600'×2 semibold)

### 기타 화면 (3개, 17건)
7. `app/dub/translate.tsx` — 10건 ('700'×4 bold, '600'×5 semibold, '500'×1 medium)
8. `app/message/create.tsx` — 17건 ('700'×6 bold, '600'×11 semibold)
9. `app/gift/received.tsx` — 7건 ('600'×5 semibold, '500'×1 medium)

## 접근
- `FontFamily` import를 각 파일에 추가
- `fontWeight: 'N'` → `fontFamily: FontFamily.xxx`로 1:1 대체, fontWeight 라인 삭제
- '200'/'300' → FontFamily.regular (Pretendard에 light/thin 없음)
- '500' → FontFamily.medium
- '600' → FontFamily.semibold
- '700' → FontFamily.bold

## 검증
- Mobile typecheck: ✅ 통과
- Backend typecheck: ✅ 통과
- 9개 파일 fontWeight 잔여: 0건

## 전체 Phase 1-B-2 결과
- Batch 1 (10개 파일): ✅ 완료
- Batch 2 (10개 파일): ✅ 완료
- Batch 3 (9개 파일): ✅ 완료
- **총 29개 파일, fontWeight→fontFamily 완전 마이그레이션 완료**

## 다음 루프
P0 Phase 1-B-2 전체 완료. BACKLOG에서 다음 우선순위 항목 (P4 또는 P5)으로 진행.
