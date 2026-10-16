# Dev 테스트 핸드오프 (갱신 2026-10-16)

> 세션 재개용 라이브 문서. **지금 상태와 남은 일만** 둔다 — 끝난 일·지난 회차의 기록은 남기지 않는다(필요하면 git
> 이력에서 본다. 2026-10-16 정리 전의 판은 `git show e493e8c3:docs/qa/dev-test-handoff.md`). 상태가 바뀌면 이 파일을
> 고친다. 규칙은 `docs/spec/` 가 유일 출처다 — 여기 베끼지 않는다.

## 스토어 상태

| 스토어 | 게재 중 | 대기 | 등록정보 |
| --- | --- | --- | --- |
| Google Play | `34 (1.2.14)` — `PUBLISHED`(2026-10-16) | 없음 | **(B)**(2026-10-16 — 날씨·앱 화면 3개 언어 문장 포함) |
| App Store | 1.2.13(빌드 10) — `READY_FOR_SALE` | 1.2.14(빌드 12) `WAITING_FOR_REVIEW`, `AFTER_APPROVAL`(승인 즉시 출시) | INTERIM(다음 버전 레코드에서 (B)) |

- 확인은 API 로 한다 — Play `releases.list` 의 `releaseLifecycleState`(`PUBLISHED` 여야 게재), ASC `appStoreVersions` 의
  `appStoreState`. 도구는 `.claude/release-tools/`(저장소 밖): `play-probe.mjs`, `asc-1214.mjs state`.
- 선물 상품은 두 스토어에서 지웠다(2026-10-16). 코드로 유료 기능을 여는 길은 초대 코드(INV-) 하나다(`plan-gates.md`).
- 스토어 문구 원본: [`app-store-listing.md`](../product/app-store-listing.md)·[`play-store-listing.md`](../product/play-store-listing.md),
  출시 노트: [`release-notes.md`](../product/release-notes.md).

## 서버·브랜치

