# Google Play 스토어 문구 (ko-KR · en-US · ja-JP)

Play Console 에 올리는 값의 원본이다. 콘솔을 고칠 때는 이 파일을 먼저 고치고 같은 값을 올린다. App Store 는
[`app-store-listing.md`](app-store-listing.md) 가 같은 역할을 한다. 설명 본문은 두 스토어가 같고, 끝의 'Android에서'·
결제·권한·링크 절만 Play 것이다.

- 상한: 제목 30자 · 짧은 설명 80자 · 전체 설명 4000자. 출시 노트(언어당 500자)는 [`release-notes.md`](release-notes.md).
- **스토어 문구에 줄표(`—`)를 쓰지 않는다**(2026-10-11 오너 지적 — AI 가 쓴 글처럼 읽힌다). 소제목은
  `■ 이름: 설명`(ja 는 전각 `：`), 하위 항목은 `◦` 로 쓴다. 규칙은 [`app-store-listing.md`](app-store-listing.md) 와 같다.
- Play 등록정보는 앱 버전과 무관하게 바꿀 수 있다 — App Store 와 달리 새 버전을 기다리지 않는다.
- 앱 화면 언어 지원 문장(ko·ja 「이용 안내」 마지막 줄)은 번역을 포함한 다음 Android 버전이 게재된 뒤에만 참이다.
  그래서 (B)·(C) 에만 둔다(2026-10-16 부터 Play 게시본). 이력인 INTERIM·(A) 에는 없다.

## 지금 상태 (2026-10-20)

- **게재 중: 35 (1.2.15)** — 프로덕션 `RELEASE_LIFECYCLE_STATE_PUBLISHED`(2026-10-19 Play Developer API 확인). AAB와 세 언어
  출시 노트만 제출했고, 등록정보는 유지했다.
- **게시 중인 등록정보는 (B)** 다(2026-10-16 commit — 제목·짧은 설명·전체 설명, 세 언어). (B) 는 커플·가족 이용권과 초대
  코드를 설명한다. W 는 같은 날 prod 로 확인했다 — 한국 17·일본 47·미국 69 지역 모두 공식 예보가 들어와 있다.
- **반영 필요(오너): (C) 를 올린다.** 커플·가족 이용권을 없애면서(`docs/qa/dev-test-handoff.md` 「다음 할 일」 2) 아래 (C) 를
  만들었다. 그 상품의 기본 요금제를 비활성화하는 날(2-①) 짧은 설명·전체 설명을 (C) 로 바꾼다 — 그날부터 그 상품을 살 수
  없으므로 (B) 는 없는 상품을 광고하게 된다. 올린 뒤 다시 읽어 글자 수가 아래 「길이」 와 같은지 확인하고 이 절을 고친다.
- **(D) 는 v1.3 용 원문**이다(2026-10-26 작성 — 아직 올리지 않았다). 조건은 「전체 설명 — (D)」.
- (B)·INTERIM·(A) 의 원문은 이 파일에서 뺐다 — `git show 9e4fda54:docs/product/play-store-listing.md` 에 있다.

## 판과 게시 조건

| 판 | 무엇 | 언제 올리나 |
|---|---|---|
| **(C)** | (B) 에서 커플·가족 이용권·초대 코드·목소리 공유·상대 알람을 걷어낸 판 | **다음에 올릴 판** — 커플·가족 상품을 비활성화하는 날. 다음에 바꿀 때 여기서 고친다 |
| (B) | 날씨 문장과 앱 화면 언어 문장 포함, 커플·가족 이용권 설명 포함 | 지금 게시본(2026-10-16 — W 확인 뒤 commit). 원문은 git(「지금 상태」) |
| INTERIM | 날씨 주장과 앱 화면 언어 문장이 없는 판 | 이력(10/11~10/16 게시본). 다시 올리지 않는다 |
| (A) | Android 30(1.2.10) 기준, 날씨 문장 포함, 앱 화면 언어 문장 없음 | 이력(올린 적 없음). Android 30 은 게재본이 아니다 |
| (D) | (C) 에 무료 직접 입력 3회·플러스 30회·이용권 종료 뒤 미나·스토어 무료 체험을 더한 판 | v1.3 Android 가 프로덕션에 게재된 뒤(「전체 설명 — (D)」). 아직 올리지 않았다 |
| + R1 · R2 | 결제 문단 끝에 붙이는 앱 해지·환불 문장 | 각각 E1 · E2 를 관찰한 뒤, 그때 게재 중인 판에 붙인다 |

