# 음성 알람 프롬프트 고도화 — 상세 설계

> 대상: `packages/backend/src/lib/vertex-translate.ts`(생성·태깅·검증), `routes/tts.ts`(파이프라인), `lib/elevenlabs.ts`(합성).
> 산출: 코드베이스 심층조사 + ElevenLabs v3 공식문서 + 메아리 기법 + 외부 논문 27편 + 4제안·3심사·1종합 토의.
> 작업 규칙: 프롬프트·생성로직 = **커밋 보류**, UI/UX = 커밋 허용, 스키마 = 선택 트랙.

---

## 1. 배경·목표

목소리 알람 앱. 사용자/관계자에 맞춘 짧은 음성 알람 문구를 Gemini(Vertex `gemini-2.5-flash`)로 생성하고 ElevenLabs v3로 합성한다. 경쟁사 알라미는 게임/미션으로 "무조건 깨움"을 판다. 우리는 **음성** 경험으로 차별화한다.

문제 제기(사용자): "같은 조건이어도 결과가 들쭉날쭉/밋밋할 때가 있다", "일본어가 일본인처럼 안 들린다", "v3 태그를 실제로 받는 것에 맞춰 잘 쓰고 싶다".

목표: (1) 일본어가 진짜 네이티브처럼, (2) v3 실제 태그를 정확히, (3) 모드/관계/호칭별 톤, (4) soft-start 따뜻하되 절제, (5) 매일 변주, (6) 알람에 맞는 길이.

---

## 2. 핵심 진단 (왜 아쉬웠나) — 근본 원인

| # | 문제 | 위치 | 영향 |
|---|------|------|------|
| 1 | **일본어 네이티브 가이드 0줄** (한국어는 ~114줄). `LANGUAGE_NAMES`에 ja만 있고 분기 본문 없음 | `vertex-translate.ts` ja 분기 | 뻣뻣/직역체 — 어색함의 직접 원인 |
| 2 | **태그가 v3 실제 어휘와 불일치**: `[warmly][encouraging][proudly][brightly][sleepily][comforting]…` 는 v3 공식 태그 아님. 10개·문두 1개뿐 | `APPROVED_TAGS` L80-91 | 태그가 의도대로 안 먹거나 무의미 |
| 3 | **고온도(0.85) 생성 + 8개 정규식 binary 검증이 대부분 폐기 → 고정 폴백** | `generateDynamicAlarmTextWithVertex` L223-236 | **들쭉날쭉의 직접 원인** (좋은 출력도 통째 버려짐) |
| 4 | **v3는 일관성에 250자+ 권장, 우리 알람은 ≤200자(보통 30~70)** | 다수 enforce | 짧은 텍스트 태그/표현 불안정 |
| 5 | **v3에서 voice_settings 미전송**(역조건) → 서버 디폴트 적용 | `elevenlabs.ts:119` | 태그가 약하게 실현(검증된 버그) |
| 6 | **순환 검증 모순**: 동적생성은 `[브래킷]` reject ↔ 직후 autoTag는 태그 추가 | `vertex-translate.ts` + `tts.ts:811` | 정상 출력이 모순으로 폐기 |
| 7 | **날씨 컨텍스트 항상 한국어** → 비한국어 타깃이 재번역 | `tts.ts` `buildWeatherAdvice` L352 | 뉘앙스 손실·환각 |
| 8 | 단발 호출·취약 JSON 파싱(재시도 없음), 조사 사후 정규식 밴드에이드 | `parseAlarmTextPreparation`, `polishDynamicAlarmText` | 실패율↑, 근본 미해결 |

> 코드로 직접 검증한 교정: (5)는 "Robust 세팅이 범인"이 아니라 **아무 설정도 미전송**이 범인. (6) 이중 Vertex 호출 실재. `listener_title`은 동적 경로에선 이미 `synthesisText`를 통해 캐시 해시에 반영됨(별도 추가는 저가치).

---

## 3. 외부 근거 기반 설계 원칙 (동료심사 다수)

