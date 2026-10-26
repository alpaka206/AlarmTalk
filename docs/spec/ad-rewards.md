# 광고 보상 — 광고를 보면 직접 입력 한 번

> **단일 출처.** 구현이 이것과 다르면 구현이 틀린 것이다. → [README](README.md)
> 2026-10-19 오너 지시: "광고 보고 직접 입력 1회 추가… 무료 사용자여도 가능하게 기본 목소리로".

## 1. 무엇을 주는가

무료 사용자는 기본 목소리 직접 입력을 **월 3회**(기본분) 만들고, 그걸 다 쓴 뒤 **보상형 광고를 끝까지 보면 한 번 더** 만든다
(2026-10-26 개정 — 그전에는 무료의 직접 입력이 광고 보상으로만 열렸다, `voice-and-message.md` §8).

| | 유료(플러스) | 무료 |
| --- | --- | --- |
| 직접 입력 목소리 | 기본 목소리·등록한 목소리 | **기본 목소리만** |
| 월 기본분 | 30(`MANUAL_TTS_MONTHLY_LIMIT.plus`) | **3**(`MANUAL_TTS_MONTHLY_LIMIT.free`) |
| 기본분을 다 쓰면 | 다음 달 | 광고 한 번 = 생성 한 번 |
| 광고로 받는 상한 | 광고를 권하지 않는다 | **10번**(`AD_REWARD_MONTHLY_LIMIT`, 보상이 생긴 KST 월) |
| 번역·동적 문구 | 그대로 | 열지 않는다 |

- **쓰는 순서는 기본분 → 보상**이다. 보상이 남아 있어도 기본분이 남았으면 기본분을 쓴다. 보상 사용은 기본분 사용량에
  더하지 않는다(무료 3 + 보상 2 를 쓰고 같은 달 플러스가 되면 남은 27).
- **받은 보상은 그 달이 지나도 남는다**(이월). 상한은 '한 달에 광고로 받는 횟수' 이고, 쓴 것도 받은 것으로 센다 — 쓰고
  다시 보는 것으로 상한을 비켜 가지 못한다. 그래서 "무료 3 + 광고 10 = 월 최대 13" 이라고 쓰지 않는다.
- **플러스가 되면 보상은 그대로 남는다** — 플러스 동안은 기본분(30)을 쓰고, 무료로 돌아오면 남은 보상을 쓴다.
- **보상을 쓰는 것은 서버가 새 음성을 만들 때뿐이다.** 이미 만든 내 음성은 폰에 있든 서버에서 다시 받든 세지 않는다.
  광고를 보고 저장하지 않고 나가도 보상은 남는다.
- **실패하면 돌려준다.** 셌는데 생성이 실패하면(합성 실패·그 뒤의 DB 쓰기 실패) 서버가 그 보상을 되돌린다.
- **광고 노출 스위치와 이미 만든 결과의 재생 권한은 별개다.** 광고를 끄면 새 시청만 멈춘다 — 적립된 보상·만든 문구·
  무료 3회는 그대로다. (예전의 '광고를 끄면 무료 직접 입력 문구를 정리' 규칙은 2026-10-26 에 없앴다.)
- **잔액은 계정에 하나다.** 안드로이드에서 받든 iOS 에서 받든 같은 잔액을 읽고 쓴다.
- 양도·현금화는 없다. 보상은 적립한 계정의 기본 목소리 새 직접 입력에만 쓴다.

### 1-1. 새로 만들 때 어디로 가나 (두 앱 같은 표)

'음성 만들기'(저장) 한 번이 새 제작이 필요할 때 — 즉 **본인 결과를 다시 쓸 수 없을 때**(폰에도 없고 서버도 같은 입력의 내
결과가 없다고 했을 때) — 의 갈래다. 판정은 두 앱 모두 순수 함수 하나(안드로이드 `AdRewardGate.route`, iOS
`AdRewardGate.route`)이고, 입력은 `GET /tts/manual-quota` 의 값이다.

| 상태 | 동작 |
| --- | --- |
| 본인 기존 결과가 있음 | 무료 재사용. 광고 없음(폰의 입력 캐시 → 서버의 `cache_hit` — 판정 함수까지 오지 않는다) |
| 무료 월 기본분이 남음 | 기본분으로 새 제작 |
| 기본분 0, 보상 잔액 있음 | 광고를 다시 보게 하지 않고 보상 1회 사용 |
| 기본분 0, 보상 0, **정산 대기 보상 있음**(`pending`) | "보상을 확인하고 있어요" — 닫을 수 있다. 광고를 다시 권하지 않는다 |
| 둘 다 0, 광고 획득 가능(`can_watch` + 이 빌드에 광고 단위) | "광고 보고 한 번 쓰기" 를 제안 |
| 광고 상한·미지원(이 빌드에 광고 단위 없음·스위치 꺼짐)·재고 없음 | 다음 제공일(`next_grant_at` — 상한이면 다음 달 1일)·만들어 둔 음성·기본 문구·플러스 안내 |
| 플러스·스토어 무료 체험·관리자 지급이 유효 | 광고 제안 없음. 그 달 30회 규칙 |

