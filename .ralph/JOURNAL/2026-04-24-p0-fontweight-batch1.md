# P0 Phase 1-B-2: fontWeight→fontFamily 마이그레이션 (Batch 1/3)

## 작업 항목
BACKLOG P0 Phase 1-B-2 — fontWeight→fontFamily(FontFamily 토큰) 변환

## 접근
- 전체 29개 파일에서 fontWeight 사용 확인 (grep 결과)
- 10개 파일 단위로 배치 처리 (메가 커밋 방지)
- 매핑: '700'→FontFamily.bold, '600'→FontFamily.semibold, '500'→FontFamily.medium
- 각 파일에 FontFamily import 추가

## 변경 파일 (Batch 1 — 10개)
1. `src/components/Toast.tsx` — '600'→semibold (1건)
2. `src/components/OfflineBanner.tsx` — '600'→semibold (1건)
3. `src/components/ErrorBoundary.tsx` — '700'→bold, '600'→semibold (2건)
4. `src/components/FamilyMemberRow.tsx` — '700'→bold, '600'→semibold×2 (3건)
5. `src/components/EmailPasswordForm.tsx` — '600'→semibold×2 (2건)
6. `src/components/LoginButtons.tsx` — '700'→bold, '600'→semibold×2 (3건)
7. `src/components/QueryStateView.tsx` — '600'→semibold×2 (2건)
8. `src/components/StateView.tsx` — '600'→semibold×2 (2건)
9. `app/onboarding.tsx` — '700'→bold×2 (2건)
10. `app/voice/upload.tsx` — '600'→semibold, '700'→bold (2건)

## 검증
- Mobile typecheck: ✅ 통과
- 변환 후 10개 파일에서 fontWeight 0건 확인

## 남은 파일
19개 파일 남음 — 다음 2회 iteration에서 처리 예정

## 다음 루프 주의사항
- 남은 19개 중 alarm/create.tsx(18건), message/create.tsx(16건)이 대형 파일
- '200', '300' fontWeight는 Pretendard에 해당 웨이트 없음 → FontFamily.regular로 대체 예정
- alarm/edit.tsx, alarm/create.tsx, voice/record.tsx에 '200' 사용 (시간 표시용 얇은 폰트)
- alarms.tsx에 '300' 사용, voice/[id].tsx에 '300' 사용
