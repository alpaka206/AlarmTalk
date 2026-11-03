# App Store 스토어 문구 (ko · en-US · ja · en-GB)

App Store Connect(앱 6799711245)에 올리는 값의 원본이다. 스토어를 고칠 때는 이 파일을 먼저 고치고 같은 값을
올린다 — ASC 에만 고치면 다음 사람이 어느 쪽이 최신인지 알 수 없다. Google Play 는
[`play-store-listing.md`](play-store-listing.md) 가 같은 역할을 한다. 설명 본문은 두 스토어가 같고, 끝의
스토어별 절만 다르다.

- 상한: 이름·부제 30자 · 프로모션 170자 · 설명 4000자 · 검색어는 아래 K. 출시 노트("이 버전의 새로운 기능", 4000자)는
  [`release-notes.md`](release-notes.md) 의 ko/en/ja 를 그대로 쓴다.
- 스크린샷은 ko 것 하나만 올려 두었고, 다른 언어는 애플이 기본 언어(ko) 스크린샷을 그대로 보여 준다.
- 앱 화면 언어 지원 문장은 번역을 포함한 다음 앱 버전이 게재된 뒤 사용한다. 게재 전 설명에서는 해당 한 줄을 뺀다.
- **스토어 문구에 줄표(`—`)를 쓰지 않는다**(2026-10-11 오너 지적 — AI 가 쓴 글처럼 읽힌다). 소제목은
  `■ 이름: 설명`(ja 는 전각 `：`), 하위 항목은 `◦` 로 쓴다. 이 파일의 설명문(문서 본문)과는 별개다.
- URL 칸은 이번에 바꾸지 않는다(지금 값, en-GB 를 추가하면 en-US 와 같은 값):

| 로컬라이제이션 | 지원 URL | 마케팅 URL | 개인정보 처리방침 URL |
|---|---|---|---|
| ko | https://alarm-talk.com/ko/contact/ | https://alarm-talk.com/ko/ | https://alarm-talk.com/privacy/ |
| en-US | https://alarm-talk.com/en/contact/ | https://alarm-talk.com/en/ | https://alarm-talk.com/en/privacy/ |
| ja | https://alarm-talk.com/ja/contact/ | https://alarm-talk.com/ja/ | https://alarm-talk.com/ja/privacy/ |

## 지금 상태 (2026-10-20)

- **게재 중: 1.2.14(빌드 12)** — `READY_FOR_SALE`(2026-10-19 ASC API로 확인). 법무 문서 버전 6을 싣는다.
  새 기능은 [`release-notes.md`](release-notes.md) 1.2.14 App Store 블록이고, 설명·검색어·이름·부제는 1.2.13에서 이어졌다.
- **1.2.15(빌드 13) 심사 대기** — `WAITING_FOR_REVIEW`(2026-10-19). `AFTER_APPROVAL`로 승인 즉시 출시한다.
  새 기능은 `release-notes.md`의 1.2.15 App Store 블록이며, 심사 계정·연락처와 한국어 스크린샷 5장을 유지했다.
- 저작권은 `© 2026 Vailen`(ASC 입력값 `2026 Vailen` — `©` 는 애플이 붙인다).
- **게재본 설명은 INTERIM이며 1.2.15 레코드에는 (B)를 넣었다**(2026-10-19). 세 언어 설명을 저장한 뒤 다시 읽어 원문과
  같음을 확인했다. 1.2.15가 출시되면 설명도 함께 바뀐다. W는 2026-10-16 prod에서 확인했다.
- 프로모션 문구는 비워 둔다(2026-10-16 오너 결정). en-GB 로컬라이제이션은 만들지 않았다.
- **반영 필요(오너): 1.2.16 레코드에는 (C) 를 넣는다.** 커플·가족 이용권을 없애면서(`docs/qa/dev-test-handoff.md`
  「다음 할 일」 2) 부제·검색어(ko·ja)·설명을 (C) 로 고쳤다. 이름은 그대로다. App Store 는 설명이 버전과 함께만 바뀌므로
  1.2.16 이 게재될 때까지 게재본(INTERIM 또는 (B))은 커플·가족 이용권을 계속 설명한다.
- **(D) 는 v1.3 레코드용 원문**이다(2026-10-26 작성 — 아직 ASC 에 넣지 않았다). 게시 조건은 (D) 절의 F·T.
- (B)(1.2.15 레코드)의 설명·부제·검색어 원문은 이 파일에서 뺐다 — `git show 9e4fda54:docs/product/app-store-listing.md`.

## 언제 무엇을 올리나

| 칸 | 언제 | 조건 |
|---|---|---|
| 프로모션 문구 | 게시하지 않음(2026-10-16 오너 결정) | — |
| 이름·부제 | 다음 버전 레코드(앱 정보) — 1.2.16 에서 부제를 (C) 로 | 이름이 이미 쓰이고 있으면 막힌다(「게시 전 확인」) |
| 검색어 | 다음 버전 레코드 — 1.2.16 에서 (C) 로 | K |
| 설명 | 다음 버전 레코드 — 1.2.16 에서 (C) 로, v1.3 에서 (D) 로 | W 를 지키면 (C), 못 지키면 INTERIM · v1.3 은 F·T 를 지키면 (D) |
| 저작권 | 다음 버전 레코드 — 새 레코드에 `2026 Vailen` 이 따라왔는지만 본다 | — |
| en-GB 로컬라이제이션(선택) | 다음 버전 레코드 | K |

- 설명은 버전과 함께만 바뀐다. INTERIM 으로 나가면 날씨 문장은 **그다음 버전**에서야 들어간다.
- 새 버전 레코드에도 프로모션 칸이 있다 — 레코드를 만들 때 게재 시점에 맞는 판인지 본다.

### 게시 조건

- **W — 날씨 문장.** 날씨 문구가 그날 그 지역의 날씨에 맞는다고 말하는 문장은 날씨 지역 서버 변경이
  **prod 에 배포되고 확인된 뒤에만** 올린다. 제품 판단으로 앞당기는 항목이 아니다 — 메타데이터는 앱의 실제
  기능을 정확히 반영해야 하고(App Store 심사 지침 2.3·2.3.1), 문구를 고쳐도 기능이 참이 되지는 않는다.
  그 전에는 INTERIM 을 쓴다.
  - 확인(prod): 앱이 지금 주는 **나라 → 지역 목록 전부**(대한민국 17·일본 47·미국 69, `@alarmtalk/shared` 의
    `WeatherRegions`)에 다가오는 날짜의 공식 예보가 prod `weather_region_daily_official` 에 있는지 본다 — 나라마다
    원천이 다르므로(기상청·일본 기상청·NWS) 한 나라만 보고 넘기지 않는다. 목록이 늘면 그 지역까지 본다. 2026-10-16 에
    세 나라 모두 확인했다(Play 와 같다 — `play-store-listing.md` 「판과 게시 조건」). (옛 확인법은 국내 9개 프리셋이었다 —
    1.2.11 전의 지역 고르기다.)
  - 2026-09-30 로컬 실행 기록(운영 서버·실기기 아님): 서울·제주는 해석에 실패해 안내 클립이 나오고, 나머지
    7곳은 60~265km 떨어진 같은 이름의 다른 지점으로 풀렸다. 원인은 서버 지오코딩(`language=ko` 검색, 나라
    이름 부분 일치, 못 찾으면 첫 결과를 쓰는 규칙)이다.
  - 확인한 결과는 [`dev-test-handoff.md`](../qa/dev-test-handoff.md) 「스토어 상태」 에 적는다.
