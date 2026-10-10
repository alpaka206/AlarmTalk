# 합성 모델을 바꿀 때 — 게시된 클립을 **제자리에서** 다시 굽는다

> 2026-09-30 신설(eleven_v3 → eleven_v4_turbo, 태그 제거). 규칙의 근거는
> [`docs/spec/voice-and-message.md`](../spec/voice-and-message.md) §5-3「화면 문구는 그대로이고 소리만 바꿀 때」·§10.

모델은 코드 상수 하나다(`packages/backend/src/lib/tts-model.ts` 의 `TTS_MODEL_ID`) — 워커 시크릿으로 바꾸는 길은 없다.
상수를 바꿔 배포하면 **새로 만드는 소리**(직접 입력·새 클론 등록)만 새 모델이 된다. 이미 게시된 클립은 `messages`
행이 '있다' 로 세어 **저절로 다시 굽히지 않는다.** 그래서 아래 둘을 따로 돌린다.

| 대상 | 무엇이 다시 굽는가 | 언제 |
| --- | --- | --- |
| 클론 사전렌더(목소리당 21개) | 큐 재적재 마이그레이션(이번 회차는 **#124**) → 서버 cron 이 같은 message_id 에 덮어쓴다 | 배포 = 마이그레이션 직후부터 자동 |
| 시스템 스톡(4목소리 × 3언어 × 20 = 240개) | `npm run publish:stock` 의 **교체 갈래**가 같은 message_id 에 소리만 바꾼다 | 사람이 들어 본 뒤 손으로 |
| 직접 입력 | 다시 굽지 않는다 — 다시 만들면 한도를 태운다. 사용자가 그 문구를 다시 만들 때 새 모델이 된다 | — |
| 앱 번들 인사말(안드로이드 `res/raw` 12개·랜딩 `public/audio` 12개·안드로이드 랜딩 미리듣기) | 코드와 같이 바꿔 앱 릴리스에 싣는다(`npm run preview:stock -- --category greeting` 로 굽고 res/raw 에 넣은 뒤 `npm run boost:greetings` — 아래 「음량」 절) | 앱 릴리스 |

⚠ **은퇴시키지 않는다**(#110 방식은 화면 글자가 바뀔 때만). 은퇴하면 모든 앱이 새 id 로 다시 묶을 때까지 차단
화면을 띄운다. 제자리 교체는 앱이 바뀐 `audio_url` 을 보고 다시 받고, **받기 전까지는 옛 파일로 울린다** —
어느 단계에서 멈춰도 무음은 없다.

⚠ **`POST /api/admin/seed-stock-clips?reset` 을 쓰지 말 것** — 시스템 프리셋 행을 지우고 그 클립을 물고 있던 알람을
sound-only 로 떼어 낸다.

⚠ **목소리 높이 보정이 꺼진다**(2026-10-08 — 스펙 §4-3). 등록 때 고른 높이(`voice_profiles.pitch_semitones`)는 **그때의
모델**(`pitch_model_id`)이 낸 높이를 바로잡는 값이라, `TTS_MODEL_ID` 가 바뀌면 서버가 굽지 않는다(`appliedPitchSemitones`).
그래서 이 회차에 다시 굽는 클론 클립은 **원래 높이**로 나온다 — 새 모델에서 다시 맞추려면 사용자가 교체 등록을 해야 한다.
모델을 바꾸기 전에 이 동작을 그대로 둘지(값을 새 모델 기준으로 옮길 방법이 있는지) 먼저 판단한다.

## 순서 (v4 Turbo 전환 기준)

1. **develop 머지** → dev 배포 + 마이그레이션 #124. dev 에서 새 직접 입력·새 클론이 v4 Turbo 가 되고, dev 클론
   재렌더가 cron 으로 시작된다(새 등록이 대기열 앞에 선다 — `claimPendingPrerenderVoices`).
2. **시청본 굽기**(로컬, `packages/backend` 에서): `npm run preview:stock -- --dry-run` 으로 개수를 본 뒤
   `npm run preview:stock`. 파이프라인 세대가 `plain@2` 로 바뀌어 옛 시청본 240개가 전부 '낡음' 으로 다시 굽힌다
   (약 31,300자 — 할인가 0.28 크레딧/글자로 약 8.8천 크레딧). `ELEVENLABS_API_KEY` 는 `.dev.vars.dev` 에서 읽는다.
3. **사람이 듣는다.** 특히 남자 목소리(도현·시우)의 음높이와 네 목소리의 음량 — v3 보다 도현 +8.7반음·시우 +6.4반음,
   음량 중앙 −4dB 로 쟀다(스펙 §10 「위험」). 받아들이기 어려우면 여기서 멈춘다(아직 아무것도 게시하지 않았다).
4. **dev 게시**: `npm run publish:stock -- --env dev --dry-run` 이 `[교체]` 240개를 보여 주는지 확인하고
   `npm run publish:stock -- --env dev`. 끝줄이 `게시 0개 · 교체 240개 · …` 여야 한다. 다시 돌리면 `이미 있음 240개`.
   - `[보류]` 줄은 **나오지 않아야 한다**(나오면 실패로 세어 명령이 1 로 끝난다). 같은 `request_hash` 를 다른
     오브젝트의 원장 행이 쥐고 있다는 뜻인데, 스톡 키는 스톡 범위(`STOCK_TTS_CACHE_SCOPE`)라 사용자 생성(직접 입력은
     그 사람 범위)과 겹치지 않는다. 그 자리는 올리지도 바꾸지도 않았고 옛 소리로 계속 울린다(무음 없음). 원장 행
     하나가 해시 하나를 쥐는 구조라 그대로 게시하면 새 오브젝트가 원장에 없는 채로 남는다(Codex #840) — 그 행을
     보고(`SELECT * FROM generated_audio_assets WHERE request_hash = ?`) 원인을 찾은 뒤 다시 돌린다. 사용자 행이면
     손으로 지우지 않는다.
5. **폰 확인**(dev 앱): 기본 목소리 테마 알람을 울려 새 소리인지, 음량이 작지 않은지. 클론이 있는 계정이면 cron 이
   다시 구운 뒤(목소리 화면이 '준비 중' 에서 돌아온 뒤) 클론 알람도. 잠금화면 문구는 클론만 바뀐다(Gemini 가 새로 쓴다).
6. **main 머지**(release) → prod 배포 + #124. 곧바로 `npm run publish:stock -- --env prod --dry-run` →
   `npm run publish:stock -- --env prod`. 시청본은 2에서 구운 것을 그대로 쓴다(같은 시청본에서 만든 같은 바이트를
   dev·prod 에 올린다 — 2026-10-08 부터는 음량을 올린 사본이다, 아래 「음량」 절).
7. **앱 릴리스**: 번들 인사말을 새로 구운 앱을 스토어에 올린다(서버 순서와 무관 — 번들은 오프라인 대체용이다).

## 음량을 바꿀 때 — `TTS_LOUDNESS_BOOST_DB`(2026-10-08, +4 dB)

> 규칙의 근거는 [`docs/spec/voice-and-message.md`](../spec/voice-and-message.md) §10「모든 소리를 +4 dB 올린다」.

음량도 코드 상수 하나다(`packages/backend/src/lib/tts-model.ts` 의 `TTS_LOUDNESS_BOOST_DB`). 셈은 `@alarmtalk/voice` 의
`boostLoudness` 하나이고(봉우리 −0.2 dBFS 상한 — 봉우리가 높은 클립은 덜 올라간다), 서버·기본 목소리 게시본·번들이 모두 같은
값·같은 셈·같은 인코더(`encodeMp3`, MP3 128 kbps 모노)를 쓴다. 올린 값은 캐시 키에 들어간다(`loudnessBoostDb`, 0 이면
빠진다) — 그래서 모델을 바꿀 때와 같은 **제자리 교체**가 된다.

| 대상 | 어떻게 올라가는가 | 언제 |
| --- | --- | --- |
| 서버 합성(클론 사전렌더·직접 입력·등록 미리듣기) | 합성 갈래가 PCM 을 받아 올려 굽는다. **이미 만든 것은 그대로다** — 클론 프리셋을 다시 구울지는 스펙 §10 「위험」에서 정한다 | 배포 직후부터 새로 만드는 것 |
| 시스템 스톡 240개 | `publish:stock` 이 시청본을 **다시 합성하지 않고** 풀어서 같은 셈으로 올린 사본을 만들어 올린다(다시 묶어도 커지지 않는 클립은 소리를 그대로 두고 표지만 단 사본 — 아래). 키가 달라져 교체 갈래로 간다 — dev 의 올리기 전 v4 클립도, prod 의 v3 클립도 | 사람이 손으로(dev → prod) |
| 앱 번들 인사말 12개·랜딩 미리듣기·랜딩 웹 사본 12개 | `npm run boost:greetings` 가 같은 셈으로 올린 사본으로 바꾸고 랜딩 사본을 같은 바이트로 맞춘다(2026-10-08 이 PR 에서 돌렸다 — 시우 인사말 3개는 다시 묶으면 작아져서 소리를 그대로 두고 표지만 달았다) | 앱 릴리스 |

- **시청본(`voice-preview/`)은 손대지 않는다.** 게시본 사본은 `packages/backend/node_modules/.cache/publish-stock-clips/boosted/<언어>/<목소리>/`
  에 실행마다 다시 만든다(결정론적 — 같은 시청본이면 같은 바이트). 올리기 전에 들어 보려면 `--dry-run` 뒤 거기서 듣는다.
- **시청본 지문은 그대로다**(파이프라인 세대 `plain@2`). 지문은 '사람이 들은 그 소리가 지금 카탈로그로 합성됐는가' 를 묻고,
  올리기는 그 바이트를 고치지 않기 때문이다. 지문에 넣으면 240개가 전부 '낡음' 이 되어 다시 합성한다.
- **두 번 올라가지 않는다.** 올린 사본에는 ID3 표지(`TXXX:alarmtalk-loudness-boost-db` = 그때의 `TTS_LOUDNESS_BOOST_DB` — 실제로
  오른 크기가 아니다)가 붙고 — 소리를 그대로 둔 사본에도 붙는다 — 표지가 있는 소리는 게시·번들 어느 쪽도 다시 받지 않는다
  (`scripts/mp3-loudness-boost.ts`). 올린 사본을 `voice-preview/` 에 넣으면 게시가 멈춘다.
- **macOS 에서 돌린다** — MP3 를 풀 때 macOS 내장 `afconvert` 를 쓴다(없으면 처음에 멈춘다). 240개 사본을 만드는 데 이 맥에서
  30초 안쪽이다.
- **다시 묶는 값이 있다.** 들어 본 MP3 를 풀어 다시 MP3 로 묶으므로 손실 압축을 한 번 더 거치고, 그때 크기가 약 0.45 dB
  준다(2026-10-08 실측: 시청본 240개를 다시 묶으니 중앙 −0.45, −0.58~−0.40 dB. 사인파로는 우리 인코더·ffmpeg 의
  libmp3lame·`lame` 이 모두 128 kbps 에서 −0.45 dB, 320 kbps 에서 0 — LAME 128 kbps 의 성질이다). 서버는 PCM 을 받아 한 번만
  묶으므로, 다시 묶은 게시본·번들의 순 변화는 **배율 − 0.45 dB 쯤**이다 — 다 올린 클립도 +3.55 dB 쯤. 값은 보정하지 않는다 —
  셈과 값을 서버와 하나로 둔다.
- **다시 묶어도 커지지 않으면 다시 묶지 않는다.** 봉우리가 이미 높아 배율이 그 손실보다 작은 클립은 다시 묶으면 들어 본 것보다
  작아진다(시우 번들 인사말 3개가 −0.24~−0.38 dB 였다). 그래서 `boostMp3` 가 묶은 결과를 다시 풀어 원본과 통합 음량을 견주고,
  커지지 않으면 들어 본 MP3 의 오디오 프레임을 그대로 둔 채 표지만 단다(`boost:greetings` 의 `[그대로]`). 올리기가 들어 본
  소리를 줄이는 일은 없다.
- **이 시청본(2026-10-08)의 결과**: 배율 중앙 +3.21 dB, 240개 중 164개가 봉우리에 닿아 덜 오른다. 다 올린 것 76·덜 올린 것
  112·그대로 52(시우 51·애니 1). 다시 묶은 188개의 순 변화는 +0.01~+3.56 dB(중앙 +3.29), 240개 전체 중앙 +2.77. 목소리별
  중앙: 도현 +3.2·미나 +3.1·애니 +3.5·시우 0(봉우리가 −0.1~−1.5 dBFS 라 거의 오르지 않는다 — 다시 묶은 9개도 +0.82 까지). 번들:
  시우 인사말 3개는 그대로, 나머지 10개는 +0.98~+3.55 dB. **어느 소리도 +4 dB 를 다 받지 못한다** — 시우까지 올리려면 순수
  배율이 아니라 리미터(봉우리를 눌러 담는 처리)가 필요하다(정하지 않았다 — 스펙 §10).

### 순서 (+4 dB 기준)

1. **번들**(이 PR): `npm run boost:greetings` — 이미 올린 파일은 건너뛰므로 다시 돌려도 무해하다. 확인은
   `npm run boost:greetings -- --check`(표지·프레임·랜딩 사본 일치·목록에 없는 파일 — afconvert 없이 돈다). 같은 검사가
   백엔드 테스트(`bundled-voice-clips-loudness.test.ts`)에도 있다.
2. **develop 머지** → dev 배포. 이때부터 dev 의 새 서버 합성이 올린 크기다. dev 의 기본 목소리 게시본은 3을 돌리기 전까지
   올리기 전 크기다.
3. **dev 게시**: `npm run publish:stock -- --env dev --dry-run`. 첫 줄이 사본 요약
   (`음량 +4 dB(TTS_LOUDNESS_BOOST_DB) 게시본 240개 — 다 올린 것 …개, 봉우리 때문에 덜 올린 것 …개, 다시 묶어도 커지지 않아
   소리를 그대로 둔 것 …개 · 다시 묶은 …개의 순 변화 …~… dB(중앙 …)` — 이 시청본으로는 76·112·52, 188개 +0.01~+3.56
   (중앙 +3.29)), 그 뒤 `[교체]` 240줄이어야 한다(올리기 전 v4 → 올린 v4 — 그대로 둔 52개도 키가 바뀌어 교체된다). 그다음 `npm run publish:stock -- --env dev`
   — 끝줄 `게시 0개 · 교체 240개 · 이미 있음 0개`. `[보류]` 는 위 「순서」 4와 같다.
4. **폰 확인**(dev 앱): 기본 목소리 테마 알람이 올린 소리인지(앱은 바뀐 `audio_url` 을 보고 다시 받는다).
5. **main 머지** → prod 배포 → `npm run publish:stock -- --env prod --dry-run`(`[교체]` 240 — v3 → 올린 v4. v4 전환의 6과 한
   번에 된다) → `npm run publish:stock -- --env prod`.
6. **앱 릴리스**: 1의 번들을 실은 앱(서버 순서와 무관).

**완료 확인**: 아래 SQL 의 `model_id` 로는 올리기 전 v4 와 올린 v4 를 가를 수 없다(둘 다 `eleven_v4_turbo`). 게시 스크립트가
지금 값으로 키를 계산하므로 `npm run publish:stock -- --env <dev|prod> --dry-run` 의 끝줄이
`게시 0개 · 교체 0개 · 이미 있음 240개` 면 끝이다.

**되돌리기**: 상수를 0 으로 되돌린다. 서버는 옛 갈래(제공자 MP3 그대로, 키도 예전 그대로)로 돌아가고, `publish:stock` 은
0 일 때 들어 본 바이트를 **그대로** 올린다 — 키가 예전으로 돌아가 `[교체]` 240 이 다시 나온다. 번들은 git 이력의 원본(올리기 전
파일)으로 되돌린 뒤 `npm run boost:greetings -- --check` 로 표지가 없는지 본다.

## 완료 확인 (DB — `turso db shell <dev|prod DB>`)

시스템 스톡 — 이 결과에 `eleven_v4_turbo` 한 줄만 남아야 끝이다:

```sql
SELECT ga.model_id, COUNT(DISTINCT m.id) AS clips
  FROM messages m
  JOIN voice_profiles vp ON vp.id = m.voice_profile_id AND COALESCE(vp.is_system, 0) = 1
  JOIN generated_audio_assets ga ON ga.audio_url = m.audio_url
 WHERE COALESCE(m.is_preset, 0) = 1 AND m.retired_at IS NULL
 GROUP BY ga.model_id;
```

클론 사전렌더 — `eleven_v3` 가 남은 클론 수(0 이 되면 끝. 밀려난 클론은 복구 때까지 남는다):

```sql
SELECT COUNT(DISTINCT m.voice_profile_id) AS clones_with_v3
  FROM messages m
  JOIN voice_profiles vp ON vp.id = m.voice_profile_id AND COALESCE(vp.is_system, 0) = 0
  JOIN generated_audio_assets ga ON ga.audio_url = m.audio_url
 WHERE COALESCE(m.is_preset, 0) = 1 AND m.retired_at IS NULL AND ga.model_id = 'eleven_v3';
```

큐 — `pending` 이 줄어드는지, `failed` 가 늘지 않는지:

```sql
SELECT status, refresh_existing, COUNT(*) FROM voice_prerender_queue GROUP BY 1, 2;
```

처리량은 시간당 약 120클립(≈ 클론 5.7개)이다 — 클론 수를 먼저 세어 끝날 시각을 가늠한다. 앱이 켜진 사용자는
목소리 화면의 전진 호출(`POST /voice/:id/prerender/advance`)로 더 빨리 끝난다.

## 되돌리기

모델은 코드 상수라 **코드를 되돌린다**(revert). 이미 교체한 클립은 되돌린 모델로 다시 교체해야 옛 소리가 된다 —
같은 절차(시청본 → 게시 교체 갈래, 클론은 새 재적재 마이그레이션)를 반대로 한 번 더 돈다. 게시하지 않았으면
되돌릴 것이 없다.