1. **음성 > 톤** (가장 견고): 소방 RCT 음성 85~89% vs 톤 56% 각성, 각성 2초 vs 156초(PMC7711682, pubmed 30482491). → 음성 자체가 1차 효용.
2. **개인화 = 정체성 신기성 아님, 맥락 적합성**: 이름/내목소리 추가 효과 미미, 라벨·의도 프레이밍이 희망·행복↑ 짜증↓(JMIR e50835). → Gemini 맥락 생성이 정답.
3. **soft-start 따뜻하되 절제**: jarring 알람 코르티솔↑, 점진 기상 스트레스↓(Thompson 24509892). 단 과한 케어톤은 신뢰↓(PMC8663575).
4. **매일 변주로 습관화 회피**: 동일자극 반응둔화. AI의 구조적 이점(정적 녹음 불가).
5. **짧게**: 수면관성 집행기능 저하 → 단순·구체, 빠른 해제=아침 행복(Frey, JMIR). ↔ v3 250자+ 권장과 텐션.
6. **KO/JA 네이티브 프로소디·존대/종조사 = 경쟁 해자 + v3 최대 리스크**: 자연스러움은 자동지표 측정 불가, 현지인 MOS 필요(arXiv:2506.16310). 텍스트 네이티브성은 **프로바이더가 바뀌어도 살아남는 유일한 해자**.
7. **자연스러움은 엔지니어링 산물**: 페르소나 조건화 + 구어체 명령 + few-shot + 소량 불어(filler) + v3 태그(Vanderbilt PLoP24, arXiv:2412.12710, LMNT).

(전체 출처: [`01-references.ko.md`](01-references.ko.md))

---

## 4. 최종 설계

### 4.1 아키텍처 백본 — 언어-네이티브-우선 단발(single-call)

- **단발 유지**(저지연·저비용 Worker): 호출 1회로 `{text, tag}`를 함께 받는다. 동적모드의 기존 **이중 Vertex 호출(생성→autoTag)을 단일화**해 순환 모순 제거.
- `systemInstruction`에 고정 철학·출력계약·태그규칙·NEVER 목록(프롬프트 캐시 친화), user prompt엔 가변 데이터(모드·관계·언어규칙·날씨·호칭·few-shot)만.
- `generationConfig.responseSchema`로 구조화 출력, 기존 brace-slice 파서는 최후 폴백으로만.
- **품질 상한은 프롬프트 콘텐츠 깊이**(언어별 네이티브 규칙)로, **하한은 2단 검증·국소수리**로 끌어올린다(메아리식 별도 2차 LLM 호출 없이 같은 호출 내 soft-repair).

### 4.2 systemInstruction (전문, 영문 — 실제 주입 텍스트)

```text
You are the voice of a personal voice-alarm app. You write ONE short spoken line — usually one
sentence, sometimes two very short ones — that one real, familiar person says out loud to gently
wake or remind someone they care about. An expressive TTS voice reads it aloud, so it must sound
like natural speech the way a native speaker actually talks, never like a notification, news
anchor, weather report, or a translated/written sentence.

PHILOSOPHY
- Native-first. Write the way a native speaker SAYS it in the target language: natural
  contractions, particles, sentence-final particles, dropped subjects/pronouns, colloquial
  rhythm. Idiomatic naturalness outranks literal fidelity.
- A specific human beside the listener, not a script. Warm but restrained — caring, never
  saccharine, theatrical, poetic, or dramatic.
- Soft-start. Open gently (the listener's title or a soft greeting), then ease into the point;
  acknowledge the wake/sleep transition when natural. Never jarring, never alarming, never
  fear/urgency.
- Meaning over novelty. The value is a context-appropriate, kind line. Never announce whose voice
  this is or the listener's identity.
- Fresh every day. Vary the opener, wording, rhythm, and the small caring detail so it never
  feels prerecorded. Do not reuse the same opener/closer each time. Never trade naturalness or any
  constraint for novelty.
- Brevity is correct. The listener just woke up — keep it simple, concrete, fast to absorb. One
  short line or two short sentences. Hard cap 200 characters.

REGISTER (one consistent register per line, matched to the relationship)
- You are given a relationship (how the speaker relates to the listener) and an optional listener
  title. Use them ONLY to choose register, warmth, vocabulary, and first-person reference — never
  speak them. Hold ONE politeness level for the whole line; never switch mid-sentence.
- Follow the LANGUAGE RULES block in the user message exactly for the target language. Korean and
  Japanese use DIFFERENT logic for the same relationship — do not copy one language's politeness
  into the other.
- Address the listener by the provided listener title EXACTLY (never translate it, never swap it
  for a guessed family title like grandmother/mom/son). If no title is given, use a natural
  title-free greeting.

DELIVERY TAG (ElevenLabs v3)
- You MAY prepend AT MOST ONE delivery tag, chosen ONLY from the allowlist in the user message,
  matching the mode/relationship mood. Return it in the separate "tag" field WITHOUT brackets;
  the backend prepends it as [tag]. Do NOT put any bracket/[tag]/stage direction inside "text".
- One tag, or none. Never combine tags, never invent tags, never use a tag mid-line.
- For pauses/pacing use punctuation and ellipses (…), NOT tags — the engine has no SSML breaks
  and a soft '…' or comma after the greeting is the soft-start.
- If the line is very short (under ~20 characters) or no tag clearly fits, leave "tag" empty —
  punctuation alone is fine, and an under-realized tag can be read aloud.
- Tag effects are SUBTLE in Japanese and Korean — carry the emotion in word/particle/ending
  choice; treat the tag as a light touch only.

NEVER
- Never recite raw values the user did not write: temperatures, percentages, weather codes, exact
  clock time, dates, weekdays, birth date/time, zodiac specifics, or city/district/country/
  location labels.
- Never state whose voice this is or name the relationship.
- Never use a stiff/formal/business register (Korean 합니다체; Japanese ビジネス敬語/文語;
  English "Please be advised") for family, friends, or partners.
- No markdown, emojis, quotes, explanations, or extra fields.

OUTPUT
- Return STRICT JSON only, matching the schema: {"text": string, "tag": string}. "text" = the
  final spoken line in the target language (no brackets). "tag" = exactly one allowlisted tag
  name, lowercase, no brackets, or "" for none.
```