- 광고를 보지 않아도 알람 만들기·기본 문구·저장한 결과 재생은 그대로다. 직접 입력 화면 진입·편집은 잠그지 않는다 —
  새 제작 자원이 필요한 **저장 순간**에만 말한다.
- 광고를 봤다고 문장을 자동으로 만들지 않는다. 보상이 들어오면 사용자가 다시 저장할 때 한 번 쓴다.

## 2. 광고는 **보상형 하나, 앱이 열려 있을 때만**

⚠ **알람 울림 화면에 광고를 넣지 않는다**(2026-10-19 검토). 다시 꺼내지 말 것 — 이유가 넷이다:

1. **iOS 는 불가능하다.** 울림 화면은 AlarmKit 의 시스템 UI 다(`alarm-ringing.md`).
2. **Play 정책 「잠금 화면 수익화」 위반이다.** 잠금 화면 앱이 아니면 잠긴 화면에 광고를 띄울 수 없는데, 울림 화면은 대부분
   잠금 화면 위에 뜬다(전체화면 인텐트 — `alarm-ringing.md` §1).
3. **AdMob 실수 클릭 규정.** 끄기 버튼 바로 옆 배너는 AdMob 이 위험하다고 명시한 배치다. 무효 클릭이 쌓이면 계정이 막힌다.
4. **우리 규칙과 부딪친다.** 울림 경로는 네트워크를 부르지 않고(`usage-events.md`), 광고를 누르면 화면을 벗어나 **알람이
   꺼진다**("벗어나면 해제" — `alarm-ringing.md`). 실수 한 번이 늦잠이다.

보상형 광고는 사용자가 **스스로 고른 순간에만** 뜬다(아래 §4). 다른 광고 형식(배너·전면)은 아직 없다 — 넣으려면 여기에 먼저
자리와 이유를 적는다.

## 3. 광고를 봤다는 사실은 **AdMob 서버가** 알려 준다 — 시청 승인 세션

앱이 "봤어요" 라고 보내는 값은 믿지 않는다 — 아무나 그 요청을 만들 수 있다. 알람톡은 제작 비용과 부정 적립을 생각해
**검증 뒤 지급**을 고른다: AdMob 의 **서버 측 확인(SSV)** 콜백만 보상을 적립한다. (SSV 가 Google 이 요구하는 유일한 지급
방식이라는 뜻은 아니다 — 우리가 고른 것이다.) 그 콜백을 **광고마다 서버가 먼저 승인한 세션**에 맞춰 본다(2026-10-26,
v1.3 W07).

### 흐름

1. 사용자가 '광고 보고 한 번 쓰기' 를 고른다(보상과 사용 범위는 버튼 문구와 게이트 본문이 먼저 말한다).
2. 앱이 `POST /api/ad-rewards/sessions` `{platform, ad_unit}` — 서버가 신규 시청 허용(운영 스위치)·이 광고 단위·무료 계정·
   이번 달 획득 가능량·열린 세션을 보고 **승인 id** 를 만들며 이번 달 자리 하나를 **임시 예약**한다. 응답의
   `ssv.user_id`(계정 PK)·`ssv.custom_data`(승인 id)를 광고의 `ServerSideVerificationOptions` 에 싣는다.
3. 앱이 광고를 불러온다. 못 불러오면(재고 없음·로딩 실패·동의 불가) `close` 로 알리고 끝 — 예약이 풀린다.
4. **표시 직전** `POST /api/ad-rewards/sessions/:id/start`(시작 승인). 이 기록은 운영 상태 관리용이다 — 보상의 증명은 SSV 다.
   시작 요청이 실패하면 광고를 띄우지 않고 `close` `show_failed` 로 닫는다 — 연결이 끊겼거나 5xx 면 시작이 들어갔는지 몰라서다
   (남겨 두면 10~15분 잠기고, 들어갔다면 결과 불명으로 월 자리를 잡는다).
5. 광고 화면이 닫히면 `POST …/:id/close` `{outcome}` — `earned`(SDK 의 보상 신호)·`dismissed`·`show_failed` 등.
6. 사용자가 끝까지 보면 AdMob 서버가 `GET /api/ads/admob-ssv?…&signature=…&key_id=…` 를 부른다(`routes/ads.ts`). 서명을
   확인하고(`lib/admob-ssv.ts` — Google 공개키 목록, ECDSA P-256) **먼저 기록한 뒤**(`ad_reward_callbacks`) 정산한다.
7. 앱은 지급을 확인할 때까지 "보상을 확인하고 있어요" 로 말하고 `manual-quota` 를 다시 읽는다. 이 응답과 `/api/ad-rewards/*` 는 **캐시하지 않는다**(`no-store`) — 30초
   캐시면 정산 전 응답을 계속 읽는다. 이 상태는 닫을 수 있고, 다시
   들어오면 다시 읽는다(`ad_reward.pending`). **몇 초 기다렸다고 실패·재시청을 요구하지 않는다.**

### 세션 상태

