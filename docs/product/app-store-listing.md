# App Store 스토어 문구 (ko · en-US · ja · en-GB)

App Store Connect(앱 6799711245)에 올리는 값의 원본이다. 스토어를 고칠 때는 이 파일을 먼저 고치고 같은 값을
올린다 — ASC 에만 고치면 다음 사람이 어느 쪽이 최신인지 알 수 없다. Google Play 는
[`play-store-listing.md`](play-store-listing.md) 가 같은 역할을 한다. 설명 본문은 두 스토어가 같고, 끝의
스토어별 절만 다르다.

- 상한: 이름·부제 30자 · 프로모션 170자 · 설명 4000자 · 검색어는 아래 K. 출시 노트("이 버전의 새로운 기능")는
  [`release-notes.md`](release-notes.md) 의 ko/en/ja 를 그대로 쓴다.
- 스크린샷은 ko 것 하나만 올려 두었고, 다른 언어는 애플이 기본 언어(ko) 스크린샷을 그대로 보여 준다.
- URL 칸은 이번에 바꾸지 않는다(지금 값, en-GB 를 추가하면 en-US 와 같은 값):

| 로컬라이제이션 | 지원 URL | 마케팅 URL | 개인정보 처리방침 URL |
|---|---|---|---|
| ko | https://alarm-talk.com/ko/contact/ | https://alarm-talk.com/ko/ | https://alarm-talk.com/privacy/ |
| en-US | https://alarm-talk.com/en/contact/ | https://alarm-talk.com/en/ | https://alarm-talk.com/en/privacy/ |
| ja | https://alarm-talk.com/ja/contact/ | https://alarm-talk.com/ja/ | https://alarm-talk.com/ja/privacy/ |

## 지금 상태 (2026-09-30)

- 게재 중인 값은 1.2.10 의 옛 값이다 — 이름 `Alarm-Talk`. 옛 부제·검색어·프로모션·설명은 이 파일의 이전 판에
  있다(`git log -p -- docs/product/app-store-listing.md`). 옛 설명도 날씨 문구를 말한다 — 설명은 버전과 함께만
  바뀌므로 다음 버전에서 (B) 나 INTERIM 으로 바뀐다.
- 저작권은 이미 `© 2026 Vailen` 으로 게재돼 있다(ASC 입력값 `2026 Vailen` — `©` 는 애플이 붙인다. 2026-09-30
  KR 공개 페이지에서 확인).
- 아래 값은 아직 하나도 올리지 않았다. 올리면 이 절을 고친다.

## 언제 무엇을 올리나

| 칸 | 언제 | 조건 |
|---|---|---|
| 프로모션 문구 — 기간판 | 지금. 버전과 무관하게 바뀌고 심사가 없다 | P |
| 프로모션 문구 — 상시판 | 2026-10-31 15:00 UTC(= 11월 1일 0시 KST) 직후. ASC 에 예약 교체가 없어 사람이 바꾼다 | — |
| 이름·부제 | 다음 버전 레코드(앱 정보) | 이름이 이미 쓰이고 있으면 막힌다(「게시 전 확인」) |
| 검색어 | 다음 버전 레코드 | K |
| 설명 | 다음 버전 레코드 | W 충족이면 (B), 아니면 INTERIM |
| 저작권 | 다음 버전 레코드 — 새 레코드에 `2026 Vailen` 이 따라왔는지만 본다 | — |
| en-GB 로컬라이제이션(선택) | 다음 버전 레코드 | K |

- 설명은 버전과 함께만 바뀐다. INTERIM 으로 나가면 날씨 문장은 **그다음 버전**에서야 들어간다.
- 새 버전 레코드에도 프로모션 칸이 있다 — 레코드를 만들 때 게재 시점에 맞는 판인지 본다.

### 게시 조건

