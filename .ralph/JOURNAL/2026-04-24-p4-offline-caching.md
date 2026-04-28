# P4: 오프라인 캐싱 검증 + 보강

## 작업 항목
BACKLOG P4 — 오프라인 캐싱 검증

## 검증 결과

### 이미 구현된 오프라인 캐싱
1. **알람 탭** (`alarms.tsx`): getCachedAlarms → 오프라인 시 캐시 표시 + "캐시된 데이터" 배너 ✅
2. **홈 화면** (`index.tsx`): getCachedAlarms + getCachedMessages → 오프라인 폴백 ✅
3. **라이브러리** (`library/index.tsx`): getCachedLibrary → 오프라인 폴백 ✅
4. **오디오 파일** (`audio.ts`): expo-file-system으로 로컬 저장, isAudioCached 유틸 ✅

### 누락되었던 캐싱 (이번에 추가)
5. **Voices 탭** (`voices.tsx`): 오프라인 캐싱 없었음 → 추가 완료

## 변경 파일 (2개)

### 1. `apps/mobile/src/services/offlineCache.ts`
- VoiceProfile import 추가
- `cacheVoices()`, `getCachedVoices()` 함수 추가
- 캐시 키: `offline_cache_voices`

### 2. `apps/mobile/app/(tabs)/voices.tsx`
- `useNetworkStatus` 훅 추가 → 네트워크 상태에 따라 쿼리 활성화
- `getCachedVoices()` 로드 (mount 시)
- `cacheVoices()` 저장 (프로필 fetch 성공 시)
- `displayProfiles = profiles ?? cachedProfiles` 폴백 패턴 적용
- 검색, 카운트 표시 모두 displayProfiles 사용

## 검증
- Mobile typecheck: ✅ 통과

## 남은 참고사항
- People 탭은 friends/family API를 사용하는데, 이것은 사용자 간 실시간 데이터이므로 오프라인 캐싱 대상이 아님
- Settings 탭은 로컬 상태만 표시하므로 캐싱 불필요
- React Query의 in-memory 캐시는 앱이 메모리에 있는 동안 작동 (persistent cache는 미구현이나, AsyncStorage 기반 오프라인 캐시로 충분)

## 다음 루프
P4 완료. P5 또는 자가 생성 풀에서 다음 작업 선택.