| 상태 | 뜻 | 동시 시청 잠금 | 이번 달 자리 |
| --- | --- | --- | --- |
| `prepared`(준비) | 승인 id 발급. 시작 승인까지 **10분**(`AD_REWARD_SESSION_TTL_MS`) | 잡는다 | 잡는다 |
| `started`(시작) | 표시 직전 시작을 승인했다 | 잡는다(15분, `AD_REWARD_START_LOCK_MS`) | 잡는다 |
| `pending`(정산 대기) | 앱이 보상 신호를 받았다고 알렸다 — SSV 를 기다린다 | 푼다 | 잡는다 |
| `unknown`(결과 불명) | 시작 뒤 15분 동안 끝을 듣지 못했다(앱 종료 등) | 푼다 | 잡는다 |
| `closed`(중도 닫힘) | 보상 신호 없이 닫혔다 | 푼다 | 푼다 |
| `released`(해제) | 보상이 생길 수 없게 끝났다 — 시작 전 만료·취소·재고 없음·로딩 실패·표시 실패 | 푼다 | 푼다 |
| `granted`(지급) | 서명된 SSV 로 보상 한 번을 적립했다 | 푼다 | 적립으로 센다 |

- **한 계정에 열린 세션(준비·시작)은 하나다** — 부분 고유 인덱스(`idx_ad_reward_sessions_one_open`)와 발급 batch 의 조건이
  함께 막는다. 두 기기가 마지막 자리를 동시에 요청하면 하나만 받고, 다른 하나는 409 `AD_REWARD_SESSION_OPEN`(또는 자리가
  없으면 `AD_REWARD_MONTHLY_LIMIT`)이다.
- **시작 승인 전**의 만료·취소·재고 없음·로딩 실패는 예약과 잠금을 푼다. **시작 승인 뒤**에는 10분 만료로 지우지 않는다 —
  정산·재조회 대상으로 남는다. SDK 화면이 닫힌 것 하나로 '보상 없음' 을 단정하지 않는다(`closed` 도 늦은 SSV 를 받는다).
- 이번 달 획득 가능량 = 상한(10) − 이번 달 적립 − 자리를 잡은 세션. 그래서 '두 기기 마지막 자리' 가 둘 다 지나가지 못한다.
- 앱의 `close` 는 보상을 주지도 빼앗지도 않는다. 같은 요청을 다시 보내도 상태가 바뀌지 않는다.

### SSV 대조 — 승인 하나에 보상 한 번

서명된 콜백의 **계정**(`user_id`)·**광고 단위**(`ad_unit`)·**거래 id**(`transaction_id`)·**승인 id**(`custom_data`)를 본다.

- 거래 id 중복 — 콜백 기록과 적립 행 모두 거래 id 가 PK 다. 같은 콜백이 다시 오면 시도 횟수만 올리고 처음 결과를 돌려준다.
- 승인 id 재사용 — 적립 행의 `session_id` 가 고유다. 다른 거래 id 로 같은 승인을 다시 쓰면 `session_reused` 로 적립하지 않는다.
- 세션의 계정과 콜백 계정이 다르면 `session_user_mismatch`, 세션을 만든 광고 단위와 다르면 `session_ad_unit_mismatch`, 모르는
  승인 id(UUID 가 아닌 값 포함)는 `session_unknown` — 모두 적립하지 않는다. 승인 id 가 있으면 옛 경로로 새지 않는다.
- **시청 중 플러스 가입·월 경계·광고 신규 노출 중단**으로 승인된 정상 완료 보상을 조용히 거절하지 않는다. 승인 id 가 있는
  콜백은 **지금의 플랜을 보지 않는다**(무료일 때 승인한 시청이다) — 플러스가 됐으면 적립해 잔액으로 둔다.
- 자리를 잡고 있던 세션(준비·시작·정산 대기·결과 불명)의 콜백은 **월 상한을 다시 보지 않는다** — 승인할 때 자리를 확인했다.
  자리를 푼 세션(중도 닫힘·해제)의 늦은 콜백은 그 달 상한 안에서만 적립한다(`monthly_limit` 이면 기록에 남는다).
- 탈퇴(유예 포함)한 계정이면 `user` 로 적립하지 않는다.

### 월 귀속

**서명된 SSV `timestamp`(보상 발생 시각)의 KST 달**에 귀속한다(`grantMonthFor`). 처리 시각으로 세면 자정 직전에 본 광고의
콜백이 늦게 와 다음 달 몫을 먹는다. 그 값이 40일보다 오래됐거나 하루보다 미래면 처리 시각으로 센다.
승인 때의 월 예약은 임시다 — 정산 정책을 승인 월로 바꾸지 않는다. **발급과 시작 사이에 달이 바뀌면** 시작 승인이 새 달의
가능량을 다시 본다(없으면 예약을 풀고 `AD_REWARD_MONTHLY_LIMIT`). **시청 중에 달이 바뀌면** 보상 발생 달로 정산한다 — 그 달이
이미 찼어도 승인된 보상을 잃게 하지 않는다(상한을 하나 넘길 수 있다. 정상 완료 보상을 잃는 쪽보다 낫다고 봤다).

### 콜백 응답 — 내구 기록 뒤 성공

AdMob 은 200 이 아니면 다시 부른다(공식 재전송은 짧다 — 1초 간격 다섯 번. 그것만으로 긴 장애 뒤의 보상이 다 복구된다고 보지
않는다).

