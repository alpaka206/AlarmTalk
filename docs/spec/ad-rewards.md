# 광고 보상 — 광고를 보면 직접 입력 한 번

> **단일 출처.** 구현이 이것과 다르면 구현이 틀린 것이다. → [README](README.md)
> 2026-10-19 오너 지시: "광고 보고 직접 입력 1회 추가… 무료 사용자여도 가능하게 기본 목소리로".

## 1. 무엇을 주는가

무료 사용자가 **보상형 광고를 끝까지 보면 기본 목소리로 직접 입력 문구를 한 번** 만들 수 있다.

| | 유료 | 무료(광고 보상) |
| --- | --- | --- |
| 직접 입력 목소리 | 기본 목소리·등록한 목소리 | **기본 목소리만** |
| 세는 단위 | 월 한도(개인 30·커플 50·가족 100 — `manual-tts-quota.ts`) | 광고 한 번 = 생성 한 번 |
| 한 달 상한 | 위 한도 | 광고로 받는 것 **10번**(`AD_REWARD_MONTHLY_LIMIT`, KST 월) |
| 번역·동적 문구 | 그대로 | 열지 않는다 |

- **한 달 상한은 유료 개인 한도(30)보다 작아야 한다.** 광고로 유료보다 많이 쓸 수 있으면 이용권을 살 이유가 사라진다.
  생성 한 번이 공용 ElevenLabs 키(dev·prod 공용)의 한도를 쓰므로 비용 상한이기도 하다. 숫자를 바꾸면 이 표와 상수를 같이 고친다.
- **받은 보상은 그 달이 지나도 남는다.** 상한은 '한 달에 광고로 받는 횟수' 이고, 쓴 것도 받은 것으로 센다 — 쓰고 다시 보는
  것으로 상한을 비켜 가지 못한다.
