# P60 — voice 화면 3개 스타일 추출 (diarize + record + [id])

## 선택한 항목
BACKLOG P60: voice 화면 스타일 추출

## 접근
P59와 동일 패턴으로 voice 도메인 3개 화면 일괄 추출:
- voice/diarize.tsx (413→257줄, -38%)
- voice/record.tsx (396→245줄, -38%)
- voice/[id].tsx (398→235��, -41%)

## 변경 파일
1. `src/styles/voiceDiarizeStyles.ts` 신규 (152줄)
2. `src/styles/voiceRecordStyles.ts` 신규 (147���)
3. `src/styles/voiceDetailStyles.ts` 신규 (161줄)
4. `app/voice/diarize.tsx` 리팩토링 (413→257줄)
5. `app/voice/record.tsx` 리팩토링 (396→245줄)
6. `app/voice/[id].tsx` 리팩토링 (398→235���)

## 검증
- typecheck: mobile 0 errors
- 테스트: mobile 466/466 통과

## 다음 루프 참고
- P61 잔여: gift/received.tsx (383L), family-alarm/create.tsx (359L) 스타일 추출
- 이후 스타일 추출 완료 시 모든 350L+ 화면이 250L 이하로 정리됨