| 경우 | 응답 | 이유 |
| --- | --- | --- |
| 서명이 틀렸다 | 403 `AD_REWARD_SIGNATURE_INVALID` | AdMob 이 보낸 것이 아니다 |
| 다른 콜백이 2초 안에 키 목록을 다시 받았다 | 429 `AD_REWARD_RETRY_LATER` | 1초 뒤 재시도에서 받힌다 |
| 서명은 맞는데 형식이 받을 수 없다 — 설정에 없는 광고 단위·빈 거래 id·계정 칸 형식 | 200 `{granted:false}`(기록 안 함) | 다시 불러도 같다. AdMob 콘솔의 'URL 확인' 시험 호출도 여기로 온다 |
| 그 밖 | **기록한 뒤** 200 `{granted}` | 정산이 거절이어도(위 대조) 기록에 이유가 남는다 |
| 기록은 됐는데 정산이 실패했다 | 200 `{granted:false, deferred:true}` | 기록이 남았으니 **cron 이 다시 정산한다**(`retryUnsettledAdRewardCallbacks`, 1분 뒤부터) |
| 키 목록을 못 받았다·기록이 실패했다 | 5xx(던진다) | 우리 장애다. 그때는 AdMob 의 재전송이 유일한 기회다 |

### 운영 스위치와 광고 단위 목록

- `ADMOB_REWARDED_ADS_ENABLED`(`true`/`1` 이면 켜짐, 그 밖은 꺼짐 — fail-closed)는 **신규 시청 허용만** 끈다. 꺼지면 새 세션
  발급·시작 승인이 409 `AD_REWARD_UNAVAILABLE`(`reason: disabled`)이고, `manual-quota` 의 `ad_reward.can_watch` 가 거짓이다.
  **이미 승인한 세션의 SSV 정산은 계속한다** — 끄는 순간 시청 중이던 사람의 보상이 사라지면 안 된다. 적립된 잔액·만든 결과도 그대로다.
- `ADMOB_REWARDED_AD_UNITS`(쉼표 구분)는 **허용 목록**이다 — 콜백은 여기 있는 단위만 기록·정산한다(남의 앱 광고 단위로 서명된
  콜백도 서명 자체는 맞다). 정산에 필요하므로 스위치를 꺼도 지우지 않는다. 앱이 세션을 만들 때 보낸 광고 단위도 이 목록에
  있어야 한다(`reason: ad_unit`).
- 둘 다 비어 있는 것이 기본값이다 — 운영 연결 전에는 **광고가 보이지 않는다**.

### `manual-quota` 의 `ad_reward`

무료 계정에게만 싣는다(플러스는 30회 규칙 — 잔액은 그대로 남는다). 스위치와 무관하게 늘 싣는다 — 잔액은 광고를 꺼도 쓴다.

| 필드 | 뜻 |
| --- | --- |
| `credits` | 쓸 수 있는 보상(계정 하나에 한 잔액) |
| `remaining_grants`·`monthly_limit` | 이번 달 더 받을 수 있는 횟수(열린 예약 포함해 뺀다)·상한 |
| `pending` | 정산 대기 세션 수(24시간 안). 앱은 "보상을 확인하고 있어요" 를 말한다 |
| `can_watch`·`unavailable_reason` | 지금 새 광고를 볼 수 있나. 못 보면 `disabled`·`monthly_limit`·`session_open` |
| `next_grant_at` | 상한이면 다음 달 1일 0시(KST). 그 밖은 null |

### 옛 앱(승인 id 없는 SSV)과의 호환

- 2026-10-26 전 빌드는 `manual-quota` 가 준 `ad_reward.user_id` 를 SSV 에 싣고 승인 없이 광고를 띄웠다. 이제 **`user_id` 를
  싣지 않는다** — 옛 빌드는 그 값이 없으면 광고를 권하지 않으므로, 승인 없는 새 시청이 시작되지 않는다. 계정 PK 는 세션 응답
  (`ssv.user_id`)에만 있다. (운영 빌드는 광고 단위가 비어 있어 광고를 띄운 적이 없다 — 실제로 영향받는 것은 dev 빌드뿐이다.)
- 그래도 승인 id 없이 오는 콜백(`custom_data` 가 빈 값)은 **옛 규칙 그대로** 정산한다 — 무료 계정만, 그 달 상한(예약 포함)
  안에서, 거래 id 중복 없이. 넘어온 보상을 잃지 않게 둔 갈래이고, 옛 빌드가 남지 않으면 지운다.

- 모르는 `key_id` 가 오면 키 목록을 다시 받아 본다. 이 라우트는 인증이 없어 아무 `key_id` 나 붙인 요청으로 Google 로 나가는
  요청을 부풀릴 수 있고, 진짜 키 교체도 같은 모양으로 온다. 그래서 — **같은 `key_id`** 는 한 번 받아 봐도 없었으면 10분 동안
  곧바로 거절(403)하고, **다른 `key_id`** 의 강제 갱신은 전체에서 2초에 한 번까지다. 그 사이에 온 것은 거절이 아니라
  `429 AD_REWARD_RETRY_LATER` 라 AdMob 의 1초 뒤 재시도에서 받힌다. 동시에 온 요청은 **진행 중인 받기 하나를 함께 기다린다** — 몰려도
  바깥 요청은 하나다. 시각은 받기에 성공한 뒤에 적는다 — 일시 장애(5xx) 뒤의 재시도는 다시 받아 본다.
