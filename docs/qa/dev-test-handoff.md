# Dev 테스트 핸드오프 (갱신 2026-10-18)

> 세션 재개용 라이브 문서. **지금 상태와 남은 일만** 둔다 — 끝난 일·지난 회차의 기록은 남기지 않는다(필요하면 git
> 이력에서 본다. 2026-10-16 정리 전의 판은 `git show e493e8c3:docs/qa/dev-test-handoff.md`). 상태가 바뀌면 이 파일을
> 고친다. 규칙은 `docs/spec/` 가 유일 출처다 — 여기 베끼지 않는다.

## 스토어 상태

| 스토어 | 게재 중 | 대기 | 등록정보 |
| --- | --- | --- | --- |
| Google Play | `34 (1.2.14)` — `PUBLISHED`(2026-10-16) | 없음 | **(B)**(2026-10-16 — 날씨·앱 화면 3개 언어 문장 포함) |
| App Store | **1.2.14(빌드 12)** — `READY_FOR_SALE`(2026-10-18 ASC API 확인) | 없음 | INTERIM(다음 버전 레코드에서 (B)) |

- 확인은 API 로 한다 — Play `releases.list` 의 `releaseLifecycleState`(`PUBLISHED` 여야 게재), ASC `appStoreVersions` 의
  `appStoreState`. 도구는 `.claude/release-tools/`(저장소 밖): `play-probe.mjs`, `asc-1214.mjs state`.
- 선물 상품은 두 스토어에서 지웠다(2026-10-16). 코드로 유료 기능을 여는 길은 초대 코드(INV-) 하나다(`plan-gates.md`).
- 스토어 문구 원본: [`app-store-listing.md`](../product/app-store-listing.md)·[`play-store-listing.md`](../product/play-store-listing.md),
  출시 노트: [`release-notes.md`](../product/release-notes.md).

## 서버·브랜치

