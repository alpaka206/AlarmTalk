# 출시 노트 (Play 스토어)

Play Console 의 "이 출시의 새로운 기능" 에 그대로 붙여 넣는 원문. 언어당 **500자 제한**이라
길이를 넘기지 말 것. 지원 언어는 앱의 `resourceConfigurations`(ko/en/ja)와 같다.

길이는 눈대중하지 말고 재고, **줄바꿈이 CRLF 로 세어질 여지까지 감안해 여유를 남긴다**
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

## 1.2.3 (versionCode 23)

`fix/received-alarm-ownership`(#675) 한 건이다. 마이그레이션은 없다.

핵심은 **받은 알람의 주인이 바뀌었다**는 것이다. 예전에는 15분 주기·푸시 pull 이 서버 값으로
계속 덮어써서, 수신자가 시각을 고쳐도 1초 만에 조용히 되돌아갔다 — 사용자는 고쳐 뒀다고 믿고
그 시각에 못 일어난다. 이제 서버 값은 **처음 받을 때의 씨앗**일 뿐이다.

### ko-KR

```
• 받은 알람은 이제 받은 사람 것입니다. 시간을 바꾸거나 꺼 두면 그대로 유지됩니다.
• 보낸 사람이 알람을 지워도 내 알람은 남습니다. 그만받기를 누르면 다른 기기에서도 사라집니다.
• 받은 알람의 스누즈가 사라지거나, 방금 끈 알람이 다시 울리던 문제를 고쳤습니다.
• 목소리 만들기: 예시 대본은 필요할 때만 펼칩니다. 녹음이 짧으면 버튼에서 바로 알려 줍니다.
• 화면을 캡처할 수 있습니다.
```

### en-US

```
• Received alarms are yours now — change the time or turn one off and it stays that way.
• If the sender deletes an alarm, yours stays. Stop receiving also clears it on your other devices.
• Fixed snoozes vanishing on received alarms, and an alarm you just turned off ringing again.
• Creating a voice: the sample script stays folded until you need it, and the button says when a recording is too short.
• Screenshots work now.
```

### ja-JP

```
• 受け取ったアラームは受け取った人のものになりました。時刻を変えても、オフにしてもそのまま保たれます。
• 送った人が削除しても自分のアラームは残ります。「受け取らない」を押すと他の端末からも消えます。
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
