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
| 앱 번들 인사말(안드로이드 `res/raw` 12개·랜딩 `public/audio` 12개·안드로이드 랜딩 미리듣기) | 코드와 같이 바꿔 앱 릴리스에 싣는다(`npm run preview:stock -- --category greeting` 로 굽는다) | 앱 릴리스 |

⚠ **은퇴시키지 않는다**(#110 방식은 화면 글자가 바뀔 때만). 은퇴하면 모든 앱이 새 id 로 다시 묶을 때까지 차단
화면을 띄운다. 제자리 교체는 앱이 바뀐 `audio_url` 을 보고 다시 받고, **받기 전까지는 옛 파일로 울린다** —
어느 단계에서 멈춰도 무음은 없다.

⚠ **`POST /api/admin/seed-stock-clips?reset` 을 쓰지 말 것** — 시스템 프리셋 행을 지우고 그 클립을 물고 있던 알람을
sound-only 로 떼어 낸다.

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
   `npm run publish:stock -- --env prod`. 시청본은 2에서 구운 것을 그대로 쓴다(같은 바이트를 dev·prod 에 올린다).
7. **앱 릴리스**: 번들 인사말을 새로 구운 앱을 스토어에 올린다(서버 순서와 무관 — 번들은 오프라인 대체용이다).

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
