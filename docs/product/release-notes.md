# 출시 노트 (Play 스토어 · App Store)

Play Console 의 "이 출시의 새로운 기능" 과 App Store Connect 의 "이 버전의 새로운 기능" 에
그대로 붙여 넣는 원문. **세 언어(ko/en/ja)를 항상 함께 쓴다** — App Store 도 en-US·ja 현지화가
있다([`app-store-listing.md`](app-store-listing.md)). 지원 언어는 앱의 `resourceConfigurations`(ko/en/ja)와 같다.

상한은 스토어마다 다르다 — **Play 는 언어당 500자**, App Store Connect 의 '이 버전의 새로운 기능' 은 **4000자**다.
⚠ 1.2.12 까지는 App Store 칸도 500자라고 잘못 알고 App Store 문안을 줄이거나 줄을 뺐다(1.2.11·1.2.12 절의 '영어 500자'
설명). 그 절들은 이력이라 그대로 두고, 1.2.13 부터는 App Store 문안을 500자에 맞춰 줄이지 않는다.

길이는 눈대중하지 말고 재고, Play 문안은 **줄바꿈이 CRLF 로 세어질 여지까지 감안해 여유를 남긴다**
(영어는 한 줄이 길어 금방 490자를 넘긴다):

```bash
node -e "const m=require('fs').readFileSync('docs/product/release-notes.md','utf8').replace(/\r\n/g,'\n'); for(const[,l,t]of m.matchAll(/### (ko-KR|en-US|ja-JP)\n\n\`\`\`\n([\s\S]*?)\n\`\`\`/g)){const n=[...t].length; console.log(l,n,'(CRLF',n+t.split('\n').length-1+')')}"
```

`.replace(/\r\n/g,'\n')` 를 빼면 이 레포에서는 **조용히 0건**이 나온다(체크아웃이 CRLF).

쓰는 규칙:
- **사용자가 눈으로 확인할 수 있는 변화만** 적는다. 백엔드 리팩터·CI·마이그레이션은 안 적는다.
- 적기 전에 **코드에서 사실을 확인**한다. 여기 적힌 수치·화면 이름은 실제 문자열 리소스와
  맞춰 둔 것이다(예: 더보기/More/その他 = `r3app_bottom_tab_menu`).

---

## 1.2.14 (versionCode 34 / iOS 빌드 12)