- **W — 날씨 문장.** 날씨 문구가 그날 그 지역의 날씨에 맞는다고 말하는 문장은 날씨 지역 서버 변경이
  **prod 에 배포되고 확인된 뒤에만** 올린다. 제품 판단으로 앞당기는 항목이 아니다 — 메타데이터는 앱의 실제
  기능을 정확히 반영해야 하고(App Store 심사 지침 2.3·2.3.1), 문구를 고쳐도 기능이 참이 되지는 않는다.
  그 전에는 INTERIM 을 쓴다.
  - 확인(prod): 국내 9개 프리셋(서울·부산·인천·대구·대전·광주·울산·수원·제주)이 모두 그 도시로 풀려 그
    도시의 날씨 문구가 나온다 — 안내 클립이나 같은 이름의 다른 지점이 아니다. 운영 서버 응답이나 실기기
    날씨 알람으로 본다.
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
| ko | `알람톡: 목소리 알람 시계` (14/30) | `서로 맞춰 주는 가족·커플 모닝콜` (18/30) |
| en-US | `AlarmTalk: Voice Alarm Clock` (28/30) | `Family & couple wake-up calls` (29/30) |
| ja | `アラームトーク：声の目覚まし時計` (16/30) | `家族・カップルで起こし合うモーニングコール` (21/30) |
| en-GB | `AlarmTalk: Voice Alarm Clock` (28/30) | `Family & couple wake-up calls` (29/30) |

- 가격·순위·'무료'·이모지는 넣지 않았다(심사 지침 2.3.7). '무료'는 설명 본문에서 사실로만 말한다.
- 브랜드 표기는 언어마다 하나다. 옛 이름의 `Alarm-Talk`(하이픈)는 쓰지 않는다.

## 검색어 (쉼표 구분 · 공백 없음)

**ko** — 본안 (95자 · 217바이트 · 26개, 먼저 시도)

```text
alarmtalk,アラームトーク,녹음,음성,깨우기,기상,연인,엄마,부모님,날씨,운세,보이스,아빠,톡,알람시계,아침,남친,여친,아이,자녀,친구,사주,응원,말하는,공휴일,선물
```

대체안 (46자 · 100바이트 · 11개, 본안이 거절되거나 잘려 저장될 때)

```text
alarmtalk,アラームトーク,녹음,음성,깨우기,기상,연인,엄마,부모님,날씨,운세
```

**en-US** — 본안 (97자 · 103바이트 · 16개, 먼저 시도)

```text
알람톡,talk,custom,own,record,message,partner,mom,dad,parents,kids,morning,weather,fortune,meds,gift
```

대체안 (92자 · 98바이트 · 15개, 본안이 거절되거나 잘려 저장될 때)

```text
알람톡,talk,custom,own,record,message,partner,mom,dad,parents,kids,morning,weather,fortune,meds
```

**ja** — 본안 (100자 · 226바이트 · 29개, 먼저 시도)

```text
alarmtalk,録音,音声,ボイス,自分,恋人,彼氏,彼女,ママ,親,天気,運勢,起床,薬,アラーム,トーク,起こす,パパ,子供,朝,占い,応援,祝日,メッセージ,夫婦,孫,友達,遠距離,おはよう
```

대체안 (47자 · 97바이트 · 14개, 본안이 거절되거나 잘려 저장될 때)

```text
alarmtalk,録音,音声,ボイス,自分,恋人,彼氏,彼女,ママ,親,天気,運勢,起床,薬
```

- 세 브랜드 표기가 각 스토어프론트에서 실리도록 나눠 넣었다 — 애플 로컬라이제이션 문서는 "그 나라 App Store 가
  지원하는 언어의 검색어로도 검색될 수 있다"고만 말한다(KR = 한국어·영어(영국), US = 영어(미국)·한국어 등,
  JP = 일본어·영어(미국)). 순위는 말하지 않는다.
- `날씨`·`weather`·`天気` 는 앱에 있는 문구 종류의 이름이라 W 전에도 둔다 — 설명과 달리 정확도를 말하는 칸이
  아니다.

## 프로모션 문구

### 기간판 — 2026-10-31 15:00 UTC 전까지 (P)

170자로는 계정별 조건을 다 담을 수 없어 규칙만 말한다. 계정마다의 판정과 정확한 삭제 시각은 앱의 종료 안내와
푸시가 알린다.