- 이 콜백은 공용 IP 한도(분당 300)에서 빼고 전용 버킷(분당 6000)으로 센다 — Google 의 몇 안 되는 발신 IP 에서 몰려 온다.
  세션 라우트는 `/api/ads` 아래에 두지 않는다(인증 라우트 `/api/ad-rewards` — 일반 사용자 한도).
- `user_id` 를 UUID 로 좁히지 않는다 — UUID 전환 전에 가입한 구글 계정은 PK 가 구글 sub 다. 실재는 정산의 `users` 조회가 본다.

### 보관

세션·콜백 기록은 식별자만 담는다(문구·광고 내용 없음). 탈퇴 파기가 지운다(`lib/account-deletion.ts`). cron 이 지우는 것: 시작도
못 하고 풀린 세션 30일, 적립하지 않은 콜백 기록 90일. **시작 승인을 받은 세션과 적립한 기록은 지우지 않는다** — 늦은 콜백과
관리자 대조가 맞춰 볼 자리다.

## 4. 앱의 흐름 (Android · iOS 같다)

- **'직접 입력' 을 잠그지 않는다**(2026-10-26). 무료도 기본 목소리로 월 3회 만들고(`voice-and-message.md` §8), 입력·편집은
  막지 않는다. 남은 횟수가 0 이라고 요청 전에 막지도 않는다 — 서버에 내 결과가 남아 있으면 세지 않고 다시 받는다.
- 새로 만들어야 하는데 기본분도 보상도 없으면 서버가 429 `MANUAL_TTS_QUOTA_EXCEEDED`(`manual_quota`·`ad_reward` 상태 동봉)로
  막는다. 그 자리에서 현황을 다시 읽고 §1-1 표(`AdRewardGate.route`)로 고른다:
  - **광고 제안** — 게이트에 **'광고 보고 한 번 쓰기'** 를 더해 연다. 제목·본문은 보상과 쓰는 범위를 먼저 말한다("이번 달 무료
    만들기를 다 썼어요" — 광고 한 번 = 기본 목소리 직접 입력 한 번, 이 계정에서만, 플러스는 월 30번). 버튼이 셋(광고 · 이용권
    보기 · 닫기)이라 세로로 쌓는다(안드로이드 `IosAlertDialog` 규칙, iOS 시스템 알럿).
  - **보상을 확인하고 있어요** — 정산 대기 보상이 있으면 광고를 다시 권하지 않고 말한다. 닫을 수 있다.
  - **다음 제공일** — 이번 달 상한이면 `next_grant_at` 의 날짜(KST)와 만들어 둔 음성·기본 문구·플러스를 말한다. 날짜가 없으면
    (스위치 꺼짐·이 빌드에 광고 없음) 한도 문구(`editor_error_manual_tts_quota`)로 말한다.
- '광고 보고 한 번 쓰기' 를 누르면 §3 의 흐름(`RewardedAdFlow.watch` — 두 앱 같은 순서)이다. 끝까지 보면 1초 간격으로 8번
  현황을 다시 읽어 보상이 들어오면 "광고 보상을 받았어요 — 다시 저장하면 이 보상으로 한 번 만들어요" 를, 아직이면 "보상을
  확인하고 있어요"(닫아도 된다)를 말한다. **실패·재시청을 요구하지 않는다.** 재고 없음은 "지금은 볼 수 있는 광고가 없어요",
  서버 거절은 그 코드의 문구(공용 표 — `AD_REWARD_MONTHLY_LIMIT`·`AD_REWARD_SESSION_OPEN`·`AD_REWARD_SESSION_INVALID`·
  `AD_REWARD_UNAVAILABLE`), 중도 닫기는 아무 말도 하지 않는다.
- 광고를 봤다고 문장을 자동으로 만들지 않는다. 보상은 사용자가 다시 저장할 때 한 번 쓴다.
- 편집기에 들어올 때마다 현황을 다시 읽는다 — 앱을 껐다 켜도 정산 대기를 다시 본다(재조회).
- **광고 단위가 없는 빌드는 광고 제안 자체를 숨긴다**(SDK 도 시작하지 않는다). iOS 는 Release 에서 Google 시험용 ID 도 없는
  것으로 본다(`AdMobConfig.resolve`). 시험용 단위는 dev(안드로이드)·DEBUG(iOS) 기본값에만 있다.
- **광고를 요청하기 전에 Google 동의(UMP)를 받는다.** 동의 정보를 갱신하고, 규정이 있는 지역(유럽 등)은 동의 양식이 뜨며,
  `canRequestAds` 가 거짓이면 요청하지 않는다(세션은 `cancelled` 로 풀린다). 그 지역에서는 동의 내역 화면에 **'광고 개인정보
  설정'** 행이 생겨 선택을 다시 바꿀 수 있다(Google 이 요구하는 privacy options 진입점). 다른 지역에서는 양식도 행도 없다.
