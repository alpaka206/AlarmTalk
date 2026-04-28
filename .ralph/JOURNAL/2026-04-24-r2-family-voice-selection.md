# R2 추가: 가족 멤버 음성을 알람 설정에서 선택

**날짜**: 2026-04-24
**BACKLOG 항목**: R2 미완료 — 가족/커플 멤버 음성을 알람 설정에서 선택 가능하게

## 접근

기존 알람 create/edit 화면은 사용자 본인의 음성 프로필(`getVoiceProfiles`)만 표시.
가족 플랜 사용자의 경우 `getFamilyVoiceProfiles` API로 가족 멤버 음성도 가져와서 별도 섹션으로 표시.

## 변경 사항

### alarm/create.tsx
- `getFamilyVoiceProfiles`, `FamilyVoiceProfile` import 추가
- `useAppStore`에서 `plan` 추가로 가져옴
- `useQuery(['familyVoiceProfiles'])` — plan === 'family'일 때만 fetch
- 음성 선택 UI: 본인 음성 아래에 "가족 음성" 서브섹션 추가
  - 각 칩에 프로필 이름 + 소유자 이름(owner_name) 표시
- `voiceSubLabel`, `voiceOwnerText` 스타일 추가
- 빈 상태 판단: 본인 음성 0개 + 가족 음성 0개일 때만 emptyVoiceBox 표시

### alarm/edit.tsx
- 동일한 패턴으로 가족 음성 섹션 추가 (create.tsx와 일관성 유지)

### i18n
- `alarmCreate.familyVoices`: "가족 음성" / "Family voices" (ko/en)

## 설계 결정

- **voice_profile_id 공유**: 가족 음성도 `voice_profiles` 테이블의 UUID를 사용하므로 기존 `voiceProfileId` 상태로 그대로 선택 가능. 백엔드에서 별도 권한 검증 불필요 (이미 R2 마이그레이션에서 voice_profile_id FK 없이 TEXT로 저장).
- **plan === 'family' 조건**: 가족 음성 API는 가족 그룹 멤버만 반환하므로 무료/개인 플랜에서는 불필요한 API 호출 방지.
- **owner_name 표시**: 가족 음성 칩에 소유자 이름을 작은 텍스트로 표시하여 누구의 음성인지 구분 가능.

## 변경 파일

| 파일 | 변경 |
|------|------|
| `app/alarm/create.tsx` | getFamilyVoiceProfiles query + 가족 음성 UI + 스타일 |
| `app/alarm/edit.tsx` | 동일 |
| `src/i18n/ko.json` | `alarmCreate.familyVoices` 추가 |
| `src/i18n/en.json` | 동일 |

## 검증

- mobile `npx tsc --noEmit` — 0 errors
- backend — 변경 없음 (기존 GET /voice/family API 활용)

## 다음 루프

R2 세부사항 계속: 프리셋 메시지 카테고리 선택 UI 개선 or 최근 사용 메시지 캐싱.
