# 음성 알람 프롬프트 고도화 (Voice Prompt Overhaul)

AlarmTalk 음성 알람 문구 생성(Vertex Gemini → ElevenLabs v3) 프롬프트·태그·검증 전면 재설계 작업 묶음.
경쟁사 알라미(게임/미션 특화) 대비 **"음성"** 경험으로 차별화하는 것이 목표.

## 문서 구성
- [`01-references.ko.md`](01-references.ko.md) — 참고한 외부 자료·논문·문서 출처(서칭 근거)
- [`02-design-detailed.ko.md`](02-design-detailed.ko.md) — **매우 상세** 진단·설계·프롬프트 전문·코드 변경맵·검증 계획
- [`03-scrum-summary.ko.md`](03-scrum-summary.ko.md) — 스크럼 공유용 1페이지 요약
- [`04-ui-ux-and-scripts.ko.md`](04-ui-ux-and-scripts.ko.md) — UI/UX 개선 + 멘트(우리가 쓴 문구) 강조/변경/제거 정리
- [`05-prelaunch-verification.ko.md`](05-prelaunch-verification.ko.md) — 출시(Gemini 실반영) 전 검증 키트(시뮬 매트릭스·적대적·KO/JA MOS·v3 청취회귀·Go/No-Go)

## 한눈에
- **검증된 버그**: `packages/backend/src/lib/elevenlabs.ts:119` — v3에 `voice_settings` 미전송 → 서버 디폴트 적용돼 태그가 약하게 실현.
- **들쭉날쭉의 원인**: 고온도(0.85) 생성 + 8개 정규식 binary 검증이 대부분을 폐기 → 고정 폴백 문구. (→ 2단 HARD/SOFT 검증으로 교체)
- **일본어 어색함의 원인**: 일본어 네이티브 화법 가이드가 코드에 0줄(한국어는 ~114줄). 가족/친밀 일본어는 **タメ口(캐주얼)** 인데 한국어 존댓말 논리를 직역.
- **태그 불일치**: `[warmly][encouraging]…` 부사 10종은 v3 실제 태그 어휘가 아님 → 실증 태그 세트로 교체.

> 산출 근거: 코드베이스 심층조사 + ElevenLabs v3 공식문서 30+ 출처 + 메아리(mearri) 기법 이식 + 외부 동료심사 논문 27편 + 4제안×3심사×1종합 토의 워크플로.
> 작업 규칙: 프롬프트·생성로직 변경은 **커밋 보류**(Gemini 실서비스 반영 전 사용자 검토). UI/UX 변경은 커밋 허용(브랜치+PR). 스키마 확장은 선택 트랙.

## 구현 현황 (2026-06-28, 워킹트리 — 커밋 안 함)
적용·검증 완료(타입체크 통과, 백엔드 1308 테스트 통과, 3관점 적대적 코드검증 후 결함 4건 수정):
- `lib/elevenlabs.ts` — **voice_settings 버그픽스**(v3에 항상 전송, stability 0.5 Natural).
- `lib/vertex-translate.ts` — 큐레이트 태그 세트(`happy/cheerfully/excited/playfully/curious/lighthearted/calm/tired/whispers/quietly`, **enum 아닌 자연어 지시**, 저각성=sleep 전용) · **일본어 네이티브 규칙 신설**(タメ口 디폴트) + ko/en 블록 · systemInstruction 분리 + responseSchema · **{text,tag} 단일 호출** · **2단 HARD/SOFT 검증**(폐기 대신 국소수리) · 회전 폴백 + **비-ko 폴백 네이티브화**(한국어 누출 차단) · temp 0.85→0.75.
- `routes/tts.ts` — 동적 **이중 호출 제거** + `[tag] `조립(200자 초과 시 태그·tags 동시 드롭) + sleep speed 0.95.
- `lib/voice-provider.ts` — voiceSettings 스레딩.
- `data/presets.ts` — 옛 태그 전량 신세트로 재작성 + 숫자낭독 제거.

미적용(결정/후속 트랙): 날씨 **구조화 토큰화 전체 refactor**(현재는 프롬프트 재표현+비-ko 폴백 네이티브화로 1차 대응), `voice_gender` 스키마/UI, 변주 엔진 고도화, 프리셋 전면 재생성, 커밋 가능한 UI quick win(설정 마케팅 철회 토글 등).

> ⚠️ **Gemini 실반영 전 필수**: `02` §6 검증(언어×모드×관계 시뮬레이션·적대적·**현지인 KO/JA MOS**·**v3 voice_settings 전후 청취회귀**). 태그 효과·KO/JA 합성 자연성은 보이스로 들어봐야 확정되는 **가설**.