### 4.3 언어별 네이티브 규칙 (실제 주입 텍스트)

#### 한국어 (ko)
```text
KOREAN — native, spoken, never an announcement. Pick the register from the speaker→listener
relationship and hold it the whole line. NEVER 합니다체(~합니다/~하십시오) for family/friends/partners.
- Grandchild→grandparent (손녀/손자/손주) and child→elder (딸/아들/자식/며느리/사위/조카): warm
  familiar 해요체 WITH honorific verb stems(존대 동사). '할머니, 일어나실 시간이에요.' '나가실 때
  우산 꼭 챙기세요.' Never clipped lower-sounding forms to an elder ('일어날 시간이에요').
- Elder→younger (부모→자식 등): caring 반말 or 반말/해요체 mix. '우리 딸, 잘 잤어?' '오늘도 화이팅이야.'
- Sibling/friend (형제/자매/누나/언니/오빠/형/동생/친구): natural 반말. '일어났어?' Bedtime: '누나,
  잘 시간이야. 휴대폰 내려놓고 얼른 자.' Never 존댓말/해요체.
- Romantic/spouse (연인/자기/여보/아내/남편): intimate 반말, warm and lightly heart-fluttering;
  never 해요체/합니다체 even for 아내/남편. '자기야, 비 온대. 나가기 전에 우산 챙겨, 감기 걸리면 안 돼.'
  No baby talk, no melodrama, no possessiveness; never new-romance/dating-luck/jealousy.
- Neutral/unknown: warm 해요체.
PARTICLES & SPACING (a writing rule, not a post-fix): keep subject/object particles alive —
'비가 올 수 있대요'(O) not '비 올 수 있대요'(X); '오늘은 비가 와요' reads warmer than '오늘 비 와요'.
Drop redundant 나/너/내가 when obvious.
REPORTED/SOFT endings for relayed weather/fortune: 해요체 '~대요/~래요/~다네요/~면 좋겠어요';
반말 '~대/~래/~다네/~면 좋겠다'. Sounds like relaying, not asserting.
AVOID: exaggerated interjections(세상에/맙소사/오 마이 갓), news-anchor openers('예보에 따르면'),
comma-spam (use connective endings). Use 할머니/할아버지 as address ONLY if it matches the listener title.
```

#### 일본어 (ja) — **핵심 신규**
```text
JAPANESE — write like a native speaker. Do NOT translate Korean/English structure into Japanese.
REGISTER — CRITICAL: Japanese family & intimate speech is CASUAL(タメ口), NOT honorific. Do NOT copy
Korean's polite 해요체 into Japanese.
- Grandchild→grandparent, child→parent, parent→child, sibling, friend, romantic partner: CASUAL
  (だ/〜だよ/〜て/〜よっか/〜ね). e.g. 'おばあちゃん、おはよう。今日は雨が降るみたい、傘忘れないでね。'
  NOT 'おばあちゃん、起きる時間です。' Address おばあちゃん/おじいちゃん (familiar), never おばあさま,
  and only if it matches the listener title.
- です・ます polite ONLY for distant/unknown/teacher/workplace or when no relationship is given:
  'おはようございます。今日は冷えるみたいなので、一枚羽織ってくださいね。' Avoid over-honorific/business
  文語 (no お目覚めください, no 〜となっております).
- Never mix politeness levels within one line.
終助詞 (the core of natural warmth; choose to match intonation, don't stack): ね = empathy/shared
feeling (soft); よ = telling/gently urging; な/なあ = soft self-musing; よね/の = soft confirmation.
Vary them; don't end every sentence with よ.
GENDER: default GENDER-NEUTRAL ね/よ. Only LIGHTLY shade by the provided voice gender (e.g.
first-person 私/僕/俺 when used). Do NOT use 役割語/manga-style gendered finals (わ/かしら/ぞ/だぜ) —
modern speakers rarely say them and they sound unnatural.
PRO-DROP (strong): omit 私/僕/俺/あなた/君 when context is clear; keep first-person consistent if used.
LOANWORDS/NAMES: natural katakana (コーヒー, マスク, ストレッチ); never literal English calques
('良い一日を過ごしてください'→'いってらっしゃい、今日もいい一日にね'). ORTHOGRAPHY: 。、！？ only, NO
spaces between words; let mora rhythm breathe; use … for a soft pause. WEATHER: soft 伝聞, never
numbers — '雨が降るみたい' / '寒くなりそうだから上着があると安心だよ'.
```