- **prod = `main` `13e88b4c`**(#910). 1.2.14 가 전제로 하는 서버(로그인하면 탈퇴 철회 #904, 문서 버전 6 #906)는 prod 에 있다.
- **develop 이 main 보다 앞서 있다** — 아직 prod 에 없는 것:
  - #911 옛 앱 갈래 제거: Android `minSupported`·`latest` 34(강제 업데이트), 문서 버전 6 만 받음, 철회 라우트·유예 예외 삭제.
    ⚠ prod 에 나가면 **iOS 1.2.13 으로 새로 가입하는 사람은 1.2.14 게재 전까지 동의가 409** 다 — 오너가 알고 정했다(iOS 실사용자 없음).
  - #916(머지 뒤) 처리방침 재동의 기준 5 — 기록 3·4 인 사람은 처리방침만 다시 동의한다.
  - #912·#913·#914 는 앱만 바뀐다(다음 앱 릴리스 1.2.15 에 실린다).

## 다음 할 일 (순서대로)

1. [ ] **develop → main**(#911 을 prod 로) — Codex 이슈 없음 → `ci` → 필수 7개 → 머지 → Deploy Backend 초록 →
       `GET /api/app/version?platform=android` 가 34/34 인지 본다. 끝나면 develop 을 main 으로 fast-forward.
2. [ ] **iOS 1.2.14 승인·게재 확인** → `app-version.ts` 의 iOS `minSupported`·`latest` 12 → 이 문서 「스토어 상태」 고치기.
3. [ ] **10/31 기간 한정 개인 플랜을 예정대로 끝낸다**(2026-10-16 오너 확정). 절차는
       [`docs/ops/personal-promo-end-runbook.md`](../ops/personal-promo-end-runbook.md) — 종료 1주 전(10/24) 대상 수 산정,
       끝 시각 모니터링, 끝 + 3일 확인, 11월 중순 정리 PR.
4. [ ] **목소리 등록 동의를 모달 하나로**(2026-10-16 오너 결정, 두 앱 + 스펙 `consent.md`·`voice-and-message.md` §4-1):
       첫 동의 화면의 두 체크("본인·동의받은 목소리만 등록" / "무단 등록 책임은 등록한 사람")를 **없애고**, 목소리
       '만들기' 를 누르면 모달이 떠 **'동의하기' 를 눌러야** 등록 화면으로 넘어간다. ElevenLabs v4 가 요구하는 **목소리
       주인의 확인된 동의**도 이 모달 문구에 넣는다(별도 화면을 만들지 않는다). ⚠ 민감정보(생체) 동의 자체는 선택 동의라
       가입 필수로 옮길 수 없다(개인정보보호법 23조·22조5항) — 이 모달은 그 동의를 대신하지 않는다. 서버가 기록하는
       동의 항목이 바뀌면 `CONSENT_MIN_POLICY_VERSION` 판단도 같이 한다(`consent.md`).
5. [ ] **iOS 목소리 반복 사이 쉼을 안드로이드와 같은 0.9초로**(2026-10-16 오너 결정): 지금 약 0.17초라 문장이 붙어
       들린다. `AlarmSoundStaging.swift` 에서 스테이징할 때 끝에 무음을 붙인다(AlarmKit 이 파일을 그대로 되풀이한다).
       잠금 화면·앱 종료 상태 울림을 실기기로 다시 확인한다(그 파일은 예전에 목소리가 아예 안 울린 이력이 있다 — `CLAUDE.md`).
6. [ ] **유료 게이트의 iOS 갈래를 안드로이드에 맞춘다**(2026-10-16 오너 결정): 지금 iOS 는 비로그인·유료 갈래 모두 [닫기]
       하나다. 안드로이드가 '이용권 보기' 로 이용권 화면에 보내는 자리는 iOS 도 그렇게 바꾼다. 규칙은 `plan-gates.md` §1 표.
7. [ ] **다음 앱 릴리스 1.2.15**(두 앱): #912(구글 로그인 창 닫기를 이슈로 안 올림), #913(Play 사전 출시 로봇을 화면으로 가름),
       #914(강등 안내를 원인과 무관한 한 문장으로 — 무료 강등이면 삭제 기한 한 줄), 위 4·5·6. App Store 레코드는 설명을 **(B)** 로 바꾼다.

## CI

- [ ] **iOS 유닛 테스트 `WeatherVariantSaveTimeoutTests.test_매달린_요청은_상한_안에_미해결로_끝난다` 가 CI 에서 가끔 진다**
      (2026-10-16 develop `3b81a91e` 푸시 실행 — `startCount` 0 ≠ 1, 테스트 2.3초). 상한 0.2초가 느린 러너에서
      URLSession 이 요청을 프로토콜에 넘기기도 전에 끝나 "요청이 실제로 나갔다" 단언이 진다. 같은 코드가 PR 실행에서는
      통과했다 — #911 과 무관한 시간 의존이다. 고칠 때: 상한을 세션 유휴 타임아웃(3초)보다 충분히 짧되 넉넉하게(예: 1초)
      두거나, 요청 시작을 기다린 뒤 상한을 재게 한다. iOS 검사는 필수 체크가 아니라 머지는 막지 않는다.

## 정리할 것 (아무 때나, 급하지 않다)

- [ ] 랜딩 이벤트 `love` 의 배포 창 재시도 걷어내기 — prod 가 `love` 를 받는다(2026-10-16 `POST /api/event/1/clips` 에
      없는 목소리로 `kind: "love"` → 404). 목록은 `apps/landing/components/event/event-api.ts` 의 `DEPLOY_WINDOW_RETRY_DELAYS_MS` 주석.
- [ ] 랜딩 이벤트 옛 종류 `comfort`·`chuseok` 호환 제거 — 백엔드 `lib/event-voices.ts` 의 `LEGACY_EVENT_MESSAGE_KINDS`·
      `EVENT_MESSAGES.comfort`·`.chuseok`, 회귀 `event-clips.test.ts` 의 두 케이스, `apps/landing/public/event/voice1.chuseok.jpg`.
- [ ] 백엔드의 닿지 않는 라이브 생성 코드 삭제 — `/tts/generate` 는 2026-09-23 부터 `random:true` 를 `400 RANDOM_TTS_RETIRED`
      로 거절한다. 남은 것: `tts.ts` 의 `randomRequested` 갈래·동적 문장 블록, `vertex-translate.ts` 의 동적 생성기,
      `GOOGLE_VERTEX_DYNAMIC_TEXT_ENABLED`. ⚠ 등록 미리듣기와 같이 쓰는 헬퍼(`presetTextWithListenerTitle` 등)와 사전렌더 검사는 남긴다.
- [ ] 안 쓰는 워커 시크릿 지우기(있으면): `GOOGLE_VERTEX_MODEL`, `ELEVENLABS_TTS_MODEL_ID` — `npx wrangler secret delete <이름> --env dev`·
      `--env production`, `.dev.vars.*` 의 줄도.
- [ ] 생성 음성(`generated-tts/`)이 DB 행 없이 R2 에 남는 경로 찾기 — 2026-10-16 prod 에서 살아 있는 계정의 고아 파일 11개를
      지웠다(오너 승인). 목소리 삭제·문구 교체가 R2 를 지우는지 본다.
- [ ] Play Console RTDN(Pub/Sub 토픽 + push 구독) 연결 확인 — 없으면 워커가 `503 RTDN_UNCONFIGURED` 이고 구독 전환·해지 알림이
      서버에 안 들어온다.

## 개발 백로그 (예전부터 남은 것, 우선순위 낮음)

- 직접 입력 오디오의 교체 판정을 **기기 시계 없이** — 서버가 `POST /tts/generate` 응답에 쓴 세대를 싣고, 앱이 오디오 옆에 적고,
  `적힌 세대 < 표식` 이면 강등(동등 비교 금지, 세대 없는 옛 사본은 지금 규칙). 프리셋은 이미 시계 없이 판정한다.
- iOS `AlarmSoundStaging` 이 메인 스레드에서 변환을 동기 대기한다 — 비동기로 바꾸면 예약·스테이징 순서가 바뀌므로 실기기 확인과 함께.
  (위 5번과 같은 파일이다.)
- 안드로이드 baseline profile 없음 — macrobenchmark 로 기기에서 생성해야 효과가 있다.
- 실기기 확인 목록(울림 화면·가족 알람·결제·동의 철회 등)은 각 스펙의 「검증 방법」 절이 원본이다. 2026-10-16 전에 이 문서에
  쌓였던 회차별 체크리스트는 옮기지 않았다(정리 전 판에 있다).

## 오너가 정할 것

- 처리방침 재동의 기준은 3 → 5 로 올린다(2026-10-16 오너 결정, #916). 기록 3·4 인 60명(iOS 기기 0)이 앱에 들어오면
  처리방침만 다시 동의한다. #911 과 같은 develop → main 릴리스로 나간다(위 「다음 할 일」 1).
- App Store 프로모션 문구는 넣지 않는다(2026-10-16 오너 결정).

## 알아 둘 사실

- **Sentry 의 Play 사전 출시 로봇** — 기기 이름이 아니라 **화면**(짧은 변 ≤320px·약 106dpi)으로 가른다. `OnePlus8Pro` 와
  `HRY-LX1T` 둘 다 로봇이다(릴리스마다 새 user.id·여러 나라). #913 부터 앱이 그 화면이면 환경을 `prelaunch` 로 찍는다.
- **ElevenLabs 키는 회사 엔터프라이즈 계정**이라 Perso 등 다른 서비스의 목소리가 같이 있다 — 이름으로 우리 고아 클론을 고를
  수 없다(우리 클론은 prod `voice_profiles.elevenlabs_voice_id` 로만 짚는다).
- **prod 잔존 점검**(탈퇴·삭제 뒤 남은 DB 행·R2 파일)은 읽기 전용으로 세고, 지우기는 오너 승인 뒤에 한다. 2026-10-16 에 한 번
  돌려 지웠다(파기된 계정 하나의 DB 3행·R2 9개, 살아 있는 계정의 고아 R2 12개 — 목록은 저장소 밖
  `.claude/handoff/prod-residue-deleted-20261016.json`).
- 이 맥의 함정·도구 위치는 `CLAUDE.md` 와 메모리(`new-mac-migration-2026-10-14`)에 있다.