**ko** (141/170)

```text
10월 31일(한국 시간)까지 무료 계정도 개인 이용권 기능을 써요. 내 목소리나 허락받은 목소리로, 직접 쓴 문장을 AI가 읽어 줘요. 끝나면 그 목소리는 3일 보관 후 삭제돼요. 단, 삭제 전에 이용권(결제 보류 중 포함)이 있으면 삭제되지 않아요.
```

**en-US** (166/170)

```text
Free accounts get Personal until Oct 31 KST: AI reads your text in a voice you may use. Then that voice is deleted after 3 days unless you have a plan (even on hold).
```

**ja** (131/170)

```text
10月31日(韓国時間)まで、無料アカウントでもパーソナルプランの機能を使えます。自分の声や許可を得た声で、入力した文をAIが読み上げます。終了後、その声は3日間保管したあと削除されます。ただし、削除される前にプラン(支払い保留中を含む)があれば削除されません。
```

### 상시판 — 그 뒤

**ko** (93/170)

```text
익숙한 목소리로 시작하는 아침. 기본 목소리 알람과 녹음 알람은 무료로 쓰고, 등록한 목소리가 새 문장을 읽어 주는 기능과 가족·커플 모닝콜은 이용권으로 더해 보세요.
```

**en-US** (168/170)

```text
Start the day with a familiar voice. Default-voice and recorded alarms are free; a plan adds a registered voice reading new messages, and family & couple wake-up calls.
```

**ja** (83/170)

```text
なじみの声で始まる朝。基本の声のアラームと録音アラームは無料。登録した声が新しいメッセージを読み上げる機能や、家族・カップルのモーニングコールはプランで追加できます。
```

## 설명 — (B) 다음 버전, W 충족 뒤

### ko (2797/4000)

