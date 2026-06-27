# 음성 알람 고도화 — 참고자료 (Reference)

이 작업에서 실제로 열람·참고한 자료. 신뢰도(동료심사 > 공식문서 > 산업리포트 > 블로그/후기) 기준으로 정리.
> 면책: 일부 외부 수치는 1차 출처를 직접 검증하지 못한 채 인용된 것이 있으므로, **출시 의사결정 전 핵심 수치는 원문 재확인** 필요(특히 시장 통계·일부 RCT 표본).

---

## A. ElevenLabs v3 / 오디오 태그 (공식 우선)

핵심 사실: model_id `eleven_v3`(alpha)에서만 오디오 태그 동작 · SSML break 미지원(문장부호/… 로 페이싱) · stability Creative/Natural에서 태그 반응(Robust는 억제) · **일관성에 250자+ 권장** · 태그가 소리내어 읽히는 버그 · 다국어 70+ 지만 비영어권 효과 미묘.

- [Prompting Eleven v3 (alpha) — Docs](https://elevenlabs.io/docs/best-practices/prompting/eleven-v3) — 공식 프롬프트 가이드(태그·배치·250자)
- [What are Eleven v3 Audio Tags — Blog](https://elevenlabs.io/blog/v3-audiotags) — 태그 개요·예시
- [How do audio tags work with Eleven v3? — Help](https://help.elevenlabs.io/hc/en-us/articles/35869142561297-How-do-audio-tags-work-with-Eleven-v3)
- [Best practices — Docs](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices)
- [Models — Docs](https://elevenlabs.io/docs/overview/models) · [Voice Settings — Docs](https://elevenlabs.io/docs/speech-synthesis/voice-settings) — stability/similarity/style/speed
- [What languages do you support? — Help](https://help.elevenlabs.io/hc/en-us/articles/13313366263441) — 70+ 언어·일본어 포함
- [Eleven v3 — 제품 페이지](https://elevenlabs.io/v3)
- (커뮤니티/보조, 신뢰도 medium) [Medium: On Text Markup for v3](https://medium.com/@v-jur-kh/on-text-markup-for-the-elevenlabs-v3-text-to-speech-2b0a330110e1) · [Moe Lueker: Best Settings & Audio Tags](https://moelueker.com/blog/elevenlabs-v3-tutorial-best-settings-audio-tags-free-gpt-tool) · [Runware: Directing with audio tags](https://runware.ai/docs/models/elevenlabs-v3/guides/directing-with-audio-tags) · [webfuse cheat sheet](https://www.webfuse.com/elevenlabs-cheat-sheet)

---

## B. 기상·수면관성·각성 과학 (동료심사)

- [PMC7711682 — 청각적 수면관성 대응 체계적 리뷰](https://pmc.ncbi.nlm.nih.gov/articles/PMC7711682/) — **음성·저주파(~500Hz)가 고주파 톤보다 각성·사후수행 우월**. 4개 주제 공통 토대. *(우리 음성-퍼스트 가설의 1차 정당화)*
- [pubmed 30482491 — 엄마 목소리 스모크알람(Nationwide Children's)](https://pubmed.ncbi.nlm.nih.gov/30482491/) — 음성 85~89% vs 톤 56% 각성, 그러나 **'이름 추가'는 각성률 못 올림** → 음성>톤은 크고 정체성-개인화는 작다.
- [JMIR e50835 — 아침 감정·알람 사용 종단 관찰연구(N=373)](https://humanfactors.jmir.org/2024/1/e50835) — 라벨링이 희망·행복↑ 짜증↓, 다중알람 긴장·피로↑, 빠른 해제=행복.
- [PMC3832615 — Frey, 수면관성과 각성/수행](https://pmc.ncbi.nlm.nih.gov/articles/PMC3832615/) — 관성 2시간 지속, 0~30분 최악 → 단순·구체 메시지, 0~30분 개입창.
- [PMC9804954 — 스누즈와 수면관성](https://pmc.ncbi.nlm.nih.gov/articles/PMC9804954/) — 스누즈가 반응시간·각성 악화 → 단일 알람·스누즈 마찰.
- [pubmed 19302343 — Bruck, 피치·패턴과 각성역치](https://pubmed.ncbi.nlm.nih.gov/19302343/) — 저주파(400·520Hz) 각성역치 낮음, **520Hz 최적** → 낮은 F0 보이스.
- [PLOS ONE 0215788 — McFarlane, 알람 톤·음악 요소](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0215788) — 멜로딕(100~120bpm) 알람이 관성↓ → 선율적 프로소디.
- [pubmed 24509892 — Thompson, dawn simulation](https://pubmed.ncbi.nlm.nih.gov/24509892/) — 점진 기상이 스트레스·심박↓ → soft-start·점증.

---

## C. 친숙한 목소리·사회적 실재감·파라소셜 (동료심사)

- [PMC8896625 — 수면 중 뇌가 낯선 목소리에 선택적 동조](https://pmc.ncbi.nlm.nih.gov/articles/PMC8896625/) — 낯선 목소리가 K-복합체·미세각성↑, 밤새 습관화 → '경보→컴패니언' 2단 전이·변주.
- [PMC8663575 — 여성 디지털�휴먼 감정표현 RCT](https://pmc.ncbi.nlm.nih.gov/articles/PMC8663575/) — 워밍 톤이 각성(EDA)↑이나 perceived support↓, 성별 선호차 → 기본 톤 절제·프리셋.
- [PMC11931160 — 음성 음향과 신뢰도 체계적 리뷰](https://pmc.ncbi.nlm.nih.gov/articles/PMC11931160/) — 밝기·부드러움·상승 인토네이션·짧은 발화가 신뢰 예측.
- [PMC10073782 — 음성비서 파라소셜·웰빙·브랜드 애착](https://pmc.ncbi.nlm.nih.gov/articles/PMC10073782/) — 파라소셜→웰빙→애착 → '모닝 컴패니언' stickiness.
- [Frontiers in Sleep — 수면앱이 불면 사용자에 스트레스](https://www.frontiersin.org/news/2026/03/20/sleep-apps-help-some-users-but-they-stress-out-people-with-insomnia) — 17% 불안 증가 → 무거운 트래킹·푸시 과다 회피.
- [HBS WP 24-078 — AI 컴패니언과 외로움](https://www.hbs.edu/ris/Publication%20Files/24-078_a3d2e2c7-eca1-4767-8543-122e818bf2e5.pdf) — 적정 사용 외로움↓, 과사용↑ → 비중독 윤리(1~3회/일).

---

## D. 프롬프트 엔지니어링 · 표현형/제어형 TTS

- [Vanderbilt PLoP24 — 페르소나 기반 LLM 상호작용 패턴언어](https://www.cs.wm.edu/~dcschmidt/PDF/schreiber-PLoP24.pdf) — 명확 페르소나가 일관성·맥락 적절성↑.
- [arXiv:2412.12710 — LLM 발화 자연스러움 위한 disfluency 삽입](https://arxiv.org/html/2412.12710v1) — 의도적 불어(filler) 삽입이 자연스러움 유의 상승.
- [LMNT — Getting LLMs to sound human](https://docs.lmnt.com/prompt-engineering/llm-prompting) — 구어체 명령·축약·필러·few-shot 없으면 문어/로봇틱.
- [Amazon Science — LLM 기반 TTS 품질·견고성](https://www.amazon.science/blog/improving-quality-and-robustness-in-llm-based-text-to-speech-systems) — 과생성/조기중단과 duration 명시 해법 → 길이 제약.
- [arXiv:2411.02625 — EmoSphere++ (VAD 감정 제어 zero-shot TTS)](https://arxiv.org/html/2411.02625v1) — VAD 연속공간 감정 제어 → 맥락별 톤 매핑 학술 기반.

---

## E. 한국어/일본어 네이티브 화법 · 로컬라이제이션

- [ScienceDirect 2014 — 한국어 경어/비경어 지각의 음성학](https://www.sciencedirect.com/science/article/abs/pii/S037821661400054X) — 존경도가 음역·자음명확도·속도까지 좌우 → 반말/해요체 분기는 음향 차이.
- [한국어 TTS 운율·분절 지속시간 트리 모델](https://www.sciencedirect.com/science/article/abs/pii/S016763939900014X) — 자음동화·비음화 등 음운현상이 운소 경계서 발생 → 정확도 검증 항목.
- [NICT ICASSP 2025 — 일본어 모라 단위 운율 예측(BERT)](https://ast-astrec.nict.go.jp/release/preprints/preprint_icassp_2025_ogura.pdf) — 모라 타이밍·F0 정밀도가 자연스러움 좌우.
- [일본어 종조사 'よ/ね'의 대화 기능](https://www.researchgate.net/publication/248451600_Dialogue_functions_of_Japanese_sentence-final_particles) — 종조사+인토네이션 조합이 발화 의도 변경 → JA 종조사·피치곡선 제어.
- [arXiv:2506.16310 — 악센트·감정 다국어 TTS 최적화](https://arxiv.org/abs/2506.16310) — 자연스러움 자동지표 측정 불가, 현지 MOS 기준 → 출시 전 KO/JA MOS 필수.
- [arXiv:2601.15621 — Qwen3-TTS 기술보고서](https://arxiv.org/pdf/2601.15621) — 한국어 포함 6/10 언어서 ElevenLabs 대비 CER 우위 보고 → KO/JA fallback/하이브리드 검토.

---

## F. 알라미·시장 (산업/후기, 신뢰도 medium)

- [Alarmy — Google Play](https://play.google.com/store/apps/details?id=droom.sleepIfUCan) — 시장 지배자(4.8★·2M+ 리뷰), 미션/게임 "무조건 깨움". 후기에 미션 피로·신뢰성(안 울림/크래시) 불만 반복 → **"부드럽게 동기부여하는 음성"** 화이트스페이스. (한국: Alarm Mon, Galarm 등은 게임/소셜·캐릭터, 음성 개인화 리더 부재)

---

## G. 내부 참고 (이식 대상, 수정 금지)

- **메아리(mearri) `src/lib/translate/gemini.ts`** — Stage0 스타일분석 → Stage1 초벌(Pro) → Stage2 LLM심사(5지표) → Stage3 플래그 세그먼트만 재번역(PATCH-MERGE). systemInstruction 분리·responseSchema·**네이티브 톤 충실(직역 금지) 철학**·`buildLanguageSpecificToneRules`(ko/ja/zh 네이티브 규칙)·프롬프트 인젝션 방지(사용자 유래 용어 sanitize+JSON 데이터화). → 본 설계의 systemInstruction 분리·언어별 규칙·구조화 출력·국소 수리 철학의 원형.
