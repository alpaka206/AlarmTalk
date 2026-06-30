# 음성 알람 — UI/UX + 멘트(문구) 개선

> 설계 원칙(네이티브·따뜻하되 절제·soft-start·숫자/날짜 낭독 금지·관계별 어체·매일 변주·짧게)에 비추어
> (A) 우리가 쓴 멘트 강조/변경/제거 + (B) 안드로이드 UI/UX 개선을 정리.
> 적용 그룹: **PL**=프롬프트·생성로직(커밋 보류) · **UX**=UI/UX(커밋 허용) · **S**=스키마 의존(결정 트랙).

---

## A. 멘트(우리가 쓴 문구) 개선

### A-1. TTS 프리셋 — `packages/backend/src/data/presets.ts` (~145개 고정 문구)

| 판정 | 대상 | 근거 / 개선안 | 그룹 |
|------|------|--------------|------|
| **재작성(必)** | 카테고리별 인라인 태그 `[warmly]/[encouraging]/[gentle]/[softly]/[calmly]/[happily]/[proudly]/[brightly]/[sleepily]/[comforting]` (91+개) | 가짜 부사 태그. v3 태그는 **enum 아닌 자연어 지시** — 우리 큐레이트 세트 `[happy/cheerfully/excited/playfully/curious/lighthearted/calm/tired/whispers/quietly]`로 교체. **실서비스 전이라 매핑 불필요 — 그냥 새 값으로 재작성**(저각성은 sleep/night 전용). | PL |
| **변경** | 숫자/단위 낭독 — `'오 분만 더'`, `'십 분만 몸을 움직여보자'`, `'10분만 먼저'`, `'한 번만 크게'` 등 ~19개 | TTS 음성화 시 숫자/단위 직시 → **숫자 낭독 금지** 위배·기계적. 구어체: `'조금만 더'`, `'잠깐만 몸을 움직여보자'`, `'조금만 먼저'`, `'한 번 크게'`. | PL |
| **(선택) 전면 재생성** | 프리셋 풀 전체 | "싹 날려도 됨"이므로, 카테고리×관계 톤·네이티브·변주 원칙으로 **풀 자체를 새로 생성**하는 것이 최선(현재는 옛 톤). 별도 생성 단계로 진행 가능. | PL |
| **강조/유지** | 따뜻·구어체로 잘 쓰인 다수 | 설계 톤에 부합 — 유지하되 매일 변주는 동적 경로가 담당(프리셋은 풀에서 랜덤 선택되므로 다양성 확보). | keep |

> ⚠️ 프리셋 변경은 **태그 정책 변경과 한 묶음으로 검토**해야 하므로 PL(커밋 보류). 변경 후 회귀(프리셋 합성 청취) 필수. v3 태그 효과는 보이스·stability 의존(Creative/Natural에서 반응↑, Robust는 억제).

### A-2. 동적 폴백 — `vertex-translate.ts` `dynamicAlarmTextReadableFallback` (L585-663)

- **제거→회전식**: 모드별 고정 단일 문구 8개(`'일어나실 시간이에요'`, `'오늘도 화이팅'` 등). 재생성 실패 시 **항상 동일 문구** → '매일 변주' 정책 위배. → `hash(dateLabel+mode+시간대)`로 모드·관계별 3~4개 opener/closer 회전. (코드 반영에 포함, PL)

### A-3. 날씨 조언 — `tts.ts` `buildWeatherAdvice` (L374-418)

- **변경**: `'비가 올 수 있어요. 우산 꼭 챙기세요'` 등 **한국어 고정 문자열만 반환** → ja/en 청자가 재번역(환각/뉘앙스 손실). → 구조화 토큰 `{condition: rain|snow|dust|cold|heat|nice, action: umbrella|mask|coat|water|walk}` + 언어별 네이티브 재표현. (전체 토큰화는 출력계약 변경이라 §02 결정 트랙; 1차로 프롬프트 수준 "타깃 언어로 재표현" 지시 — PL)

### A-4. 일본어 — `vertex-translate.ts` ja 분기

- **추가(必)**: ja 분기 0줄 → `japaneseRegisterGuidance()` 신설(タメ口 디폴트·종조사 ね/よ/な·性別중립·役割語 금지·가타카나·모라). (코드 반영에 포함, PL)

### A-5. 동의/권한 카피 — `docs/legal/consent-and-permission-copy.ko.md`

- **변경(경미)**: §1-A 운세 고지(L25)의 장문장 분리로 가독성↑. 법적 정확성은 양호. (문서, 커밋 가능)
- (별개) 마케팅 동의 상세본은 `docs/legal/marketing-consent.ko.md`로 이미 작성됨.

### A-(systemic) 멘트 전반 구조 문제
1. 프리셋 태그 allowlist 미전환(위 A-1) — 가장 시급.
2. 폴백 천편일률(A-2).
3. 날씨 한국어 고정(A-3).
4. 일본어 가이드 부재(A-4).
5. 프리셋 내 숫자 낭독(A-1).

