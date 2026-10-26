# 합성 렌더 지문과 운영 예산

서버가 만드는 소리 파일 하나하나가 **어떤 설정으로 만들어졌는가**를 원장에 적고, 그 설정이 바뀌었을 때 **누가 비용을
내는가**와 **얼마나 다시 굽는가**를 정한다(2026-10-26, v1.3 지시서 W12 「합성 설정 지문·운영 예산 분리」).
직접 입력의 횟수 규칙 자체는 [voice-and-message.md](voice-and-message.md) §8 이 정하고, 이 문서는 그 규칙이 설정
변경을 만났을 때를 정한다.

## 1. 렌더 지문 — 원장에 "무엇으로 만들었나" 를 적는다

`generated_audio_assets` 의 새 행마다 두 값을 적는다(마이그레이션 #139, `lib/render-fingerprint.ts`).

| 칸 | 담는 것 | 쓰는 곳 |
| --- | --- | --- |
| `render_fingerprint` (`rf1-…`) | 그 소리를 만든 설정 **전부**: 공급자 · 모델 id · provider voice id · 언어 · 합성 옵션(`TTS_VOICE_SETTINGS`) · 글자 규칙 세대(`TTS_TEXT_NORMALIZATION_VERSION`) · 후처리 세대(`TTS_POSTPROCESS_VERSION`) · 높이 · 음량 · 최종 형식(`TTS_FINAL_AUDIO_FORMAT`, 코덱·샘플레이트·비트레이트) · 굽는 길(PCM → 굽기 → MP3 / 제공자 MP3 그대로 / 시청본 MP3 → 음량 사본) | 서비스 재렌더 판정(§2) |
| `render_revision` (`rv1-…`) | 그중 **목소리·언어와 무관한 전역 설정**(공급자·모델·합성 옵션·두 세대·음량·최종 형식) | 다시 구울 목록(§5) |

- **설정 값의 단일 출처는 `lib/tts-model.ts`** 다. 서버 합성·스톡 게시 스크립트가 같은 상수를 쓴다.
- 이 마이그레이션 전에 만든 행은 두 칸이 NULL 이다 — **채워 넣지 않는다.** 행만 보고는 무엇으로 만들었는지 알 수 없다.
  목록은 NULL 을 '지문 이전(legacy)' 으로 따로 센다.
- 서버 합성과 기본 목소리 게시본은 굽는 길만 달라 **같은 세대**다(게시본은 사람이 들어 본 시청본을 음량만 올린 사본 —
  voice-and-message §10).

### 캐시 키는 바꾸지 않는다 — 지금 설정이면 예전 키 그대로

캐시 키(`computeTtsCacheKey`)에는 원래 모델·provider voice·언어·글자·형식 라벨·범위·높이·음량이 들어 있었고, **합성
옵션은 빠져 있었다** — 그래서 `TTS_VOICE_SETTINGS` 를 바꿔도 옛 설정의 소리가 계속 서빙됐다. 이제 원래 키에 없던
부가 설정(합성 옵션·두 세대·최종 형식)도 키에 들어가되, **2026-10-26 의 값(`BASELINE_RENDER_EXTRAS`)과 같으면 빠진다.**

- 그래서 이 변경으로는 **어떤 키도 바뀌지 않는다** — 쌓인 캐시를 한꺼번에 무효로 만들어 전체를 다시 합성하지 않는다
  (회귀 테스트가 지문 이전 공식과 글자 하나까지 맞대 본다).
- 부가 설정을 바꾸면 그때부터 만드는 소리만 새 키를 쓴다. 기준값 리터럴은 **고치지 않는다** — 함께 고치면 옛 설정의
  소리를 새 설정의 결과로 계속 내준다.

## 2. 논리 결과와 물리 렌더를 가른다 — 서비스 사정의 재렌더는 세지 않는다

직접 입력에서 사용자가 **고른 것**은 논리 결과다: 누구의 · 어느 목소리(그 교체 세대) · 어느 언어 · 번역 여부 · 친 글자.
원장 칸 `logical_key`(`lk1-…`, `manualResultLogicalKey`)에 적는다. 렌더 설정은 넣지 않는다.

| 상황 | 캐시 | 차감 |
| --- | --- | --- |
| 같은 요청, 설정 그대로 | 히트(같은 키) | 없음(§8 그대로) |
| 같은 요청인데 **서비스가 설정을 바꿨다**(모델·음량·합성 옵션·글자 규칙·후처리·형식) | 미스 → 새 설정으로 다시 굽는다 | **없음** — 응답 `charged_source: "none"` |
| 같은 요청인데 클론이 **LRU 로 반납됐다가 재등록**돼 provider voice 가 바뀌었다 | 미스 → 다시 굽는다 | **없음**(서비스 사정 — 교체 세대가 그대로다) |
| 문구·목소리·언어를 바꿨다, 또는 녹음을 **갈아 끼웠다**(제자리 교체 — 교체 세대가 바뀐다) | 미스 | 1회(§8 그대로) |
| 30일 정리·명시적 삭제로 결과가 없다 | 미스, 논리 결과도 없다 | 1회(§8 그대로) |
| 같은 논리 결과가 **지금 설정으로 이미 있다**는데 미스(번역처럼 같은 입력에서 다른 글자가 나오는 갈래) | 미스 | 1회 — 서비스 재렌더가 아니다 |

- 판정은 **캐시 미스가 확정된 뒤, 세기 전** 한 자리다(`routes/tts.ts`). 그 사람의 원장 행 중 같은 논리 키가 있고, 그중
  지금 설정의 지문과 같은 행이 **없을 때만** 서비스 재렌더다. 마지막 줄(지금 지문의 행이 이미 있음)이 없으면 같은 요청을
  되풀이해 세지 않는 합성을 끝없이 받을 수 있다.
- `request_id`(같은 요청 표식)·광고 보상·환불 규칙은 그대로다. 서비스 재렌더도 표식은 잡는다(동시에 두 번 굽지 않게).
- 지문 이전 행은 논리 키가 비어 있다 — 그 행이 **캐시로 다시 쓰이는 순간** 채운다. 못 채워도 그 행은 예전 그대로라
  응답을 막지 않는다. 한 번도 다시 쓰이지 않은 옛 행은 설정이 바뀌면 예전처럼 세지만, 30일 미사용 정리 대상이기도 하다.
- 새 칸을 **읽는** 판정과 **쓰는** 원장 INSERT 는 칸이 없는 배포 창(#139 전)에 던져 500 이 된다 — 세기 전이거나 같은
  트랜잭션이라 잃는 것이 없다(CLAUDE.md 「배포 / 환경」 fail-closed).

### 이전 파일은 새 파일이 준비되기 전에 지우지 않는다

- **직접 입력**: 다시 구운 결과는 **새 문구 행·새 원장 행**이다. 옛 행·옛 오브젝트는 그대로 남고, 알람이 그 문구를
  쓰는 동안은 보관 정리가 건너뛴다(`cleanupExpiredAudio` — 알람이 참조하는 오디오 제외). 기기에 받아 둔 파일과 OS 예약은
  사용자가 그 알람을 다시 저장할 때까지 옛 파일로 울린다(무음 없음).
- **기본 목소리 게시본·클론 사전렌더**: 같은 message_id 에서 소리만 바꾸는 제자리 교체다(voice-and-message §5-3). 새
  오브젝트를 올리고 행을 바꾼 **뒤에** 옛 키를 삭제 큐에 넣고, 실제 삭제는 드레인이 업로드 시각 유예와 참조를 보고
  정한다. 기기는 매니페스트가 바뀐 것을 보고 다시 받고, 받기 전까지 옛 파일로 울린다.

## 3. 예산 — 정하지 않은 예산은 없는 예산이다

ElevenLabs 키는 **dev·prod 공용**이고 한 계정의 한도를 나눠 쓴다. 키를 환경별로 나눠도 같은 조직(워크스페이스)이면
한도는 갈리지 않을 수 있다 — 그래서 환경별 사용량은 **우리 장부(§4)로 세고**, 공급자 조회는 계정 전체의 바닥만 본다.

| 설정(워커 변수 · 스크립트 환경 변수) | 뜻 | 비어 있으면 |
| --- | --- | --- |
| `TTS_DEV_MONTHLY_CHAR_BUDGET` | dev(운영이 아닌 환경)의 KST 월 합성 글자 상한. **dev 전용** — 동기화 스크립트가 운영에 올리기를 거절하고, 워커도 운영에서는 읽지 않는다 | dev 요청은 막지 않는다. 워커 dev 의 대량 작업 계획은 dry-run |
| `TTS_RERENDER_BATCH_MAX_CHARS` | 대량 작업 한 회차의 글자 상한 | 대량 작업은 dry-run |
| `TTS_RERENDER_CONCURRENCY` | 대량 작업의 동시 합성 수 | 대량 작업은 dry-run |
| `TTS_PROVIDER_REMAINING_ALERT_CHARS` | 공급자 계정의 남은 글자가 이 밑이면 경보 | 공급자를 조회하지 않는다 |

- 값은 양의 정수만 받는다. 빈 값·0·음수·소수는 '정하지 않음' 이다. 코드에 기본값을 두지 않는다.
- **dev 월 예산을 넘으면**: 직접 입력·동적·미리듣기 생성은 **세기·합성 전에** 503 `TTS_BUDGET_EXHAUSTED`(경보 목록),
  클론 사전렌더 cron 은 그 틱을 건너뛴다(큐는 남아 다음 달이나 예산을 올린 뒤 잇는다). 장부를 못 읽으면 던진다 —
  정한 예산을 확인하지 못한 채 쓰지 않는다. **운영 요청은 이 숫자로 막지 않는다**(사용자 한도는 §8 이 따로 정한다).
- **대량 작업은 dry-run 이 기본이다.** 시청본 굽기(`npm run preview:stock`)는 회차 상한과 동시 수를 정해야(환경 변수
  또는 `--max-chars`·`--concurrency`) 굽는다. 정하지 않으면 예상 글자와 빠진 설정 이름만 찍는다. 상한을 넘는 나머지는
  다음 회차로 남는다(멱등 — 다시 돌리면 잇는다).
- **공급자 잔여 경보**: 문턱을 정했으면 cron 이 한 시간에 한 번(정시 첫 틱) `GET /v1/user/subscription` 을 조회해
  남은 글자가 문턱 밑이면 `scheduled.tts_provider_remaining` 으로 경보한다. dev·prod 워커가 같은 계정을 보므로 둘 다
  정하면 같은 경보가 두 번 온다 — 한쪽에만 정한다. 조회는 글자를 쓰지 않는다.
- **비밀값을 출력하지 않는다.** 합성 키는 요청 헤더에만 싣는다. 결과·오류 문구·로그·관리자 응답에 키를 넣지 않고,
  공급자 오류는 상태 코드만 남긴다(응답 본문은 버린다). 설정은 '정했는가와 숫자' 만 보인다. 스토어·광고 비밀값도 같다.
- **키가 없다고 가짜 소리를 돌려주지 않는다.** 합성 갈래가 없으면(키 없음·provider voice 없음) 400 `NO_VOICE_ID` 이고
  오디오를 싣지 않는다. 스톡 사전렌더도 던진다(`generateStockClip`).

## 4. 사용량 장부 — 요청 종류별로 성공·실패·재시도·지연을 센다

표 `tts_synthesis_usage`(#139): KST 날짜 × 요청 종류 × 결과(성공·실패)마다 횟수·재시도 횟수·글자·지연 합·최대.
사람을 가리키는 값은 없다(탈퇴 파기 대상이 아니다 — `test/account-purge-residue.test.ts` 의 분류).

| 종류 | 무엇 |
| --- | --- |
| `manual` | 직접 입력 — 새로 만들어 한 번을 셌다 |
| `manual_rerender` | 직접 입력 — 서비스 재렌더(§2, 세지 않았다) |
| `dynamic` | 프리셋·동적 문구 생성 |
| `draft_preview` | 등록 초안 미리듣기 |
| `stock_prerender` | 클론 사전렌더·기본 목소리 스톡(서버 `generateStockClip`) |
| `clone_reregister` | LRU 로 반납된 클론의 재등록 — 글자 0, **지연만** 잰다 |

- 재시도는 같은 `request_id` 의 표식이 이미 있었을 때(끝났거나 버려진 표식을 다시 잡았다) 센다.
- 이번 달 예산은 **성공한** 글자만 센다(실패는 공급자가 세지 않는다고 본다).
- **기록은 응답을 막지 않는다.** 이미 합성한 뒤라 비용은 나갔고, 기록 실패로 요청을 실패시키면 사용자가 다시 시도해
  한 번 더 합성한다. 빠지는 것은 숫자 한 줄이고 잘못 남는 행은 없다 — 실패는 로그에 남긴다.
- 클론 슬롯(활성·반납 수와 상한 `MAX_PROVIDER_CLONE_VOICES`)은 관리자 보기(§5)가 함께 싣는다.

## 5. 다시 구울 목록 — 무엇을, 얼마나

관리자 콘솔의 읽기 전용 JSON 두 개(`routes/admin.ts`, 콘솔 로그인 또는 Basic 인증):

- `GET /admin/tts/render-backlog` — 지금 게시 중인 렌더(문구 행이 그 오브젝트를 가리키고 은퇴하지 않은 것) 중 세대가
  지금과 다른 것을 **종류 × 상태(stale·legacy)** 별 개수와 예상 글자로 센다. 제자리 교체로 밀려난 옛 원장 행은 세지
  않는다. `?kind=`(`system_stock`·`clone_prerender`·`manual`·`other`)를 주면 그 종류의 대상 목록 한 쪽(`limit` ≤ 100,
  `offset` ≥ 0 — 식별자와 글자 수만, 문구 원문 없음), `?legacy=1` 은 지문 이전 행도 넣는다. 응답의 `plan` 은 지금
  예산으로 한 회차를 고른 결과다(`mode`·빠진 설정 이름·고른/남은 글자) — **합성하지 않는다.**
- `GET /admin/tts/usage` — 장부(기본 31일, `?days=` 1~100), 예산 설정, 클론 슬롯. `?provider=1` 이면 공급자 잔여도
  조회한다(문턱을 정했을 때만).

| 종류 | 다시 굽는 길 | 미리 굽는가 |
| --- | --- | --- |
| `system_stock` | `preview:stock`(예산 안에서) → 청취 → `publish:stock` 교체 갈래(voice-and-message §5-3) | 예 |
| `clone_prerender` | 다시 굽기 큐 → 서버 cron(틱당 몇 개씩) | 예 |
| `manual` | 사용자가 다시 받을 때 세지 않고 굽는다(§2) | **아니오** — 숫자는 모두 다시 받을 때의 최대치 |
| `other` | 요청마다 새로 만든다 | 아니오 |

- **점진적 게시**: 회차 상한·동시 수·(dev 면) 월 남은 예산 안에서만 고르고 나머지는 다음 회차다. 기본 목소리는 dev 에서
  먼저 게시해 폰으로 들어 본 뒤 운영에 올린다(voice-and-message §10 「위험」).
- 절차와 완료 확인 쿼리는 [`docs/ops/tts-model-rerender.md`](../ops/tts-model-rerender.md).

## 운영 연결 대기 (2026-10-26)

- 공급자 응답 모양(`character_count`·`character_limit`·`next_character_count_reset_unix`·`voice_slots_used`·
  `voice_limit`)은 공개 문서 기준이고 **실제 계정에서 아직 조회하지 않았다.** 숫자가 아니면 던진다(잘못 읽은 0 으로
  경보를 끄지 않는다). 키를 dev·prod 로 나눌 때 한도가 갈리는지도 실제 계정에서 확인해야 한다.
- 네 설정 값은 오너가 정한다 — 그전까지 대량 작업은 dry-run, 공급자 경보는 꺼져 있다.

## 구현 지도

| 규칙 | 백엔드 | Android | iOS |
| --- | --- | --- | --- |
| 설정 상수의 단일 출처 | `lib/tts-model.ts`(`TTS_VOICE_SETTINGS`·`TTS_TEXT_NORMALIZATION_VERSION`·`TTS_POSTPROCESS_VERSION`·`TTS_FINAL_AUDIO_FORMAT`) | — | — |
| 렌더 지문·전역 세대·논리 결과 키 | `lib/render-fingerprint.ts`(`renderFingerprint`·`renderRevision`·`manualResultLogicalKey`) | — | — |
| 캐시 키의 부가 설정(기준값이면 빠진다) | `lib/audio-cache.ts` 의 `computeTtsCacheKey` + `renderExtrasCacheKeyPart` | — | — |
| 원장에 지문 적기 | `routes/tts.ts`(직접 입력·동적·미리듣기), `lib/stock-clips.ts` 의 `generateStockClip`, `lib/stock-clip-replace.ts`, `scripts/publish-stock-clips.ts` | — | — |
| 서비스 재렌더는 세지 않는다 | `routes/tts.ts` 의 `serviceRerender`(캐시 미스 뒤·세기 전) | 서버 응답 `charged_source` 를 그대로 표시 | 같음 |
| 옛 행의 논리 키 채우기 | `routes/tts.ts` 캐시 히트 갈래 | — | — |
| 예산 설정·dev 월 예산·대량 작업 계획 | `lib/tts-budget.ts`(`checkDevBudget`·`planBulkRerender`), `src/index.ts` 사전렌더 cron, `scripts/prerender-stock-preview.ts` | — | — |
| dev 전용 예산 키 | `scripts/worker-secret-keys.ts` 의 `DEV_ONLY_SECRET_KEYS` | — | — |
| 사용량 장부 | `lib/tts-usage.ts`, `lib/voice-recover.ts`(재등록 지연) | — | — |
| 공급자 잔여 경보 | `lib/tts-provider-quota.ts`, `src/index.ts` 의 `scheduled.tts_provider_remaining` | — | — |
| 다시 구울 목록·관리자 보기 | `lib/render-backlog.ts`, `lib/admin/tts-ops.ts`, `routes/admin.ts` 의 `/tts/render-backlog`·`/tts/usage` | — | — |
| 에러 코드 `TTS_BUDGET_EXHAUSTED` | `packages/shared/src/schemas/error-codes.ts` | 문구 표에 없다(폴백 문구 — dev 전용) | 같음 |
| 회귀 테스트 | `test/render-fingerprint.test.ts`, `test/tts-render-budget.test.ts`, `test/tts.test.ts` 「렌더 지문과 서비스 재렌더」 | — | — |