- **보상을 쓰는 것은 서버가 음성을 만들 때뿐이다.** 직접 입력 월 한도와 같은 규칙(`voice-and-message.md` — "폰에 없어서 서버에
  달라고 했는가")이라, 그 문구의 음성이 이미 폰에 있으면 몇 번을 다시 저장해도 보상을 쓰지 않는다. 광고를 보고 저장하지 않고
  나가도 보상은 남는다.
- **실패하면 돌려준다.** 셌는데 생성이 실패하면(합성 실패·그 뒤의 DB 쓰기 실패) 서버가 되돌린다.

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

## 3. 광고를 봤다는 사실은 **AdMob 서버가** 알려 준다

앱이 "봤어요" 라고 보내는 값은 믿지 않는다 — 아무나 그 요청을 만들 수 있다. AdMob 의 **서버 측 확인(SSV)** 콜백만 보상을
적립한다.

1. 앱이 `GET /api/tts/manual-quota` 로 `ad_reward.user_id`(계정 PK)를 받는다. 앱이 쥔 로그인 식별자는 구글 계정이면 PK 가
   아니라서 서버가 준다.
2. 앱이 광고를 띄울 때 `ServerSideVerificationOptions.userId` 에 그 값을 싣는다.
3. 사용자가 끝까지 보면 AdMob 서버가 `GET /api/ads/admob-ssv?…&signature=…&key_id=…` 를 부른다(`routes/ads.ts`).
4. 서버가 서명을 확인하고(`lib/admob-ssv.ts` — Google 공개키 목록, ECDSA P-256), 거래 id(`transaction_id`)를 PK 로 한 행을
   적립한다(`lib/ad-reward-credits.ts`). 같은 콜백이 다시 와도 한 번이다.
5. 앱은 보상 신호를 받은 뒤 `manual-quota` 를 다시 읽어 늘어난 것을 확인한다. 콜백은 보통 몇 초 안에 오지만 늦을 수 있다.

콜백 응답 — AdMob 은 200 이 아니면 다시 부른다:

| 경우 | 응답 | 이유 |
| --- | --- | --- |
| 서명이 틀렸다 | 403 `AD_REWARD_SIGNATURE_INVALID` | AdMob 이 보낸 것이 아니다 |
| 서명은 맞는데 적립할 수 없다 — 설정에 없는 광고 단위·없는(탈퇴 유예 포함) 계정·월 상한·이미 받은 거래 | 200 `{granted:false}` | 다시 불러도 같다. 재시도를 멈춘다. AdMob 콘솔의 'URL 확인' 시험 호출도 여기로 온다 |
| 키 목록을 못 받았다·DB 실패 | 5xx(던진다) | 우리 장애다. AdMob 이 나중에 다시 부르면 적립된다 |

⚠ **광고 단위 설정(`ADMOB_REWARDED_AD_UNITS`)이 비면 아무것도 적립하지 않는다.** 남의 앱 광고 단위로 서명된 콜백도 서명
자체는 맞기 때문이다. 이 값이 곧 기능 스위치다 — 비어 있으면 `manual-quota` 도 `ad_reward` 를 싣지 않아 앱이 광고를 권하지
않는다(보고도 못 받는 광고를 보여 주지 않는다).

- 모르는 `key_id` 가 오면 키 목록을 다시 받아 보되 **10분에 한 번까지**다. 이 라우트는 인증이 없어, 아무 `key_id` 나 붙인
  요청으로 Google 로 나가는 요청을 부풀릴 수 있다. 간격은 **받기에 성공한 뒤에** 잰다 — 일시 장애(5xx) 뒤의 재시도는 다시
  받아 본다.
- ⚠ **AdMob 은 실패한 콜백을 1초 간격으로 다섯 번만 다시 부른다.** 그 안에 못 받으면 그 보상은 영영 없다. 그래서
  - 이 콜백은 공용 IP 한도(분당 300)에서 빼고 전용 버킷(분당 6000)으로 센다 — Google 의 몇 안 되는 발신 IP 에서 몰려 온다.
  - `user_id` 를 UUID 로 좁히지 않는다 — UUID 전환 전에 가입한 구글 계정은 PK 가 구글 sub 다. 실재는 `users` 조회가 본다.
- **어느 달의 적립인가는 보상을 받은 시각**(서명된 `timestamp`, KST)이다. 처리 시각으로 세면 자정 직전에 본 광고의 콜백이
  늦게 와 다음 달 몫을 먹는다. 그 값이 40일보다 오래됐거나 하루보다 미래면 처리 시각으로 센다.

## 4. 앱의 흐름 (Android)

- 무료 사용자의 문구 목록에서 '직접 입력' 은 지금처럼 **잠긴 행**이다(`voice-and-message.md` §2). 남은 보상이 있으면 잠금이
  풀린 행으로 그린다.
- 잠긴 행을 누르면 뜨는 게이트(`plan-gates.md` 「로그인 + 무료」)에 **'광고 보고 한 번 쓰기'** 를 더한다. 버튼이 셋이 되므로
  세로로 쌓는다(`IosAlertDialog` 규칙). 광고를 쓸 수 없으면(광고 단위가 없는 빌드·이번 달 상한) 예전 두 버튼 그대로다.
- 광고를 끝까지 보면 보상이 들어온 것을 확인한 뒤 직접 입력을 고른 상태로 둔다. 확인이 늦으면 "잠시 뒤 다시" 를 말하고,
  보상은 서버에 남으므로 다시 누르면 광고 없이 열린다 — **잠긴 행을 누를 때마다 게이트를 열기 전에 현황을 다시 읽는다.**
  화면 값만 보고 게이트를 열면 늦게 들어온 보상 대신 광고를 또 권한다.
- **광고를 요청하기 전에 Google 동의(UMP)를 받는다.** 규정이 있는 지역(유럽 등)은 동의 양식이 뜨고, `canRequestAds()` 가
  거짓이면 요청하지 않는다. 그 지역에서는 동의 내역 화면에 **'광고 개인정보 설정'** 행이 생겨 선택을 다시 바꿀 수 있다(Google 이
  요구하는 진입점). 다른 지역에서는 양식도 행도 없다.
- 저장할 때 서버를 불러야 하는데(폰에 그 음성이 없다) 남은 보상이 없으면 **요청 전에 막고 이유를 말한다** — 유료의 월 한도
  소진과 같은 자리다(`AlarmEditorScreen` 의 저장 흐름).

## 5. 의도된 차이

- **iOS 에는 아직 광고가 없다.** 넣으려면 ATT(앱 추적 투명성) 팝업과 App Store 개인정보 라벨 수정이 함께 필요해 따로 정한다.
  서버는 플랫폼을 가리지 않는다 — iOS 무료 사용자가 받을 보상이 없을 뿐이다.

## 6. 내보내기 전에 (운영)

코드만으로는 켜지지 않는다. 출시 전에 사람이 할 일:

1. **AdMob** — 앱 등록, 보상형 광고 단위를 dev·prod 따로 만들고 각 단위의 SSV 콜백 URL 을
   `https://api-dev.alarm-talk.com/api/ads/admob-ssv` / `https://api.alarm-talk.com/api/ads/admob-ssv` 로 둔다.
2. **워커 설정** — `ADMOB_REWARDED_AD_UNITS` 를 각 환경의 광고 단위로 둔다. **앱 빌드** — `~/.gradle/gradle.properties` 에
   `alarmTalkProdAdmobAppId`·`alarmTalkProdAdmobRewardedAdUnitId`(dev 는 `alarmTalkDev…`). prod 광고 단위가 비면 광고 버튼이
   없다. 앱 id 가 비면 Google 시험용 앱 id 가 들어간다(광고 SDK 는 앱 id 가 없으면 시작하자마자 죽는다). dev 의 광고 단위
   기본값은 Google 시험용이라 광고는 뜨지만 **보상은 쌓이지 않는다**(그 단위는 우리 서버로 확인 콜백을 보내지 않는다).
3. **개인정보 처리방침** — 광고 식별자와 Google(AdMob)로의 처리 위탁·국외 이전을 적는다. 문서 버전 순서는 서버 먼저
   (`CLAUDE.md` 「법무 문서 버전」).
4. **Play Console** — 데이터 보안 양식(광고 ID·광고 목적 — 광고 SDK 가 `AD_ID` 권한을 매니페스트에 더한다), '광고 포함'
   표시. 유럽 등의 동의 양식(UMP)은 앱에 있다 — AdMob 콘솔의 '개인정보 보호 및 메시지' 에서 GDPR 메시지를 만들어 게시해야
   실제로 뜬다.

## 구현 지도

| 규칙 | 백엔드 | Android | iOS |
| --- | --- | --- | --- |
| 서명 확인·적립 | `lib/admob-ssv.ts`, `routes/ads.ts`, `lib/ad-reward-credits.ts` `grantAdRewardCredit` | — | — |
| 한 달 상한 | `AD_REWARD_MONTHLY_LIMIT` | 서버 값(`remaining_grants`)으로 광고 버튼을 가른다(`AdRewardGate.canOfferAd`) | — |
| 무료 + 기본 목소리 + 직접 입력을 보상으로 연다 | `routes/tts.ts` `useAdRewardCredit` | `AdRewardGate.manualLocked` → `RandomPromptSettingsPane` 의 `manualLocked`·`manualRewardCredits` | 없음(§5) |
| 게이트의 '광고 보고 한 번 쓰기' | — | `AlarmEditorScreen` 의 `rewardedAdAction`(잠긴 행이 연 무료 게이트만) → `PlanGateDialog` | 없음(§5) |
| 광고 띄우기·서버 확인용 계정 PK 싣기 | — | `ads/RewardedAds.kt` `loadAndShow` | — |
| 동의(UMP) 먼저·광고 개인정보 설정 | — | `RewardedAds.gatherConsent`·`privacyOptionsRequired` → `ConsentHistoryScreen` 의 '광고' 카드 | — |
| 다시 누르면 현황부터 다시 읽기 | — | `AlarmEditorScreen` 의 `onManualLocked` | — |
| 보상 도착 확인 뒤 직접 입력 고르기 | — | `AlarmEditorScreen` 의 `watchRewardedAd`(8번·1초) → `selectManualRequest` | — |
| 저장 전에 막기 | 강제: `FREE_PLAN_PRESET_ONLY` | `AdRewardGate.blocksManualSave`(저장 흐름의 월 한도 확인 옆) | — |
| 쓰는 자리·되돌리기 | `routes/tts.ts` `reserveManualGeneration`, catch 의 `refundAdRewardCredit` | — | — |
| 현황·계정 PK 내려주기 | `GET /tts/manual-quota` 의 `ad_reward`(무료만) | `ManualQuotaResponse.adReward` | — |
| 광고 단위·앱 id(스위치가 비면 `ad_reward` 를 싣지 않는다) | `ADMOB_REWARDED_AD_UNITS` | `build.gradle.kts` 의 `alarmTalk{Dev,Prod}Admob*` → `BuildConfig.ADMOB_REWARDED_AD_UNIT_ID`·매니페스트 `admobAppId` | — |
| 탈퇴 파기 | `lib/account-deletion.ts` | — | — |
| 회귀 테스트 | `test/ad-rewards.test.ts`, `test/tts.test.ts` 「광고 보상」 | `AdRewardGateTest`, `GiftCodeRemovalTest`(게이트 기본 두 버튼) | — |