- **무료의 직접 입력 문구를 편집기가 지우지 않는다.** 기본 목소리 클립을 다시 붙이는 효과가 직접 입력을 고른 상태면 등급과
  무관하게 손대지 않는다(`AlarmEditorScreen` 의 `manualChosen` 가드, iOS `AlarmEditDraft.keepsTypedManualText`).
- **기본 목소리 알람은 무엇을 말하든 무료로 울린다** — 저장·무료 잠금·울림 강등이 보는 판정(`usesFreeSystemVoiceAlarm` /
  iOS `PaidVoiceGate.usesFreeSystemVoice`)이 시스템 목소리를 무료로 읽는다. 등록 목소리만 유료다.
- **앱 측정은 동의 뒤에 시작한다** — 안드로이드 매니페스트의 `DELAY_APP_MEASUREMENT_INIT`, iOS Info.plist 의
  `GADDelayAppMeasurementInit`. 안 막으면 광고 SDK 가 앱 시작 때 동의 없이 데이터를 보낸다.

## 5. iOS — Google Mobile Ads + UMP

- SwiftPM(`project.yml` 의 `GoogleMobileAds` 13.11.0 · `GoogleUserMessagingPlatform` 3.1.0, 판을 못 박는다). 래퍼는
  `Ads/RewardedAds.swift` 하나 — 편집기는 SDK 를 직접 가져오지 않는다.
- 앱 ID(`GADApplicationIdentifier`)·광고 단위(`ALARMTALK_ADMOB_REWARDED_AD_UNIT_ID`)는 빌드 설정 `ADMOB_APP_ID`·
  `ADMOB_REWARDED_AD_UNIT_ID` 로만 받는다(코드에 적지 않는다 — gitignore 된 `Local.xcconfig` 또는 `xcodebuild … ADMOB_…=`).
  앱 ID 의 기본값만은 Google 시험용이다 — SDK 는 그 칸이 비면 앱이 뜨자마자 죽는다(안드로이드와 같은 이유). 광고를 띄울지는
  광고 단위가 정한다.
- ⚠ **ATT(앱 추적 투명성)를 묻지 않는다.** 우리는 IDFA 를 읽지 않고, 추적 동의를 보상 조건으로 만들지 않는다. ATT 를 묻지 않은
  기기에서 SDK 는 IDFA 없이(비추적) 광고를 낸다 — 거부한 사람과 같은 경로다. IDFA 를 직접 쓰게 되면 그때 ATT 팝업·
  `NSUserTrackingUsageDescription`·처리방침·App Store 개인정보 라벨을 함께 바꾼다.
- 오픈소스 고지 목록에는 넣지 않는다 — Google 의 비공개 SDK 다(안드로이드가 play-services 를 빼는 것과 같다).

## 6. 내보내기 전에 (운영)

코드만으로는 켜지지 않는다 — **기본값은 광고가 보이지 않는 상태다**(스위치 꺼짐·운영 광고 단위 없음). 출시 전에 사람이 할 일:

1. **AdMob** — 안드로이드·iOS 앱을 각각 등록(패키지·번들·스토어 연결), 보상형 광고 단위를 dev·prod 따로 만들고 각 단위의 SSV
   콜백 URL 을 `https://api-dev.alarm-talk.com/api/ads/admob-ssv` / `https://api.alarm-talk.com/api/ads/admob-ssv` 로 둔다. 앱
   소유권·개발자 웹사이트의 **app-ads.txt**(랜딩 `alarm-talk.com/app-ads.txt`)·readiness 상태를 확인한다. 운영 광고를 반복
   시청·클릭하는 것을 QA 방법으로 쓰지 않는다 — 실제 단위는 테스트 기기 등록으로 확인한다.
2. **워커 설정** — `ADMOB_REWARDED_AD_UNITS`(두 플랫폼의 단위, 쉼표 구분)를 각 환경에 둔 뒤 `ADMOB_REWARDED_ADS_ENABLED=true`
   로 신규 시청을 연다(`npm run secrets:sync:{dev,prod}`). 끌 때는 스위치만 비운다 — 단위 목록은 정산에 필요하다.
3. **앱 빌드** — 안드로이드 `~/.gradle/gradle.properties` 의 `alarmTalkProdAdmobAppId`·`alarmTalkProdAdmobRewardedAdUnitId`
   (dev 는 `alarmTalkDev…`). iOS `Local.xcconfig`(또는 CI)의 `ADMOB_APP_ID`·`ADMOB_REWARDED_AD_UNIT_ID`. 비면 광고 버튼이 없다.
   dev·DEBUG 의 광고 단위 기본값은 Google 시험용이라 서버가 세션을 거절한다(`reason: ad_unit` — 허용 목록에 없다). 흐름을 dev
   에서 보려면 dev 허용 목록에 시험 단위를 잠시 넣는다(시험 단위는 SSV 를 보내지 않아 보상은 쌓이지 않는다).