- **K — 검색어.** 애플 문서가 서로 다르다(레퍼런스는 100바이트, 검색 안내는 100자). 본안(100자 이내, 바이트는
  넘는다)을 먼저 넣고 저장한 뒤 다시 열어 한 글자씩 비교한다. 거절되거나 잘려 있으면 대체안(100바이트 이내)으로
  바꾼다. 본안은 대체안과 같은 단어를 같은 순서로 맨 앞에 둔다. 저장돼도 뒤쪽 단어가 색인되는지는 게재 뒤
  검색해 봐야 안다.
- **P — 프로모션 기간판.** 넣기 직전에 운영 상태를 본다: prod 스위치 `PERSONAL_PROMO_STARTS_AT` 가 켜져 있고,
  무료 테스트 계정의 `/auth/me` 가 `personal_promo.ends_at` 를 `2026-10-31T15:00:00Z` 로 돌려주는지. 꺼져
  있으면 상시판만 넣는다.

## 이름 · 부제

| 로컬라이제이션 | 이름 | 부제 |
|---|---|---|
| ko | `알람톡: 목소리 알람 시계` (14/30) | `좋아하는 목소리로 깨는 아침` (15/30) |
| en-US | `AlarmTalk: Voice Alarm Clock` (28/30) | `Wake up to a voice you love` (27/30) |
| ja | `アラームトーク：声の目覚まし時計` (16/30) | `好きな声で目覚める朝` (10/30) |
| en-GB | `AlarmTalk: Voice Alarm Clock` (28/30) | `Wake up to a voice you love` (27/30) |

- 가격·순위·'무료'·이모지는 넣지 않았다(심사 지침 2.3.7). '무료'는 설명 본문에서 사실로만 말한다.
- 부제는 (C) 값이다(1.2.16 레코드). 예전 부제 '서로 맞춰 주는 가족·커플 모닝콜' 은 없앤 상대 알람을 말해 바꿨다 — 새 부제는
  설명 첫 줄과 같은 말이다(오너가 다른 말을 고르면 이 표를 고친다).
- 브랜드 표기는 언어마다 하나다. 옛 이름의 `Alarm-Talk`(하이픈)는 쓰지 않는다.

## 검색어 (쉼표 구분 · 공백 없음)

**ko** — 본안 (88자 · 196바이트 · 16개, 먼저 시도)

```text
alarmtalk,alarm-talk,알람,목소리,목소리알람,음성알람,녹음알람,날씨알람,운세알람,기상알람,모닝알람,응원알람,복약알람,말하는알람,알람시계,알람앱
```

대체안 (48자 · 92바이트 · 8개, 본안이 거절되거나 잘려 저장될 때)

```text
alarmtalk,alarm-talk,알람,목소리,목소리알람,음성알람,녹음알람,날씨알람
```

**en-US** — 본안 (92자 · 98바이트 · 13개, 먼저 시도)

```text
알람톡,alarm-talk,alarm,voice,talking,custom,record,message,morning,ai,ringtone,weather,fortune
```

대체안 없음 — 본안이 이미 100바이트 안이다.

**ja** — 본안 (84자 · 206바이트 · 15개, 먼저 시도)

```text
alarmtalk,アラーム,ボイス,音声,録音,声アラーム,音声アラーム,録音アラーム,天気アラーム,運勢アラーム,目覚ましアプリ,アラームアプリ,起床,朝,おはよう
```

대체안 (44자 · 100바이트 · 8개, 본안이 거절되거나 잘려 저장될 때)

```text
alarmtalk,アラーム,ボイス,音声,録音,声アラーム,音声アラーム,録音アラーム
```

- **검색어는 서비스를 말하는 낱말로 채운다 — '목소리'·'알람' 과 '<기능>알람'**(2026-10-11 오너 결정). 관계 낱말(아빠·남친·
  여친·연인·부모님·자녀 등)과 '톡'·'トーク' 를 뺐고, 한국어·일본어는 기능을 붙인 꼴로 쓴다(`날씨알람`·`운세알람`·
  `복약알람` / `天気アラーム`·`運勢アラーム`) — 사람들이 붙여 치는 꼴이고, 이름의
  띄어 쓴 '목소리 알람' 과 같은 낱말로 묶인다고 장담할 수 없어서다. 영어는 낱말이 띄어 써져 이름의 `Alarm` 과 그대로
  묶이므로(`weather`+`alarm`) 붙인 꼴을 만들지 않는다. '알람'·'목소리'·`alarm`·`voice` 는 이름에도 있어 애플 안내로는
  겹치는 말이지만(이름·부제·검색어·카테고리를 함께 색인한다), 오너 결정으로 낱말 그대로도 둔다.
- **영문 브랜드는 붙여 쓴 `alarmtalk` 와 하이픈 `alarm-talk` 로 찾히게 한다**(2026-10-11 오너 결정). 띄어 쓴
  'alarm talk' 은 노리지 않는다 — `talk` 낱말을 두지 않는다. `alarm-talk` 는 옛 이름 `Alarm-Talk` 의 표기라 ko(KR)·
  en-US(US·JP) 검색어에 둔다. 애플이 하이픈을 단어 경계로 쪼개는지는 문서에 없어, 'alarm talk' 검색에 전혀 안
  걸린다고 장담하지는 않는다.
- 커플·가족 낱말(`커플알람`·`가족알람`·`カップルアラーム`·`家族アラーム`)은 (C) 에서 뺐다 — 없앤 기능이다(2026-10-20).
  남은 자리는 비워 둔다. 새 낱말은 오너가 고른다.
- 검색어는 로컬라이제이션마다 따로다 — 애플이 번역해 주지 않는다. 한국어만 채우면 JP 스토어의 일본어 검색에 안 걸린다.
- `날씨`·`weather`·`天気` 는 앱에 있는 문구 종류의 이름이라 W 전에도 둔다 — 설명과 달리 정확도를 말하는 칸이
  아니다.