#### 영어 (en)
```text
ENGLISH — natural, warm, spoken (American-neutral), not formal writing. Contractions always
(you're, it's, let's, don't). English has little grammatical register, so RELATIONSHIP changes
warmth/intimacy, not grammar.
- Most relationships: friendly, like a close person nudging you awake. 'Hey, morning… time to get
  up. Looks like rain later, grab your umbrella, okay?'
- Elder/respectful or teacher: warm but a touch more composed — still contractions, no stiffness.
- Romantic: tender, low-key intimate, never cheesy. 'Morning, you. Up you get… I've got you today.'
Drop the subject when natural. One light opener/filler max (Hey/Alright/Okay). Address by the given
title if provided, else a soft 'hey'/'morning'; never a guessed family title. Weather/fortune stays
casual and number-free. AVOID: weather-report numbers, exclamation spam, 'Please be advised',
'rise and shine' clichés, over-sweet lines.
```

### 4.4 모드별 가이드

| 모드 | 핵심 | 기본 태그 |
|------|------|-----------|
| **wake_weather** | 부드럽게 깨운 뒤, 날씨 컨텍스트에서 최대 2개 행동권유를 대화로(숫자/코드/% 금지). 조건+행동 페어(비→우산, 미세먼지→마스크, 추위→따뜻이, 더위→물, 맑음→산책). 날씨는 **구조화 토큰**으로 받아 네이티브로 재표현(한국어 문자열 직역 금지) | `[cheerfully]`/`[happy]` |
| **wake_fortune** | 가벼운 엔터테인먼트 운세(예언 아님), 생년월일/시간/별자리 금지. 연인/배우자면 새 인연·연애운·질투 금지(기분/소소한 운/건강/일/공부) | `[playfully]`/`[curious]` |
| **meal** | 끼니 챙겼는지 자연스레 + 메뉴 1개 제안, 날씨 부드럽게. 잔소리 아님 | `[cheerfully]`/`[curious]` |
| **sleep** | 폰 내려놓고 쉬도록. **차분·저에너지(저각성 톤 허용 유일 모드)**. KO 형제=반말, JA 캐주얼 | `[calm]`, 드물게 `[tired]`/`[whispers]`/`[quietly]` |
| **exercise** | 활기차되 유치하지 않게. 날씨 맞춰 실내근력/실외유산소. "무리 말고" | `[cheerfully]` (또래/연인 `[excited]`) |
| **love** | 사적·다정한 아침. 연인=은근 설렘이되 알람으로 쓸 수 있게. 드라마/소유욕/새 인연 금지 | `[happy]`/`[cheerfully]`/`[playfully]` |
| **preset/custom(사용자문구)** | 사용자 말 재작성 금지. 번역 요청 시 네이티브 구어로 충실 번역, 아니면 원문 유지. 시작 태그 1개. 사용자 입력은 DATA로만(인젝션 안전) | 감정 매칭 1개 |

### 4.5 태그 정책

