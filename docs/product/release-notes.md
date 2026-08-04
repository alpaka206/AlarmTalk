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

---

## 다음 출시 (versionCode 미정 — 릴리스 시 +1)

`fix/session-persistence`(#665) + `fix/alarm-survives-update`(#666) 기준. 번호는 실제 업로드
시점에 정한다.

### 이 출시에 반드시 넣어야 하는 한 줄

**1.2.1 이하에서 이미 로그인이 풀린 기기는 이 업데이트만으로 알람이 되살아나지 않는다.**
한 번 로그인해야 한다. 아래 ko/en/ja 마지막 줄이 그 안내다.

왜 자동으로 못 하는가: 되살려도 되는 계정을 가리는 표시(`session_expired_owner`)가 이번
출시에서 처음 생긴다. 그 이전 버전에서는 **자동 로그아웃과 사용자가 직접 한 로그아웃이
로컬에 똑같은 흔적을 남긴다** — 알람 행은 둘 다 `ownerUserId=A`·`enabled=1` 이고 세션만
비어 있다. 추측으로 되살리면 직접 로그아웃한 사람의 알람이 울리는데, 그 목록은 로그인
화면에 가려 **끌 수가 없다.** 못 가릴 때는 로그인 한 번 시키는 쪽이 안전하다(2026-08-04 확정).

이번 출시부터는 재발하지 않는다 — 토큰 수명 90일 + `/auth/me` 롤링 갱신 + 자동 만료 표시.

### ko-KR

```
• 앱을 업데이트해도 알람이 그대로 울립니다. 앱을 열지 않아도 예약이 다시 잡힙니다.
• 로그인이 주기적으로 풀리던 문제를 고쳤습니다.
• 스누즈를 누른 알람이 5분 뒤에 울리지 않던 문제를 고쳤습니다.
• 이전 버전에서 로그인이 이미 풀려 있었다면, 한 번만 로그인해 주세요. 알람이 되살아납니다.
```

### en-US

```
• Alarms keep ringing after an app update — they are rescheduled without opening the app.
• Fixed sign-in dropping every so often.
• Fixed snoozed alarms not ringing again after 5 minutes.
• If you were already signed out on an older version, sign in once and your alarms come back.
```

### ja-JP

```
• アプリを更新してもアラームはそのまま鳴ります。アプリを開かなくても再設定されます。
• ログインが定期的に切れる問題を修正しました。
• スヌーズしたアラームが5分後に鳴らない問題を修正しました。
• 以前のバージョンで既にログアウトされていた場合は、一度ログインしてください。アラームが戻ります。
```

### 근거 (적은 항목만)

| 노트 항목 | 근거 |
| --- | --- |
| 업데이트 후 재예약 | `AlarmScheduleIntegrityWorker`(15분 주기, 무제약) + `BootCompletedReceiver` 의 `MY_PACKAGE_REPLACED`. **강제 종료된 앱은 브로드캐스트도 워커도 못 받는다** — 그 경우는 이 노트로 약속하지 않는다 |
| 로그인 유지 | `packages/backend/src/lib/jwt.ts` `DEFAULT_TTL_SECONDS = 90일`, `GET /auth/me` 의 롤링 토큰 재발급 |
| 스누즈 | `AlarmRepository.snooze` 를 `restoreMutex` 안으로 — 정합성 워커가 스누즈를 다음 날로 덮던 경합 |
| 한 번 로그인 안내 | `AuthSessionStore.sessionExpiredOwnerUserId` KDoc 의 '구버전 코호트' 절 |