제목은 모든 판이 같다. 이 파일에는 (C) 의 짧은 설명·전체 설명만 둔다(지난 판은 git).

- **W — 날씨 문장.** 조건과 확인 방법은 [`app-store-listing.md`](app-store-listing.md) 「게시 조건」 W 와 같다 —
  날씨 지역 서버 변경이 prod 에 배포되고 확인되기 전에는 날씨가 맞는다고 말하지 않는다. 제품 판단으로 앞당기지
  않는다(Play 메타데이터 정책: 메타데이터는 앱 기능을 정확히 반영해야 한다).
  - (A) 는 **Android 30 사용자가 실제로 고르는 값**으로 확인한다: ko 는 국내 9개 프리셋, en 은 직접 입력(프리셋
    없음), ja 는 일본 도시 프리셋 8개(`東京` 등 — 나라 값은 `大韓民国` 으로 보낸다). 2026-09-30 로컬 실행에서
    ja `東京` 프리셋은 해석에 실패했고, en 직접 입력은 입력 형식에 따라 다른 지점이 골라졌다(`New York` → 영국
    요크). 확인되지 않은 언어는 INTERIM 을 유지한다.
  - (B)·(C) 는 앱이 지금 주는 **나라 → 지역 목록 전부**(대한민국 17·일본 47·미국 69, `@alarmtalk/shared` 의 `WeatherRegions`)로
    확인한다 — prod `weather_region_daily_official` 에 모든 지역의 다가오는 날짜 예보가 있는지 본다(2026-10-16 확인).
    목록이 늘면 그 지역까지 본다. (옛 판은 국내 9개 프리셋으로 확인했다 — 1.2.11 전의 지역 고르기다.)
- **R1 · R2 — 앱 해지·환불 문장.** 앱 안 해지는 코드로만 확인했고 운영에서 실행해 본 적이 없다. Google Play 로
  직접 결제한 구독은 Play `cancel` 이 성공한 뒤에만 '종료일에 해지' 를, `revoke`(비례 환불)가 성공한 뒤에만
  '지금 해지' 를 반영하고, 실패하면 502 로 Play 에서 해지하라고 안내한다. App Store 결제는 앱에서 해지할 수 없다.
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

| 언어 | 제목 | 짧은 설명 — (C)(다음에 올릴 판) |
|---|---|---|
| ko-KR | `알람톡: 목소리 알람 시계` (14/30) | 좋아하는 목소리로 깨는 아침. 녹음 그대로 울리는 알람, 날씨·운세 문구, 등록한 목소리로 읽는 새 문장까지. (61/80) |
| en-US | `AlarmTalk: Voice Alarm Clock` (28/30) | Wake to a loved voice: recorded alarms, weather & fortune, a voice you register. (80/80) |
| ja-JP | `アラームトーク：声の目覚まし時計` (16/30) | 好きな声で目覚める朝。録音そのままのアラーム、天気・運勢メッセージ、登録した声で読む新しい文まで。 (49/80) |

## 전체 설명 — (C) (다음에 올릴 판)

(B) 에서 커플·가족 이용권 소개 줄과 「커플·가족 이용권」 절을 빼고, 공유를 말하던 줄(개인정보·인터넷·결제)을 고쳤다.
나머지는 (B) 와 한 글자도 다르지 않다.

### ko-KR (2435/4000)

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