탈퇴 유예 화면 폐지(#904·#905). 탈퇴를 신청하면 모든 기기에서 로그아웃되고, 30일 안에 다시 로그인하면 서버가 탈퇴를
철회한다(`docs/spec/session-and-auth.md` 「탈퇴 유예 — 다시 로그인하면 철회」). iOS 는 첫 화면(랜딩)이 iOS 27 일부 기기에서
닫히던 것도 고쳤다(#901, Sentry ALARMTALK-IOS-4). 서버 쪽 고침(날씨 원천 물러서기 등)은 모든 버전에 가므로 적지 않는다.

- 법무 문서 **버전 6**을 싣는다(탈퇴 철회 방법, 결제 기록의 '쿠폰' 문구, '다시 구독'). 서버는 개정 동안 5·6 을 모두
  받아(`ACCEPTED_POLICY_VERSIONS`) 두 스토어의 게재 시점이 달라도 가입·동의가 막히지 않는다. 처리방침 개정은 출시 노트에
  적지 않는다(앱 안 변화가 아니다).

### Play (Android 34)

### ko-KR

```
• 회원 탈퇴를 신청하면 모든 기기에서 로그아웃됩니다.
• 탈퇴를 신청한 뒤 30일 안에 다시 로그인하면 탈퇴가 취소됩니다.
```

### en-US

```
• Requesting account deletion now signs you out on all devices.
• Signing in again within 30 days of the request cancels the deletion.
```

### ja-JP

```
• 退会を申請すると、すべての端末からログアウトします。
• 申請から30日以内にもう一度ログインすると、退会は取り消されます。
```

### App Store (iOS 빌드 12)

#### ko

```
• 회원 탈퇴를 신청하면 모든 기기에서 로그아웃됩니다.
• 탈퇴를 신청한 뒤 30일 안에 다시 로그인하면 탈퇴가 취소됩니다.
• 일부 기기에서 첫 화면을 열 때 앱이 닫히던 문제를 고쳤습니다.
```

#### en-US

```
• Requesting account deletion now signs you out on all devices.
• Signing in again within 30 days of the request cancels the deletion.
• Fixed the app closing on the first screen on some devices.
```

#### ja

```
• 退会を申請すると、すべての端末からログアウトします。
• 申請から30日以内にもう一度ログインすると、退会は取り消されます。
• 一部の端末で最初の画面を開くとアプリが終了する問題を修正しました。
```

---

## 1.2.13 (versionCode 33 / iOS 빌드 10)

선물 코드 폐지. iOS 1.2.12(빌드 9)가 App Store 심사 지침 3.1.1 로 다시 반려돼(2026-10-12 — 이번 사유는 선물 코드) 고친
판이다. 개인 이용권 선물(1회성 상품 결제 → GIFT- 코드)을 서버·두 앱에서 지웠고, 유료 게이트의 코드 입력도 없앴다
(`docs/spec/plan-gates.md` 「선물 코드 — 폐지」). 버전 계획과 순서는 핸드오프 정리 전 판 `git show e493e8c3:docs/qa/dev-test-handoff.md` 의 2026-10-14 절.

- **Play**: 아래 한 줄만 낸다. 31(1.2.11)·32(1.2.12) 어느 쪽에서 올라와도 맞는 문장이다 — 1.2.12 의 Play 줄("선물 코드와
  초대 코드만 받습니다")은 이제 틀린 말이라 다시 쓰지 않는다.
- **App Store**: 1.2.11·1.2.12 는 게재된 적이 없다 — iOS 사용자는 1.2.10 에서 곧바로 1.2.13 으로 온다. 그래서 App Store
  레코드에 실려 있는 1.2.11 문안(아래 1.2.11 의 뒤 세 블록)을 **한 글자도 바꾸지 않고** 쓰고, 끝에 같은 선물 줄 하나만
  더한다. App Store 칸은 4000자라 줄일 까닭이 없다(이 절의 첫 판은 500자로 잘못 알고 영어 두 줄을 줄였었다).
- 선물 줄은 기능을 **없앴다고만** 말한다. 코드 칸·코드 등록 이야기는 어느 블록에도 쓰지 않는다 — 심사가 문제 삼은 것이
  코드로 여는 길이라 스토어 문구는 그쪽을 가리키지 않는다(`plan-gates.md` 같은 절의 규칙). 초대 코드는 스토어 설명의
  커플·가족 줄에서 "한 사람이 구독하고 초대 코드로 그 이용권에 들인다" 로만 말한다.

### Play (Android 33)

길이 ko 30 · en 47 · ja 25.

### ko-KR

```
• 개인 이용권 선물하기를 더 이상 제공하지 않습니다.
```

### en-US

```
• Gifting a Personal plan is no longer offered.
```

### ja-JP

```
• パーソナルプランのギフトは提供を終了しました。
```

### App Store (iOS 1.2.13 빌드 10)

길이 ko 403 · en 542 · ja 364(CRLF 로 세면 409 · 548 · 370) — 1.2.11 App Store 블록(372 · 494 · 338)에 한 줄을 더한 값이다.
App Store 칸의 상한은 4000자다(맨 위).

### ko-KR

```
• 목소리를 등록할 때 '톤 조절'로 목소리 높이를 맞출 수 있습니다. '원본 듣기'와 '현재 톤 듣기'로 비교하며 고릅니다.
• 쓰던 목소리를 더 쓸 수 없게 된 알람(이용권 종료·목소리 삭제·공유 해제)은 이제 알람음이 아니라 기본 목소리 '미나'로 울립니다.
• 목소리 등록의 '목소리 느낌' 선택을 없앴습니다. 알람 문구는 등록한 녹음의 말투를 따릅니다.
• 날씨 지역 목록이 대한민국·일본·미국의 지역으로 넓어졌고, 직접 입력은 없어졌습니다.
• 영어·일본어 화면에 한국어로 남아 있던 곳을 번역했습니다.
• 이메일 인증 코드가 거절되거나, 이번 달 목소리 등록을 이미 마쳤거나, 녹음에 말소리가 거의 없어 등록할 수 없을 때 그 이유를 바로 알려 줍니다.
• 개인 이용권 선물하기를 더 이상 제공하지 않습니다.
```

### en-US

```
• New Tone slider for voice registration: compare "Play original" and "Play current tone".
• Alarms whose voice becomes unavailable now ring in the default voice Mina, not an alarm sound.
• Voice feel is gone; messages follow your recording's style.
• Weather regions now cover South Korea, Japan and the US; manual entry is gone.
• Translated leftover Korean text.
• Clearer messages when a verification code is refused, the monthly voice limit is reached, or a recording has almost no speech.
• Gifting a Personal plan is no longer offered.
```

### ja-JP

```
• 声を登録するときに「トーン調整」で声の高さを合わせられます。「元の声を聞く」と「今のトーンで聞く」で聞き比べて選びます。
• 使っていた声が使えなくなったアラーム(利用券の終了・声の削除・共有の解除)は、アラーム音ではなく基本の声「ミナ」で鳴るようになりました。
• 声の登録時の「声の雰囲気」の選択をなくしました。アラーム文言は登録した録音の話し方に合わせます。
• 天気の地域リストが韓国・日本・アメリカの地域に広がり、直接入力はなくなりました。
• 英語・日本語の画面で韓国語のまま残っていた箇所を翻訳しました。
• 認証コードが受け付けられなかったとき、今月の声の登録が済んでいるとき、録音に話し声がほとんどなく登録できないときに、その理由をすぐにお知らせします。
• パーソナルプランのギフトは提供を終了しました。
```

---

## 1.2.12 (versionCode 32 / iOS 빌드 9)

프로모 코드 폐지. iOS 1.2.11(빌드 8)이 App Store 심사 지침 3.1.1 로 반려돼(2026-10-12) 고친 판이다. 코드 칸은
선물·초대 코드만 받는다(`docs/spec/plan-gates.md` 「프로모 코드 — 폐지」). 버전을 두 앱 모두 1.2.12 로 올린 이유는
핸드오프 정리 전 판 `git show e493e8c3:docs/qa/dev-test-handoff.md` 의 2026-10-12 절.

- **App Store**: 1.2.11 은 게재된 적이 없다 — iOS 사용자는 1.2.10 에서 곧바로 1.2.12 로 온다. 그래서 아래 1.2.11 의
  App Store 문안(뒤 세 블록)을 **그대로** 쓴다. 코드 칸 문구 변화는 적지 않는다(영어 500자에 자리가 없다).
- **Play**: 1.2.11 이 게재돼 있다. 아래 한 줄만 낸다.
- ⚠ **(2026-10-14 덧붙임)** iOS 1.2.12 도 같은 지침 3.1.1 로 반려됐다 — 이번 사유는 선물 코드다. 그래서 위 '선물·초대 코드만
  받는다' 는 1.2.13 에서 틀린 말이 됐다(선물 코드 폐지 — 위 1.2.13 절). 이 절의 문안은 다시 쓰지 않는다.

### Play (Android 32)

### ko-KR

```
• 코드 등록 칸은 이제 선물 코드와 초대 코드만 받습니다.
```

### en-US

```
• The code field now accepts gift and invite codes only.
```

### ja-JP

```
• コード登録欄はギフトコードと招待コードのみ受け付けるようになりました。
```

---

## 1.2.11 (versionCode 31 / iOS 빌드 8)

#870·#871·#872(톤 조절) · #820·#828(못 쓰게 된 목소리 → 미나) · #817('목소리 느낌' 제거) · #837(날씨 지역 목록) ·
#836(iOS 잠금 화면·Live Activity 번역)·#848~#858·#866·#868(영어·일본어 화면) · #821(＋ 멈춤) ·
#876(Sentry 후속 — Android 15 크래시·인증 코드·월 등록 한도·말소리 없는 녹음 거절). 릴리스 PR #874, 버전 올림 #875.
마이그레이션 #123~#128.

제출: 2026-10-11 — 두 앱 모두 아래 초안 그대로 심사에 냈다. App Store 1.2.11 빌드 8 은 08:22Z 제출(`WAITING_FOR_REVIEW`,
수동 출시), Play `31 (1.2.11)` 은 08:45Z 프로덕션 commit(`IN_REVIEW`, 관리형 게시). 승인 뒤 대기시켰다가, 서버 머지
#874 의 prod 배포가 초록이 되면 곧바로 출시한다.
톤 조절로 고른 값은 서버가 먼저 나가 있어야 알람 소리에 실린다 — 그래서 서버 머지 뒤에 출시한다.

**두 스토어의 문안이 미나 줄과 고친 문제 줄이 다르다.** 1.2.10 안드로이드는 알람음 스위치가 꺼져 있으면 그 알람이
소리 없이 울릴 수 있었고(#820), 그 사실은 Play 문안에만 적는다 — iOS 에는 그 무음 경로가 없다. ＋ 멈춤(#821)과
Android 15 크래시(WorkManager 2.10)도 안드로이드에만 있던 문제라 Play 에만 적는다. 인증 코드·월 등록 한도·말소리 없는
녹음 안내는 두 앱 모두 고쳤다. 나머지 네 항목은 두 앱에 똑같이 들어갔다. 아래 첫 세 블록이 Play, 뒤 세 블록이 App Store 용이다.
영어는 500자에 맞추려고 두 스토어 모두 미나 줄의 괄호(이용권 종료·삭제·공유 해제)와 번역 줄의 언어 이름을 뺐다.

일부러 적지 않은 것:
- 음량(+4 dB, #873)과 새 합성 모델(#840) — 1.2.10 사용자가 듣던 소리(v3)보다 커졌다고 할 수 없다. v4 Turbo 가
  중앙 −4.1 dB 작게 나오고, +4 dB 는 그 차이를 메우는 값이다.
- 날씨가 "더 정확해졌다" — 스토어 등록정보의 날씨 주장이 보류 중이다. 지역 목록이 넓어진 것만 적었다.
- 편집기 수정(#819)·'삭제된 목소리' 배너 제거(#826)·이용권 카드 문구(#816·#835) — 영어 500자에 자리가 없다.

### Play (Android 31)

길이 ko 485 · en 488 · ja 439(CRLF 로 세면 491 · 493 · 445). 영어가 빠듯하다 — 줄을 더하지 말 것.

### ko-KR

```
• 목소리를 등록할 때 '톤 조절'로 목소리 높이를 맞출 수 있습니다. '원본 듣기'와 '현재 톤 듣기'로 비교하며 고릅니다.
• 쓰던 목소리를 더 쓸 수 없게 된 알람(이용권 종료·목소리 삭제·공유 해제)은 이제 기본 목소리 '미나'로 울립니다. 전에는 알람음으로 바뀌었고, 알람음을 꺼 둔 알람은 소리 없이 울릴 수 있었습니다.
• 목소리 등록의 '목소리 느낌' 선택을 없앴습니다. 알람 문구는 등록한 녹음의 말투를 따릅니다.
• 날씨 지역 목록이 대한민국·일본·미국의 지역으로 넓어졌고, 직접 입력은 없어졌습니다.
• 영어·일본어 화면에 한국어로 남아 있던 곳을 번역했습니다.
• 알람 추가(＋)를 누르면 몇 초씩 멈추던 문제와 기본 목소리를 받는 중 앱이 꺼지던 문제(Android 15 이상)를 고쳤습니다.
• 이메일 인증 코드가 거절되거나, 이번 달 목소리 등록을 이미 마쳤거나, 녹음에 말소리가 거의 없어 등록할 수 없을 때 그 이유를 바로 알려 줍니다.
```

### en-US

```
• New Tone slider for voice registration: compare "Play original" and "Play current tone".
• Alarms that lose their voice now ring in the default voice Mina instead of a possibly silent alarm sound.
• Voice feel is gone; messages follow your recording's style.
• Weather regions now cover South Korea, Japan and the US; manual entry is gone.
• Translated leftover Korean text.
• Fixed a freeze on +, an Android 15+ crash, and unclear verification, voice-limit and silent-recording errors.
```

### ja-JP

```
• 声を登録するときに「トーン調整」で声の高さを合わせられます。「元の声を聞く」と「今のトーンで聞く」で聞き比べて選びます。
• 使っていた声が使えなくなったアラーム(利用券の終了・声の削除・共有の解除)は、基本の声「ミナ」で鳴るようになりました。以前はアラーム音に切り替わり、アラーム音をオフにしていると無音で鳴ることがありました。
• 声の登録時の「声の雰囲気」の選択をなくしました。アラーム文言は登録した録音の話し方に合わせます。
• 天気の地域リストが韓国・日本・アメリカの地域に広がり、直接入力はなくなりました。
• 英語・日本語の画面で韓国語のまま残っていた箇所を翻訳しました。
• アラームの追加(＋)を押すと数秒止まる問題と、基本の声の受信中にアプリが終了する問題(Android 15以降)を修正しました。
• 認証コードが受け付けられなかったとき、今月の声の登録が済んでいるとき、録音に話し声がほとんどなく登録できないときに、その理由をすぐにお知らせします。
```

### App Store (iOS 1.2.11 빌드 8)

길이 ko 372 · en 494 · ja 338(CRLF 로 세면 377 · 499 · 343).

### ko-KR

```
• 목소리를 등록할 때 '톤 조절'로 목소리 높이를 맞출 수 있습니다. '원본 듣기'와 '현재 톤 듣기'로 비교하며 고릅니다.
• 쓰던 목소리를 더 쓸 수 없게 된 알람(이용권 종료·목소리 삭제·공유 해제)은 이제 알람음이 아니라 기본 목소리 '미나'로 울립니다.
• 목소리 등록의 '목소리 느낌' 선택을 없앴습니다. 알람 문구는 등록한 녹음의 말투를 따릅니다.
• 날씨 지역 목록이 대한민국·일본·미국의 지역으로 넓어졌고, 직접 입력은 없어졌습니다.
• 영어·일본어 화면에 한국어로 남아 있던 곳을 번역했습니다.
• 이메일 인증 코드가 거절되거나, 이번 달 목소리 등록을 이미 마쳤거나, 녹음에 말소리가 거의 없어 등록할 수 없을 때 그 이유를 바로 알려 줍니다.
```

### en-US

```
• New Tone slider for voice registration: compare "Play original" and "Play current tone".
• Alarms whose voice becomes unavailable now ring in the default voice Mina, not an alarm sound.
• Voice feel is gone; messages follow your recording's style.
• Weather regions now cover South Korea, Japan and the US; manual entry is gone.
• Translated leftover Korean text.
• Clearer messages when a verification code is refused, the monthly voice limit is reached, or a recording has almost no speech.
```

### ja-JP

```
• 声を登録するときに「トーン調整」で声の高さを合わせられます。「元の声を聞く」と「今のトーンで聞く」で聞き比べて選びます。
• 使っていた声が使えなくなったアラーム(利用券の終了・声の削除・共有の解除)は、アラーム音ではなく基本の声「ミナ」で鳴るようになりました。
• 声の登録時の「声の雰囲気」の選択をなくしました。アラーム文言は登録した録音の話し方に合わせます。
• 天気の地域リストが韓国・日本・アメリカの地域に広がり、直接入力はなくなりました。
• 英語・日本語の画面で韓国語のまま残っていた箇所を翻訳しました。
• 認証コードが受け付けられなかったとき、今月の声の登録が済んでいるとき、録音に話し声がほとんどなく登録できないときに、その理由をすぐにお知らせします。
```

## 1.2.10 (versionCode 30 / iOS 빌드 7)

#801·#802·#803(+#795~#800). 마이그레이션 #121(웰컴 그룹 코드 끄기)·#122(`voice_profiles.voice_energy`).

제출: Play `30 (1.2.10)` 2026-09-27 프로덕션 commit(심사 중), App Store 1.2.10 빌드 7 2026-09-27T15:04Z
심사 제출. 두 스토어 모두 아래 세 블록을 그대로 넣었다(길이 ko 240 · en 441 · ja 218).

**두 스토어의 문안이 같다** — 이번 회차의 사용자 변화는 두 앱에 똑같이 들어갔다. 기간 한정 개인
플랜 줄은 서버 스위치(`PERSONAL_PROMO_STARTS_AT`)가 켜져 있을 때만 보이므로 "무료로 쓸 수 있을 때"
로 조건을 적는다(스위치는 iOS 1.2.10 게재 뒤에 켠다 — `billing-lifecycle.md` 「운영」).

### ko-KR

```
• 목소리를 등록할 때 '목소리 느낌'(자동·경쾌·차분)을 고를 수 있습니다. 알람 문구의 말투와 톤을 그 느낌에 맞춥니다.
• 등록한 목소리로 만드는 알람 문구가 사람이 말하듯 더 자연스러워졌습니다.
• 기간 한정으로 개인 플랜을 무료로 쓸 수 있을 때, 이용권 화면에 이용 기간을 보여 주고 끝나기 1주 전부터 알려 드립니다.
• 처음 실행할 때 뜨던 코드 안내 창을 없앴습니다. 코드는 더보기에서 그대로 등록할 수 있습니다.
```

### en-US

```
• When registering a voice, you can now choose its Voice feel (Auto, Lively, Calm). Alarm lines match that feel in wording and tone.
• Alarm lines made with your registered voice now sound more natural, like a person talking.
• When the Personal plan is free for a limited time, the plan screen shows how long it lasts, with a reminder a week before it ends.
• Removed the code prompt on first launch. You can still register codes from More.
```

### ja-JP

```
• 声を登録するときに「声の雰囲気」(自動・明るい・落ち着いた)を選べるようになりました。アラーム文言の話し方とトーンをその雰囲気に合わせます。
• 登録した声で作るアラーム文言が、人が話すようにより自然になりました。
• パーソナルプランを期間限定で無料で使えるとき、プラン画面に利用期間を表示し、終了の1週間前からお知らせします。
• 初回起動時に表示されていたコード案内を削除しました。コードは「その他」から引き続き登録できます。
```

## 1.2.9 (versionCode 29 / iOS 빌드 6)

#788(+#790·#791). 마이그레이션은 없다.

**두 스토어의 문안이 다르다.** 이 회차의 수정은 플랫폼마다 걸친 자리가 달라서다 — 잠금 화면
울림 화면과 '알람이 없어요' 는 안드로이드 전용이고(iOS 는 울림 화면을 AlarmKit 이 그린다),
백그라운드 사이클 복구와 매니페스트 경합은 iOS 전용이다. 날씨 두 건만 공통이다.
아래 첫 세 블록이 Play, 뒤 세 블록이 App Store 용이다.

### Play (Android 29, 2026-09-22 게재)

사용자에게 보이는 것: 잠금 화면 울림 화면, 첫 알람 직후의 '알람이 없어요', 날씨 테마 저장
대기, 날씨 조건을 반쪽만 받았을 때의 오재생.

### ko-KR

```
• 화면이 잠긴 상태에서 알람이 울릴 때 소리만 나고 울림 화면이 뜨지 않던 문제를 고쳤습니다.
• 첫 알람을 만든 직후 목록에 '알람이 없어요'로 보이던 문제를 고쳤습니다.
• 인터넷이 느릴 때 날씨 테마 알람 저장이 오래 걸리던 것을 고쳤습니다. 날씨는 뒤에서 이어서 받습니다.
• 날씨 정보를 일부만 받았을 때 엉뚱한 날씨로 저장되던 문제를 고쳤습니다.
```

### en-US

```
• Fixed the alarm screen not appearing (sound only) when the alarm went off on a locked phone.
• Fixed the list showing "No alarms yet" right after creating your first alarm.
• Saving a weather-themed alarm no longer stalls on a slow connection; the forecast is fetched in the background.
• Fixed alarms being saved with the wrong weather when only part of the forecast was received.
```

### ja-JP

```
• 画面ロック中にアラームが鳴ったとき、音だけで画面が表示されない問題を修正しました。
• 最初のアラームを作成した直後に「アラームがありません」と表示される問題を修正しました。
• 通信が遅いときに天気テーマのアラーム保存に時間がかかる問題を修正しました。天気は後から取得します。
• 天気情報の一部しか受け取れなかったときに誤った天気で保存される問題を修正しました。
```

### App Store (iOS 1.2.9 빌드 6, 2026-09-23 심사 제출)

1.2.8 이 2026-09-22 에 게재된 뒤 올린 첫 회차다. iOS 에서만 보이는 것: 배달되자마자 죽어
있던 백그라운드 사이클(로그인 갱신·알람/목소리 동기화, `BGTaskScheduler` 핸들러 격리 —
CLAUDE.md 「시스템이 큐를 정하는 콜백에…」)과 목소리 등록 직후의 매니페스트 경합(#791).

### ko-KR

```
• 앱을 한동안 열지 않아도 로그인 상태와 목소리·알람 동기화가 백그라운드에서 계속 이어지도록 고쳤습니다.
• 인터넷이 느릴 때 날씨 테마 알람 저장이 오래 걸리던 것을 고쳤습니다. 날씨는 뒤에서 이어서 받습니다.
• 날씨 정보를 일부만 받았을 때 엉뚱한 날씨로 저장되던 문제를 고쳤습니다.
• 목소리를 등록한 직후 최신 문구 목록을 놓치던 문제를 고쳤습니다.
```

### en-US

```
• Background sync now keeps your sign-in, voices, and alarms up to date even if you do not open the app for a while.
• Saving a weather-themed alarm no longer stalls on a slow connection; the forecast is fetched in the background.
• Fixed alarms being saved with the wrong weather when only part of the forecast was received.
• Fixed the newest message list being missed right after you register a voice.
```

### ja-JP

```
• アプリをしばらく開かなくても、ログイン状態と声・アラームの同期がバックグラウンドで続くように修正しました。
• 通信が遅いときに天気テーマのアラーム保存に時間がかかる問題を修正しました。天気は後から取得します。
• 天気情報の一部しか受け取れなかったときに誤った天気で保存される問題を修正しました。
• 声を登録した直後に最新のメッセージ一覧を取得できないことがある問題を修正しました。
```

## 1.2.8 (versionCode 28)

#782 릴리스(2026-09-21 게재). 이 문안은 게재 당시 Play 에 올린 것을 옮겨 적은 것이다.

### ko-KR

```
• 목소리를 등록할 때 만들기와 내려받기를 하나의 퍼센트로 보여 줍니다.
• 목소리 등록 화면의 안내와 버튼 동작을 정리했습니다.
• 결제 확인과 알림 처리를 더 안정적으로 고쳤습니다.
```

### en-US

```
• Voice registration now shows generation and download as a single percentage.
• Tidied up the guidance and buttons on the voice registration screen.
• More reliable purchase verification and notification handling.
```

### ja-JP

```
• 音声の登録時に、生成とダウンロードを1つのパーセンテージで表示します。
• 音声登録画面の案内とボタンの動作を整理しました。
• 購入確認と通知処理をより安定させました。
```

## 1.2.7 (versionCode 27)

#749 한 건. 마이그레이션은 없다(백엔드는 로그인 거절의 보고 수준만 낮췄다).

### ko-KR

```
• 로그인 직후 알람 동기화가 불필요하게 반복되던 문제를 고쳐 배터리와 데이터를 아낍니다.
• 오류 진단이 더 정확해져 문제를 더 빨리 찾아 고칠 수 있게 되었습니다.
```

### en-US

```
• Fixed alarm sync retrying needlessly right after sign-in, saving battery and data.
• Error diagnostics are more accurate, so issues can be found and fixed faster.
```

### ja-JP

```
• ログイン直後にアラーム同期が不要に繰り返される問題を修正し、バッテリーと通信量を節約します。
• エラー診断がより正確になり、問題をより早く見つけて修正できるようになりました。
```

## 1.2.6 (versionCode 26)

1.2.5 뒤 변경을 반영한 배포 릴리스.

### ko-KR

```
• 울림 화면이 더 안정적으로 뜨고, 울림 화면을 나가도 알람이 깔끔하게 종료됩니다.
• 알람 끄기는 한 번의 조작으로 처리되도록 정리했습니다.
• 울림 중 미리듣기/재생이 겹치거나 누수되는 구간이 줄어들었습니다.
• 받는 가족 알람의 수신 상태 표시가 더 일관되게 보입니다.
• 구글 결제 소유권·캐시 동기화가 안정화되어 안내가 더 정확해졌습니다.
• 볼륨 미리듣기 동작이 단순화되어 알람 직전 조절이 더 자연스러워졌습니다.
```

### en-US

```
• The ringing screen is more stable and exits cleanly when you leave it.
• Alarm dismissal is simplified to one-step handling.
• Duplicate ringing preview/playback has been reduced.
• Family alarm receiving status is shown more consistently.
• Billing ownership and state synchronization is more stable with clearer notices.
• Ring-time volume preview flow is simpler, so pre-ring adjustment is smoother.
```

### ja-JP

```
• 通知アラーム画面の立ち上がりが安定し、画面を離れるとアラームがきれいに終了します。
• アラーム解除操作を1ステップで終えられるよう整理しました。
• 鳴動中のプレビュー/再生の重複やリークが減りました。
• 受け取り家族アラームの受信状態表示がより一貫して見えるようになりました。
• 課金の所有権・状態同期が安定し、案内が分かりやすくなります。
• ボリュームプレビューの操作が簡素化され、鳴る前の調整がしやすくなりました。
```

## 1.2.4 (versionCode 24)

#685 한 건. 마이그레이션은 없다(백엔드는 알람 저장의 메시지 접근 조건만 고쳤다).

핵심은 **알람 편집기가 내 선택을 안 잊는다**는 것이다. 문구 종류가 저장 과정에서 통째로
사라지고 있었다 — 새 알람은 매번 '기본 인사말' 로 열리고, 그 알람을 다시 열면 '직접 입력'
으로 보였다. 두 증상이 같은 원인이라 한 줄로 적는다.

**검은 화면은 반드시 적는다.** 저장을 두 번 눌렀을 때 화면이 통째로 검게 남고 앱을 다시
켜야 했다 — 사용자가 "알람이 저장됐나?" 를 확인할 방법조차 없던 상태다.

공유받은 목소리 알람이 서버에 저장되지 않던 것도 적는다. 알람은 울렸지만 다른 기기에
안 뜨고 목록에 계속 경고가 붙어 있었다. 반대로 **동기화 경고를 없앤 것 자체는 안 적는다** —
"경고가 사라졌다" 는 사용자에게 변화가 아니라 그냥 정상이다.

### ko-KR

```
• 새 알람이 지난번에 고른 문구를 그대로 이어받습니다. 직접 입력은 문구까지 이어받아요.
• 저장한 알람을 다시 열면 그때 고른 문구가 그대로 보입니다.
• 저장을 두 번 눌러도 화면이 검게 남지 않습니다. 저장 중에는 버튼에서 돌아갑니다.
• 지역과 운세 정보는 한 번 넣으면 다시 묻지 않습니다. 바꾸려면 '변경하기' 를 누르세요.
• 공유받은 목소리로 만든 알람이 이제 제대로 저장됩니다.
• 가입 화면에서 필수 항목이 위로 모였습니다.
```

### en-US

```
• New alarms keep the message type you picked last time — including your own text.
• Reopen a saved alarm and you see the message you actually chose.
• Tapping Save twice no longer leaves a black screen. Saving now shows on the button.
• Region and fortune details are asked once. Tap Change to edit them.
• Alarms made with a voice shared with you now save properly.
• On the sign-up screen, required items come first.
```

### ja-JP

```
• 新しいアラームに、前回選んだ文面の種類を引き継ぎます。直接入力は文面ごと引き継ぎます。
• 保存したアラームを開き直すと、そのとき選んだ文面がそのまま表示されます。
• 保存を二度押しても画面が真っ暗になりません。保存中はボタンで分かります。
• 地域と占い情報は一度入れれば再び聞きません。変えるときは「変更」から。
• 共有された声で作ったアラームが正しく保存されるようになりました。
• 登録画面で必須項目が上にまとまりました。
```

### 근거 (적은 항목만)

| 노트 항목 | 근거 |
| --- | --- |
| 문구 종류 이어받기 | `AlarmEditorState.toDraft()` 가 버킷 알람의 `voiceRandomContext` 를 떨어뜨리던 것을 고쳤다. 유료 클론은 문구 5종이 전부 버킷으로 매핑돼(`clonePrerenderBucketCategoryFor`) 사실상 모든 저장이 이 경로였다 |
| 직접 입력 문구까지 | `last_manual_text_<userId>`(`DynamicPromptPreferenceStore`). 글자가 같으면 오디오 캐시에 걸려 재생성·한도 차감이 없다 — 그래서 새 알람이 **바로 저장 가능**하다 |
| 재편집 시 문구 유지 | 판정을 `!voiceRandomPrompt && !isActiveBucketAlarm()` 로 통일(저장·pane·요약 행). 종류를 잃은 옛 행은 `randomPromptContextForBucket(bucketId)` 로 되짚는다 |
| 검은 화면 | `popBackStackOrHome()` 이 바닥에서 팝하지 않는다. 두 번 팝되던 경로는 `MainViewModel.alarmSaving` 으로 잠근다 |
| 다시 묻지 않기 | `RandomPromptSettingsPane` 의 `selectContext` 가 값이 없을 때만 다이얼로그를 연다. 고치는 길은 `RandomPromptDetailRow` 의 '변경하기' |
| 공유 목소리 알람 저장 | `messageBelongsToCaller` 에 공유 프리셋 갈래 추가(소유자 유료일 때만 — `isPaidVoicePlan`). `GET /tts/messages/:id/audio` 와 같은 규칙 |
| 동의 필수 우선 | `ConsentScreen` 이 서버 `optional` 로 필수/선택을 갈라 정렬한다 |

---

## 1.2.3 (versionCode 23)

#675(받은 알람 소유권) · #677·#678(탈퇴 시 목소리 철회) 세 건. 마이그레이션 92·93 이 있다.

핵심은 **받은 알람의 주인이 바뀌었다**는 것이다. 예전에는 15분 주기·푸시 pull 이 서버 값으로
계속 덮어써서, 수신자가 시각을 고쳐도 1초 만에 조용히 되돌아갔다 — 사용자는 고쳐 뒀다고 믿고
그 시각에 못 일어난다. 이제 서버 값은 **처음 받을 때의 씨앗**일 뿐이다.

**탈퇴 철회는 한 줄만 적는다.** 눈에 보이는 변화는 딱 하나다 — 보낸 사람이 계정을 지우면
그 목소리가 기기에서 사라지고 알람은 같은 시각에 그대로 울린다. 이걸 안 적으면 사용자는
"엄마 목소리가 왜 없어졌지" 를 알 길이 없다. 반대로 푸시·마이그레이션·FK 같은 건 안 적는다.

### ko-KR

```
• 받은 알람은 이제 받은 사람 것입니다. 시간을 바꾸거나 꺼 두면 그대로 유지됩니다.
• 보낸 사람이 알람을 지워도 내 알람은 남습니다. 그만받기를 누르면 다른 기기에서도 사라집니다.
• 보낸 사람이 계정을 지우면 그 목소리는 기기에서 지워지고, 알람은 같은 시각에 그대로 울립니다.
• 받은 알람의 스누즈가 사라지거나, 방금 끈 알람이 다시 울리던 문제를 고쳤습니다.
• 목소리 만들기: 예시 대본은 필요할 때만 펼칩니다. 녹음이 짧으면 버튼에서 바로 알려 줍니다.
• 화면을 캡처할 수 있습니다.
```

### en-US

```
• Received alarms are yours — change the time or turn one off and it stays.
• If the sender deletes an alarm, yours stays. Stop receiving clears it on your other devices.
• If they delete their account, their voice is removed but the alarm still rings.
• Fixed snoozes vanishing on received alarms, and an alarm you just turned off ringing again.
• Creating a voice: the sample script folds away, and the button says when a recording is too short.
• Screenshots work now.
```

### ja-JP

```
• 受け取ったアラームは受け取った人のものになりました。時刻を変えても、オフにしてもそのまま保たれます。
• 送った人が削除しても自分のアラームは残ります。「受け取らない」を押すと他の端末からも消えます。
• 送った人がアカウントを削除すると、その声は端末から消えますが、アラームは同じ時刻に鳴り続けます。
• 受け取ったアラームのスヌーズが消える問題、今オフにしたアラームが再び鳴る問題を修正しました。
• 声を作る画面: サンプル台本は必要なときだけ開きます。録音が短いとボタンで知らせます。
• スクリーンショットが撮れるようになりました。
```

---

## 1.2.2 (versionCode 22)

`fix/session-persistence`(#665)·`fix/alarm-survives-update`(#666) 가 **이 출시에서 처음 나간다.**
그 둘을 "다음 출시" 로 따로 적어 두고 1.2.2 노트를 쓰다가 아래 필수 한 줄을 빠뜨릴 뻔했다
(Codex #674 P1). 대기 절은 이 절로 합쳤다.

### 이 출시에 반드시 넣어야 하는 한 줄

**1.2.1 이하에서 이미 로그인이 풀린 기기는 이 업데이트만으로 알람이 되살아나지 않는다.**
한 번 로그인해야 한다. 아래 ko/en/ja 의 두 번째 줄이 그 안내다.

왜 자동으로 못 하는가: 되살려도 되는 계정을 가리는 표시(`session_expired_owner`)가 이번
출시에서 처음 생긴다. 그 이전 버전에서는 **자동 로그아웃과 사용자가 직접 한 로그아웃이
로컬에 똑같은 흔적을 남긴다** — 알람 행은 둘 다 `ownerUserId=A`·`enabled=1` 이고 세션만
비어 있다. 추측으로 되살리면 직접 로그아웃한 사람의 알람이 울리는데, 그 목록은 로그인
화면에 가려 **끌 수가 없다.** 못 가릴 때는 로그인 한 번 시키는 쪽이 안전하다(2026-08-04 확정).

이번 출시부터는 재발하지 않는다 — 토큰 수명 90일 + `/auth/me` 롤링 갱신 + 자동 만료 표시.

### ko-KR

```
• 앱을 업데이트해도 알람이 그대로 울립니다. 앱을 열지 않아도 예약이 다시 잡힙니다.
• 이전 버전에서 로그인이 이미 풀려 있었다면, 한 번만 로그인해 주세요. 알람이 되살아납니다.
• 로그인이 주기적으로 풀리던 문제를 고쳤습니다.
• 스누즈를 누른 알람이 5분 뒤에 울리지 않던 문제, 껐던 알람이 다시 켜져 울리던 문제를 고쳤습니다.
• 알람 음성이 준비되는 동안 진행률을 하나로 보여줍니다.
• 권한이 없을 때 무엇을 켜야 하는지, 켜지 않으면 어떻게 되는지 정확히 안내합니다.
• 알람 설정 창을 같은 모양으로 통일하고 아이콘을 새로 바꿨습니다.
```

### en-US

```
• Alarms keep ringing after an app update — rescheduled without opening the app.
• If you were already signed out on an older version, sign in once and your alarms come back.
• Fixed sign-in dropping every so often.
• Fixed snoozed alarms not ringing after 5 minutes, and alarms switching themselves back on.
• One progress number while your alarm voice gets ready.
• Clearer permission notices; new app icon.
```

### ja-JP

```
• アプリを更新してもアラームはそのまま鳴ります。アプリを開かなくても再設定されます。
• 以前のバージョンで既にログアウトされていた場合は、一度ログインしてください。アラームが戻ります。
• ログインが定期的に切れる問題を修正しました。
• スヌーズしたアラームが5分後に鳴らない問題、オフにしたアラームが再びオンになって鳴る問題を修正しました。
• アラーム音声の準備状況を一つの進捗で表示します。
• 権限が足りないときの案内を正確にしました。アイコンも新しくなりました。
```

---

## 1.2.1 (versionCode 21)

`versionCode 20` 은 **건너뛴 번호**다 — 7/29 에 20 을 찍은 빌드가 Play 에 올라가 있어 재사용할
수 없고, 그 빌드는 `document_version` 을 보내기 전(7/30 이전)이라 강제 업데이트 하한으로도 쓸 수
없다. 자세한 이유는 `packages/backend/src/lib/app-version.ts` 주석 참고.

노트는 **1.1.3(versionCode 18) → 1.2.1** 기준으로 썼다. 20 번 빌드가 프로덕션 트랙까지 나갔는지
내부 테스트에 머물렀는지는 확인하지 않았다 — 프로덕션까지 나갔다면 그 사용자에게는 여기 적힌
항목 중 일부가 이미 있는 것이다.

### ko-KR

```
• 새 알람을 만들면 지난번에 고른 목소리와 문구 종류를 그대로 이어받습니다.
• 문구를 바꾸지 않았다면 이미 만든 음성을 다시 씁니다. 저장이 빨라졌어요.
• 공유받은 알람의 음성을 매번 다시 내려받지 않습니다.
• 목소리 만들기: 녹음 하한을 1분에서 12초로 낮췄습니다.
• 가입할 때 약관과 개인정보 처리방침 전문을 그 자리에서 펼쳐 읽을 수 있습니다.
• 음성 생체정보 처리 동의와 광고성 정보 수신 동의는 더보기 → 설정에서 철회할 수 있습니다.
• 목소리 준비 화면에서 멈추던 문제, 계정을 바꿔도 이전 계정 정보가 남던 문제를 고쳤습니다.
```

### en-US

```
• New alarms keep the voice and message type you chose last time.
• Unchanged message? We reuse the audio already made — saving is faster.
• Voices for shared alarms are no longer re-downloaded each time.
• Creating a voice: the recording minimum is 12 seconds, not 1 minute.
• Read the full terms and privacy policy on the sign-up screen. Voice biometric and marketing consents can be withdrawn from More → Settings.
• Fixed a voice preparation screen hang and stale cross-account data.
```

### ja-JP

```
• 新しいアラームに、前回選んだ声とメッセージの種類を引き継ぎます。
• 文面を変えていなければ、以前つくった音声をそのまま使います。保存が速くなりました。
• 共有されたアラームの音声を毎回ダウンロードしなくなりました。
• 声の作成：録音の下限を1分から12秒に下げました。
• 登録画面で利用規約とプライバシーポリシーの全文をその場で開いて読めます。
• 音声生体情報の処理同意と広告情報の受信同意は「その他」→「設定」から撤回できます。
• 声の準備画面で止まる問題、アカウントを切り替えても前のデータが残る問題を修正しました。
```

### 근거 (적은 항목만)

| 노트 항목 | 근거 |
| --- | --- |
| 직전 선택 유지 | `AlarmEditorScreen.kt` `lastMessageContext`, `VoiceAudioCard.kt` `lastUsedVoiceId` (새 알람 한정) |
| 음성 재사용 | `AlarmEditorScreen.kt` `hasFreshTtsAudio` / `AlarmAudioStore.resolveTtsInput`. 랜덤 문구·가족 알람은 제외라 "문구를 바꾸지 않았다면" 으로 한정해 적었다 |
| 공유 알람 음성 캐시 | `RemoteAlarmPullSyncService.kt` `getCachedAudio("remote-message-…")` |
| 녹음 하한 12초 | `VoiceProfileAudioLimits.MIN_DURATION_MILLIS = 12_000`(`AlarmAudioStore.kt`), 서버는 `POST /voice/clone` 의 `MIN_CLONE_DURATION_MS = 12_000`(`voice-profile.ts`). 같은 파일의 `AlarmAudioLimits`(30초)는 **알람 오디오용 별개 객체**이고, `voice-upload.ts` 의 `MIN_UPLOAD_DURATION_MS`(60초)는 가족 알람 업로드 전용이라 둘 다 이 항목과 무관하다 |
| 전문 열람 | `ConsentScreen.kt` 가 `assets` 의 `LegalDocument` 를 펼친다. **가입 화면 한정** — 설정의 문서 보기는 웹뷰라 "가입할 때" 로 못 박았다 |
| 동의 철회 | `ConsentHistoryScreen.kt` (더보기 → 설정 → 약관 및 개인정보 처리 동의). **철회할 수 있는 건 두 가지뿐** — 음성 생체정보는 단방향 "동의 철회" 액션, 광고성 정보 수신은 토글. 약관·개인정보·만14세·국외이전 같은 **필수 동의는 철회 액션이 없다**(국외이전은 `:141` 에 의도라고 적혀 있다). 그래서 "동의 철회 언제든 가능" 이라고 뭉뚱그리지 않고 두 항목을 이름으로 적는다 |
| 준비 화면 탈출 | `VoiceOnboardingScreen.kt` `ESCAPE_GRACE_MILLIS = 12_000` |
| 계정 전환 잔존 데이터 | `fix(android): 같은 계열의 남은 크로스계정 누수 네 곳을 막는다` 외 |