## 프로모션 문구

### 기간판 — 2026-10-31 15:00 UTC 전까지 (P)

170자로는 계정별 조건을 다 담을 수 없어 규칙만 말한다. 계정마다의 판정과 정확한 삭제 시각은 앱의 종료 안내와
푸시가 알린다.

**ko** (138/170)

```text
10월 31일(한국 시간)까지 무료 계정도 플러스 기능을 써요. 내 목소리나 허락받은 목소리로, 직접 쓴 문장을 AI가 읽어 줘요. 끝나면 그 목소리는 3일 보관 후 삭제돼요. 단, 삭제 전에 이용권(결제 보류 중 포함)이 있으면 삭제되지 않아요.
```

**en-US** (162/170)

```text
Free accounts get Plus until Oct 31 KST: AI reads your text in a voice you may use. Then that voice is deleted after 3 days unless you have a plan (even on hold).
```

**ja** (126/170)

```text
10月31日(韓国時間)まで、無料アカウントでもプラスの機能を使えます。自分の声や許可を得た声で、入力した文をAIが読み上げます。終了後、その声は3日間保管したあと削除されます。ただし、削除される前にプラン(支払い保留中を含む)があれば削除されません。
```

### 상시판 — 그 뒤

**ko** (82/170)

```text
익숙한 목소리로 시작하는 아침. 기본 목소리 알람과 녹음 알람은 무료로 쓰고, 등록한 목소리가 새 문장을 읽어 주는 기능은 이용권으로 더해 보세요.
```

**en-US** (133/170)

```text
Start the day with a familiar voice. Default-voice and recorded alarms are free; a plan adds a registered voice reading new messages.
```

**ja** (65/170)

```text
なじみの声で始まる朝。基本の声のアラームと録音アラームは無料。登録した声が新しいメッセージを読み上げる機能はプランで追加できます。
```

## 설명 — (C) 1.2.16 레코드(커플·가족 이용권 폐지판)

(B) 에서 커플·가족 이용권 소개 줄과 「커플·가족 이용권」 절을 빼고, 공유를 말하던 줄(개인정보·인터넷·결제)을 고쳤다.
나머지는 (B) 와 한 글자도 다르지 않다.

### ko (2206/4000)

```text
좋아하는 목소리로 깨는 아침.

알람톡(AlarmTalk · アラームトーク)은 목소리로 깨워 주는 알람이에요.
• 무료: 기본 목소리 4종이 날씨·운세 같은 문구를 읽어 주고, 알람마다 30초까지 녹음해 두면 그 녹음 그대로 울려요.
• 플러스: 내 목소리나 허락받은 목소리를 등록하면, AI 음성 합성으로 그 목소리가 녹음에 없던 새 문장도 읽어 줘요.
수학 문제나 흔들기 같은 해제 미션 없이, 듣고 싶은 목소리로 일어나요.

■ 무료: 기본 목소리와 녹음 알람
• 알람은 요일마다 반복하거나 한 번만 울리게 만들 수 있어요.
• 기본 목소리 4종(시우·미나·도현·애니)이 앱 언어(한국어·영어·일본어)로 알람을 읽어 줘요. 목소리 대신 알람음으로 울리게 할 수도 있어요.
• 문구는 날씨·운세·응원·약 중에서 골라요.
  ◦ 날씨: 그날 날씨(맑음·비·눈·미세먼지·더위·추위 등)에 맞는 문구. 지역은 대한민국·일본·미국의 지역 목록에서 골라요.
  ◦ 운세: 성별·생년월일·태어난 시간으로 고르는, 재미로 보는 오늘의 운세
  ◦ 응원·약: 울릴 때마다 미리 준비된 다음 문구로 바뀌어요.
• 녹음 알람: 알람마다 최대 30초까지 녹음하면 울릴 때 녹음한 그대로 재생돼요. 그 알람에만 쓰는 소리라서 다른 문장을 읽게 할 수는 없어요.
• 공휴일에는 끄기(대체·임시 공휴일 포함, 한국·일본·미국 달력), 다시 울림, 목소리 크기 조절도 있어요.

■ 플러스: 등록한 목소리로 새 문장까지
• 앱에서 녹음하거나 음성 파일(12초~2분)을 올려 목소리 1개를 등록해요. 본인 목소리이거나, 권리를 가진 사람에게 허락받은 목소리만 등록할 수 있어요.
• 등록한 목소리는 AI 음성 합성으로 녹음에 없던 문장을 읽어요. 기상 인사·날씨·운세·응원·약 문구는 서버에서 미리 만들어 폰에 받아 두고, 나와의 관계(예: 딸)와 나를 부를 이름(예: 엄마)을 적으면(둘 다 선택) 거기에 맞춰 만들어요.
• 직접 입력: 내가 쓴 문장을 AI가 그 목소리로 읽어 줘요. 새로 만들기는 월 30회이고, 같은 목소리로 같은 문장을 쓰는 알람이 이 폰에 남아 있으면 다시 써도 횟수가 줄지 않아요.
• 알람을 읽어 줄 언어는 한국어·영어·일본어 중에서 골라요.
• 목소리는 한 계정에 1개, 등록·교체는 한 달에 한 번 할 수 있어요.

■ 믿고 맡기는 알람
• 울리는 순간에는 인터넷이 필요 없어요. 소리를 미리 폰에 받아 두어 비행기 모드에서도 제시간에 울려요.
• 잠금 화면에서도 울리고, 알람이 울리는 동안 목소리를 반복해서 들려줘요.

■ 목소리와 개인정보
• 등록한 목소리는 내 알람에만 쓰이고, 원본 음성을 앱 밖으로 내려받는 기능은 없어요.
• 이용권이 끝나 무료로 돌아가도 알람은 남아요. 등록한 목소리는 3일 보관한 뒤 삭제돼요(3일 안에 이용권을 다시 시작하면 삭제되지 않아요).
• 탈퇴를 신청하면 30일 뒤 계정과 서버에 저장된 데이터(알람·목소리 등)가 삭제되고, 그 전에 다시 로그인해 탈퇴를 취소할 수 있어요. 단, 법령이나 처리방침에 따라 따로 보관하는 기록(결제·거래 기록은 최대 5년 등)과 백업·로그는 각 보관 기간이 끝나면 삭제돼요. 폰에 저장된 알람과 소리 파일은 알람이나 앱을 지울 때까지 남을 수 있어요.
• 음성 생체정보 처리 동의를 철회하면 등록한 목소리와 녹음 원본이 삭제돼요.

■ 이용 안내
• 로그인이 필요해요(이메일 또는 간편 로그인).
• 목소리 등록, 문구 준비, 동기화에는 인터넷이 필요해요.
• 알람 권한을 허용해야 제시간에 울려요.
• 앱 화면은 한국어·영어·일본어를 지원해요.

■ iPhone에서
• Apple로 로그인 또는 이메일로 시작해요.
• 울리는 알람은 잠금 화면과 다이내믹 아일랜드(지원 기기)에서도 바로 끄거나 다시 울림으로 넘길 수 있어요.

■ 이용권과 결제
플러스는 매월 자동 갱신되는 구독이에요. 결제 금액과 갱신 조건은 구매 화면에서 확인할 수 있어요. 결제는 구매를 확정할 때 Apple 계정으로 청구되고, 현재 기간이 끝나기 24시간 전까지 자동 갱신을 끄지 않으면 다음 기간이 자동으로 결제돼요. 구독 관리와 취소는 Apple 계정 설정에서 할 수 있어요.

이용약관: https://alarm-talk.com/terms/
개인정보 처리방침: https://alarm-talk.com/privacy/
Apple 표준 사용권 계약(EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
```