■ Android에서
• Google 또는 이메일로 로그인해요.
• 진동 패턴 17가지와 알람음 크기를 알람마다 고르고, 울리는 화면에서 다시 울림 간격을 1분씩 바꿀 수 있어요.
• 잠겨 있거나 앱을 보고 있으면 전체 화면으로, 다른 화면을 쓰는 중이면 배너로 울려요.
• 재부팅·시간대 변경·시각 변경 뒤에도 알람을 다시 예약해요.

■ 이용권과 결제
플러스는 매월 자동 갱신되는 Google Play 정기 결제예요. 가격과 갱신 조건은 앱의 구매 화면에서 확인할 수 있어요. Google Play 스토어의 [결제 및 정기 결제]에서 해지하면 이번 결제 기간이 끝날 때까지 쓸 수 있어요.

■ 권한
• 필수: 알림·정확한 알람·전체 화면 알림(제시간에, 잠금 화면에서 울리기), 포그라운드 서비스(울리는 동안 소리 유지, 목소리 문구 받기), 오디오 설정·절전 해제·진동, 재부팅 뒤 재예약, 네트워크(울리는 순간에는 쓰지 않음)
• 선택: 마이크(녹음할 때). 허용하지 않아도 기본 목소리와 음성 파일 업로드는 쓸 수 있어요.
• 알람 해제를 막는 기기 관리자 권한이나 접근성 권한은 쓰지 않아요.

개인정보 처리방침: https://alarm-talk.com/privacy/
이용약관: https://alarm-talk.com/terms/
고객 지원: https://alarm-talk.com/contact/
```

### en-US (3205/4000)

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

■ On Android
• Sign in with Google or email
• 17 vibration patterns and alarm sound volume per alarm; change snooze time in 1-minute steps while it rings
• Full screen when locked or in the app, a banner otherwise
• Reschedules after reboot, time or time-zone changes

■ Plans and billing
Plus is a monthly auto-renewing Google Play subscription; the price and terms are in the app. If you cancel in Google Play, you keep access until the period ends.

■ Permissions
• Required: notifications, exact alarms, full-screen alerts, foreground service, audio settings, wake lock, vibrate, boot and network (not used to ring)
• Optional: microphone, to record (not needed for default voices or audio upload)
• No device admin or accessibility permissions

Privacy Policy: https://alarm-talk.com/en/privacy/
Terms of Service: https://alarm-talk.com/en/terms/
Support: https://alarm-talk.com/en/contact/
```

### ja-JP (2307/4000)

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

■ Androidでは
• Googleまたはメールでログインします。
• 17種類の振動パターンとアラーム音の音量をアラームごとに選べ、鳴動画面でスヌーズ間隔を1分ずつ変えられます。
• ロック中やアプリを開いているときは全画面で、それ以外のときはバナーで鳴ります。
• 再起動・タイムゾーン変更・時刻変更のあともアラームを再設定します。

■ プランとお支払い
プラスは毎月自動更新されるGoogle Playの定期購入です。料金と更新条件はアプリの購入画面でご確認いただけます。Google Playストアの[お支払いと定期購入]で解約すると、現在の請求期間が終わるまで使えます。

■ 権限
• 必須：通知・正確なアラーム・全画面通知(時間どおりに、ロック画面で鳴らす)、フォアグラウンドサービス(鳴動中の再生維持、声のメッセージの保存)、オーディオ設定・スリープ解除・バイブレーション、再起動後の再設定、ネットワーク(鳴る瞬間には使いません)
• 任意：マイク(録音するとき)。許可しなくても、基本の声と音声ファイルのアップロードは使えます。
• アラームの解除を妨げる端末管理者権限やユーザー補助(アクセシビリティ)権限は使用しません。

