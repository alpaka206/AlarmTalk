# Dev 테스트 핸드오프 (갱신 2026-10-20)

> 세션 재개용 라이브 문서. **지금 상태와 남은 일만** 둔다 — 끝난 일·지난 회차의 기록은 남기지 않는다(필요하면 git
> 이력에서 본다. 2026-10-16 정리 전의 판은 `git show e493e8c3:docs/qa/dev-test-handoff.md`). 상태가 바뀌면 이 파일을
> 고친다. 규칙은 `docs/spec/` 가 유일 출처다 — 여기 베끼지 않는다.

## 스토어 상태

| 스토어 | 게재 중 | 대기 | 등록정보 |
| --- | --- | --- | --- |
| Google Play | **`36 (1.2.16)` — `PUBLISHED`**(2026-10-25 확인) | 없음 | **(C)**(2026-10-21) |
| App Store | **1.2.16(빌드 14)** — `READY_FOR_SALE`(2026-10-25 확인) · 플러스 구독 `APPROVED` | 없음 | 1.2.16 레코드 |

- 2026-10-26: 두 스토어 1.2.16 게재 확인 뒤 강제 업데이트(`app-version.ts` Android 36·iOS 14)를 올렸다. 옛 앱 호환
  응답 정리는 그다음 서버 릴리스다(`docs/spec/plan-gates.md` 「강제 업데이트」 4).

- 확인은 API 로 한다 — Play `releases.list` 의 `releaseLifecycleState`(`PUBLISHED` 여야 게재), ASC `appStoreVersions` 의
  `appStoreState`. 도구는 `.claude/release-tools/`(저장소 밖): `play-probe.mjs`, `asc-1215.mjs state`.
- 선물 상품은 두 스토어에서 지웠다(2026-10-16). 커플·가족 이용권과 초대 코드는 1.2.16 에서
  걷어냈다(두 스토어 게재 2026-10-25 확인). 옛 앱은 강제 업데이트로 막는다.
  두 스토어의 커플·가족 상품은 2026-10-21 에 정리했다 — App Store 는 두 구독을 **삭제**(구독자 0), Play 는 두 기본
  요금제를 **비활성화**(구매 이력이 있는 상품은 지울 수 없다). 원본 백업은 `.claude/release-tools/group-products-backup-20261021.json`.
  유료 이용권 이름은 '개인' → **'플러스'**(상품 id `personal_monthly` 는 그대로). Play 구독 제목은 바꿨고, App Store 구독
  표시 이름(ko 'AlarmTalk 플러스'·en·ja)은 '제출 준비 중' 판이라 **1.2.16 을 심사에 낼 때 이 구독을 함께 제출**해야 적용된다.
- 스토어 문구 원본: [`app-store-listing.md`](../product/app-store-listing.md)·[`play-store-listing.md`](../product/play-store-listing.md),
  출시 노트: [`release-notes.md`](../product/release-notes.md).

## 서버·브랜치