### en-US (3070/4000)

```text
Wake up to a voice you love.

AlarmTalk (알람톡 · アラームトーク) wakes you with a voice.
• Free: default voices read messages like weather and fortune, and a recording plays exactly as recorded.
• Plus: AI speech synthesis lets a voice you register read new messages it never recorded.
No math, no shaking.

■ Free
• Repeating or one-time alarms
• Four default voices speak the app language (English, Korean or Japanese), or use an alarm sound
• Messages: Weather (the day's weather, from rain to poor air; regions in Korea, Japan and the US), Fortune (for fun, from gender, birth date and time), Encouragement and Meds (each ring plays the next prepared one)
• Recorded alarm: up to 30 seconds per alarm, played exactly as recorded; it can't read other text
• Turn off on holidays (incl. substitute and temporary holidays; Korea, Japan or US), snooze, voice volume

■ Plus
• Register one voice per account, once a month, by recording or uploading audio (12 sec to 2 min): yours, or one you have permission to use
• Wake-up, weather, fortune, encouragement and meds messages in that voice are made in advance on our servers and downloaded to your phone, tailored to who the voice is to you and what it calls you (both optional)
• Type it yourself: AI reads your text in that voice (30 new a month; free if an alarm on this phone has the same text and voice)
• Messages in Korean, English or Japanese

■ Reliable and private
• Rings on time offline (sounds are saved in advance, even in airplane mode), on the lock screen, repeating the voice while it rings
• Your registered voice is used only for your own alarms, and original recordings can't be downloaded from the app
• If your plan ends, alarms stay; your voice is deleted after 3 days unless you restart a plan
• Deleting your account removes it and its server data (alarms, voices, etc.) after 30 days unless you sign in and cancel first. Records kept by law or our Privacy Policy (e.g., payment records, up to 5 years), backups and logs are deleted when retention ends; files on your phone may stay until you delete them or the app
• Withdrawing voice biometric consent deletes your voice and original recordings

■ Good to know
• Sign-in required; registering a voice, preparing messages and sync need internet
• Allow alarm permission so alarms ring on time

■ On iPhone
• Sign in with Apple or with email.
• A ringing alarm also appears on the Lock Screen and in the Dynamic Island (on supported models), where you can stop or snooze it.

■ Plans and billing
Plus is a monthly auto-renewing subscription. The price and renewal terms are shown on the purchase screen. Payment is charged to your Apple Account when you confirm the purchase, and the subscription renews automatically unless auto-renew is turned off at least 24 hours before the end of the current period. You can manage or cancel it in your Apple Account settings.

Terms of Service: https://alarm-talk.com/en/terms/
Privacy Policy: https://alarm-talk.com/en/privacy/
Apple Standard EULA: https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
```

### ja (2091/4000)

```text
好きな声で目覚める朝を。

アラームトーク(AlarmTalk・알람톡)は、声で起こしてくれるアラームです。
• 無料：基本の声4種類が天気・運勢などのメッセージを読み上げます。アラームごとに30秒まで録音すれば、録音したそのままの音で鳴ります。
• プラス：自分の声や許可を得た声を登録すると、AI音声合成で、録音にない新しいメッセージもその声が読み上げます。
計算問題やシェイクのようなミッションはなく、聞きたい声で目を覚ませます。

■ 無料：基本の声と録音アラーム
• 曜日ごとの繰り返しも、1回だけのアラームも設定できます。
• 基本の声4種類が、アプリの言語(日本語・韓国語・英語)でアラームを読み上げます。声の代わりにアラーム音で鳴らすこともできます。
• メッセージは天気・運勢・応援・薬から選べます。
  ◦ 天気：その日の天気(晴れ・雨・雪・PM2.5・暑さ・寒さなど)に合わせたメッセージ。地域は韓国・日本・アメリカの地域一覧から選びます。
  ◦ 運勢：性別・生年月日・生まれた時間から選ぶ、お楽しみの今日の運勢
  ◦ 応援・薬：鳴るたびに、あらかじめ用意された次のメッセージに切り替わります。
• 録音アラーム：アラームごとに最大30秒まで録音すると、鳴るときに録音したそのままの音が流れます。そのアラーム専用の音なので、別の文を読み上げさせることはできません。
• 祝日はオフにする(振替休日・臨時祝日を含む。日本・韓国・米国のカレンダー)、スヌーズ、声の音量調整も使えます。

■ プラス：登録した声で新しいメッセージも
• アプリで録音するか、音声ファイル(12秒〜2分)をアップロードして、声を1つ登録します。登録できるのは、本人の声か、権利を持つ人から許可を得た声だけです。
• 登録した声は、AI音声合成で録音にない文を読み上げます。起床のあいさつ・天気・運勢・応援・薬のメッセージはサーバーであらかじめ作ってスマホにダウンロードし、あなたとの関係(例：娘)と、あなたを呼ぶ名前(例：ママ)を入れると(どちらも任意)、それに合わせて作ります。
• 自分で入力：書いた文をAIがその声で読み上げます。新しく作れるのは月30回まで。同じ声・同じ文を使うアラームがこのスマホに残っていれば、回数に数えません。
• 読み上げる言語は、日本語・韓国語・英語から選べます。
• 声は1アカウントに1つ。登録・変更は月1回までです。

■ 安心して任せられるアラーム
• 鳴る瞬間にインターネットは不要です。音をあらかじめスマホに保存するので、機内モードでも時間どおりに鳴ります。
• ロック画面でも鳴り、アラームが鳴っている間は声を繰り返し流します。

■ 声とプライバシー
• 登録した声は自分のアラームにだけ使われます。元の音声をアプリの外にダウンロードする機能はありません。
• プランが終わって無料に戻ってもアラームは残ります。登録した声は3日間保管したあと削除されます(3日以内にプランを再開すれば削除されません)。
• 退会を申請すると、30日後にアカウントとサーバーに保存されたデータ(アラーム・声など)が削除されます。それまでに再ログインすれば退会を取り消せます。ただし、法令やプライバシーポリシーに基づき別途保管する記録(決済・取引記録は最長5年など)とバックアップ・ログは、それぞれの保管期間が終わると削除されます。スマホに保存したアラームや音声ファイルは、アラームやアプリを削除するまで残ることがあります。
• 音声の生体情報の処理への同意を撤回すると、登録した声と元の録音が削除されます。

■ ご利用にあたって
• ログインが必要です(メールまたは簡単ログイン)。
• 声の登録、メッセージの準備、同期にはインターネット接続が必要です。
• 時間どおりに鳴らすには、アラームの権限を許可してください。
• アプリは日本語・韓国語・英語に対応しています。

■ iPhoneでは
• Appleでサインイン、またはメールで始められます。
• 鳴っているアラームは、ロック画面とダイナミックアイランド(対応機種)からもすぐに止めたりスヌーズしたりできます。

■ プランとお支払い
プラスは毎月自動更新されるサブスクリプションです。料金と更新条件は購入画面でご確認いただけます。お支払いは購入の確定時にAppleアカウントに請求され、現在の期間が終わる24時間前までに自動更新をオフにしない限り、次の期間が自動的に更新されます。管理や解約はAppleアカウントの設定から行えます。

利用規約: https://alarm-talk.com/ja/terms/
プライバシーポリシー: https://alarm-talk.com/ja/privacy/
Apple 標準使用許諾契約 (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
```

