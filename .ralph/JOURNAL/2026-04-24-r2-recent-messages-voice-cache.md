# R2: 최근 사용 메시지 + 음성 캐싱

**날짜**: 2026-04-24
**BACKLOG 항목**: R2 미완료 — 최근 사용 메시지 목록 + 음성 캐싱

## 접근

### 최근 사용 메시지
프리셋 메시지를 선택해 TTS를 생성할 때마다 해당 텍스트를 AsyncStorage에 저장. 프리셋 섹션 상단에 "최근 사용" 목록으로 표시하여 빠른 재선택 가능.

### 음성 캐싱
TTS 생성 직전에 이미 `messages` 쿼리 데이터에서 동일한 `voice_profile_id + text` 조합이 있는지 검색. 있으면 API 호출 없이 기존 `message_id`를 바로 선택하고 토스트로 재사용 알림.

## 변경 사항

### offlineCache.ts
- `KEYS.recentPresets` 추가 (`recent_preset_messages`)
- `getRecentPresetMessages()` — AsyncStorage에서 최근 프리셋 메시지 배열 로드
- `addRecentPresetMessage(text)` — 중복 제거 + 최대 5개 유지 + 최신 우선

### alarm/create.tsx
- `recentPresets` 상태 + `loadRecentPresets` 콜백 + `useEffect` 로드
- `handlePresetGenerate` 변경:
  - 생성 전 `addRecentPresetMessage` 호출 → 목록 갱신
  - `messages.find(voice_profile_id + text)` 매칭 → 있으면 재사용 (TTS 호출 스킵)
  - 재사용 시 `reusedMessage` 토스트 표시
- 프리셋 섹션에 "최근 사용" 서브섹션 추가 (recentPresets.length > 0 시만 표시)

### i18n
- `alarmCreate.recentMessages`: "최근 사용" / "Recently used"
- `alarmCreate.reusedMessage`: "이미 생성된 메시지를 재사용합니다." / "Reusing previously generated message."

## 설계 결정

- **AsyncStorage (클라이언트 사이드)**: 서버에 최근 사용 이력 API를 만들지 않고 로컬에 저장. 이유: 프리셋 메시지 이력은 기기별 개인화 데이터이며, 오프라인에서도 접근 가능해야 함.
- **최대 5개**: 너무 많으면 카테고리 탐색보다 목록이 길어져 역효과. 5개면 마지막 2~3일 사용분.
- **음성 캐싱 = 메시지 쿼리 재활용**: 별도 캐시 레이어 없이 이미 fetch된 `messages` 데이터에서 매칭. 추가 인프라 비용 0.
- **생성 전 저장**: `addRecentPresetMessage`를 TTS 호출 전에 실행. 실패해도 이력이 남는 편이 UX에 유리 (재시도 시 바로 선택 가능).

## 변경 파일

| 파일 | 변경 |
|------|------|
| `src/services/offlineCache.ts` | recentPresets CRUD 2함수 추가 |
| `app/alarm/create.tsx` | 최근 사용 UI + 음성 캐싱 로직 |
| `src/i18n/ko.json` | 2키 추가 |
| `src/i18n/en.json` | 2키 추가 |

## 검증

- mobile `npx tsc --noEmit` — 0 errors
- backend — 변경 없음

## 다음 루프

R2 세부사항 3개 전부 완료. BACKLOG에 남은 미완료 항목 확인 후 다음 작업 선택.
