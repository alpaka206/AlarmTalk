# R1: 음성 관리 리빌드

**날짜**: 2026-04-24
**BACKLOG 항목**: R1 (음성 관리 리빌드)

## 접근

음성 프로필을 최대 2개로 제한하고, 등록 UI를 개선했다.

### 백엔드 변경
1. `POST /voice/clone` — 기존 플랜별 제한(free:1, plus:3, family:10)을 flat MAX_VOICE_PROFILES=2로 변경
2. 에러 코드 `VOICE_LIMIT_REACHED` + 한국어 메시지 반환
3. `GET /voice/family` 신규 — family_members 조인으로 같은 그룹 멤버의 ready 음성 프로필 조회 (읽기 전용)

### 프론트엔드 변경
1. `api.ts`에 `getFamilyVoiceProfiles()` + `FamilyVoiceProfile` 타입 추가
2. `voices.tsx` 전면 리빌드:
   - "내 음성 (N/2)" 카운터 + "음성 추가" 버튼 (2개 시 비활성화)
   - 추가 클릭 → 녹음/업로드 선택 카드 (인라인, 기존 4개 항상 노출 → 2개 선택 UI)
   - 가족 음성 섹션 (family plan만, 읽기 전용)
   - 기존 검색 + 화자감지/통화녹음 카드 제거 (불필요한 복잡도 — R2에서 필요시 복원)
   - SafeAreaView edges 수정 (headerShown:true로 인해 top 중복 방지)

### i18n
- ko/en 각 6키 추가: myVoices, addVoice, limitReached, familyVoices, familyReadOnly, chooseMethod

## 변경 파일

| 파일 | 변경 |
|------|------|
| `packages/backend/src/routes/voice.ts` | MAX_VOICE_PROFILES 상수, clone 제한 변경, GET /family 신규 |
| `apps/mobile/src/services/api.ts` | FamilyVoiceProfile 타입, getFamilyVoiceProfiles 함수 |
| `apps/mobile/app/(tabs)/voices.tsx` | 전면 리빌드 (2개 제한 UI, 가족 음성, 추가 방법 선택) |
| `apps/mobile/src/i18n/ko.json` | voices.* 6키 추가 |
| `apps/mobile/src/i18n/en.json` | 동일 |

## 검증

- backend `npx tsc --noEmit` — 0 errors
- mobile `npx tsc --noEmit` — 0 errors

## 다음 루프 주의사항

- R2 (알람 설정 리빌드)에서 음성 선택 UI가 이 음성 목록을 참조함
- GET /voice/family는 family_members 테이블 기반 — 가족 그룹이 없으면 빈 배열 반환