プライバシーポリシー: https://alarm-talk.com/ja/privacy/
利用規約: https://alarm-talk.com/ja/terms/
サポート: https://alarm-talk.com/ja/contact/
```

## 전체 설명 — (D) v1.3 (무료 직접 입력 · 스토어 무료 체험)

**다음에 쓸 원문이다 — 아직 Play Console 에 올리지 않았다**(2026-10-26 작성). (C) 에서 바꾼 자리는
[`app-store-listing.md`](app-store-listing.md) 「설명 — (D)」 와 같은 다섯 군데이고(무료 직접 입력 · 플러스 직접 입력 ·
이용권 종료 뒤 미나 · 횟수 규칙 · 결제 문단의 무료 체험), 나머지는 (C) 와 같다. 짧은 설명은 (C) 그대로 둔다.

- **언제 올리나**: Play 등록정보는 버전과 무관하게 바뀌어 **모든 설치 사용자**가 본다. 그래서 무료 직접 입력 3회를 열고
  결제 카드에 체험 조건을 그리는 v1.3 Android 빌드가 프로덕션에 **게재된 뒤**에 올린다 — 옛 빌드는 무료의 직접 입력을 잠근 채
  보이고, 결제할 때는 이미 체험 오퍼(첫 페이즈가 가장 싼 오퍼)를 고르지만 카드가 체험 조건을 말하지 않는다(카드 문구
  `freeTrialPeriodForPlan` 은 v1.3 에 들어왔다, `docs/spec/plan-gates.md`). 서버 변경(#942)이 prod 에 있는지도 먼저 본다.
- 체험 오퍼 `free-trial-1m` 이 그날 활성인지 본다(`plan-gates.md` 「신규 1개월 무료」). 내렸으면 결제 문단을 (C) 것으로 쓴다.
- 광고 보상은 넣지 않는다(운영 전 — `docs/spec/ad-rewards.md` §6 「공개 문구」).
- R1·R2 는 (D) 결제 문단 끝에도 같은 자리에 붙인다(아래 절).
- Play 정책 메모: 정기 결제 정책은 무료 체험의 기간·체험 뒤 청구 금액·해지 방법을 결제 전에 분명히 알리라고 한다 — 앱의 결제
  카드가 그 말을 하고, 설명은 그와 어긋나지 않게만 쓴다(금액은 나라마다 달라 적지 않는다).

### ko-KR (2647/4000)

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
• 직접 입력 횟수는 한국 시간 매월 1일에 다시 채워지고, 이미 만든 같은 음성을 다시 쓰면 줄지 않아요.
• 앱 화면은 한국어·영어·일본어를 지원해요.

■ Android에서
• Google 또는 이메일로 로그인해요.
• 진동 패턴 17가지와 알람음 크기를 알람마다 고르고, 울리는 화면에서 다시 울림 간격을 1분씩 바꿀 수 있어요.
• 잠겨 있거나 앱을 보고 있으면 전체 화면으로, 다른 화면을 쓰는 중이면 배너로 울려요.
• 재부팅·시간대 변경·시각 변경 뒤에도 알람을 다시 예약해요.

■ 이용권과 결제
플러스는 매월 자동 갱신되는 Google Play 정기 결제예요. 처음 구독하면 1개월 무료 체험이 적용될 수 있고(대상은 Google Play가 정해요), 체험이 끝나면 자동으로 결제돼요. 가격과 갱신 조건은 앱의 구매 화면에서 확인할 수 있어요. Google Play 스토어의 [결제 및 정기 결제]에서 해지하면 이번 결제 기간(무료 체험 포함)이 끝날 때까지 쓸 수 있고, 체험 중에 해지하면 결제되지 않아요.

■ 권한
• 필수: 알림·정확한 알람·전체 화면 알림(제시간에, 잠금 화면에서 울리기), 포그라운드 서비스(울리는 동안 소리 유지, 목소리 문구 받기), 오디오 설정·절전 해제·진동, 재부팅 뒤 재예약, 네트워크(울리는 순간에는 쓰지 않음)
• 선택: 마이크(녹음할 때). 허용하지 않아도 기본 목소리와 음성 파일 업로드는 쓸 수 있어요.
• 알람 해제를 막는 기기 관리자 권한이나 접근성 권한은 쓰지 않아요.

개인정보 처리방침: https://alarm-talk.com/privacy/
이용약관: https://alarm-talk.com/terms/
고객 지원: https://alarm-talk.com/contact/
```