---

## B. UI/UX 개선 (안드로이드)

| # | 화면 | 이슈 | 심각도 | 제안 | 커밋 | 관련 |
|---|------|------|--------|------|------|------|
| 1 | SettingsScreen | **마케팅 수신 철회 토글 부재** (가입 시 동의받지만 끄는 경로 없음) | high | '광고성 정보 수신' 토글 추가(SettingsRow 패턴), `POST /user/consents`로 marketing agreed=0 재기록 | ✅ | consent |
| 2 | AlarmEditor / VoiceProfileManagementPanel | **알람별 호칭(listener_title) 변경 불가** — 프로필당 1개라 알람마다 다른 호칭 쓰려면 프로필 복제 | high | 보이스 카드 내 '호칭 편집' 인라인 필드(30자, WakerInputShape) | ✅ | general |
| 3 | VoiceProfileManagementPanel | **보이스 성별/톤 선택 UI 부재** (일본어 1인칭 자연성 구분 불가) | medium | Identity 단계에 '목소리 성별' 칩 3개(남/여/중립, WakerChipShape) + 향후 톤 프리셋 | ❌(스키마 의존) | persona |
| 4 | AlarmEditor / VoiceAudioCard | 랜덤/동적 모드 발견성 낮음(모드 의미·sleep↔기상 차이 불명확) | medium | RandomPromptSummaryRow 아래 모드별 1줄 설명 카드 | ✅ | general |
| 5 | AlarmEditor / VoiceAudioCard | 음성 미리듣기 버튼 역할 불명확·생성중 상태 미비 | medium | '듣기/정지' 라벨·ContentDescription, '생성 중…' 시각화 | ✅ | general |
| 6 | AlarmRandomPromptSettings / Fortune | 날씨/운세 선택 후 상세설정 자동 안 뜸 → 누락 쉬움 | medium | 모드 선택 시 WeatherLocationDialog/FortuneInfoDialog 자동 오픈 | ✅ | general |
| 7 | AlarmEditor | 자동 해석된 호칭 확인 불가(resolveListenerTitle 결과 안 보임) | low | 보이스 카드에 '호칭: [값]' 한 줄 + 수정 버튼 | ✅ | general |
| 8 | VoiceProfileManagementPanel | 호칭 입력 placeholder에 예시 없음 | low | placeholder `'예: 엄마, 자기, 김팀장'` | ✅ | general |
| 9 | AlarmSettingsCard / VoiceAudioCard | sleep 모드 선택 시 톤이 '차분'으로 바뀌는 안내 없음 | low | 모드 설명에 '취침=차분한 톤' 명시 | ✅ | general |
| 10 | 공유 음성 | 공유받은 음성도 listener_title 강제 — 공유자 호칭이 수신자에 강제처럼 보임 | low | 수신자 맞춤 호칭 입력임을 카피로 명확화 | ✅ | general |

### B-1. 바로 커밋 가능한 Quick Wins (1시간 내, UX)
1. SettingsScreen 마케팅 수신 토글(+철회 경로) — **마케팅 동의 트랙과 직결, 최우선** (~30분)
2. 음성 미리듣기 '듣기/정지' 라벨·설명 (~15분)
3. RandomPromptSummaryRow 모드별 1줄 설명 (~25분)
4. 호칭 placeholder `'예: 엄마'` 구체화 (~5분)
5. 보이스 카드에 '호칭: [자동 해석값]' 표시 (~20분)
6. 날씨/운세 선택 시 상세 다이얼로그 자동 오픈 (~10분)

> 모든 UX 제안은 디자인 토큰(WakerDesign `Waker*Shape`·`MaterialTheme.colorScheme`, 생 리터럴 금지) 준수.

### B-2. 결정/후속 트랙
- **#3 보이스 성별/톤 UI**: `voice_profiles.voice_gender`(+`tone_preset`) 스키마 추가가 선행(§02 결정 5). 출시 전 DB 초기화라 additive nullable로 부담 없음. 일본어 1인칭(僕/俺/私) 자연성의 최고 ROI.
- **#2 알람별 호칭**: 백엔드는 이미 TtsGenerateRequest.listenerTitle을 받으므로 클라 UI만 추가하면 됨(스키마 무관, 커밋 가능).

---

## C. 적용 계획
- **PL(커밋 보류)**: A-1(프리셋 태그/숫자), A-2(폴백 회전), A-3(날씨), A-4(일본어) — 태그/프롬프트 변경과 한 묶음으로 사용자 검토 후 Gemini 실반영.
- **UX(커밋 허용, 브랜치+PR)**: B-1 quick wins(특히 #1 마케팅 토글), #2/#4/#5/#7/#8/#9.
- **S(결정 트랙)**: #3 보이스 성별/톤 UI(스키마 결정 후).
- A-5(동의 카피 분리)·이 문서 자체는 문서 커밋 가능.