```text
좋아하는 목소리로 깨는 아침.

알람톡(AlarmTalk · アラームトーク)은 목소리로 깨워 주는 알람이에요.
• 무료: 기본 목소리 4종이 날씨·운세 같은 문구를 읽어 주고, 알람마다 30초까지 녹음해 두면 그 녹음 그대로 울려요.
• 개인 이용권: 내 목소리나 허락받은 목소리를 등록하면, AI 음성 합성으로 그 목소리가 녹음에 없던 새 문장도 읽어 줘요.
• 커플·가족 이용권: 목소리를 함께 쓰고 서로의 폰에 알람을 보내요. 받는 사람이 허용해 둔 경우에만 도착해요.
수학 문제나 흔들기 같은 해제 미션 없이, 듣고 싶은 목소리로 일어나요.

■ 무료 — 기본 목소리와 녹음 알람
• 일반 알람은 개수 제한 없이 만들어요. 요일마다 반복하거나 한 번만 울릴 수 있어요.
• 기본 목소리 4종(시우·미나·도현·애니)이 앱 언어(한국어·영어·일본어)로 알람을 읽어 줘요. 목소리 대신 알람음으로 울리게 할 수도 있어요.
• 문구는 날씨·운세·응원·약 중에서 골라요.
  - 날씨: 그날 날씨(맑음·비·눈·미세먼지·더위·추위 등)에 맞는 문구. 지역은 국내 주요 9개 도시 중에서 골라요.
  - 운세: 성별·생년월일·태어난 시간으로 고르는, 재미로 보는 오늘의 운세
  - 응원·약: 울릴 때마다 미리 준비된 다음 문구로 바뀌어요.
• 녹음 알람: 알람마다 최대 30초까지 녹음하면 울릴 때 녹음한 그대로 재생돼요. 그 알람에만 쓰는 소리라서 다른 문장을 읽게 할 수는 없어요.
• 공휴일에는 끄기(대체·임시 공휴일 포함, 한국·일본·미국 달력), 다시 울림, 목소리 크기 조절도 있어요.

■ 등록한 목소리로 새 문장을 — 개인 이용권
• 앱에서 녹음하거나 음성 파일(12초~2분)을 올려 목소리 1개를 등록해요. 본인 목소리이거나, 권리를 가진 사람에게 허락받은 목소리만 등록할 수 있어요.
• 등록한 목소리는 AI 음성 합성으로 녹음에 없던 문장을 읽어요. 기상 인사·날씨·운세·응원·약 문구는 서버에서 미리 만들어 폰에 받아 두고, 나와의 관계(예: 딸)와 나를 부를 이름(예: 엄마)을 적으면(둘 다 선택) 거기에 맞춰 만들어요.
• 직접 입력: 내가 쓴 문장을 AI가 그 목소리로 읽어 줘요. 새로 만들기는 월 30회이고, 폰에 이미 있는 문장을 다시 쓰면 횟수가 줄지 않아요.
• 알람을 읽어 줄 언어는 한국어·영어·일본어 중에서 골라요.
• 목소리는 한 계정에 1개, 등록·교체는 한 달에 한 번 할 수 있어요.
• 개인 1개월 이용권을 선물 코드로 보낼 수도 있어요(1회 결제, 자동 갱신 없음).

■ 서로 맞춰 주는 알람 — 커플·가족 이용권
• 커플은 2명, 가족은 최대 5명(본인 포함)이 초대 코드로 모여요. 구성원마다 목소리를 1개씩 등록할 수 있고, 개인 이용권 기능이 모두 들어 있어요.
• 목소리 공유: 공유를 켠 목소리는 그룹 안에서만 보이고, 공유받은 목소리로 내 알람을 만들거나 직접 입력을 쓸 수 있어요.
• 상대 알람: 시각·요일·목소리·문구를 정해 상대의 폰으로 알람을 보내요.
  - 받는 사람이 설정에서 상대 알람을 허용해 둔 경우에만 도착하고, 알람을 받지 않을 시간도 정할 수 있어요.
  - 도착한 알람은 받은 사람의 것이에요. 시각·목소리·문구를 바꾸거나 지우는 것도 받은 사람이 해요.
  - 날씨·운세 문구는 받는 사람의 지역과 정보로 골라요.
• 직접 입력은 커플 월 50회, 가족 월 100회를 그룹이 함께 써요.

■ 믿고 맡기는 알람
• 울리는 순간에는 인터넷이 필요 없어요. 소리를 미리 폰에 받아 두어 비행기 모드에서도 제시간에 울려요.
• 잠금 화면에서도 울리고, 알람이 울리는 동안 목소리를 반복해서 들려줘요.

■ 목소리와 개인정보
• 공유는 초대 코드로 연결된 그룹 안에서만 되고, 원본 음성을 앱 밖으로 내려받는 기능은 없어요.
• 이용권이 끝나 무료로 돌아가도 알람은 남아요. 등록한 목소리는 3일 보관한 뒤 삭제돼요(3일 안에 이용권을 다시 시작하면 삭제되지 않아요).
• 탈퇴를 신청하면 30일 뒤 계정과 서버에 저장된 데이터(알람·목소리 등)가 삭제되고, 그 전에 다시 로그인해 탈퇴를 취소할 수 있어요. 단, 법령이나 처리방침에 따라 따로 보관하는 기록(결제·거래 기록은 최대 5년 등)과 백업·로그는 각 보관 기간이 끝나면 삭제돼요. 폰에 저장된 알람과 소리 파일은 알람이나 앱을 지울 때까지 남을 수 있어요.
• 음성 생체정보 처리 동의를 철회하면 등록한 목소리와 녹음 원본이 삭제돼요.

■ 이용 안내
• 로그인이 필요해요(이메일 또는 간편 로그인).
• 목소리 등록, 문구 준비, 공유, 동기화에는 인터넷이 필요해요.
• 알람 권한을 허용해야 제시간에 울려요.
• 앱 화면은 한국어·영어·일본어를 지원해요.

■ iPhone에서
• Apple로 로그인 또는 이메일로 시작해요.
• 울리는 알람은 잠금 화면과 다이내믹 아일랜드(지원 기기)에서도 바로 끄거나 다시 울림으로 넘길 수 있어요.

■ 이용권과 결제
개인·커플·가족 이용권은 매월 자동 갱신되는 구독이에요. 결제 금액과 갱신 조건은 구매 화면에서 확인할 수 있어요. 결제는 구매를 확정할 때 Apple 계정으로 청구되고, 현재 기간이 끝나기 24시간 전까지 자동 갱신을 끄지 않으면 다음 기간이 자동으로 결제돼요. 구독 관리와 취소는 Apple 계정 설정에서 할 수 있어요. 개인 1개월 선물 이용권은 자동 갱신되지 않는 1회성 상품이에요.

이용약관: https://alarm-talk.com/terms/
개인정보 처리방침: https://alarm-talk.com/privacy/
Apple 표준 사용권 계약(EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
```

