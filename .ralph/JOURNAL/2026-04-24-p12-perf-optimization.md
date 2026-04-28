# P12: React Native 성능 최적화

**날짜**: 2026-04-24
**BACKLOG 항목**: P12 (자가 생성 — 성능 프로파일링 + 최적화)

## 접근

BACKLOG 고갈 후 "성능 프로파일링 + 최적화" 항목 선택. 전체 앱 대상 성능 감사 수행:
- FlatList 가상화 최적화
- React.memo 적용 (리스트 아이템 컴포넌트)
- 인라인 renderItem 추출 (useCallback)
- 인라인 .filter() 연산 useMemo 처리

## 변경 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/components/FamilyMemberRow.tsx` | React.memo 래핑 (FlatList 아이템) |
| `src/components/Toast.tsx` | React.memo 래핑 |
| `src/components/PeopleSkeletonCard.tsx` | React.memo 래핑 |
| `app/(tabs)/alarms.tsx` | FlatList perf props 추가 (initialNumToRender, maxToRenderPerBatch, windowSize, removeClippedSubviews) |
| `app/(tabs)/compose.tsx` | FlatList perf props 추가 |
| `app/people/index.tsx` | 3개 FlatList에 perf props 추가 |
| `app/library/index.tsx` | FlatList perf props + categories renderItem → useCallback 추출, getCategoryLabel → useCallback |
| `app/gift/received.tsx` | FlatList perf props + inline renderItem → useCallback 추출, statusLabel → useCallback |
| `app/dub/translate.tsx` | .filter() 인라인 연산 → useMemo(targetLanguages) 추출 |
| `app/voice/[id].tsx` | styles useMemo 추가 + listData useMemo + inline renderItem → useCallback 추출 + FlatList perf props |

## 설계 결정

- **FlatList 표준 값**: `initialNumToRender=8~10`, `maxToRenderPerBatch=5`, `windowSize=5` (기본 21에서 축소 → 메모리 절약), `removeClippedSubviews` (Android 네이티브 뷰 정리)
- **scrollEnabled=false인 FlatList는 제외**: voices 탭의 내부 리스트는 스크롤 비활성이므로 가상화 의미 없음
- **getItemLayout 미적용**: 대부분 아이템이 가변 높이 → 고정 높이 레이아웃 최적화 불가
- **React.memo 범위**: FlatList에서 렌더되는 컴포넌트만 적용. 스크린 컴포넌트는 이미 React Navigation이 관리하므로 제외

## 검증

- mobile `npx tsc --noEmit` — 0 errors
- backend `npx tsc --noEmit` — 0 errors

## 다음 루프

BACKLOG 자가 생성 풀에서 다음 항목 선택. 후보: Sentry 연동, 앱 아이콘 디자인, E2E 테스트.