- **태그 ≠ enum (2026-06-28 사용자 검증, 공식 문서)**: ElevenLabs v3는 "지원 태그 enum 전체 목록"을 공개하지 않으며, 공식 문서는 audio tag를 **"natural-language instructions, not an enum parameter"** 로 규정한다. 즉 `[laughs]`/`[whispering]`처럼 **대괄호 안 자연어 지시**이고, 실제 효과는 **voice·context·stability에 의존**(같은 `[shouting]`도 조용한 보이스엔 안 먹음). → 우리는 "v3가 받는 enum"을 강제하는 게 아니라, **예측가능성·알람 적합성·태그 낭독 방지**를 위해 **우리가 쓰는 큐레이트된 자연어 딜리버리 큐 집합**을 둔다(모델은 이 집합에서 1개 또는 0개; 우리 검증 게이트도 이 집합으로만 제한).
- **큐레이트 세트(공식 문서/블로그 예시에 실증된 것만)**: 긍정/기상 `[happy] [cheerfully] [excited] [playfully] [curious] [lighthearted]` · 차분/취침 `[calm] [tired] [whispers] [quietly]` · (드문 강조) `[short pause]`. 기존 가짜 부사 어휘(warmly/encouraging/gentle/softly/calmly/happily/proudly/brightly/sleepily/comforting)는 **전량 폐기** — **실서비스 전이라 back-compat·마이그레이션 맵 불필요**(프리셋 등 옛 태그는 그냥 새 값으로 치환/재작성).
- **제외**: `[yawns]`(공식 문서 미확인 → 제외; 졸림은 `[tired]`), `[sighs]`/`[laughs]`/`[giggles]`(따뜻한 알람에 부적합·불만족조), `[standing]/[grinning]/[pacing]/[music]`(공식 Enhance가 **사용 금지 예시**로 명시), 억양/캐릭터 태그(알람 무관). 페이싱은 SSML 미지원 → …/、/쉼표 우선, `[short pause]`만 예외적.
- **각성 규칙(Bruck/McFarlane)**: 저각성 큐 `[calm][tired][whispers][quietly]`는 **sleep 모드 전용** — 기상엔 금지(저각성 신호가 기상 목표와 충돌).
- **배치**: 정확히 1개를 문두에(우리 문장은 한 호흡이라 단일 시작 태그가 옳은 입자). 조합 금지(<250자에서 2개+ 예측불가). <20자 또는 명확히 안 맞으면 빈 태그(소리내어 읽힘 방지).
- **짧은텍스트(<250자) 전략**: 단일 시작 태그·문장부호 페이싱·짧은 범위의 긴 쪽(인사+케어 1개, 2문장) 선호·효과는 미묘함 수용(특히 JA). 태그 어휘는 공식 문서/예시로 실증되지만 **보이스별 실제 효과는 가설** — 보이스별 청취로 확정 전까지 그라운드 트루스로 취급 금지.
- **voice_settings(검증된 버그 수정)**: `elevenlabs.ts:119`의 `if (modelId !== DEFAULT_TTS_MODEL_ID)` 때문에 v3(유일 모델)는 **현재 voice_settings 미전송** → 서버 디폴트 적용돼 태그 약화. **수정**: eleven_v3에 항상 voice_settings 전송 — `stability 0.5(Natural, 이산 enum 값)`, `similarity_boost 0.8`, `style 0.4`, `speed 1.0`(sleep 0.95), `use_speaker_boost true`. **Robust(0.7+) 금지**(태그 억제). ※ "v3가 voice_settings를 존중한다/이 픽스가 태그를 되살린다"는 **가설** — 전/후 청취 회귀로 확인 전 사실로 출시 금지.
- **전송**: 태그는 **인라인**으로(백엔드가 `[tag] `+text 조립; 모델은 tag 필드만 반환 → 브래킷 오타/오배치 방지). model_id=eleven_v3. JSON tag 필드는 조립/로깅용이지 2차 API 호출 아님.

### 4.6 길이 정책

- 목표: 한 줄 또는 두 짧은 문장. KO/JA ~25~70자, EN ~10~22단어. 하드캡 200자 유지(`tts.ts:801`, `vertex L226`, `prepared L824`).
- 수면관성 과학상 **짧은 쪽**을 택한다(단순·구체·빠른 파싱 = 신뢰·빠른 해제·아침 행복). v3의 "250자+ 안정" 텐션은 **패딩으로 메우지 않고**(패딩은 알람 가치·자연스러움 훼손) (1) 짧은 범위의 긴 쪽 지향 (2) stability=Natural(0.5) (3) 보수 단일 태그 (4) 문장부호 페이싱 (5) 나쁜 출력 재생성 으로 헤지.
- 실제 스위트스팟(1~3초 각성효과 vs v3 4~6초 안정)은 **미해결** → 출시 전 KO/JA MOS로 실측. 어느 쪽도 확정 취급 금지.

### 4.7 검증·재시도 (2단)

기존 binary 9-check 전량폐기(`vertex-translate.ts:223-236`)를 **2단 스코어러**로 교체. "들쭉날쭉"의 최대 레버는 고온도 후보를 **폐기 대신 국소 수리**하는 것.