### en-US (3774/4000)

```text
Wake up to a voice you love.

AlarmTalk (알람톡 · アラームトーク) wakes you with a voice.
• Free: default voices read messages like weather and fortune, and a recording plays exactly as recorded.
• Personal plan: AI speech synthesis lets a voice you register read new messages it never recorded.
• Couple and Family plans: share voices and send each other alarms (only if the receiver allows it).
No math, no shaking.

■ Free
• Unlimited alarms, repeating or one-time
• Four default voices speak the app language (English, Korean or Japanese), or use an alarm sound
• Messages: Weather (the day's weather, from rain to poor air; one of 9 major Korean cities), Fortune (for fun, from gender, birth date and time), Encouragement and Meds (each ring plays the next prepared one)
• Recorded alarm: up to 30 seconds per alarm, played exactly as recorded; it can't read other text
• Turn off on holidays (incl. substitute and temporary holidays; Korea, Japan or US), snooze, voice volume

■ Personal plan
• Register one voice per account, once a month, by recording or uploading audio (12 sec to 2 min): yours, or one you have permission to use
• Wake-up, weather, fortune, encouragement and meds messages in that voice are made in advance on our servers and downloaded to your phone, tailored to who the voice is to you and what it calls you (both optional)
• Type it yourself: AI reads your text in that voice (30 new a month; text already on your phone doesn't count)
• Messages in Korean, English or Japanese
• Gift a 1-month Personal plan by code (one-time purchase, no renewal)

■ Couple (2) and Family (up to 5, incl. you)
• Join by invite code; each member can register a voice; everything in Personal is included
• Share voices within your group only, for your own alarms and typed messages
• Send an alarm (time, days, voice, message) to a member who allows it, outside hours they block. Once delivered, it's theirs to change or delete; weather and fortune use their details.
• Typed messages: 50 a month for Couple, 100 for Family, shared by the group

■ Reliable and private
• Rings on time offline (sounds are saved in advance, even in airplane mode), on the lock screen, repeating the voice while it rings
• Original recordings can't be downloaded from the app
• If your plan ends, alarms stay; your voice is deleted after 3 days unless you restart a plan
• Deleting your account removes it and its server data (alarms, voices, etc.) after 30 days unless you sign in and cancel first. Records kept by law or our Privacy Policy (e.g., payment records, up to 5 years), backups and logs are deleted when retention ends; files on your phone may stay until you delete them or the app
• Withdrawing voice biometric consent deletes your voice and original recordings

■ Good to know
• Sign-in required; registering a voice, preparing messages, sharing and sync need internet
• Allow alarm permission so alarms ring on time

■ On iPhone
• Sign in with Apple or with email.
• A ringing alarm also appears on the Lock Screen and in the Dynamic Island (on supported models), where you can stop or snooze it.

■ Plans and billing
Personal, Couple and Family plans are monthly auto-renewing subscriptions. The price and renewal terms are shown on the purchase screen. Payment is charged to your Apple Account when you confirm the purchase, and the subscription renews automatically unless auto-renew is turned off at least 24 hours before the end of the current period. You can manage or cancel it in your Apple Account settings. The 1-month Personal gift is a one-time purchase that does not renew.

Terms of Service: https://alarm-talk.com/en/terms/
Privacy Policy: https://alarm-talk.com/en/privacy/
Apple Standard EULA: https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
```