4. **개인정보 처리방침** — 광고 SDK(Google AdMob·UMP)로의 처리 위탁·국외 이전과 처리 항목을 적는다. 문서 버전 순서는 서버 먼저
   (`CLAUDE.md` 「법무 문서 버전」). "위치나 기기 데이터를 일절 처리하지 않는다" 류의 문장은 쓰지 않는다. GPS·현재 좌표는
   수집하지 않는다.
5. **공개 항목**(App Store 개인정보 라벨 · Play 데이터 보안 · 처리방침이 같은 말을 해야 한다). 광고 SDK 가 처리하는 것:
   | 항목 | 비고 |
   | --- | --- |
   | 기기 식별자 | Android 광고 ID(AD_ID). iOS 는 ATT 를 묻지 않아 IDFA 를 쓰지 않지만 IDFV 등 SDK 식별자는 처리될 수 있다 |
   | 대략적 위치(IP 기반) | 광고 SDK 가 IP 로 추정한다. GPS 는 아니다 |
   | 상품 상호작용(광고 노출·클릭) | 광고 목적·분석 |
   | 진단(충돌·성능) | SDK 자체 진단 |
   | 기타 사용 데이터 | 보상 확인용 계정 PK·승인 id 는 **우리 서버**가 받는다(AdMob 이 SSV 로 되돌려 준다) |
   목적은 광고·분석·부정 방지, '추적'(타사 데이터와 결합한 타깃팅)은 iOS 에서 하지 않는다. Play '광고 포함' 표시, App Store
   심사 메모(보상형 광고 위치·코드 없음)도 함께 바꾼다.
6. **Play Console** — ⚠ 광고를 켜기 전에는 앱 매니페스트가 광고 SDK 의 `AD_ID`·`ACCESS_ADSERVICES_*` 권한을 **뺀다**
   (`tools:node="remove"`, 1.2.16 — 쓰지 않는 광고 ID 를 두면 Play 가 신고를 요구한다). 켜는 회차에 그 줄을 지운다. 유럽 등의
   동의 양식(UMP)은 앱에 있다 — AdMob 콘솔의 '개인정보 보호 및 메시지' 에서 GDPR 메시지를 만들어 게시해야 실제로 뜬다.

7. **공개 문구 — 출시 때 추가할 문장**(2026-10-26, v1.3 W17). 지금의 랜딩·`llms.txt`·스토어 설명 원문((D))에는 광고 보상을
   **쓰지 않았다** — 운영에 나가지 않은 기능을 광고하면 메타데이터가 실제 기능과 어긋난다(App Store 2.3·Play 메타데이터 정책).
   운영 스위치를 켜는 회차에 아래 문장을 더한다. 두 앱 모두 해당한다(§4·§5) — 한쪽 광고 단위만 켜는 회차라면 그 플랫폼 이름을
   붙이고(예: 'Android에서는'), 켜지 않은 스토어의 설명에는 넣지 않는다.
   - 자리: 랜딩 FAQ '직접 입력은 몇 번 쓸 수 있나요?' 답의 끝(`apps/landing/messages/{ko,en,ja}.json`), `llms.txt` 「직접 입력
     횟수」 절의 끝, Play·App Store (D) 의 「무료」 절 직접 입력 줄 바로 뒤(`docs/product/play-store-listing.md`·`app-store-listing.md`).
   - ko: "무료 3회를 다 쓴 뒤 광고를 끝까지 보면 기본 목소리로 한 번 더 만들 수 있어요(광고로 받는 횟수는 한 달에 최대 10번)."
   - en: "After your 3 free ones, watching an ad to the end lets you make one more with a default voice (up to 10 from ads a month)."
   - ja: "無料の3回を使い切ったあと広告を最後まで見ると、基本の声でもう1回作れます(広告で受け取れるのは月10回まで)。"
   - "무료 3 + 광고 10 = 월 최대 13" 처럼 합쳐 쓰지 않는다(§1 — 보상은 이월된다). 숫자는 `AD_REWARD_MONTHLY_LIMIT` 를 다시 보고 쓴다.

광고 순매출·실제 신규 합성 비용·지급 지연·누락·완료 후 제작률·플러스 전환 변화가 쌓이기 전에는 "광고 수익으로 제작비가
충당된다" 고 쓰지 않는다.

## 7. 관리자 대조 (읽기 전용)

`/admin` 의 JSON 두 개(`routes/admin.ts` → `lib/admin/ad-rewards.ts`, 관리자 로그인 필요):

- `GET /admin/ad-rewards.json` — **24시간 넘은 미확정 세션**(시작·정산 대기·결과 불명인데 적립이 없다 — 그 승인 id 로 들어온
  콜백 수·결과를 붙인다), **정산하지 못한 콜백**(`received` 로 남은 것 — cron 이 다시 하는데도 남았으면 장애), 상태별 세션 수.
  24시간은 운영 알림값이다 — 자동 실패·자동 삭제 기한이 아니다.
- `GET /admin/users/:id/ad-rewards.json` — 한 사람의 세션·콜백·적립·잔액(`readAdRewardStatus`)을 나란히 두고 어긋남을 표시한다
  (`granted_session_without_credit`·`credit_session_not_granted`·`granted_callback_without_credit`·`stale_pending`).