- **prod = `main` `13e88b4c`**(#910). 1.2.14 가 전제로 하는 서버(로그인하면 탈퇴 철회 #904, 문서 버전 6 #906)는 prod 에 있다.
- **develop 이 main 보다 앞서 있다** — 아직 prod 에 없는 것:
  - #911 옛 앱 갈래 제거: Android `minSupported`·`latest` 34(강제 업데이트), 문서 버전 6 만 받음, 철회 라우트·유예 예외 삭제.
    iOS 1.2.14 게재를 확인했으며 이번 후속 PR이 iOS `minSupported`·`latest`를 12로 올린다.
  - #917 처리방침 재동의 기준 5 — 기록 3·4 인 사람은 처리방침만 다시 동의한다. 사용 기록 업로드는 동의
    게이트를 거치지 않고 라우트가 직접 보고 받고 버린다.
  - #912·#913·#914 는 앱만 바뀐다(다음 앱 릴리스 1.2.15 에 실린다).

## 다음 할 일 (순서대로)

1. [ ] **[통합 PR #917](https://github.com/alpaka206/AlarmTalk/pull/917)을 develop에 반영** — #915·#916은 닫혔다. 처리방침 재동의·버전 대조·CI 수정과 양 앱 후속을
       한 PR로 모았다. 실기기 확인이 남아 draft이며, 추가 리뷰 요청은 하지 않았다.
       리뷰 후속 수정에는 동의 조회 경합, 동의 전·미래 기록 제외, 기존 목소리 알람의 쉼 적용, 탈퇴 트랜잭션 열기 재시도,
       등록 한도 없는 호환 응답 처리가 포함된다. 추가 회귀 테스트는 작성했으며 로컬 실행은 하지 않았다.
2. [ ] **develop → main** — iOS 1.2.14(문서 6, 빌드 12)는 게재됐다. 이번 PR의 iOS 최소 지원 12와 재동의 기준 5를 함께 낸다.
       리뷰·필수 CI 확인 뒤 머지하고 Deploy Backend 성공, `/api/app/version`의 Android 34/34·iOS 12/12를 확인한다.
       현재 prod iOS 응답은 아직 7/7이다(2026-10-18 읽기 조회). 재동의 뒤 정확한 목록 조회·즉시 동기화는 다음 앱부터이므로,
       새 앱 게재 전 서버를 전환하면 기존 앱의 열린 세션에서는 전체 가입 항목 재수집·다음 동기화까지 지연이 남는다.
3. [ ] **10/31 기간 한정 개인 플랜을 예정대로 끝낸다**(2026-10-16 오너 확정). 절차는
       [`docs/ops/personal-promo-end-runbook.md`](../ops/personal-promo-end-runbook.md) — 종료 1주 전(10/24) 대상 수 산정,
       끝 시각 모니터링, 끝 + 3일 확인, 11월 중순 정리 PR.
4. [ ] **다음 앱 릴리스 1.2.15**(두 앱) — #912·#913·#914와 이번 등록 입구 동의 모달·재동의 후 동기화·iOS 이용권
       버튼·목소리 끝 무음 0.9초를 싣는다. App Store 설명은 (B)로 바꾼다.
5. [ ] **실기기 검증** — iOS 잠금 화면·앱 종료·오프라인 울림(0.9초 쉼), 두 앱 등록 모달의 취소/동의와 미동의자의
       별도 생체정보 동의, 재동의 뒤 가족 알람 수신을 확인한다. 10/18에는 실기기 미연결이라 완료 처리하지 않았다.
6. [ ] **탈퇴 오류 수정 배포 뒤 관찰** — [Sentry 확인 기록](sentry-followup-2026-10-18.md). 실제 기기의 탈퇴 500/Turso 520에
       COMMIT 전 실패만 재시도하는 수정을 넣었다. 배포·운영 재발 확인은 아직이다.

## CI

- iOS CI 의 두 흔들림은 #917에서 고쳤다: 날씨 상한 테스트의 시간 의존(상한 0.2초 → 그 테스트만 1.5초), 로그 업로드
  단계의 일시적 네트워크 실패(`ENOTFOUND`)가 실행을 빨갛게 만들던 것(`continue-on-error`). iOS 검사는 필수 체크가 아니다.

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
  (이번 끝 무음 변경과 같은 파일이다.)
- 안드로이드 baseline profile 없음 — macrobenchmark 로 기기에서 생성해야 효과가 있다.
- 실기기 확인 목록(울림 화면·가족 알람·결제·동의 철회 등)은 각 스펙의 「검증 방법」 절이 원본이다. 2026-10-16 전에 이 문서에
  쌓였던 회차별 체크리스트는 옮기지 않았다(정리 전 판에 있다).

## 확정된 결정

- 처리방침 재동의 기준은 3 → 5 로 올린다(2026-10-16 오너 결정). 기록 3·4 인 60명(iOS 기기 0)이 앱에 들어오면
  처리방침만 다시 동의한다. #911 과 같은 develop → main 릴리스로 나간다(위 「다음 할 일」 2).
- App Store 프로모션 문구는 넣지 않는다(2026-10-16 오너 결정).

## 알아 둘 사실

- **Sentry 의 Play 사전 출시 로봇** — 기기 이름이 아니라 **화면**(짧은 변 ≤320px **그리고** 밀도 <160dpi)으로 가른다.
  #913부터 그 조건이면 `prelaunch`로 찍는다. 기기 이름·미래 시계만으로 로봇이라고 단정하지 않는다.
- **ElevenLabs 키는 회사 엔터프라이즈 계정**이라 Perso 등 다른 서비스의 목소리가 같이 있다 — 이름으로 우리 고아 클론을 고를
  수 없다(우리 클론은 prod `voice_profiles.elevenlabs_voice_id` 로만 짚는다).
- **prod 잔존 점검**(탈퇴·삭제 뒤 남은 DB 행·R2 파일)은 읽기 전용으로 세고, 지우기는 오너 승인 뒤에 한다. 2026-10-16 에 한 번
  돌려 지웠다(파기된 계정 하나의 DB 3행·R2 9개, 살아 있는 계정의 고아 R2 12개 — 목록은 저장소 밖
  `.claude/handoff/prod-residue-deleted-20261016.json`).
- 이 맥의 함정·도구 위치는 `CLAUDE.md` 와 메모리(`new-mac-migration-2026-10-14`)에 있다.