## 설명 — (D) v1.3 레코드(무료 직접 입력 · 스토어 무료 체험)

**다음 버전 제출 때 쓸 원문이다 — 아직 어디에도 올리지 않았다**(2026-10-26 작성). (C) 에서 아래 다섯 군데만 다르고
나머지는 한 글자도 같다:

- 「무료」 절: 직접 입력 한 줄(기본 목소리로 새로 만들기 월 3회).
- 「플러스」 절: 직접 입력 줄을 '기본 목소리와 합쳐 월 30회' 로(재사용 규칙은 「이용 안내」 한 줄로 옮겼다. 2026-10-27 에 서버에서
  다시 받는 것도 1회로 되돌려, 그 줄은 다시 '이 폰에 남아 있는' 음성만 무차감이라고 말한다).
- 「목소리와 개인정보」: 이용권이 끝나면 등록한 목소리를 쓰던 알람이 기본 목소리(미나)로 울리고, 3일 안에 다시 시작하면
  원래 목소리로 돌아온다(`docs/spec/billing-lifecycle.md` — 대체 목소리는 미나 하나).
- 「이용 안내」: 직접 입력 횟수의 초기화(한국 시간 매월 1일)와 이 폰에 남아 있는 음성의 재사용 무차감.
- 「이용권과 결제」: 첫 구독 1개월 무료 체험과 체험 뒤 자동 결제. 자동 갱신 고지 문장은 그대로 두고 '체험이 있으면 체험이
  끝날 때 청구'·'현재 기간(무료 체험 포함)' 을 끼워 넣어 두 문장이 어긋나지 않게 했다.

게시 조건(셋 다 지켜야 (D), 아니면 (C)):

