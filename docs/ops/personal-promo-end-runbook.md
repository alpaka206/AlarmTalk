# 기간 한정 개인 플랜 종료 — 운영 런북

> 2026-10-16 핸드오프(`docs/qa/dev-test-handoff.md`)에서 옮겼다. 규칙은 스펙이 유일 출처다 —
> [`billing-lifecycle.md`](../spec/billing-lifecycle.md) 「기간 한정 개인 플랜」 · [`gates-and-overlays.md`](../spec/gates-and-overlays.md)
> 「개인 플랜 종료 안내」. 끝 시각은 `@alarmtalk/shared` 의 `PERSONAL_PROMO.endsAt` 한 곳이다(여기 베끼지 않는다).
> 이 문서는 **끝 전후에 사람이 할 일**(리허설·대상 수 산정·모니터링·정리 PR)과 그 배경 기록이다. 끝나고 정리 PR 이
> 머지되면 이 문서를 지운다. **10/31 에 예정대로 끝낸다**(2026-10-16 오너 확정). (선물·쿠폰 코드는 2026-10-12·14 에, 초대 코드와 커플·가족 이용권은 2026-10-20 에 없앴다 — 아래 리허설·확인에는 그 계정이 없다.)

- 스위치는 `PERSONAL_PROMO_STARTS_AT` 하나다 — 없으면 프로모가 없다. prod 는 2026-09-27 에 꺼진 채
  배포(마이그레이션 #121 — 웰컴 그룹 코드 비활성화 포함)됐고 2026-09-28 에 켰다(`docs/qa/dev-test-handoff.md` 의 이력 — git).
- 2026-09-27 리뷰 수정(백엔드): 종료 전환·보관 스윕은 **1분 전용 크론**(`wrangler.toml` 두 환경에
  `"* * * * *"` 추가)이 묶음으로 한다. 공유 목소리는 원시 게이트(보류 그룹 부활 차단), 응답에
  `personal_promo.deletes_voices_at_end` 추가, 삭제 예고 푸시는 개인 플랜 종료 전용 문구, 전역 클론
  상한 200 → 500.
- 2026-09-27 리뷰 2차(백엔드, 스펙 D6~D10): `delete_after` 는 **끝 + 3일보다 이르지 않다**(앞당겨
  나눠 걸던 공식을 걷어냄 — 먼저 전환된 사람이 3일을 못 채웠다). 2,500명 시뮬레이션: 가장 이른
  삭제 = 끝 + 3일 정각, 가장 늦은 삭제 = 끝 + 3일 + 4시간 1분, 약속 시각 전 삭제 0. 약속 시각을
  넘겨 전환된 사람은 전환 + 24시간. 응답에 `personal_promo.computed_at`(서버 계산 시각 — 앱의 낡은
  캐시 판정용), 알람 PATCH 는 `voice_profile_id` 가 **바뀔 때만** 소유권을 본다(보류 주인의 공유
  목소리 알람 토글이 404 로 동기화 실패하던 것), 스윕이 아무도 못 지운 실행은 같은 실행에서 전환으로
  넘어가고 스윕 실패·기한 초과 경보는 시간당 한 번. 푸시의 약속 시각(한국 시간 자정)은 "M월 D일
  밤 12시" 꼴로 적는다("오전 12시" 는 낮으로 읽힌다).
- 2026-09-27 리뷰 3차(백엔드·스펙, 스펙 D11~D16): 알람 PATCH 는 `message_id` 도 **바뀔 때만** 소유권을
  본다(D13 — 안드로이드는 토글마다 주인의 공유 프리셋 클립 id 를 그대로 보내서, 보류 주인의 클립을 쓰는
  멤버 알람이 여전히 404 로 동기화에 실패했다. 재생은 오디오 라우트가 계속 403). 전환 실패 경보도
  시간당 한 번(D14 — 정시에 두 크론 중 맡은 쪽만). 전용 크론의 삭제는 약속 시각 + 하루 꼬리 없이
  남은 전환 대상의 행이 없어질 때까지 돈다(D15 — 지울 것이 없으면 분당 조회 하나). 모든 전환의
  기한 = max(끝 + 3일, 전환 + 24시간) 정시(D16 — 약속 직전 전환도 시각이 적힌 예고와 하루). 2,500명
  재측정: 기기 평균 1.06대 → 가장 늦은 삭제 끝 + 3일 + 4시간 1분, 기기 2대 → + 5시간 39분, 둘 다 약속
  시각 전 삭제 0·한 실행 최대 subrequest 43. 앱 규칙: 종료 안내는 이 진입의 **첫 결과**(실패 포함)가
  진입을 끝낸다(D11 — 두 앱 같게), 낡은 프로모 하나로만 무료인 전경 잠금은 iOS 도 이번 진입의 plan
  반영을 기다린다(D12), plan·프로모 쓰기의 순번 가드는 두 앱 모두.
- 2026-09-27 리뷰 3차 앱 구현(통합 브랜치 `wf/promo-r3-integrated`): 안드로이드 — 계정 요청 실패를
  장부에 적는다(`PersonalPromoLedger.recordAccountFailure`, `AccountEntryAnswer`), `/auth/me` 의 plan·세션
  쓰기 전에 순번을 잡는다(`claimPlanAnswer` — 밀린 답은 세션·스냅샷·plan 반영 표시를 건너뛴다), 이펙트
  갈래를 순수 함수로(`foregroundPlanLockAction`·`deferredPromoLapseLockDue`·`evaluateEndNotice`).
  iOS — 전경 잠금의 낡은 프로모 대기(`PaidVoiceGate.freePlanLockMayApply`·`isFreeOnlyByPromoLapse`,
  `AuthViewModel.planAnsweredEntry`), 세션 밖 `/auth/me` 의 답·토큰만 구른 답·세션 밖 요청의 **실패**
  (`SocialFeatureViewModel.onAccountRequestFailed` → `AuthViewModel.noteAccountRequestFailure` — 통합 때
  더했다. 이게 없으면 세션 밖 갱신이 먼저 실패한 진입에서 뒤의 `refreshUser` 성공이 안내를 판정해
  D11 이 iOS 에서만 느슨했다)도 이 진입의 결과로 적는다.
- 리뷰 3차 뒤 **남은 후속**(이 PR 에서 하지 않았다):
  - (해결) 안드로이드 결제 전 조회의 plan 쓰기도 `/auth/me` 와 같은 순번이다(`crossStoreRenewalBlocked` —
    `claimPlanAnswer`). iOS 는 예약할 때 울릴 시각으로 프로모를 본다(AlarmKit — `billing-lifecycle.md` D1).
  - [ ] iOS 실기기: 끝 직전에 다음날 한 번 울릴 클론 알람을 맞추면 기본 알람음으로 예약되는지, 반복 알람은
    끝 뒤 앱을 열거나 백그라운드 새로고침이 돈 뒤 기본 알람음으로 바뀌는지.
  - (해결 — 2026-10-05 `fix/profile-save-keeps-plan`) 안드로이드 닉네임 수정(`updateNickname` →
    `saveSessionPreservingCurrentToken`)이 PATCH 를 시작할 때 잡은 세션 사용자(plan·`personal_promo`·받은 시각
    포함)를 그대로 저장해, 그 사이 `/auth/me` 가 오면 세션의 plan·프로모가 다음 `/auth/me` 까지 되돌아가던 것.
    판정 스냅샷은 영향이 없었지만 **세션 plan 을 직접 읽는 편집기(`AlarmEditorScreen` 의 `freeVoiceTier`)·목소리
    관리(`VoiceProfileManagementPanel` 의 `paidVoiceAccess`)는 그 사이 무료로 보였다**(클론 숨김·동적 문구 잠금·
    목소리 등록 막힘). 가족 알람 설정 저장·계정 설정 올리기(안드로이드)와 탈퇴 복구 저장(iOS
    `completeAccountRecovery` — 푸시 준비를 기다리기 전의 사본)도 같은 뿌리였다. 이제 바꾼 칸만 쓰는 순간의
    세션 위에 얹고(안드로이드 `AuthSessionStore.updateUserIfAlive` ← `saveProfileEdit`; iOS `updateProfile` 은
    응답을 기다린 뒤 `var updated = current` 에 바꾼 칸만 얹고 → `refreshUser`, `completeAccountRecovery` 는 준비를
    기다린 뒤의 세션에 탈퇴 상태만 — `/auth/me` 경로는 → `reconcileAccountAnswer` 로 다시 다듬기), 저장 뒤 확인
    조회를 한다(`session-and-auth.md` 「프로필 저장은 바꾼 칸만 세션에 적는다」). iOS 확인 조회는 저장 전에 떠난
    조회(옛 이름)가 먼저 와 토큰을 굴려도 '토큰만 구른' 갈래에서 프로필 칸까지 다시 적는다
    (`applyAccountAnswerOnRolledToken` — 리뷰: 그 갈래가 plan·프로모만 적어 이 순서에서 덮지 못했다). 회귀: 안드로이드
    `ProfileSaveKeepsAccountAnswerTest`, iOS `AuthViewModelTests`(닉네임 × 두 도착 순서·탈퇴 복구 두 경로 — 가족 설정
    경우는 2026-10-20 에 그 설정과 함께 지웠다).
  - [ ] 남은 것(낮음): 프로필 저장 뒤 확인 조회까지 실패하면, 저장 **전에** 떠나 옛 이름을 읽은
    `/auth/me` 가 되돌린 칸이 다음 조회까지 남는다(계정 설정만 울타리가 막는다). 확인 조회보다 **뒤에 보낸** plan
    답(안드로이드 결제 전 조회, iOS 세션 밖 `/auth/me`·결제 전 조회 — 프로필 칸은 쓰지 않는다)이 확인 조회의 답보다
    먼저 반영돼도 같다 — 확인 조회의 답이 밀린 답이 된다(두 앱, 세 요청이 겹쳐야 한다). iOS 배경 갱신
    (`BackgroundSyncTask.renewSessionTokenIfNeeded` → `EntitlementWriter.renewSession`)의 plan·프로모 패치는 토큰
    CAS 만 보고 계정 요청 순번은 안 본다 — 그 사이 전경의 결제 전 조회가 더 새 plan 을 썼으면 덮을 수 있다(미검증).
  - Compose 배선은 단위 테스트가 없다 — 종료 안내 이펙트의 키(`accountEntryAnswer`·`anyModalOpen`·
    `activityResumed`·`systemPermissionPromptOpen`)와 `planAnsweredEntry` 재확인 이펙트의 호출 자리.
    iOS 도 `promoLapseLockWaitKey` 가 실제 콜드 스타트에서 잠금을 다시 돌리는지는 순수 함수 테스트뿐이다.
    아래 실기기 확인 항목으로 본다.
  - 백엔드: 전용 크론이 빠진 배포면 첫날의 전환 실패는 로그로만 남는다(D14 — 경보는 전용 크론이 맡는다).
    끝부터 정리 PR 까지 한가한 전용 크론은 분당 조회 하나(D15 — `paid_voice_retention` 에 `delete_after`
    인덱스가 없어 작은 표를 훑는다). 실행 전체가 잡히지 않은 예외로 죽는 경우(`captureCron(
    'scheduled.personal_promo_end', …)` — DB 장애 등)는 시간당 한 번으로 묶이지 않았다.
  - 그대로 남은 확인: 크론 트리거 한도·ElevenLabs 슬롯 500·외부 파일 삭제 드레인(아래 체크리스트),
    정리 PR 의 개인 플랜 종료 분기 제거(아래 ⚠ 정리 PR).
  - 의도적으로 두는 차이(후속 아님): iOS 알럿 버튼 순서는 플랫폼 표준 그대로, 푸시 문구의 자정은 "밤 12시".
    (로그인·가입 성공 응답은 이제 두 앱 모두 이번 진입의 계정 응답으로 적는다 — 안드로이드 `recordSignInAnswer`.)
- [x] 배포 전: Cloudflare 계정의 **크론 트리거 한도**가 워커마다 하나 더(두 환경 합쳐 넷) 허용하는지
      확인한다. ElevenLabs 요금제의 **보이스 슬롯이 500 이상**인지 확인한다 — 작으면 요금제를 올리거나
      `MAX_PROVIDER_CLONE_VOICES`(`lib/voice-slots.ts`)를 요금제에 맞춰 내린다.
      (2026-09-27 조회: 계정의 워커는 `voice-alarm-api`·`voice-alarm-api-dev` 둘, 크론은 지금 3개 → prod
      배포 뒤 4개 — 계정 한도 무료 5·유료 250 안. ElevenLabs 는 두 환경이 같은 enterprise 계정, `voice_limit`
      20000 중 10307 사용.)
- [x] 배포 전: `/admin/promo` 에서 그룹명이 정확히 `welcome` 이 **아닌** 웰컴 계열 코드(대소문자·
      변형)가 있는지 보고, 있으면 토글로 끈다. #121 은 `welcome` 만 잡는다.
      (2026-09-28 prod 조회: 3행 전부 `welcome`·비활성, 변형 그룹 없음.)
- [ ] dev 리허설: `.dev.vars.dev` 에 `PERSONAL_PROMO_STARTS_AT`(과거)·`PERSONAL_PROMO_ENDS_AT`
      (지금 + 10분)을 넣고 `npm run secrets:sync:dev --workspace=backend` → 무료+목소리 / 무료 / 개인 결제
      계정으로 개인 기능이 열리는지(안드로이드 2대·아이폰) → 끝 시각 뒤
      `/auth/me`·게이트·`paid_voice_retention`(끝 + 3일을 **정시로 올린 값** — 그보다 이르면 안
      된다)·푸시 문구("기간 한정 개인 플랜이 끝나 … M월 D일 오전/오후 H시까지만 보관", 자정이면
      "…밤 12시")·1분 크론 로그·앱 잠금과 안내 → 끝을 미래로 되돌려 다시 열리는지. 열려 있는 동안
      `/auth/me` 의 `personal_promo.computed_at` 이 서버 시각으로 오는지도 본다. (그룹 계정 확인은 커플·가족
      이용권을 없애며 뺐다.)
      ⚠ **리허설 값을 지우려면 `npx wrangler secret delete PERSONAL_PROMO_ENDS_AT --env dev`.**
      동기화 스크립트는 빈 값을 건너뛰므로 파일에서 지우는 것만으로는 워커에서 사라지지 않는다.
- [ ] 종료 1주 전: prod 읽기 전용으로 종료 전환 **대상 수와 그들의 기기(push 토큰) 수**를 센다(**베타
      계정 등 기간 전부터 무료였던 계정도 목소리가 있으면 대상이다** — 제품 결정). 삭제는 인원과 무관하게
      끝 + 3일에 **시작**한다. 스윕 묶음이 사람 10명·기기 합 14대 중 먼저 닿는 쪽에서 잘리므로 분당 삭제
      ≈ `min(10, 14 ÷ (기기 ÷ 대상))` 명 — 기기 하나면 2,500명 ≈ 4시간, 둘이면 ≈ 6시간(시뮬레이션 5시간
      39분). 걸리는 시간이 6시간을 넘으면(대략 기기 하나 3,600명·둘 2,500명 초과) 기한 초과 경보가
      울린다 — 삭제는 계속되지만(D15), 그 전에 **묶음·예산 상수**(`lib/personal-promo-end.ts` 의
      `PROMO_END_SWEEP_BATCH`·`PROMO_END_RUN_BUDGET` — 계정의 실행당 subrequest 한도 안에서)를 다시 재고
      시뮬레이션을 그 규모로 돌리는 PR. `RETENTION_OVERDUE_ALERT_MS`(6시간)는 D6 으로 고정이라 올리지
      않는다. 산식·근거는 스펙 [`billing-lifecycle.md`](../spec/billing-lifecycle.md) 「운영」 4.
      ```sql
      SELECT COUNT(*) AS targets,
             COALESCE(SUM((SELECT COUNT(*) FROM push_tokens pt WHERE pt.user_id = u.id)), 0) AS devices
      FROM users u
      WHERE u.plan = 'free'
        AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active')
        AND NOT EXISTS (SELECT 1 FROM paid_voice_retention r WHERE r.user_id = u.id)
        AND EXISTS (SELECT 1 FROM voice_profiles vp
                    WHERE (vp.user_id = u.id OR vp.user_id = u.google_id)
                      AND vp.deleted_at IS NULL AND COALESCE(vp.is_system, 0) = 0
                      AND COALESCE(vp.is_draft, 0) = 0);
      ```
- [ ] 끝 시각 모니터링: `billing.personal_promo_end` 로그(전환은 끝 + 몇 시간 안에 끝난다),
      Sentry `scheduled.personal_promo_end.transition_user`·`.sweep_batch`·`.retention_overdue` 경보
      (셋 다 매시 정각에만 온다 — 로그는 매 실행). 유료 게이트 에러 코드의 `api_error` 증가는 정상이다.
- [ ] 끝 + 3일부터 몇 시간: **전환 대상의 행**(기한이 끝 + 3일 이후) 중 **기한이 이미 지난** 것이 줄어
      0 이 되는지 본다(전용 크론이 첫날 뒤에 지우는 것과 같은 조건 — D15).
      ⚠ **`paid_voice_retention` 전체를 세지 말 것** — 끝 뒤에 끝난 보통 구독의 보관 행은 자기 기한
      (그 시각 + 3일)대로 남아 표가 0 이 되지 않는다. 그걸 스윕 실패로 읽으면 안 된다. 늦게 전환된
      사람(전환 + 24시간 — D16)의 행도 기한 전까지는 남는 게 맞다.
      ```sql
      -- 전환 대상의 행 중 기한이 지났는데 남은 것 — 끝 + 3일 뒤 (규모 산정의 걸리는 시간) 안에 0.
      SELECT COUNT(*) FROM paid_voice_retention
      WHERE delete_after >= '<끝 + 3일 — PERSONAL_PROMO.endsAt + 3일, ISO 8601>'
        AND delete_after <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
      -- 기한을 6시간 넘긴 행(기한 초과 경보와 같은 조건) — 걸리는 시간이 6시간 안이면 언제 봐도 0.
      SELECT COUNT(*) FROM paid_voice_retention
      WHERE delete_after <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 hours');
      ```
- [ ] 앱(리뷰 3차 — D11·D12, 실기기·에뮬레이터 확인 기록 없음): (1) 비행기 모드로 진입해 `/auth/me`
      를 실패시킨 뒤 같은 진입에서 `plan_changed` 푸시·결제 권한 재확인이 와도 종료 안내가
      **뜨지 않는지**(다음 진입에서는 뜬다) — 안드로이드 2대·아이폰. 아이폰은 제어 센터를 열었다 닫는
      새로고침으로도 뜨지 않아야 한다. (2) 끝 뒤 콜드 스타트, 다른 기기에서
      스토어 결제로 원시 유료가 된 계정: 이번 진입의 답이 오기 전에 목소리 알람이 잠기거나
      `무료 이용권으로 바뀌었어요` 가 적히지 않는지 — 특히 **아이폰**(D12 로 새로 맞췄다). (3) 진입
      새로고침이 떠 있는 동안 결제로 유료가 된 뒤 늦게 온 옛 답이 목소리 알람을 다시 닫지 않는지(순번
      가드) — 느린 네트워크에서.
- ⚠ 정리 PR(11월 중순) 전까지 `PERSONAL_PROMO_STARTS_AT` 을 지우지 말 것 — 지우면 종료 전환도
  멈춘다(꺼짐 = 프로모가 없었던 것). 정리 PR 에서 `index.ts` 의 개인 플랜 종료 분기를 뺀다. 1분 크론이
  홀수 분에 비우던 탈퇴 등급 통지 대기열(`pending_plan_notifications`)은 커플·가족 이용권과 함께 없앴으므로
  (표는 마이그레이션 #131 이 지운다 — 그 폐지 뒤로 1분 크론은 매분 종료 분기만 돈다), 종료 분기를 빼면 1분 크론에는 할 일이 없다 —
  그 PR 에서 `wrangler.toml` 두 환경의 1분 크론 트리거도 함께 정리한다.
- ⚠ 커플·가족 이용권 폐지(`docs/qa/dev-test-handoff.md` 「다음 할 일」 2)의 운영 배포는 **2026-10-31 15:00Z ~ 11-04**
  (종료 전환과 끝 + 3일 삭제)를 피한다 — 두 작업이 그 폐지가 고친 코드와 표(`freeDowngradeWrites`·`revokeDeletedVoices`
  ·`voice_profiles`)를 지난다.
- 알려진 한계: 스윕이 삭제 큐에 넣은 **외부 파일**(R2 오디오 — 목소리당 사전렌더 21개 — 와
  ElevenLabs 보이스)은 5분 틱의 `drainExternalDeletions` 가 틱당 10건씩 지운다. 2,500명이면 큐가
  수만 건이라 DB 행이 끝 + 3일 뒤 몇 시간 안에 지워져도 파일 삭제는 며칠~몇 주 더 걸린다. `pending_external_deletions`
  를 지켜보고, 필요하면 드레인 용량을 따로 늘리는 PR.