**후속(이번에 만들지 않는다)**: 장기 대기의 재정산·고객 보상 지급 쓰기. 붙일 때는 같은 승인 id 에 묶어(적립 행의 `session_id`
고유) 이후 콜백과 이중 적립되지 않게 하고, 사유·처리자·시각을 감사 이력으로 남긴다. 관리자 기간 지급(`billing-lifecycle.md`)
과는 다른 도구다 — 보상 한 번을 돌려주는 것이지 기간을 주는 것이 아니다.

## 구현 지도

| 규칙 | 백엔드 | Android | iOS |
| --- | --- | --- | --- |
| 서명 확인 | `lib/admob-ssv.ts`, `routes/ads.ts` | — | — |
| 승인 세션 발급·시작·끝(상태 기계·10분·15분 잠금) | `routes/ad-reward-sessions.ts` → `lib/ad-reward-sessions.ts` `prepareAdRewardSession`·`startAdRewardSession`·`closeAdRewardSession` (마이그레이션 141) | `network/AdRewardApi.kt`, `ui/main/MainViewModelAdRewards.kt` `adRewardSessionClient` | `AlarmTalkAPI.createAdRewardSession`·`startAdRewardSession`·`closeAdRewardSession`, `Ads/RewardedAdFlow.swift` `LiveAdRewardSessionClient` |
| 한 계정 한 세션·두 기기 마지막 자리 | `idx_ad_reward_sessions_one_open`, 발급 batch 의 `capacitySql` | — | — |
| SSV 내구 기록 뒤 정산·대조(거래 id·승인 id·계정·광고 단위) | `recordAdRewardCallback`·`settleAdRewardCallback`, `idx_ad_reward_credits_session` | — | — |
| 정산 실패 재시도·보관 | cron `retryUnsettledAdRewardCallbacks`·`pruneAdRewardHistory`(`src/index.ts`) | — | — |
| 월 귀속(보상 시각의 KST 달) | `grantMonthFor` | — | — |
| 운영 스위치(신규 시청만) | `ADMOB_REWARDED_ADS_ENABLED` → `adRewardViewingEnabled` | — | — |
| 광고 단위 허용 목록 | `ADMOB_REWARDED_AD_UNITS` → `isConfiguredRewardedAdUnit` | `build.gradle.kts` `alarmTalk{Dev,Prod}Admob*` → `BuildConfig.ADMOB_REWARDED_AD_UNIT_ID`·매니페스트 `admobAppId` | `project.yml` `ADMOB_APP_ID`·`ADMOB_REWARDED_AD_UNIT_ID` → Info.plist → `AdMobConfig.current` |
| 현황 내려주기(`ad_reward`) | `GET /tts/manual-quota` → `adRewardView`(무료만) | `ManualQuotaResponse.adReward` | `ManualQuotaResponse.adReward` |
| §1-1 표 | — | `AdRewardGate.route`·`canOfferAd` | `AdRewardGate.route`·`canOfferAd` |
| 429 뒤의 갈래(광고 제안·확인 중·다음 제공일) | 429 본문의 `ad_reward` | `AlarmEditorScreen` 의 생성 실패 갈래 → `PlanGateDialog`(`rewardedAdAction`·`adOfferGate`) | `AlarmEditorSheet.handleManualQuotaRefusal` → `VoicePlanGateAlert`(`offersRewardedAd`) |
| 광고 한 번의 순서 | — | `ads/RewardedAdFlow.kt` `watch` ← `AlarmEditorScreen.watchRewardedAd` | `Ads/RewardedAdFlow.swift` `watch` ← `AlarmEditorSheet.watchRewardedAd` |
| 광고 불러오기·SSV 옵션(계정 PK·승인 id)·표시 | — | `ads/RewardedAds.kt` `load`·`show` | `Ads/RewardedAds.swift` `load`·`show` |
| 동의(UMP) 먼저·광고 개인정보 설정 | — | `RewardedAds.gatherConsent`·`privacyOptionsRequired` → `ConsentHistoryScreen` 의 '광고' 카드 | `RewardedAds.gatherConsent`·`privacyOptionsRequired` → `ConsentHistoryView.adsSection` |
| 거절 코드의 문구 | `AD_REWARD_*`(shared `error-codes.ts`) | `network/ApiErrorMessages.kt` | `APIErrorMessages.swift` |
| 쓰는 자리·되돌리기 | `routes/tts.ts` `reserveManualGeneration`, catch 의 `refundAdRewardCredit` | — | — |
| 관리자 대조(읽기 전용) | `lib/admin/ad-rewards.ts`, `GET /admin/ad-rewards.json`·`/admin/users/:id/ad-rewards.json` | — | — |
| 탈퇴 파기 | `lib/account-deletion.ts`(세션·콜백·적립) | — | — |
| 회귀 테스트 | `test/ad-reward-sessions.test.ts`, `test/ad-rewards.test.ts`, `test/tts.test.ts` 「광고 보상」, `test/account-purge-residue.test.ts` | `AdRewardGateTest`, `RewardedAdFlowTest`, `GiftCodeRemovalTest`(게이트 기본 두 버튼) | `AdRewardGateTests`, `RewardedAdFlowTests` |