### ja (2677/4000)

```text
好きな声で目覚める朝を。

アラームトーク(AlarmTalk・알람톡)は、声で起こしてくれるアラームです。
• 無料：基本の声4種類が天気・運勢などのメッセージを読み上げます。アラームごとに30秒まで録音すれば、録音したそのままの音で鳴ります。
• パーソナルプラン：自分の声や許可を得た声を登録すると、AI音声合成で、録音にない新しいメッセージもその声が読み上げます。
• カップル・ファミリープラン：声を共有し、お互いのスマホにアラームを送れます。受け取る人が許可している場合だけ届きます。
計算問題やシェイクのようなミッションはなく、聞きたい声で目を覚ませます。

■ 無料 — 基本の声と録音アラーム
• 通常アラームは無制限。曜日ごとの繰り返しも、1回だけのアラームも設定できます。
• 基本の声4種類が、アプリの言語(日本語・韓国語・英語)でアラームを読み上げます。声の代わりにアラーム音で鳴らすこともできます。
• メッセージは天気・運勢・応援・薬から選べます。
  - 天気：その日の天気(晴れ・雨・雪・PM2.5・暑さ・寒さなど)に合わせたメッセージ。都市は韓国の主要9都市から選びます。
  - 運勢：性別・生年月日・生まれた時間から選ぶ、お楽しみの今日の運勢
  - 応援・薬：鳴るたびに、あらかじめ用意された次のメッセージに切り替わります。
• 録音アラーム：アラームごとに最大30秒まで録音すると、鳴るときに録音したそのままの音が流れます。そのアラーム専用の音なので、別の文を読み上げさせることはできません。
• 祝日はオフにする(振替休日・臨時祝日を含む。日本・韓国・米国のカレンダー)、スヌーズ、声の音量調整も使えます。

■ 登録した声で新しいメッセージを — パーソナルプラン
• アプリで録音するか、音声ファイル(12秒〜2分)をアップロードして、声を1つ登録します。登録できるのは、本人の声か、権利を持つ人から許可を得た声だけです。
• 登録した声は、AI音声合成で録音にない文を読み上げます。起床のあいさつ・天気・運勢・応援・薬のメッセージはサーバーであらかじめ作ってスマホにダウンロードし、あなたとの関係(例：娘)と、あなたを呼ぶ名前(例：ママ)を入れると(どちらも任意)、それに合わせて作ります。
• 自分で入力：書いた文をAIがその声で読み上げます。新しく作れるのは月30回まで。スマホにすでにある文を使う場合は回数に数えません。
• 読み上げる言語は、日本語・韓国語・英語から選べます。
• 声は1アカウントに1つ。登録・変更は月1回までです。
• パーソナル1か月分をギフトコードで贈ることもできます(1回限りの購入、自動更新なし)。

■ 起こし合うアラーム — カップル・ファミリープラン
• カップルは2人、ファミリーは最大5人(本人を含む)で、招待コードでグループを作ります。メンバーはそれぞれ声を1つ登録でき、パーソナルプランの機能もすべて含まれます。
• 声の共有：共有をオンにした声はグループ内だけに表示され、共有された声で自分のアラームを作ったり、自分で入力を使ったりできます。
• 相手のアラーム設定：時刻・曜日・声・メッセージを決めて、相手のスマホにアラームを送れます。
  - 受け取る人が設定で相手からのアラームを許可している場合だけ届きます。アラームを受け取らない時間も設定できます。
  - 届いたアラームは受け取った人のものになり、時刻・声・メッセージの変更や削除も受け取った人が行います。
  - 天気・運勢のメッセージは、受け取る人の地域と情報で選ばれます。
• 自分で入力は、カップルは月50回、ファミリーは月100回をグループで分け合います。

■ 安心して任せられるアラーム
• 鳴る瞬間にインターネットは不要です。音をあらかじめスマホに保存するので、機内モードでも時間どおりに鳴ります。
• ロック画面でも鳴り、アラームが鳴っている間は声を繰り返し流します。

■ 声とプライバシー
• 共有は招待コードでつながったグループ内だけ。元の音声をアプリの外にダウンロードする機能はありません。
• プランが終わって無料に戻ってもアラームは残ります。登録した声は3日間保管したあと削除されます(3日以内にプランを再開すれば削除されません)。
• 退会を申請すると、30日後にアカウントとサーバーに保存されたデータ(アラーム・声など)が削除されます。それまでに再ログインすれば退会を取り消せます。ただし、法令やプライバシーポリシーに基づき別途保管する記録(決済・取引記録は最長5年など)とバックアップ・ログは、それぞれの保管期間が終わると削除されます。スマホに保存したアラームや音声ファイルは、アラームやアプリを削除するまで残ることがあります。
• 音声の生体情報の処理への同意を撤回すると、登録した声と元の録音が削除されます。

■ ご利用にあたって
• ログインが必要です(メールまたは簡単ログイン)。
• 声の登録、メッセージの準備、共有、同期にはインターネット接続が必要です。
• 時間どおりに鳴らすには、アラームの権限を許可してください。
• アプリは日本語・韓国語・英語に対応しています。

■ iPhoneでは
• Appleでサインイン、またはメールで始められます。
• 鳴っているアラームは、ロック画面とダイナミックアイランド(対応機種)からもすぐに止めたりスヌーズしたりできます。

■ プランとお支払い
パーソナル・カップル・ファミリープランは毎月自動更新されるサブスクリプションです。料金と更新条件は購入画面でご確認いただけます。お支払いは購入の確定時にAppleアカウントに請求され、現在の期間が終わる24時間前までに自動更新をオフにしない限り、次の期間が自動的に更新されます。管理や解約はAppleアカウントの設定から行えます。パーソナル1か月ギフトは自動更新されない1回限りの商品です。

利用規約: https://alarm-talk.com/ja/terms/
プライバシーポリシー: https://alarm-talk.com/ja/privacy/
Apple 標準使用許諾契約 (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
```

