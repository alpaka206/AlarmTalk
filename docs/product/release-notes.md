# 출시 노트 (Play 스토어)

Play Console 의 "이 출시의 새로운 기능" 에 그대로 붙여 넣는 원문. 언어당 **500자 제한**이라
길이를 넘기지 말 것. 지원 언어는 앱의 `resourceConfigurations`(ko/en/ja)와 같다.

길이는 눈대중하지 말고 재고, **줄바꿈이 CRLF 로 세어질 여지까지 감안해 여유를 남긴다**
(영어는 한 줄이 길어 금방 490자를 넘긴다):

```bash
node -e "const b=require('fs').readFileSync('docs/product/release-notes.md','utf8').matchAll(/### (ko-KR|en-US|ja-JP)\n\n\`\`\`\n([\s\S]*?)\n\`\`\`/g); for(const[,l,t]of b)console.log(l,[...t].length)"
```

쓰는 규칙:
- **사용자가 눈으로 확인할 수 있는 변화만** 적는다. 백엔드 리팩터·CI·마이그레이션은 안 적는다.
- 적기 전에 **코드에서 사실을 확인**한다. 여기 적힌 수치·화면 이름은 실제 문자열 리소스와
  맞춰 둔 것이다(예: 더보기/More/その他 = `r3app_bottom_tab_menu`).

---

## 1.2.1 (versionCode 21)

`versionCode 20` 은 결번이다 — 이유는 `packages/backend/src/lib/app-version.ts` 주석 참고.
직전 스토어 출시본은 1.1.3(versionCode 18)이라, 아래 노트는 1.1.3 → 1.2.1 기준으로 썼다.

### ko-KR

```
• 새 알람을 만들면 지난번에 고른 목소리와 문구 종류를 그대로 이어받습니다.
• 문구를 바꾸지 않았다면 이미 만든 음성을 다시 씁니다. 저장이 빨라졌어요.
• 공유받은 알람의 음성을 매번 다시 내려받지 않습니다.
• 목소리 만들기: 녹음 하한을 1분에서 12초로 낮췄습니다.
• 가입할 때 약관과 개인정보 처리방침 전문을 그 자리에서 펼쳐 읽을 수 있습니다. 동의 철회는 더보기 → 설정에서 언제든 가능합니다.
• 목소리 준비 화면에서 멈추던 문제, 계정을 바꿔도 이전 계정 정보가 남던 문제를 고쳤습니다.
```

### en-US

```
• New alarms keep the voice and message type you chose last time.
• Unchanged message? We reuse the audio you already made — saving is faster.
• Voices for shared alarms are no longer re-downloaded each time.
• Creating a voice: the recording minimum is now 12 seconds, not 1 minute.
• Read the full terms and privacy policy on the sign-up screen. Withdraw consent anytime from More → Settings.
• Fixed a hang on the voice preparation screen and stale data after switching accounts.
```

### ja-JP

```
• 新しいアラームに、前回選んだ声とメッセージの種類を引き継ぎます。
• 文面を変えていなければ、以前つくった音声をそのまま使います。保存が速くなりました。
• 共有されたアラームの音声を毎回ダウンロードしなくなりました。
• 声の作成：録音の下限を1分から12秒に下げました。
• 登録画面で利用規約とプライバシーポリシーの全文をその場で開いて読めます。同意の撤回は「その他」→「設定」からいつでもできます。
• 声の準備画面で止まる問題、アカウントを切り替えても前のデータが残る問題を修正しました。
```

### 근거 (적은 항목만)

| 노트 항목 | 근거 |
| --- | --- |
| 직전 선택 유지 | `AlarmEditorScreen.kt` `lastMessageContext`, `VoiceAudioCard.kt` `lastUsedVoiceId` (새 알람 한정) |
| 음성 재사용 | `AlarmEditorScreen.kt` `hasFreshTtsAudio` / `AlarmAudioStore.resolveTtsInput`. 랜덤 문구·가족 알람은 제외라 "문구를 바꾸지 않았다면" 으로 한정해 적었다 |
| 공유 알람 음성 캐시 | `RemoteAlarmPullSyncService.kt` `getCachedAudio("remote-message-…")` |
| 녹음 하한 12초 | `AlarmAudioStore.MIN_DURATION_MILLIS = 12_000`, 서버 `MIN_CLONE_DURATION_MS = 12_000` |
| 전문 열람 | `ConsentScreen.kt` 가 `assets` 의 `LegalDocument` 를 펼친다. **가입 화면 한정** — 설정의 문서 보기는 웹뷰라 "가입할 때" 로 못 박았다 |
| 동의 철회 | `ConsentHistoryScreen.kt` "동의 철회" (더보기 → 설정 → 약관 및 개인정보 처리 동의) |
| 준비 화면 탈출 | `VoiceOnboardingScreen.kt` `ESCAPE_GRACE_MILLIS = 12_000` |
| 계정 전환 잔존 데이터 | `fix(android): 같은 계열의 남은 크로스계정 누수 네 곳을 막는다` 외 |