### en-US (3635/4000)

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
• Typed-message counts refill on the 1st of each month (Korea time); reusing audio you already made doesn't count

■ On Android
• Sign in with Google or email
• 17 vibration patterns and alarm sound volume per alarm; change snooze time in 1-minute steps while it rings
• Full screen when locked or in the app, a banner otherwise
• Reschedules after reboot, time or time-zone changes

■ Plans and billing
Plus is a monthly auto-renewing Google Play subscription; the price and terms are in the app. First-time subscribers may get a 1-month free trial (Google Play decides who qualifies), and it is charged automatically when the trial ends. If you cancel in Google Play, you keep access until the period ends (including a free trial), and cancelling during the trial means no charge.

■ Permissions
• Required: notifications, exact alarms, full-screen alerts, foreground service, audio settings, wake lock, vibrate, boot and network (not used to ring)
• Optional: microphone, to record (not needed for default voices or audio upload)
• No device admin or accessibility permissions

Privacy Policy: https://alarm-talk.com/en/privacy/
Terms of Service: https://alarm-talk.com/en/terms/
Support: https://alarm-talk.com/en/contact/
```

### ja-JP (2510/4000)

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
• 自分で入力の回数は韓国時間の毎月1日にまた使えるようになり、すでに作った同じ音声をもう一度使っても減りません。
• アプリは日本語・韓国語・英語に対応しています。

■ Androidでは
• Googleまたはメールでログインします。
• 17種類の振動パターンとアラーム音の音量をアラームごとに選べ、鳴動画面でスヌーズ間隔を1分ずつ変えられます。
• ロック中やアプリを開いているときは全画面で、それ以外のときはバナーで鳴ります。
• 再起動・タイムゾーン変更・時刻変更のあともアラームを再設定します。

■ プランとお支払い
プラスは毎月自動更新されるGoogle Playの定期購入です。はじめて購読する方には1か月の無料体験が適用されることがあり(対象はGoogle Playが決めます)、体験が終わると自動で請求されます。料金と更新条件はアプリの購入画面でご確認いただけます。Google Playストアの[お支払いと定期購入]で解約すると、現在の請求期間(無料体験を含む)が終わるまで使え、体験中に解約すれば請求されません。

■ 権限
• 必須：通知・正確なアラーム・全画面通知(時間どおりに、ロック画面で鳴らす)、フォアグラウンドサービス(鳴動中の再生維持、声のメッセージの保存)、オーディオ設定・スリープ解除・バイブレーション、再起動後の再設定、ネットワーク(鳴る瞬間には使いません)
• 任意：マイク(録音するとき)。許可しなくても、基本の声と音声ファイルのアップロードは使えます。
• アラームの解除を妨げる端末管理者権限やユーザー補助(アクセシビリティ)権限は使用しません。

プライバシーポリシー: https://alarm-talk.com/ja/privacy/
利用規約: https://alarm-talk.com/ja/terms/
サポート: https://alarm-talk.com/ja/contact/
```

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
| 짧은 설명 — (C) | 80 | 61 | 80 | 49 |
| 전체 설명 — (C) | 4000 | 2435 | 3205 | 2307 |
| 전체 설명 — (C) + R1 | 4000 | 2488 | 3265 | 2349 |
| 전체 설명 — (C) + R1 + R2 | 4000 | 2590 | 3383 | 2449 |
| 전체 설명 — (D) | 4000 | 2647 | 3635 | 2510 |
| 전체 설명 — (D) + R1 + R2 | 4000 | 2802 | 3813 | 2652 |

글자 수는 유니코드 코드 포인트 수다. 이 표는 위 문구에서 센 값이다 — 문구를 고치면 다시 센다.
(2026-10-26: (C) 의 전체 설명 글자 수가 이용권 이름을 '플러스' 로 바꾸기 전 값으로 남아 있어 다시 셌다. 줄바꿈은 1자로 센다.
R1·R2 는 앞의 공백 한 칸을 포함한 값으로 더했다.)