## 설명 — INTERIM (W 전에 다음 버전을 낼 때)

(B) 에서 날씨를 말하는 줄만 바꾼다(`-` 줄을 `+` 줄로, `+` 가 없으면 그 줄을 지운다). 나머지는 (B) 와 한 글자도
다르지 않다. Play 의 INTERIM 과 같은 줄이다.

**ko** (결과 2716/4000)

```diff
-• 무료: 기본 목소리 4종이 날씨·운세 같은 문구를 읽어 주고, 알람마다 30초까지 녹음해 두면 그 녹음 그대로 울려요.
+• 무료: 기본 목소리 4종이 운세·응원 같은 문구를 읽어 주고, 알람마다 30초까지 녹음해 두면 그 녹음 그대로 울려요.
-• 문구는 날씨·운세·응원·약 중에서 골라요.
+• 문구는 운세·응원·약 등에서 골라요.
-  - 날씨: 그날 날씨(맑음·비·눈·미세먼지·더위·추위 등)에 맞는 문구. 지역은 국내 주요 9개 도시 중에서 골라요.
-• 등록한 목소리는 AI 음성 합성으로 녹음에 없던 문장을 읽어요. 기상 인사·날씨·운세·응원·약 문구는 서버에서 미리 만들어 폰에 받아 두고, 나와의 관계(예: 딸)와 나를 부를 이름(예: 엄마)을 적으면(둘 다 선택) 거기에 맞춰 만들어요.
+• 등록한 목소리는 AI 음성 합성으로 녹음에 없던 문장을 읽어요. 기상 인사·운세·응원·약 문구는 서버에서 미리 만들어 폰에 받아 두고, 나와의 관계(예: 딸)와 나를 부를 이름(예: 엄마)을 적으면(둘 다 선택) 거기에 맞춰 만들어요.
-  - 날씨·운세 문구는 받는 사람의 지역과 정보로 골라요.
+  - 운세 문구는 받는 사람의 정보로 골라요.
```

**en-US** (결과 3685/4000)