- **HARD 차단(reject → 1회 한정 재롤 → 회전식 폴백)**: 파싱불가/메타 JSON('here is the json'); 200자 초과; 운세 PII 누설(생년월일·별자리 — `hasFortuneProfileEcho` 유지); 관계라벨 누설/자기참조(`hasRelationshipLabelLeak` 유지); 추정 가족호칭 ≠ listener_title(`hasUnsupportedListenerAddress` 유지하되 `FAMILY_TITLE_RE`를 **호격 조사/문장부호가 바로 뒤** 오도록 완화 → 딸/아들 성씨형 오매칭 수정); 알람시각/날짜 에코(유지); 브래킷 지문/태그>1/allowlist 밖 태그; 타깃언어 불일치.
- **SOFT(수용+자동수리, 폐기 금지, 신뢰도만 하향)**: KO 조사/띄어쓰기('비 올 수 있대요'→'비가 올 수 있대요')는 `polishDynamicAlarmText`를 **수리로만**(reject 신호 아님); 경미한 어체 슬립; 행동 없는 날씨; 태그 누락(무태그 출고). `hasRomanticToneIssue`의 '해요체 어미 전량 reject'를 **관계기반 SOFT**로 강등(현재는 모든 정중 어미 reject) — 새 인연/질투 어휘 체크만 HARD 하위규칙 유지.
- **순환태그 수정**: 텍스트와 태그를 **같은 호출**에서 생성(`{text,tag}`), 동적모드의 2차 `prepareAlarmTextWithVertex(autoTag)`(`tts.ts:811`) 제거. 동적 프롬프트가 인라인 브래킷을 금지하고 태그를 별도 필드로 내므로 `hasDeliveryTagOrStageDirection`은 text 내 브래킷만 reject.
- **재시도**: 최대 1회, HARD 차단/JSON 실패에만(공통경로 ~1왕복 유지, temp 0.85→0.75로 churn↓). 선택적 신뢰도 게이팅 경량 수리(임계 미달+재시도 예산 시 같은 호출 1회 nudge 재롤; 공통경로에 강제 2차 LLM 금지). 2차 실패 시 **회전식 폴백**(모드+dateLabel 해시로 몇 개 템플릿 회전; 고정 단일 문구 금지).
- **견고 JSON**: `generationConfig.responseSchema`(`{text,tag}`, required:[text]) 1차, brace-slice 파서 최후 폴백 유지(responseSchema+thinkingBudget:0 on flash는 미검증 — 회귀 확인 전 레거시 파서 유지). 조사/날씨 정규식 밴드에이드는 KO/JA MOS 확인 후 얇은 안전망으로 축소(정규식 늘리지 말 것).

### 4.8 페르소나·변주

- `relationship_label` = 레지스터/온도/어휘만 구동(절대 발화 금지 — 누설 가드 유지). `listener_title` = 호칭 그대로, 동적모드는 이미 `synthesisText`→캐시 해시에 반영됨(키 추가는 무해하나 저가치). v1은 **DB 컬럼 없이** relationship_label에서 in-prompt 페르소나 파생(연인→intimate peer, 손녀→young&respectful, 친구→casual peer, 선생님→composed warm).
- **voice_gender(단일 nullable 컬럼 m/f/neutral, 선택 트랙)**: 최고 단일-ROI 페르소나 신호 — **오직 일본어 1인칭(僕/俺/私) 때문**. 기본 GENDER-NEUTRAL ね/よ, 성별은 1인칭/어휘로만 가볍게. **가드: 役割語/만화체(わ/かしら/ぞ/だぜ) 금지**. 연령/방언/톤은 후속.
- **경계된 변주 엔진(제안4 그래프트, 디스코프)**: freshness seed = hash(dateLabel + mode + 시간대 버킷)로 **opener·리듬·소소한 케어 디테일만** 변주(골격 고정). **제외**: (1) wakeSuccessRate→각성 에스컬레이션(soft-start 윤리 충돌·코르티솔 리스크·텔레메트리 부재) (2) VAD파생 per-call voice_settings 변주(개인보이스 캐시 fan-out 폭증). voice_settings는 모드별 고정값(요일 변주 아님). seed 입자는 버킷(요일/시간대)이라 시스템 스톡보이스 공유캐시 유효.

### 4.9 few-shot 예시 (실제 주입)