- **#918은 main에 머지·운영 배포 완료**(2026-10-19, `98a5017f`). 재동의 기준 5·탈퇴 오류 재시도·옛 앱 정리가
  운영에 반영됐다. `/api/app/version`은 Android 34/34·iOS 12/12로 확인했다. Play 35 게재 뒤 Android `latest` 를 35 로
  올린다(#923 — 최소 지원은 34 그대로, main 배포 뒤 다시 확인한다).
- **앱 빌드 출처는 main `bda43e1e`**(#919). Android 1.2.15(35)·iOS 1.2.15(13)이며 정책 문서 버전은 6이다.
  iOS 프로젝트는 이 커밋의 `project.yml`로 XcodeGen을 실행했다. 서버 최소 지원 버전은 이번 앱 제출로 올리지 않는다.
- Android 서명 AAB 빌드와 Sentry 매핑 업로드·원격 UUID 대조, iOS Release archive·IPA export·Apple 검증·업로드가 통과했다. 빌드 13은 `VALID` 확인 후 심사에 연결했다.
  산출물·로그는 기존 네이티브 build/DerivedData 경로, 해시는 저장소 밖 `.claude/release-tools/release-1.2.15.json`에 있다.
- **커플·가족 이용권 폐지 브랜치 `refactor/remove-couple-family-plans`**(develop `9e4fda54` 기준, 아직 develop 머지 전) —
  커플·가족 그룹과 거기에만 딸린 초대 코드·목소리 공유·가족 알람(받은 알람 포함)을 지우고 무료·플러스(옛 이름 개인)만 남긴다. 옛 앱이
  부르는 자리는 상태 없는 호환 응답으로 남긴다(`docs/spec/plan-gates.md` 「커플·가족 이용권 — 폐지」). 마이그레이션
  **#131** 이 그룹 표·열과 커플·가족 상품 행을 지운다(#130 은 develop 에만 있어 운영에는 둘이 함께 간다). 법무 문서는
  **7판**(그룹 내용을 걷어낸 축소 개정, 재동의 없음)이고 서버가 7·6 을 함께 받는다 — 서버가 먼저 나가야 한다.
- **실기기 확인은 이번 출시에서 생략**(2026-10-19 오너 명시 지시). iOS 잠금·앱 종료·오프라인 울림,
  등록 모달과 별도 민감 동의, 재동의 뒤 가족 알람 수신을 실기기 검증 완료로 기록하지 않는다.

## 다음 할 일 (순서대로)

0. [ ] **v1.3 출시** — develop 에 다 들어갔다(main·스토어 업로드 전). 순서·중지·복구·오너 할 일은
       [`v1-3-handoff.md`](v1-3-handoff.md). main 마지막 릴리스는 2026-10-21(#932)이라 아래 2-④(#938·#944)도 같은 릴리스로 나간다.
1. [ ] **1.2.15 App Store 심사·게재 확인** — 앱 변경은 #912·#913·#914·#917을 포함한다. Play 35는 게재됐다(2026-10-19).
       App Store는 `AFTER_APPROVAL`이다. 심사 제출과 실제 게재를 구분해 위 표를 갱신한다.
2. [ ] **커플·가족 이용권 폐지 출시** — 운영(main) 배포와 스토어 작업은 오너가 한다. 순서를 바꾸지 않는다:
       - ① **오너**: App Store Connect·Play Console 에서 커플·가족 상품 판매를 멈춘다(Play 는 기본 요금제 비활성화).
         서버가 그 상품을 `UNKNOWN_PRODUCT` 로 거절하기 시작하므로, 팔리는 채로 두면 애플은 결제만 받고 이용권을
         못 열어 준다(자동 환불도 없다).
       - ② **develop → main**(서버 먼저). develop 머지가 dev 배포와 마이그레이션 #131 을 먼저 돌린다(dev 에는 그룹 행이
         남아 있다). 운영은 #130·#131 이 함께 돈다. 운영 배포 직전에 그룹 잔여(활성 그룹 구독·`users.plan='family'`·
         그룹 상품의 스토어 거래)가 0 인지 읽기 전용으로 다시 센다(2026-10-20 prod 모두 0). ⚠ **2026-10-31 15:00Z ~
         11-04**(개인 플랜 종료와 목소리 정리)는 피한다 — 두 작업이 이번에 고친 코드와 표를 지난다.
       - ③ **1.2.16 두 앱 심사·게재** — 법무 문서 7판을 싣는다. 서버(②)가 먼저 7 을 받아야 가입·재동의가 막히지 않는다.
       - ④ **두 스토어 게재를 확인한 뒤 후속 변경** — `minSupported` 를 1.2.16 빌드(안드로이드 36·iOS 14)로 올리는 강제
         업데이트는 #938 로 develop 에 있다. 옛 앱 호환 응답·`plan.max_members: 1`·정책 6판 수락 제거도 2026-10-26 develop 에
         넣었다(`chore/forced-update-cleanup`). ⚠ 운영에는 #938 과 **같은 릴리스나 그 뒤**에만 나가야 한다 — 먼저 나가면 옛 앱이
         막히기 전에 호환 응답이 사라진다.
         게재 전에 올리면 받을 새 버전이 없어 앱이 벽돌이 된다.
3. [ ] **10/31 기간 한정 개인 플랜을 예정대로 끝낸다**(2026-10-16 오너 확정). 절차는
       [`docs/ops/personal-promo-end-runbook.md`](../ops/personal-promo-end-runbook.md) — 종료 1주 전(10/24) 대상 수 산정,
       끝 시각 모니터링, 끝 + 3일 확인, 11월 중순 정리 PR.
4. [ ] **탈퇴 오류 수정 배포 뒤 관찰** — [Sentry 확인 기록](sentry-followup-2026-10-18.md).
       10/19 서버 수정 배포는 끝났다. 운영 재발 여부는 별도 관찰한다.

## CI

- iOS CI 의 두 흔들림은 #917에서 고쳤다: 날씨 상한 테스트의 시간 의존(상한 0.2초 → 그 테스트만 1.5초), 로그 업로드
  단계의 일시적 네트워크 실패(`ENOTFOUND`)가 실행을 빨갛게 만들던 것(`continue-on-error`). iOS 검사는 필수 체크가 아니다.
- 10/19 develop 검사에서 설정 재전송 테스트(`AuthViewModelTests.testPromptSettingsEditedDuringABusyUploadIsUploadedAfterward`)가
  요청 시작을 완료로 보고 미전송 표시를 일찍 검사했다. 테스트가 두 번째 응답을 붙잡아 전송 중 표시를 확인하고, 응답 처리
  완료까지 기다리도록 수정했다. 수정 후 CI는 확인 전이다. 같은 소스의 main 검사는 통과했고 제출한 빌드 13은 심사 대기 중이다.

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
- 실기기 확인 목록(울림 화면·결제·동의 철회 등)은 각 스펙의 「검증 방법」 절이 원본이다. 2026-10-16 전에 이 문서에
  쌓였던 회차별 체크리스트는 옮기지 않았다(정리 전 판에 있다).

## 확정된 결정

- 처리방침 재동의 기준은 3 → 5 로 올린다(2026-10-16 오너 결정). 기록 3·4 인 60명(iOS 기기 0)이 앱에 들어오면
  처리방침만 다시 동의한다. #918로 2026-10-19 운영에 반영됐다.
- App Store 프로모션 문구는 넣지 않는다(2026-10-16 오너 결정).
- 커플·가족 이용권과 거기에만 딸린 기능(초대 코드·목소리 공유·가족 알람)을 없앤다(2026-10-20 오너 결정 — 공유·서로 맞춰
  주는 기능에서 버그가 계속 났다). 기기에 남은 받은 가족 알람은 업데이트 때 내 알람으로 바뀌고, 목소리는 내 목소리, 없으면
  기본 목소리 미나로 바뀐다. 이번 출시에 강제 업데이트를 건다(올리는 시점은 위 2-④).

## 알아 둘 사실

- **Sentry 의 Play 사전 출시 로봇** — 기기 이름이 아니라 **화면**(짧은 변 ≤320px **그리고** 밀도 <160dpi)으로 가른다.
  #913부터 그 조건이면 `prelaunch`로 찍는다. 기기 이름·미래 시계만으로 로봇이라고 단정하지 않는다.
- **ElevenLabs 키는 회사 엔터프라이즈 계정**이라 Perso 등 다른 서비스의 목소리가 같이 있다 — 이름으로 우리 고아 클론을 고를
  수 없다(우리 클론은 prod `voice_profiles.elevenlabs_voice_id` 로만 짚는다).
- **prod 잔존 점검**(탈퇴·삭제 뒤 남은 DB 행·R2 파일)은 읽기 전용으로 세고, 지우기는 오너 승인 뒤에 한다. 2026-10-16 에 한 번
  돌려 지웠다(파기된 계정 하나의 DB 3행·R2 9개, 살아 있는 계정의 고아 R2 12개 — 목록은 저장소 밖
  `.claude/handoff/prod-residue-deleted-20261016.json`).
- 이 맥의 함정·도구 위치는 `CLAUDE.md` 와 메모리(`new-mac-migration-2026-10-14`)에 있다.
