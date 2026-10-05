# Google Play 스토어 문구 (ko-KR · en-US · ja-JP)

Play Console 에 올리는 값의 원본이다. 콘솔을 고칠 때는 이 파일을 먼저 고치고 같은 값을 올린다. App Store 는
[`app-store-listing.md`](app-store-listing.md) 가 같은 역할을 한다. 설명 본문은 두 스토어가 같고, 끝의 'Android에서'·
결제·권한·링크 절만 Play 것이다.

- 상한: 제목 30자 · 짧은 설명 80자 · 전체 설명 4000자. 출시 노트는 [`release-notes.md`](release-notes.md).
- Play 등록정보는 앱 버전과 무관하게 바꿀 수 있다 — App Store 와 달리 새 버전을 기다리지 않는다.
- 앱 화면 언어 지원 문장은 번역을 포함한 다음 앱 버전이 게재된 뒤 사용한다. 게재 전 설명에서는 해당 한 줄을 뺀다.

## 지금 상태 (2026-09-30)

- 게재 중: 제목 `알람톡 - 좋아하는 목소리로 깨워주는 알람 시계` 와 옛 설명(ko 공개 페이지에서 확인). 옛 설명에는
  익명 이용자 후기, 연예인·캐릭터 목소리 권유, 해시태그 목록, 개인 연락처가 있고, 무료 범위와 날씨('오늘의
  날씨·기온') 설명이 지금 앱과 다르다 — 다음 버전을 기다리지 않고 **INTERIM 으로 바로 바꾼다.**
- 아래 값은 아직 하나도 올리지 않았다. 올리면 이 절을 고친다.

## 판과 게시 조건

| 판 | 무엇 | 언제 올리나 |
|---|---|---|
| INTERIM | 날씨 주장이 없는 판 | 지금 |
| (A) | Android 30(1.2.10, 지금 게재 버전) 기준, 날씨 문장 포함 | W 를 Android 30 기준으로 확인한 뒤, Android 30 이 게재본인 동안 |
| (B) | 다음 Android 버전 기준, 날씨 문장 포함 | 그 버전이 게재되고 W 도 확인된 뒤. W 전이면 INTERIM 을 그대로 둔다 |
| + R1 · R2 | 결제 문단 끝에 붙이는 앱 해지·환불 문장 | 각각 E1 · E2 를 관찰한 뒤, 그때 게재 중인 판에 붙인다 |

제목은 모든 판이 같다. 짧은 설명은 INTERIM 과 (A)·(B) 두 가지다.

- **W — 날씨 문장.** 조건과 확인 방법은 [`app-store-listing.md`](app-store-listing.md) 「게시 조건」 W 와 같다 —
  날씨 지역 서버 변경이 prod 에 배포되고 확인되기 전에는 날씨가 맞는다고 말하지 않는다. 제품 판단으로 앞당기지
  않는다(Play 메타데이터 정책: 메타데이터는 앱 기능을 정확히 반영해야 한다).
  - (A) 는 **Android 30 사용자가 실제로 고르는 값**으로 확인한다: ko 는 국내 9개 프리셋, en 은 직접 입력(프리셋
    없음), ja 는 일본 도시 프리셋 8개(`東京` 등 — 나라 값은 `大韓民国` 으로 보낸다). 2026-09-30 로컬 실행에서
    ja `東京` 프리셋은 해석에 실패했고, en 직접 입력은 입력 형식에 따라 다른 지점이 골라졌다(`New York` → 영국
    요크). 확인되지 않은 언어는 INTERIM 을 유지한다.
  - (B) 는 세 언어 모두 국내 9개 프리셋(보내는 값이 같다)으로 확인한다.
- **R1 · R2 — 앱 해지·환불 문장.** 앱 안 해지는 코드로만 확인했고 운영에서 실행해 본 적이 없다. Google Play 로
  직접 결제한 구독은 Play `cancel` 이 성공한 뒤에만 '종료일에 해지' 를, `revoke`(비례 환불)가 성공한 뒤에만
  '지금 해지' 를 반영하고, 실패하면 502 로 Play 에서 해지하라고 안내한다. 선물·코드 이용권은 환불이 없고,
  App Store 결제는 앱에서 해지할 수 없다.
  - R1 은 E1 뒤에 붙인다: 운영 서비스 계정의 Play `cancel` 권한과 앱 '종료일에 해지' 한 번을 관찰.
  - R2 는 E2 뒤에, R1 다음에만 붙인다: 실결제 구독의 '지금 해지'(비례 환불)를 관찰.
  - 그 전 게시본은 Play 스토어에서 해지하는 방법만 말한다.

## 정책 메모 (Play 메타데이터 정책 — 2026-09-30 원문 확인)

- 메타데이터는 앱 기능을 정확히 반영해야 한다 → W.
- 설명에 출처 없는·익명 이용자 후기를 둘 수 없다 → 옛 설명의 이용자 후기를 뺐다.
- 제목은 30자 이하이고, 제목·아이콘·개발자 이름에 순위·가격·프로모션 표현과 이모지·반복 특수문자를 쓰지 않는다 →
  새 제목에는 '무료' 같은 말이 없다.
- 스팸성 키워드를 금한다 → 해시태그 목록을 뺐다.
- 목소리는 본인 것이나 권리자에게 허락받은 것만 등록할 수 있다(앱 규칙) → 연예인·캐릭터 목소리를 권하지 않는다.
- 설명의 연락처는 연락 페이지 URL 만 쓴다(개인 메일·주소를 넣지 않는다).

## 제목 · 짧은 설명

| 언어 | 제목 | 짧은 설명 — INTERIM | 짧은 설명 — (A)·(B) |
|---|---|---|---|
| ko-KR | `알람톡: 목소리 알람 시계` (14/30) | 좋아하는 목소리로 깨는 아침. 녹음 그대로 울리는 알람, 운세·응원 문구, 가족·커플 모닝콜까지. (54/80) | 좋아하는 목소리로 깨는 아침. 녹음 그대로 울리는 알람, 날씨·운세 문구, 가족·커플 모닝콜까지. (54/80) |
| en-US | `AlarmTalk: Voice Alarm Clock` (28/30) | Wake to a loved voice: recorded alarms, fortune & cheer, family wake-up calls. (78/80) | Wake to a loved voice: recorded alarms, weather & fortune, family wake-up calls. (80/80) |
| ja-JP | `アラームトーク：声の目覚まし時計` (16/30) | 好きな声で目覚める朝。録音そのままのアラーム、運勢・応援メッセージ、家族・カップルのモーニングコールまで。 (53/80) | 好きな声で目覚める朝。録音そのままのアラーム、天気・運勢メッセージ、家族・カップルのモーニングコールまで。 (53/80) |

## 전체 설명 — INTERIM (지금)

### ko-KR (2915/4000)

```text
좋아하는 목소리로 깨는 아침.

알람톡(AlarmTalk · アラームトーク)은 목소리로 깨워 주는 알람이에요.
• 무료: 기본 목소리 4종이 운세·응원 같은 문구를 읽어 주고, 알람마다 30초까지 녹음해 두면 그 녹음 그대로 울려요.
• 개인 이용권: 내 목소리나 허락받은 목소리를 등록하면, AI 음성 합성으로 그 목소리가 녹음에 없던 새 문장도 읽어 줘요.
• 커플·가족 이용권: 목소리를 함께 쓰고 서로의 폰에 알람을 보내요. 받는 사람이 허용해 둔 경우에만 도착해요.
수학 문제나 흔들기 같은 해제 미션 없이, 듣고 싶은 목소리로 일어나요.

■ 무료 — 기본 목소리와 녹음 알람
• 알람은 요일마다 반복하거나 한 번만 울리게 만들 수 있어요.
• 기본 목소리 4종(시우·미나·도현·애니)이 앱 언어(한국어·영어·일본어)로 알람을 읽어 줘요. 목소리 대신 알람음으로 울리게 할 수도 있어요.
• 문구는 운세·응원·약 등에서 골라요.
  - 운세: 성별·생년월일·태어난 시간으로 고르는, 재미로 보는 오늘의 운세
  - 응원·약: 울릴 때마다 미리 준비된 다음 문구로 바뀌어요.
• 녹음 알람: 알람마다 최대 30초까지 녹음하면 울릴 때 녹음한 그대로 재생돼요. 그 알람에만 쓰는 소리라서 다른 문장을 읽게 할 수는 없어요.
• 공휴일에는 끄기(대체·임시 공휴일 포함, 한국·일본·미국 달력), 다시 울림, 목소리 크기 조절도 있어요.

■ 등록한 목소리로 새 문장을 — 개인 이용권
• 앱에서 녹음하거나 음성 파일(12초~2분)을 올려 목소리 1개를 등록해요. 본인 목소리이거나, 권리를 가진 사람에게 허락받은 목소리만 등록할 수 있어요.
• 등록한 목소리는 AI 음성 합성으로 녹음에 없던 문장을 읽어요. 기상 인사·운세·응원·약 문구는 서버에서 미리 만들어 폰에 받아 두고, 나와의 관계(예: 딸)와 나를 부를 이름(예: 엄마)을 적으면(둘 다 선택) 거기에 맞춰 만들어요.
• 직접 입력: 내가 쓴 문장을 AI가 그 목소리로 읽어 줘요. 새로 만들기는 월 30회이고, 같은 목소리로 같은 문장을 쓰는 알람이 이 폰에 남아 있으면 다시 써도 횟수가 줄지 않아요.
• 알람을 읽어 줄 언어는 한국어·영어·일본어 중에서 골라요.
• 목소리는 한 계정에 1개, 등록·교체는 한 달에 한 번 할 수 있어요.
• 개인 1개월 이용권을 선물 코드로 보낼 수도 있어요(1회 결제, 자동 갱신 없음).

■ 서로 맞춰 주는 알람 — 커플·가족 이용권
• 커플은 2명, 가족은 최대 5명(본인 포함)이 초대 코드로 모여요. 구성원마다 목소리를 1개씩 등록할 수 있고, 개인 이용권 기능이 모두 들어 있어요.
• 목소리 공유: 공유를 켠 목소리는 그룹 안에서만 보이고, 공유받은 목소리로 내 알람을 만들거나 직접 입력을 쓸 수 있어요.
• 상대 알람: 시각·요일·목소리·문구를 정해 상대의 폰으로 알람을 보내요.
  - 받는 사람이 설정에서 상대 알람을 허용해 둔 경우에만 도착하고, 알람을 받지 않을 시간도 정할 수 있어요.
  - 도착한 알람은 받은 사람의 것이에요. 시각·목소리·문구를 바꾸거나 지우는 것도 받은 사람이 해요.
  - 운세 문구는 받는 사람의 정보로 골라요.
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

■ Android에서
• Google 또는 이메일로 로그인해요.
• 진동 패턴 17가지와 알람음 크기를 알람마다 고르고, 울리는 화면에서 다시 울림 간격을 1분씩 바꿀 수 있어요.
• 잠겨 있거나 앱을 보고 있으면 전체 화면으로, 다른 화면을 쓰는 중이면 배너로 울려요.
• 재부팅·시간대 변경·시각 변경 뒤에도 알람을 다시 예약해요.

■ 이용권과 결제
개인·커플·가족 이용권은 매월 자동 갱신되는 Google Play 정기 결제예요. 가격과 갱신 조건은 앱의 구매 화면에서 확인할 수 있어요. Google Play 스토어의 [결제 및 정기 결제]에서 해지하면 이번 결제 기간이 끝날 때까지 쓸 수 있어요.

■ 권한
• 필수: 알림·정확한 알람·전체 화면 알림(제시간에, 잠금 화면에서 울리기), 포그라운드 서비스(울리는 동안 소리 유지, 목소리 문구 받기), 오디오 설정·절전 해제·진동, 재부팅 뒤 재예약, 네트워크(울리는 순간에는 쓰지 않음)
• 선택: 마이크(녹음할 때). 허용하지 않아도 기본 목소리와 음성 파일 업로드는 쓸 수 있어요.
• 알람 해제를 막는 기기 관리자 권한이나 접근성 권한은 쓰지 않아요.

개인정보 처리방침: https://alarm-talk.com/privacy/
이용약관: https://alarm-talk.com/terms/
고객 지원: https://alarm-talk.com/contact/
```

### en-US (3726/4000)

```text
Wake up to a voice you love.

AlarmTalk (알람톡 · アラームトーク) wakes you with a voice.
• Free: default voices read messages like fortune and encouragement, and a recording plays exactly as recorded.
• Personal plan: AI speech synthesis lets a voice you register read new messages it never recorded.
• Couple and Family plans: share voices and send each other alarms (only if the receiver allows it).
No math, no shaking.

■ Free
• Repeating or one-time alarms
• Four default voices speak the app language (English, Korean or Japanese), or use an alarm sound
• Messages include Fortune (for fun, from gender, birth date and time), Encouragement and Meds (each ring plays the next prepared one)
• Recorded alarm: up to 30 seconds per alarm, played exactly as recorded; it can't read other text
• Turn off on holidays (incl. substitute and temporary holidays; Korea, Japan or US), snooze, voice volume

■ Personal plan
• Register one voice per account, once a month, by recording or uploading audio (12 sec to 2 min): yours, or one you have permission to use
• Wake-up, fortune, encouragement and meds messages in that voice are made in advance on our servers and downloaded to your phone, tailored to who the voice is to you and what it calls you (both optional)
• Type it yourself: AI reads your text in that voice (30 new a month; free if an alarm on this phone has the same text and voice)
• Messages in Korean, English or Japanese
• Gift a 1-month Personal plan by code (one-time purchase, no renewal)

■ Couple (2) and Family (up to 5, incl. you)
• Join by invite code; each member can register a voice; everything in Personal is included
• Share voices within your group only, for your own alarms and typed messages
• Send an alarm (time, days, voice, message) to a member who allows it, outside hours they block. Once delivered, it's theirs to change or delete; fortune uses their details.
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

■ On Android
• Sign in with Google or email
• 17 vibration patterns and alarm sound volume per alarm; change snooze time in 1-minute steps while it rings
• Full screen when locked or in the app, a banner otherwise
• Reschedules after reboot, time or time-zone changes

■ Plans and billing
Plans are monthly auto-renewing Google Play subscriptions; prices and terms are in the app. If you cancel in Google Play, you keep access until the period ends.

■ Permissions
• Required: notifications, exact alarms, full-screen alerts, foreground service, audio settings, wake lock, vibrate, boot and network (not used to ring)
• Optional: microphone, to record (not needed for default voices or audio upload)
• No device admin or accessibility permissions

Privacy Policy: https://alarm-talk.com/en/privacy/
Terms of Service: https://alarm-talk.com/en/terms/
Support: https://alarm-talk.com/en/contact/
```

### ja-JP (2789/4000)

```text
好きな声で目覚める朝を。

アラームトーク(AlarmTalk・알람톡)は、声で起こしてくれるアラームです。
• 無料：基本の声4種類が運勢・応援などのメッセージを読み上げます。アラームごとに30秒まで録音すれば、録音したそのままの音で鳴ります。
• パーソナルプラン：自分の声や許可を得た声を登録すると、AI音声合成で、録音にない新しいメッセージもその声が読み上げます。
• カップル・ファミリープラン：声を共有し、お互いのスマホにアラームを送れます。受け取る人が許可している場合だけ届きます。
計算問題やシェイクのようなミッションはなく、聞きたい声で目を覚ませます。

■ 無料 — 基本の声と録音アラーム
• 曜日ごとの繰り返しも、1回だけのアラームも設定できます。
• 基本の声4種類が、アプリの言語(日本語・韓国語・英語)でアラームを読み上げます。声の代わりにアラーム音で鳴らすこともできます。
• メッセージは運勢・応援・薬などから選べます。
  - 運勢：性別・生年月日・生まれた時間から選ぶ、お楽しみの今日の運勢
  - 応援・薬：鳴るたびに、あらかじめ用意された次のメッセージに切り替わります。
• 録音アラーム：アラームごとに最大30秒まで録音すると、鳴るときに録音したそのままの音が流れます。そのアラーム専用の音なので、別の文を読み上げさせることはできません。
• 祝日はオフにする(振替休日・臨時祝日を含む。日本・韓国・米国のカレンダー)、スヌーズ、声の音量調整も使えます。

■ 登録した声で新しいメッセージを — パーソナルプラン
• アプリで録音するか、音声ファイル(12秒〜2分)をアップロードして、声を1つ登録します。登録できるのは、本人の声か、権利を持つ人から許可を得た声だけです。
• 登録した声は、AI音声合成で録音にない文を読み上げます。起床のあいさつ・運勢・応援・薬のメッセージはサーバーであらかじめ作ってスマホにダウンロードし、あなたとの関係(例：娘)と、あなたを呼ぶ名前(例：ママ)を入れると(どちらも任意)、それに合わせて作ります。
• 自分で入力：書いた文をAIがその声で読み上げます。新しく作れるのは月30回まで。同じ声・同じ文を使うアラームがこのスマホに残っていれば、回数に数えません。
• 読み上げる言語は、日本語・韓国語・英語から選べます。
• 声は1アカウントに1つ。登録・変更は月1回までです。
• パーソナル1か月分をギフトコードで贈ることもできます(1回限りの購入、自動更新なし)。

■ 起こし合うアラーム — カップル・ファミリープラン
• カップルは2人、ファミリーは最大5人(本人を含む)で、招待コードでグループを作ります。メンバーはそれぞれ声を1つ登録でき、パーソナルプランの機能もすべて含まれます。
• 声の共有：共有をオンにした声はグループ内だけに表示され、共有された声で自分のアラームを作ったり、自分で入力を使ったりできます。
• 相手のアラーム設定：時刻・曜日・声・メッセージを決めて、相手のスマホにアラームを送れます。
  - 受け取る人が設定で相手からのアラームを許可している場合だけ届きます。アラームを受け取らない時間も設定できます。
  - 届いたアラームは受け取った人のものになり、時刻・声・メッセージの変更や削除も受け取った人が行います。
  - 運勢のメッセージは、受け取る人の情報で選ばれます。
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

■ Androidでは
• Googleまたはメールでログインします。
• 17種類の振動パターンとアラーム音の音量をアラームごとに選べ、鳴動画面でスヌーズ間隔を1分ずつ変えられます。
• ロック中やアプリを開いているときは全画面で、それ以外のときはバナーで鳴ります。
• 再起動・タイムゾーン変更・時刻変更のあともアラームを再設定します。

■ プランとお支払い
パーソナル・カップル・ファミリープランは毎月自動更新されるGoogle Playの定期購入です。料金と更新条件はアプリの購入画面でご確認いただけます。Google Playストアの[お支払いと定期購入]で解約すると、現在の請求期間が終わるまで使えます。

■ 権限
• 必須：通知・正確なアラーム・全画面通知(時間どおりに、ロック画面で鳴らす)、フォアグラウンドサービス(鳴動中の再生維持、声のメッセージの保存)、オーディオ設定・スリープ解除・バイブレーション、再起動後の再設定、ネットワーク(鳴る瞬間には使いません)
• 任意：マイク(録音するとき)。許可しなくても、基本の声と音声ファイルのアップロードは使えます。
• アラームの解除を妨げる端末管理者権限やユーザー補助(アクセシビリティ)権限は使用しません。

プライバシーポリシー: https://alarm-talk.com/ja/privacy/
利用規約: https://alarm-talk.com/ja/terms/
サポート: https://alarm-talk.com/ja/contact/
```

## 전체 설명 — (B) 다음 Android 버전, W 뒤

### ko-KR (2996/4000)

```text
좋아하는 목소리로 깨는 아침.

알람톡(AlarmTalk · アラームトーク)은 목소리로 깨워 주는 알람이에요.
• 무료: 기본 목소리 4종이 날씨·운세 같은 문구를 읽어 주고, 알람마다 30초까지 녹음해 두면 그 녹음 그대로 울려요.
• 개인 이용권: 내 목소리나 허락받은 목소리를 등록하면, AI 음성 합성으로 그 목소리가 녹음에 없던 새 문장도 읽어 줘요.
• 커플·가족 이용권: 목소리를 함께 쓰고 서로의 폰에 알람을 보내요. 받는 사람이 허용해 둔 경우에만 도착해요.
수학 문제나 흔들기 같은 해제 미션 없이, 듣고 싶은 목소리로 일어나요.

■ 무료 — 기본 목소리와 녹음 알람
• 알람은 요일마다 반복하거나 한 번만 울리게 만들 수 있어요.
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
• 직접 입력: 내가 쓴 문장을 AI가 그 목소리로 읽어 줘요. 새로 만들기는 월 30회이고, 같은 목소리로 같은 문장을 쓰는 알람이 이 폰에 남아 있으면 다시 써도 횟수가 줄지 않아요.
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

■ Android에서
• Google 또는 이메일로 로그인해요.
• 진동 패턴 17가지와 알람음 크기를 알람마다 고르고, 울리는 화면에서 다시 울림 간격을 1분씩 바꿀 수 있어요.
• 잠겨 있거나 앱을 보고 있으면 전체 화면으로, 다른 화면을 쓰는 중이면 배너로 울려요.
• 재부팅·시간대 변경·시각 변경 뒤에도 알람을 다시 예약해요.

■ 이용권과 결제
개인·커플·가족 이용권은 매월 자동 갱신되는 Google Play 정기 결제예요. 가격과 갱신 조건은 앱의 구매 화면에서 확인할 수 있어요. Google Play 스토어의 [결제 및 정기 결제]에서 해지하면 이번 결제 기간이 끝날 때까지 쓸 수 있어요.

■ 권한
• 필수: 알림·정확한 알람·전체 화면 알림(제시간에, 잠금 화면에서 울리기), 포그라운드 서비스(울리는 동안 소리 유지, 목소리 문구 받기), 오디오 설정·절전 해제·진동, 재부팅 뒤 재예약, 네트워크(울리는 순간에는 쓰지 않음)
• 선택: 마이크(녹음할 때). 허용하지 않아도 기본 목소리와 음성 파일 업로드는 쓸 수 있어요.
• 알람 해제를 막는 기기 관리자 권한이나 접근성 권한은 쓰지 않아요.

개인정보 처리방침: https://alarm-talk.com/privacy/
이용약관: https://alarm-talk.com/terms/
고객 지원: https://alarm-talk.com/contact/
```

### en-US (3815/4000)

```text
Wake up to a voice you love.

AlarmTalk (알람톡 · アラームトーク) wakes you with a voice.
• Free: default voices read messages like weather and fortune, and a recording plays exactly as recorded.
• Personal plan: AI speech synthesis lets a voice you register read new messages it never recorded.
• Couple and Family plans: share voices and send each other alarms (only if the receiver allows it).
No math, no shaking.

■ Free
• Repeating or one-time alarms
• Four default voices speak the app language (English, Korean or Japanese), or use an alarm sound
• Messages: Weather (the day's weather, from rain to poor air; one of 9 major Korean cities), Fortune (for fun, from gender, birth date and time), Encouragement and Meds (each ring plays the next prepared one)
• Recorded alarm: up to 30 seconds per alarm, played exactly as recorded; it can't read other text
• Turn off on holidays (incl. substitute and temporary holidays; Korea, Japan or US), snooze, voice volume

■ Personal plan
• Register one voice per account, once a month, by recording or uploading audio (12 sec to 2 min): yours, or one you have permission to use
• Wake-up, weather, fortune, encouragement and meds messages in that voice are made in advance on our servers and downloaded to your phone, tailored to who the voice is to you and what it calls you (both optional)
• Type it yourself: AI reads your text in that voice (30 new a month; free if an alarm on this phone has the same text and voice)
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

■ On Android
• Sign in with Google or email
• 17 vibration patterns and alarm sound volume per alarm; change snooze time in 1-minute steps while it rings
• Full screen when locked or in the app, a banner otherwise
• Reschedules after reboot, time or time-zone changes

■ Plans and billing
Plans are monthly auto-renewing Google Play subscriptions; prices and terms are in the app. If you cancel in Google Play, you keep access until the period ends.

■ Permissions
• Required: notifications, exact alarms, full-screen alerts, foreground service, audio settings, wake lock, vibrate, boot and network (not used to ring)
• Optional: microphone, to record (not needed for default voices or audio upload)
• No device admin or accessibility permissions

Privacy Policy: https://alarm-talk.com/en/privacy/
Terms of Service: https://alarm-talk.com/en/terms/
Support: https://alarm-talk.com/en/contact/
```

### ja-JP (2864/4000)

```text
好きな声で目覚める朝を。

アラームトーク(AlarmTalk・알람톡)は、声で起こしてくれるアラームです。
• 無料：基本の声4種類が天気・運勢などのメッセージを読み上げます。アラームごとに30秒まで録音すれば、録音したそのままの音で鳴ります。
• パーソナルプラン：自分の声や許可を得た声を登録すると、AI音声合成で、録音にない新しいメッセージもその声が読み上げます。
• カップル・ファミリープラン：声を共有し、お互いのスマホにアラームを送れます。受け取る人が許可している場合だけ届きます。
計算問題やシェイクのようなミッションはなく、聞きたい声で目を覚ませます。

■ 無料 — 基本の声と録音アラーム
• 曜日ごとの繰り返しも、1回だけのアラームも設定できます。
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
• 自分で入力：書いた文をAIがその声で読み上げます。新しく作れるのは月30回まで。同じ声・同じ文を使うアラームがこのスマホに残っていれば、回数に数えません。
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

■ Androidでは
• Googleまたはメールでログインします。
• 17種類の振動パターンとアラーム音の音量をアラームごとに選べ、鳴動画面でスヌーズ間隔を1分ずつ変えられます。
• ロック中やアプリを開いているときは全画面で、それ以外のときはバナーで鳴ります。
• 再起動・タイムゾーン変更・時刻変更のあともアラームを再設定します。

■ プランとお支払い
パーソナル・カップル・ファミリープランは毎月自動更新されるGoogle Playの定期購入です。料金と更新条件はアプリの購入画面でご確認いただけます。Google Playストアの[お支払いと定期購入]で解約すると、現在の請求期間が終わるまで使えます。

■ 権限
• 必須：通知・正確なアラーム・全画面通知(時間どおりに、ロック画面で鳴らす)、フォアグラウンドサービス(鳴動中の再生維持、声のメッセージの保存)、オーディオ設定・スリープ解除・バイブレーション、再起動後の再設定、ネットワーク(鳴る瞬間には使いません)
• 任意：マイク(録音するとき)。許可しなくても、基本の声と音声ファイルのアップロードは使えます。
• アラームの解除を妨げる端末管理者権限やユーザー補助(アクセシビリティ)権限は使用しません。

プライバシーポリシー: https://alarm-talk.com/ja/privacy/
利用規約: https://alarm-talk.com/ja/terms/
サポート: https://alarm-talk.com/ja/contact/
```

## 전체 설명 — (A) Android 30, W 뒤

(B) 와 ko 는 한 글자도 다르지 않다. en·ja 는 날씨 한 줄만 다르다 — Android 30 의 en 은 프리셋이 없고 ja 프리셋은
일본 도시라서 '국내 9개 도시'를 말하지 않는다. (B) 에서 `-` 줄을 `+` 줄로 바꾼다.

**en-US** (결과 3785/4000)

```diff
-• Messages: Weather (the day's weather, from rain to poor air; one of 9 major Korean cities), Fortune (for fun, from gender, birth date and time), Encouragement and Meds (each ring plays the next prepared one)
+• Messages: Weather (the day's weather, from rain to poor air), Fortune (for fun, from gender, birth date and time), Encouragement and Meds (each ring plays the next prepared one)
```

**ja-JP** (결과 2846/4000)

```diff
-  - 天気：その日の天気(晴れ・雨・雪・PM2.5・暑さ・寒さなど)に合わせたメッセージ。都市は韓国の主要9都市から選びます。
+  - 天気：その日の天気(晴れ・雨・雪・PM2.5・暑さ・寒さなど)に合わせたメッセージ。
```

INTERIM 이 (B) 와 다른 줄은 [`app-store-listing.md`](app-store-listing.md) 「설명 — INTERIM」 과 같다(위 INTERIM
전문에 이미 반영돼 있다).

## 결제 문단 끝에 붙일 문장 (R1 · R2)

'■ 이용권과 결제' 문단의 마지막 문장 바로 뒤에 붙인다(ko·en 은 앞에 공백 한 칸, ja 는 공백 없이).

**ko-KR** — R1 (52자)

```text
앱의 이용권 화면에서 '종료일에 해지'를 골라도 이번 결제 기간이 끝날 때까지 쓸 수 있어요.
```

R2 (101자)

```text
Google Play 정기 결제를 직접 하고 있다면 앱에서 '지금 해지'를 골라 바로 끝낼 수도 있고, 이때 남은 기간에 해당하는 금액은 Google Play를 통해 비례 환불돼요.
```

**en-US** — R1 (59자)

```text
Choosing "Cancel on the end date" in the app does the same.
```

R2 (117자)

```text
If you pay via Google Play yourself, "Cancel now" in the app ends it at once with a prorated refund from Google Play.
```

**ja-JP** — R1 (42자)

```text
アプリのプラン画面で「終了日に解約」を選んでも、現在の請求期間が終わるまで使えます。
```

R2 (100자)

```text
ご自身でGoogle Playの定期購入をしている場合は、アプリで「今すぐ解約」を選んですぐに終了することもでき、その場合は残りの期間に応じた金額がGoogle Playを通じて日割りで返金されます。
```

## 길이

| 칸 | 상한 | ko-KR | en-US | ja-JP |
|---|---|---|---|---|
| 제목 | 30 | 14 | 28 | 16 |
| 짧은 설명 — INTERIM | 80 | 54 | 78 | 53 |
| 짧은 설명 — (A)·(B) | 80 | 54 | 80 | 53 |
| 전체 설명 — INTERIM | 4000 | 2915 | 3726 | 2789 |
| 전체 설명 — INTERIM + R1 | 4000 | 2968 | 3786 | 2831 |
| 전체 설명 — INTERIM + R1 + R2 | 4000 | 3070 | 3904 | 2931 |
| 전체 설명 — (A) | 4000 | 2996 | 3785 | 2846 |
| 전체 설명 — (A) + R1 | 4000 | 3049 | 3845 | 2888 |
| 전체 설명 — (A) + R1 + R2 | 4000 | 3151 | 3963 | 2988 |
| 전체 설명 — (B) | 4000 | 2996 | 3815 | 2864 |
| 전체 설명 — (B) + R1 | 4000 | 3049 | 3875 | 2906 |
| 전체 설명 — (B) + R1 + R2 | 4000 | 3151 | 3993 | 3006 |

글자 수는 유니코드 코드 포인트 수다. 이 표는 위 문구에서 센 값이다 — 문구를 고치면 다시 센다.