```diff
-• Free: default voices read messages like weather and fortune, and a recording plays exactly as recorded.
+• Free: default voices read messages like fortune and encouragement, and a recording plays exactly as recorded.
-• Messages: Weather (the day's weather, from rain to poor air; one of 9 major Korean cities), Fortune (for fun, from gender, birth date and time), Encouragement and Meds (each ring plays the next prepared one)
+• Messages include Fortune (for fun, from gender, birth date and time), Encouragement and Meds (each ring plays the next prepared one)
-• Wake-up, weather, fortune, encouragement and meds messages in that voice are made in advance on our servers and downloaded to your phone, tailored to who the voice is to you and what it calls you (both optional)
+• Wake-up, fortune, encouragement and meds messages in that voice are made in advance on our servers and downloaded to your phone, tailored to who the voice is to you and what it calls you (both optional)
-• Send an alarm (time, days, voice, message) to a member who allows it, outside hours they block. Once delivered, it's theirs to change or delete; weather and fortune use their details.
+• Send an alarm (time, days, voice, message) to a member who allows it, outside hours they block. Once delivered, it's theirs to change or delete; fortune uses their details.
```

**ja** (결과 2602/4000)

```diff
-• 無料：基本の声4種類が天気・運勢などのメッセージを読み上げます。アラームごとに30秒まで録音すれば、録音したそのままの音で鳴ります。
+• 無料：基本の声4種類が運勢・応援などのメッセージを読み上げます。アラームごとに30秒まで録音すれば、録音したそのままの音で鳴ります。
-• メッセージは天気・運勢・応援・薬から選べます。
+• メッセージは運勢・応援・薬などから選べます。
-  - 天気：その日の天気(晴れ・雨・雪・PM2.5・暑さ・寒さなど)に合わせたメッセージ。都市は韓国の主要9都市から選びます。
-• 登録した声は、AI音声合成で録音にない文を読み上げます。起床のあいさつ・天気・運勢・応援・薬のメッセージはサーバーであらかじめ作ってスマホにダウンロードし、あなたとの関係(例：娘)と、あなたを呼ぶ名前(例：ママ)を入れると(どちらも任意)、それに合わせて作ります。
+• 登録した声は、AI音声合成で録音にない文を読み上げます。起床のあいさつ・運勢・応援・薬のメッセージはサーバーであらかじめ作ってスマホにダウンロードし、あなたとの関係(例：娘)と、あなたを呼ぶ名前(例：ママ)を入れると(どちらも任意)、それに合わせて作ります。
-  - 天気・運勢のメッセージは、受け取る人の地域と情報で選ばれます。
+  - 運勢のメッセージは、受け取る人の情報で選ばれます。
```

## en-GB 로컬라이제이션 (선택)

KR 스토어프론트가 지원하는 영어는 영어(영국)라서, en-GB 검색어는 KR 에서도 쓰인다(위 애플 문서 기준).
이름·부제·설명·프로모션은 en-US 와 같은 값을 쓰고 검색어만 아래 값이다(100자 · 100바이트 — 본안이 곧 대체안).

```text
talk,custom,own,record,message,partner,mom,dad,parents,kids,morning,weather,fortune,medicine,holiday
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
| 부제 | 30자 | 18 | 29 | 21 |
| 검색어 본안 — 글자 / 바이트 | K | 95 / 217 | 97 / 103 | 100 / 226 |
| 검색어 대체안 — 글자 / 바이트 | 100바이트 | 46 / 100 | 92 / 98 | 47 / 97 |
| 프로모션 — 기간판 | 170자 | 141 | 166 | 131 |
| 프로모션 — 상시판 | 170자 | 93 | 168 | 83 |
| 설명 — (B) | 4000자 | 2797 | 3774 | 2677 |
| 설명 — INTERIM | 4000자 | 2716 | 3685 | 2602 |

글자 수는 유니코드 코드 포인트 수, 바이트는 UTF-8 이다. 이 표는 위 문구에서 센 값이다 — 문구를 고치면 다시 센다.