- **F — 무료 직접 입력.** 무료 3회는 서버(#942)와 앱(잠금을 푼 v1.3 빌드)이 **함께** 있어야 참이다 — 옛 앱은 무료의 직접
  입력을 잠근 채 보인다. App Store 설명은 버전과 함께 바뀌므로 **그 v1.3 빌드의 레코드**에 넣고, 서버 변경이 prod 에 나간
  것을 먼저 확인한다(무료 테스트 계정의 `GET /tts/manual-quota` 가 `limit: 3`).
- **T — 무료 체험.** ASC `personal_monthly` 첫 구독 오퍼(무료 1개월)가 그 레코드를 제출하는 날 살아 있는지 본다
  (`docs/spec/plan-gates.md` 「신규 1개월 무료」 — 확인 `probe-trials.mjs`). 오퍼를 내렸으면 체험 문장 둘을 뺀 (C) 결제 문단을 쓴다.
- **광고 보상은 넣지 않는다.** 운영에 나가지 않았다(`docs/spec/ad-rewards.md` §6 「공개 문구」 — iOS 광고 단위를 켜는 회차에 거기
  적힌 문장을 더하고, 개인정보 라벨·심사 메모도 함께 바꾼다).

심사 지침 메모(2026-10-26 기준 — 원문을 다시 읽고 제출한다):
- 3.1.2 — 자동 갱신 구독은 사용자가 무엇을 얼마 동안 받는지, 체험 뒤 얼마가 청구되는지 결제 전에 분명해야 한다. 앱의 결제
  카드가 그 말을 하고(`plan-gates.md` — "1개월 무료 체험, 이후 월 3,900원" + 자동 결제 안내), 설명은 그와 어긋나지 않게만 쓴다.
  금액은 설명에 적지 않는다(나라마다 다르다 — 구매 화면을 가리킨다).
- 2.3 · 2.3.1 — 메타데이터는 그 버전의 실제 기능이어야 한다 → F.
- 3.1.1 — 코드로 유료 기능을 연다는 말을 쓰지 않는다(`scripts/check-paid-unlock-codes.py`).

### ko (2415/4000)

```text
좋아하는 목소리로 깨는 아침.

알람톡(AlarmTalk · アラームトーク)은 목소리로 깨워 주는 알람이에요.
• 무료: 기본 목소리 4종이 날씨·운세 같은 문구를 읽어 주고, 알람마다 30초까지 녹음해 두면 그 녹음 그대로 울려요.
• 플러스: 내 목소리나 허락받은 목소리를 등록하면, AI 음성 합성으로 그 목소리가 녹음에 없던 새 문장도 읽어 줘요.
수학 문제나 흔들기 같은 해제 미션 없이, 듣고 싶은 목소리로 일어나요.

■ 무료: 기본 목소리와 녹음 알람
• 알람은 요일마다 반복하거나 한 번만 울리게 만들 수 있어요.
• 기본 목소리 4종(시우·미나·도현·애니)이 앱 언어(한국어·영어·일본어)로 알람을 읽어 줘요. 목소리 대신 알람음으로 울리게 할 수도 있어요.
• 문구는 날씨·운세·응원·약 중에서 골라요.
  ◦ 날씨: 그날 날씨(맑음·비·눈·미세먼지·더위·추위 등)에 맞는 문구. 지역은 대한민국·일본·미국의 지역 목록에서 골라요.
  ◦ 운세: 성별·생년월일·태어난 시간으로 고르는, 재미로 보는 오늘의 운세
  ◦ 응원·약: 울릴 때마다 미리 준비된 다음 문구로 바뀌어요.
• 녹음 알람: 알람마다 최대 30초까지 녹음하면 울릴 때 녹음한 그대로 재생돼요. 그 알람에만 쓰는 소리라서 다른 문장을 읽게 할 수는 없어요.
• 직접 입력: 내가 쓴 문장을 AI가 기본 목소리로 읽어 줘요. 새로 만들기는 월 3회예요.
• 공휴일에는 끄기(대체·임시 공휴일 포함, 한국·일본·미국 달력), 다시 울림, 목소리 크기 조절도 있어요.

■ 플러스: 등록한 목소리로 새 문장까지
• 앱에서 녹음하거나 음성 파일(12초~2분)을 올려 목소리 1개를 등록해요. 본인 목소리이거나, 권리를 가진 사람에게 허락받은 목소리만 등록할 수 있어요.
• 등록한 목소리는 AI 음성 합성으로 녹음에 없던 문장을 읽어요. 기상 인사·날씨·운세·응원·약 문구는 서버에서 미리 만들어 폰에 받아 두고, 나와의 관계(예: 딸)와 나를 부를 이름(예: 엄마)을 적으면(둘 다 선택) 거기에 맞춰 만들어요.
• 직접 입력: 내가 쓴 문장을 등록한 목소리로도 AI가 읽어 줘요. 새로 만들기는 기본 목소리와 합쳐 월 30회예요.
• 알람을 읽어 줄 언어는 한국어·영어·일본어 중에서 골라요.
• 목소리는 한 계정에 1개, 등록·교체는 한 달에 한 번 할 수 있어요.

■ 믿고 맡기는 알람
• 울리는 순간에는 인터넷이 필요 없어요. 소리를 미리 폰에 받아 두어 비행기 모드에서도 제시간에 울려요.
• 잠금 화면에서도 울리고, 알람이 울리는 동안 목소리를 반복해서 들려줘요.

■ 목소리와 개인정보
• 등록한 목소리는 내 알람에만 쓰이고, 원본 음성을 앱 밖으로 내려받는 기능은 없어요.
• 이용권이 끝나 무료로 돌아가도 알람은 남고, 등록한 목소리를 쓰던 알람은 기본 목소리(미나)로 울려요. 등록한 목소리는 3일 보관한 뒤 삭제돼요(3일 안에 이용권을 다시 시작하면 원래 목소리로 돌아와요).
• 탈퇴를 신청하면 30일 뒤 계정과 서버에 저장된 데이터(알람·목소리 등)가 삭제되고, 그 전에 다시 로그인해 탈퇴를 취소할 수 있어요. 단, 법령이나 처리방침에 따라 따로 보관하는 기록(결제·거래 기록은 최대 5년 등)과 백업·로그는 각 보관 기간이 끝나면 삭제돼요. 폰에 저장된 알람과 소리 파일은 알람이나 앱을 지울 때까지 남을 수 있어요.
• 음성 생체정보 처리 동의를 철회하면 등록한 목소리와 녹음 원본이 삭제돼요.

■ 이용 안내
• 로그인이 필요해요(이메일 또는 간편 로그인).
• 목소리 등록, 문구 준비, 동기화에는 인터넷이 필요해요.
• 알람 권한을 허용해야 제시간에 울려요.
• 직접 입력 횟수는 한국 시간 매월 1일에 다시 채워지고, 이 폰에 남아 있는 음성을 다시 쓰면 줄지 않아요.
• 앱 화면은 한국어·영어·일본어를 지원해요.

■ iPhone에서
• Apple로 로그인 또는 이메일로 시작해요.
• 울리는 알람은 잠금 화면과 다이내믹 아일랜드(지원 기기)에서도 바로 끄거나 다시 울림으로 넘길 수 있어요.

■ 이용권과 결제
플러스는 매월 자동 갱신되는 구독이에요. 처음 구독하면 1개월 무료 체험이 적용될 수 있고(대상은 Apple이 정해요), 체험이 끝나면 자동으로 결제돼요. 결제 금액과 갱신 조건은 구매 화면에서 확인할 수 있어요. 결제는 구매를 확정할 때(무료 체험이 있으면 체험이 끝날 때) Apple 계정으로 청구되고, 현재 기간(무료 체험 포함)이 끝나기 24시간 전까지 자동 갱신을 끄지 않으면 다음 기간이 자동으로 결제돼요. 구독 관리와 취소는 Apple 계정 설정에서 할 수 있어요.

이용약관: https://alarm-talk.com/terms/
개인정보 처리방침: https://alarm-talk.com/privacy/
Apple 표준 사용권 계약(EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
```

### en-US (3482/4000)

```text
Wake up to a voice you love.

AlarmTalk (알람톡 · アラームトーク) wakes you with a voice.
• Free: default voices read messages like weather and fortune, and a recording plays exactly as recorded.
• Plus: AI speech synthesis lets a voice you register read new messages it never recorded.
No math, no shaking.

■ Free
• Repeating or one-time alarms
• Four default voices speak the app language (English, Korean or Japanese), or use an alarm sound
• Messages: Weather (the day's weather, from rain to poor air; regions in Korea, Japan and the US), Fortune (for fun, from gender, birth date and time), Encouragement and Meds (each ring plays the next prepared one)
• Recorded alarm: up to 30 seconds per alarm, played exactly as recorded; it can't read other text
• Type it yourself: AI reads your text in a default voice (3 new a month)
• Turn off on holidays (incl. substitute and temporary holidays; Korea, Japan or US), snooze, voice volume

■ Plus
• Register one voice per account, once a month, by recording or uploading audio (12 sec to 2 min): yours, or one you have permission to use
• Wake-up, weather, fortune, encouragement and meds messages in that voice are made in advance on our servers and downloaded to your phone, tailored to who the voice is to you and what it calls you (both optional)
• Type it yourself in that voice too (30 new a month, shared with default voices)
• Messages in Korean, English or Japanese

■ Reliable and private
• Rings on time offline (sounds are saved in advance, even in airplane mode), on the lock screen, repeating the voice while it rings
• Your registered voice is used only for your own alarms, and original recordings can't be downloaded from the app
• If your plan ends, alarms stay, and those that used your registered voice ring in a default voice (Mina); your voice is deleted after 3 days unless you restart a plan
• Deleting your account removes it and its server data (alarms, voices, etc.) after 30 days unless you sign in and cancel first. Records kept by law or our Privacy Policy (e.g., payment records, up to 5 years), backups and logs are deleted when retention ends; files on your phone may stay until you delete them or the app
• Withdrawing voice biometric consent deletes your voice and original recordings

■ Good to know
• Sign-in required; registering a voice, preparing messages and sync need internet
• Allow alarm permission so alarms ring on time
• Typed-message counts refill on the 1st of each month (Korea time); reusing audio that's still on this phone doesn't count

■ On iPhone
• Sign in with Apple or with email.
• A ringing alarm also appears on the Lock Screen and in the Dynamic Island (on supported models), where you can stop or snooze it.

■ Plans and billing
Plus is a monthly auto-renewing subscription. First-time subscribers may get a 1-month free trial (Apple decides who qualifies), and it is charged automatically when the trial ends. The price and renewal terms are shown on the purchase screen. Payment is charged to your Apple Account when you confirm the purchase (or when a free trial ends), and the subscription renews automatically unless auto-renew is turned off at least 24 hours before the end of the current period, including a free trial. You can manage or cancel it in your Apple Account settings.

Terms of Service: https://alarm-talk.com/en/terms/
Privacy Policy: https://alarm-talk.com/en/privacy/
Apple Standard EULA: https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
```

### ja (2294/4000)

```text
好きな声で目覚める朝を。

アラームトーク(AlarmTalk・알람톡)は、声で起こしてくれるアラームです。
• 無料：基本の声4種類が天気・運勢などのメッセージを読み上げます。アラームごとに30秒まで録音すれば、録音したそのままの音で鳴ります。
• プラス：自分の声や許可を得た声を登録すると、AI音声合成で、録音にない新しいメッセージもその声が読み上げます。
計算問題やシェイクのようなミッションはなく、聞きたい声で目を覚ませます。

■ 無料：基本の声と録音アラーム
• 曜日ごとの繰り返しも、1回だけのアラームも設定できます。
• 基本の声4種類が、アプリの言語(日本語・韓国語・英語)でアラームを読み上げます。声の代わりにアラーム音で鳴らすこともできます。
• メッセージは天気・運勢・応援・薬から選べます。
  ◦ 天気：その日の天気(晴れ・雨・雪・PM2.5・暑さ・寒さなど)に合わせたメッセージ。地域は韓国・日本・アメリカの地域一覧から選びます。
  ◦ 運勢：性別・生年月日・生まれた時間から選ぶ、お楽しみの今日の運勢
  ◦ 応援・薬：鳴るたびに、あらかじめ用意された次のメッセージに切り替わります。
• 録音アラーム：アラームごとに最大30秒まで録音すると、鳴るときに録音したそのままの音が流れます。そのアラーム専用の音なので、別の文を読み上げさせることはできません。
• 自分で入力：書いた文をAIが基本の声で読み上げます。新しく作れるのは月3回までです。
• 祝日はオフにする(振替休日・臨時祝日を含む。日本・韓国・米国のカレンダー)、スヌーズ、声の音量調整も使えます。

■ プラス：登録した声で新しいメッセージも
• アプリで録音するか、音声ファイル(12秒〜2分)をアップロードして、声を1つ登録します。登録できるのは、本人の声か、権利を持つ人から許可を得た声だけです。
• 登録した声は、AI音声合成で録音にない文を読み上げます。起床のあいさつ・天気・運勢・応援・薬のメッセージはサーバーであらかじめ作ってスマホにダウンロードし、あなたとの関係(例：娘)と、あなたを呼ぶ名前(例：ママ)を入れると(どちらも任意)、それに合わせて作ります。
• 自分で入力：書いた文を、登録した声でもAIが読み上げます。新しく作れるのは基本の声と合わせて月30回までです。
• 読み上げる言語は、日本語・韓国語・英語から選べます。
• 声は1アカウントに1つ。登録・変更は月1回までです。

■ 安心して任せられるアラーム
• 鳴る瞬間にインターネットは不要です。音をあらかじめスマホに保存するので、機内モードでも時間どおりに鳴ります。
• ロック画面でも鳴り、アラームが鳴っている間は声を繰り返し流します。

■ 声とプライバシー
• 登録した声は自分のアラームにだけ使われます。元の音声をアプリの外にダウンロードする機能はありません。
• プランが終わって無料に戻ってもアラームは残り、登録した声を使っていたアラームは基本の声(ミナ)で鳴ります。登録した声は3日間保管したあと削除されます(3日以内にプランを再開すれば元の声に戻ります)。
• 退会を申請すると、30日後にアカウントとサーバーに保存されたデータ(アラーム・声など)が削除されます。それまでに再ログインすれば退会を取り消せます。ただし、法令やプライバシーポリシーに基づき別途保管する記録(決済・取引記録は最長5年など)とバックアップ・ログは、それぞれの保管期間が終わると削除されます。スマホに保存したアラームや音声ファイルは、アラームやアプリを削除するまで残ることがあります。
• 音声の生体情報の処理への同意を撤回すると、登録した声と元の録音が削除されます。

■ ご利用にあたって
• ログインが必要です(メールまたは簡単ログイン)。
• 声の登録、メッセージの準備、同期にはインターネット接続が必要です。
• 時間どおりに鳴らすには、アラームの権限を許可してください。
• 自分で入力の回数は韓国時間の毎月1日にまた使えるようになり、このスマホに残っている音声をもう一度使っても減りません。
• アプリは日本語・韓国語・英語に対応しています。

■ iPhoneでは
• Appleでサインイン、またはメールで始められます。
• 鳴っているアラームは、ロック画面とダイナミックアイランド(対応機種)からもすぐに止めたりスヌーズしたりできます。

■ プランとお支払い
プラスは毎月自動更新されるサブスクリプションです。はじめて購読する方には1か月の無料体験が適用されることがあり(対象はAppleが決めます)、体験が終わると自動で請求されます。料金と更新条件は購入画面でご確認いただけます。お支払いは購入の確定時(無料体験がある場合は体験の終了時)にAppleアカウントに請求され、現在の期間(無料体験を含む)が終わる24時間前までに自動更新をオフにしない限り、次の期間が自動的に更新されます。管理や解約はAppleアカウントの設定から行えます。

利用規約: https://alarm-talk.com/ja/terms/
プライバシーポリシー: https://alarm-talk.com/ja/privacy/
Apple 標準使用許諾契約 (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
```

## 설명 — INTERIM (W 전에 다음 버전을 낼 때)

(C) 에서 날씨를 말하는 줄만 바꾼다(`-` 줄을 `+` 줄로, `+` 가 없으면 그 줄을 지운다). 나머지는 (C) 와 한 글자도
다르지 않다. 날씨 줄은 Play 의 INTERIM 과 같다 — Play INTERIM 은 번역이 들어간 Android 버전보다 먼저 올리므로 앱
화면 언어 문장도 빼지만, 여기 설명은 다음 버전과 함께 게재되므로 그 문장을 둔다.

**ko** (결과 2128/4000)

```diff
-• 무료: 기본 목소리 4종이 날씨·운세 같은 문구를 읽어 주고, 알람마다 30초까지 녹음해 두면 그 녹음 그대로 울려요.
+• 무료: 기본 목소리 4종이 운세·응원 같은 문구를 읽어 주고, 알람마다 30초까지 녹음해 두면 그 녹음 그대로 울려요.
-• 문구는 날씨·운세·응원·약 중에서 골라요.
+• 문구는 운세·응원·약 등에서 골라요.
-  ◦ 날씨: 그날 날씨(맑음·비·눈·미세먼지·더위·추위 등)에 맞는 문구. 지역은 대한민국·일본·미국의 지역 목록에서 골라요.
-• 등록한 목소리는 AI 음성 합성으로 녹음에 없던 문장을 읽어요. 기상 인사·날씨·운세·응원·약 문구는 서버에서 미리 만들어 폰에 받아 두고, 나와의 관계(예: 딸)와 나를 부를 이름(예: 엄마)을 적으면(둘 다 선택) 거기에 맞춰 만들어요.
+• 등록한 목소리는 AI 음성 합성으로 녹음에 없던 문장을 읽어요. 기상 인사·운세·응원·약 문구는 서버에서 미리 만들어 폰에 받아 두고, 나와의 관계(예: 딸)와 나를 부를 이름(예: 엄마)을 적으면(둘 다 선택) 거기에 맞춰 만들어요.
```

**en-US** (결과 2986/4000)

```diff
-• Free: default voices read messages like weather and fortune, and a recording plays exactly as recorded.
+• Free: default voices read messages like fortune and encouragement, and a recording plays exactly as recorded.
-• Messages: Weather (the day's weather, from rain to poor air; regions in Korea, Japan and the US), Fortune (for fun, from gender, birth date and time), Encouragement and Meds (each ring plays the next prepared one)
+• Messages include Fortune (for fun, from gender, birth date and time), Encouragement and Meds (each ring plays the next prepared one)
-• Wake-up, weather, fortune, encouragement and meds messages in that voice are made in advance on our servers and downloaded to your phone, tailored to who the voice is to you and what it calls you (both optional)
+• Wake-up, fortune, encouragement and meds messages in that voice are made in advance on our servers and downloaded to your phone, tailored to who the voice is to you and what it calls you (both optional)
```

**ja** (결과 2015/4000)

```diff
-• 無料：基本の声4種類が天気・運勢などのメッセージを読み上げます。アラームごとに30秒まで録音すれば、録音したそのままの音で鳴ります。
+• 無料：基本の声4種類が運勢・応援などのメッセージを読み上げます。アラームごとに30秒まで録音すれば、録音したそのままの音で鳴ります。
-• メッセージは天気・運勢・応援・薬から選べます。
+• メッセージは運勢・応援・薬などから選べます。
-  ◦ 天気：その日の天気(晴れ・雨・雪・PM2.5・暑さ・寒さなど)に合わせたメッセージ。地域は韓国・日本・アメリカの地域一覧から選びます。
-• 登録した声は、AI音声合成で録音にない文を読み上げます。起床のあいさつ・天気・運勢・応援・薬のメッセージはサーバーであらかじめ作ってスマホにダウンロードし、あなたとの関係(例：娘)と、あなたを呼ぶ名前(例：ママ)を入れると(どちらも任意)、それに合わせて作ります。
+• 登録した声は、AI音声合成で録音にない文を読み上げます。起床のあいさつ・運勢・応援・薬のメッセージはサーバーであらかじめ作ってスマホにダウンロードし、あなたとの関係(例：娘)と、あなたを呼ぶ名前(例：ママ)を入れると(どちらも任意)、それに合わせて作ります。
```

## en-GB 로컬라이제이션 (선택)

KR 스토어프론트가 지원하는 영어는 영어(영국)라서, en-GB 검색어는 KR 에서도 쓰인다(위 애플 문서 기준).
이름·부제·설명·프로모션은 en-US 와 같은 값을 쓰고 검색어만 아래 값이다(98자 · 98바이트 — 본안이 곧 대체안. KR 스토어는 en-US 를
색인하지 않아 `alarmtalk` 를 여기 둔다).

```text
alarmtalk,alarm-talk,alarm,voice,talking,custom,record,message,morning,ai,ringtone,weather,fortune
```

## 게시 전 확인

- **스크린샷**: 새 설명과 대조한다(아직 보지 않았다). W 전에는 날씨를 약속하는 스크린샷도 설명과 같은 조건이다.
- **이름 중복**: App Store 이름은 스토어 전체에서 유일해야 한다. 게재되지 않은 앱이 선점했는지는 ASC 에 입력해 봐야
  안다. 막히면 ko `알람톡 AlarmTalk: 목소리 알람 시계`(24자) / ja `アラームトーク AlarmTalk：声の目覚まし時計`(26자)를
  쓰고, 그때는 ko·ja 검색어의 `alarmtalk` 를 다른 단어로 바꾼다.
- **올린 뒤**: 이 파일의 「지금 상태」 를 실제 값으로 고친다.

## 길이

| 칸 | 상한 | ko | en-US | ja |
|---|---|---|---|---|
| 이름 | 30자 | 14 | 28 | 16 |
| 부제 | 30자 | 15 | 27 | 10 |
| 검색어 본안 — 글자 / 바이트 | K | 88 / 196 | 92 / 98 | 84 / 206 |
| 검색어 대체안 — 글자 / 바이트 | 100바이트 | 48 / 92 | 92 / 98 | 44 / 100 |
| 프로모션 — 기간판 | 170자 | 141 | 166 | 131 |
| 프로모션 — 상시판 | 170자 | 82 | 133 | 65 |
| 설명 — (C) | 4000자 | 2206 | 3070 | 2091 |
| 설명 — INTERIM | 4000자 | 2128 | 2986 | 2015 |
| 설명 — (D) | 4000자 | 2415 | 3482 | 2294 |

글자 수는 유니코드 코드 포인트 수, 바이트는 UTF-8 이다. 이 표는 위 문구에서 센 값이다 — 문구를 고치면 다시 센다.
(2026-10-26: (C)·INTERIM 의 설명 글자 수가 이용권 이름을 '플러스' 로 바꾸기 전 값으로 남아 있어 다시 셌다. 줄바꿈은 1자로 센다.)