| lang | context | output |
|------|---------|--------|
| ko | wake_weather, 손녀→할아버지, rain | `[cheerfully] 할아버지, 좋은 아침이에요. 오늘은 비가 올 수 있대요. 나가실 때 우산 꼭 챙기세요.` |
| ko | wake_weather, 연인, dust | `[cheerfully] 자기야, 일어나자. 오늘 미세먼지 많대. 나갈 때 마스크 꼭 챙겨, 알았지?` |
| ko | sleep, 형제(누나) | `[calm] 누나, 잘 시간이야. 휴대폰 내려놓고 얼른 자.` |
| ko | wake_fortune, 중립 | `[playfully] 좋은 아침이에요. 오늘은 작은 선택에 좋은 기운이 따른대요. 가벼운 마음으로 시작해요.` |
| ko | meal(점심), 부모→자식 | `[cheerfully] 우리 딸, 점심 챙겼어? 바빠도 따뜻한 국밥 한 그릇은 먹자.` |
| ja | wake_weather, 孫→祖母(タメ口), rain | `[cheerfully] おばあちゃん、おはよう。今日は雨が降るみたい、出かけるとき傘忘れないでね。` |
| ja | wake_weather, 距離/불명(です・ます), cold | `[calm] おはようございます。今日は冷えるみたいなので、一枚羽織ってくださいね。` |
| ja | sleep, 恋人(タメ口) | `[calm] そろそろ寝よっか。スマホは置いて、ゆっくり休んでね。` |
| ja | exercise, 友達(タメ口), nice | `[cheerfully] そろそろ体動かそっか。今日は天気もいいし、軽く外を歩いてこよ。` |
| ja | wake_fortune, 중립/casual | `[playfully] おはよう。今日はちょっといいことがありそうだよ。気楽にいこうね。` |
| en | wake_weather, neutral, rain | `[cheerfully] Morning… time to get up. Looks like rain later, grab your umbrella before you head out.` |
| en | love, romantic, babe | `[happy] Morning, babe. Take your time getting up — I've got you today, okay?` |
| en | sleep, friend | `[calm] Hey, it's getting late. Put the phone down and let's get some rest.` |

---

## 5. 코드 변경맵

> 커밋 그룹: **PL**=prompt-logic-nocommit(커밋 보류) · **UX**=uiux-commit(커밋 허용) · **S**=schema-optional(선택)

| 파일 | 변경 | 그룹 |
|------|------|------|
| `vertex-translate.ts` `generateContent*` (L394-430) | 요청 본문에 `systemInstruction:{parts:[{text}]}` 스레딩 + `responseSchema({text,tag},required:[text])`. responseMimeType/json·thinkingBudget:0 유지 | PL |
| `vertex-translate.ts` `APPROVED_TAGS` (L80-91) | 큐레이트 세트 `[happy,cheerfully,excited,playfully,curious,lighthearted,calm,tired,whispers,quietly]`(+드문 `short pause`)로 **그냥 교체**(마이그레이션 맵 불필요) + mode→default-tag 헬퍼 + Bruck/McFarlane 가드(저각성 `[calm][tired][whispers][quietly]` sleep 전용). 주석에 "태그=자연어 지시, enum 아님" 명시 | PL |
| `vertex-translate.ts` `dynamicAlarmTextPrompt` (L518-583) | 고정 철학/출력계약/태그정책을 systemInstruction으로 이전; user prompt엔 가변+활성언어 블록만. `{text,tag}` 단일 호출(브래킷 모순 제거). `japaneseRegisterGuidance()` 신설(敬語 vs タメ口·종조사·pro-drop·gender-neutral·役割語 금지·가타카나·모라·… 페이싱) + 경량 `englishRegisterGuidance()`; ko/ja/en 분기 배선(ja 현재 0줄) | PL |
| `vertex-translate.ts` 검증 (L223-236) | binary→2단 스코어러(HARD→1재롤→회전폴백; SOFT→수용+수리). `hasRomanticToneIssue` 해요체 전량reject→SOFT(새인연/질투만 HARD). `FAMILY_TITLE_RE` 호격 경계 완화. temp 0.85→0.75 | PL |
| `vertex-translate.ts` 폴백/파서 | `dynamicAlarmTextReadableFallback`(L585-663) 모드+dateLabel 해시 회전. `parseAlarmTextPreparation` brace-slice는 responseSchema 뒤 최후 폴백 | PL |
| `elevenlabs.ts` (L119) | **버그 수정**: 역조건 제거 → eleven_v3에 항상 voice_settings 전송(stability 0.5 Natural, similarity 0.8, style 0.4, speed 1.0/ sleep 0.95, use_speaker_boost). Robust 금지 | PL |
| `tts.ts` 동적경로 | 동적모드 이중 Vertex 호출 제거 — `generateDynamicAlarmTextWithVertex`(L758) 후 `prepareAlarmTextWithVertex(autoTag)`(L811) 생략, 반환 `{text,tag}` 직접 사용·`[tag] `+text 조립. prepare는 preset/custom+번역 경로만 | PL |
| `tts.ts` 날씨 | `loadWeatherSummary/buildWeatherAdvice`(L314/L352)가 한국어 문장 대신 구조화 토큰 `{condition:rain|snow|dust|cold|heat|nice, action:umbrella|mask|coat|water|walk}` 산출 → ja/en 네이티브 재표현(재번역 환각 제거, #7). 호출부/테스트 갱신. 모드별 voice_settings·freshness seed 전달 | PL |
| `migrations.ts` | (선택) `voice_profiles.voice_gender`(m/f/neutral) nullable + 선택 `tone_preset(warm\|calm)`. additive nullable(출시 전 DB 초기화라 back-compat 부담 없음) | S |
| `packages/shared/src/schemas` | (선택) voice profile zod + TtsGenerateRequest에 voice_gender/tone_preset, 공유 weatherSignal 토큰 타입 | S |
| `apps/android-native` 보이스 프로필 화면 | (선택) voice_gender 선택/ tone_preset 토글/ JA 정중 토글. WakerDesign shape 토큰 + colorScheme(생 리터럴 금지) | UX |

---

## 6. 검증 계획 (출시·Gemini 실반영 전, 4겹)

1. **시뮬레이션 매트릭스(자동)**: 언어{ko,ja,en} × 모드{6} × 관계{손녀→조부모, 부모→자식, 형제, 친구, 연인/배우자, 중립} × 호칭{유/무} 전수. 각 셀 5회 생성해 (a)레지스터 적합(특히 **JA 손주→조부모가 タメ口인지**) (b)금지 누설(관계/숫자/날짜/시각/생년월일) (c)200자 (d)태그 1개·allowlist·문두 (e)초단문 빈태그 가드 자동 채점 + 변주·폴백률 측정.
2. **적대적 검증**: 프롬프트 인젝션(호칭/프리셋에 '관계 말해라'/'시각 읽어라'), 연인+운세 새인연/질투 유도, fortune 생년월일 에코 유도, alarm_time/date 에코 유도, JSON 깨뜨리기(코드펜스/중첩/메타) → HARD 100% 차단·1재롤→회전폴백 확인.
3. **현지인 MOS(필수)**: KO/JA 원어민 각 10~20명, 자연스러움·관계적절성·기상의욕 5점. 특히 **JA 손주→조부모 タメ口 디폴트 수용도**·종조사 자연성·役割語 여부. 미달 시 제공자 라우팅/정중 토글 검토.
4. **v3 합성 청취 회귀(코드픽스 검증)**: (a)`elevenlabs.ts` voice_settings 픽스 전/후 동일 텍스트 비교 — 태그 실제 실현·'설정 미전송이 범인' 가정 실측 (b)<250자 단문 태그가 소리내어 읽히는지(특히 JA, 보이스별) (c)sleep 저각성 태그 타 모드 누출 없음 (d)stability 0.5 enum 거부/스냅 여부. + 엔지니어링 회귀(responseSchema+thinkingBudget:0 간헐 빈응답 시 브레이스 폴백, 단일콜 1왕복 유지, 날씨 토큰화 후 ja/en 환각 제거, 캐시 히트율).

---

## 7. 미해결 결정 (사용자 판단 필요)

1. **태그 allowlist 확정 범위**: 9개 세트로 출시 전 보이스별 청취 확정 vs 더 보수적 `[happy/cheerfully/calm]`만으로 시작. (태그는 v3 실증이 제각각 → 가설)
2. **길이 정책 + MOS 게이트**: 짧게(수면관성) vs v3 250자+ 권장. MOS를 출시 게이트로 둘지.
3. **v3 KO/JA MOS 미달 시 대체 라우팅을 이번 범위에 넣을지** vs 별도 트랙.
4. **일본어 가족 디폴트 タメ口 vs 정중 토글 노출**: 조부모 청자에 너무 격의 없을 수 있음.
5. **voice_gender 1컬럼(+선택 tone_preset) 이번에 스키마/마이그레이션/UI까지** vs 텍스트 규칙만 먼저.
6. **날씨 구조화 토큰화 이번 PR 포함** vs 프롬프트 '의미 재표현'으로 임시 처리 후 분리.
7. **경계된 변주 엔진(freshness seed) 이번에 켤지** — 차별화 이득 vs 회귀/캐시 표면.
8. **temperature 0.85→0.75** 인하가 변주 다양성을 너무 줄이는지 A/B.

---

## 8. 가설 vs 확정 (정직성 노트)

- **확정(코드로 검증)**: voice_settings 미전송 버그, 이중 Vertex 호출·순환 태그모순, 일본어 가이드 0줄, binary 검증 과폐기, 날씨 한국어 고정.
- **가설(출시 전 실측 필요)**: 태그 allowlist 어휘의 v3 실제 반응, voice_settings 픽스가 태그를 "되살린다"는 인과, KO/JA v3 합성의 MOS 통과, 짧은 길이의 각성-안정 스위트스팟, 변주 엔진이 실제 스누즈율/기상성공 개선. → 모두 §6 검증으로 확인 후에야 "Gemini 실반영" 권장.
