# 세션 유지 — 한 번 로그인하면 다시 안 한다

## 목표

**한 번 로그인한 사용자는 다시 로그인하지 않는다.** 알람 앱은 앱을 안 열어도 정상
동작하므로(알람은 기기의 `AlarmManager` / AlarmKit 이 울린다) 몇 달씩 안 여는 사용자가
흔하다. 그 사이 세션이 죽으면 다음에 열었을 때 **조용히 로그아웃**돼 있고, 그게 알람
목록·재예약의 소유자 게이트에 걸려 **알람이 사라지고 울리지도 않는** 상태가 된다.

## 왜 '무한 토큰' 이 아닌가

만료를 아예 없애면 유출된 토큰을 **시간으로 끊을 방법이 사라진다**. 남는 수단은 서명
시크릿 교체뿐인데 그건 전원 로그아웃이다. 그래서 만료는 두되, 갱신이 사용자 눈에 안
띄게 돌아 **사실상 무기한**으로 만든다.

| 장치 | 무엇을 하나 |
| --- | --- |
| 긴 TTL | 발급 토큰 수명 **365일** |
| rolling refresh | `GET /auth/me` 가 **매번** 새 토큰을 준다 |
| 앱 오픈 갱신 | 앱을 열면 `/auth/me` 가 돌아 토큰이 굴러간다 |
| **백그라운드 갱신** | 주기 동기화가 **앱을 열지 않아도** 갱신한다 (아래) |
| 즉시 폐기 | `users.token_epoch` +1 → 다음 요청부터 `TOKEN_REVOKED` |

결론: **1년에 한 번이라도 네트워크에 붙는 기기**는 만료를 만나지 않는다.

## 백그라운드 갱신

앱 오픈 갱신만 있으면 "앱을 여는 사람" 에게만 유효하다 — 정작 문제인 **안 여는 사용자**
에게는 아무 소용이 없다. 그래서 이미 도는 주기 동기화가 갱신을 대신한다.

- 판정: 남은 수명이 **90일** 미만이면 갱신한다(TTL 의 약 1/4).
- ⚠ **매 회차 갱신하지 않는다.** 15분 주기에서 그러면 기기당 하루 96회다. 임계값을
  두면 정상 사용에서는 대략 9개월에 한 번이고, 앱을 열어 온 사용자에게는 아예 안 걸린다.
- ⚠ **`exp` 를 못 읽으면 갱신한다.** 못 읽는 토큰은 우리가 모르는 형식이거나 깨진
  것인데, 어느 쪽이든 "만료가 멀다" 고 단정할 근거가 없다. 여기서 "갱신 안 함" 을
  택하면 갱신이 영영 안 돌아 조용한 로그아웃으로 끝난다 — 헛걸음 한 번이 훨씬 싸다.
- ⚠ **갱신 실패로 동기화를 재시도로 밀지 않는다.** 갱신은 알람 동기화의 전제 조건이
  아니다. 네트워크가 잠깐 나빴다는 이유로 이미 받아 둔 알람 pull 까지 통째로 버리게 된다.
- ⚠ **저장 직전에 세션을 다시 확인한다.** 네트워크 왕복 중 로그아웃·계정 전환이 끼면
  **비운 저장소에 끝난 세션을 되쓴다.** 안드로이드는 세션 세대로
  (`saveTokenIfGeneration` — 판정과 쓰기가 한 덩어리), iOS 는 저장 직전 **토큰** 재확인으로
  막는다.
- ⚠ **iOS 의 비교 대상은 사용자 id 가 아니라 토큰이다**(코덱스 #734). 같은 계정으로
  로그아웃→재로그인하면 **id 는 그대로**라, 로그아웃 전 토큰으로 인가된 늦은 응답이
  새 세션에 그대로 박힌다. `applyRolledToken`·`applyFreshPlan`·`refreshUser` 가 전부
  출처 토큰을 대조한다.
- ⚠ **401 도 마찬가지다 — 그리고 그건 중앙에서 처리된다.** `AlarmTalkAPI` 가 모든 401 에
  알림을 쏘고 `AuthViewModel` 이 받아 로그아웃하는데, 그 알림에 **실패한 요청의 토큰**을
  싣지 않으면 늦게 온 A 의 401 이 **방금 만든 B 의 세션을 끊는다.** 개별 호출부에서 막아도
  이 경로가 남는다. 디바운스도 **토큰별**이어야 한다 — 안 그러면 옛 토큰의 401 이 3초 창을
  차지해 지금 세션의 진짜 401 이 삼켜진다.
  토큰 없는 로그인 요청이나 출처를 알 수 없는 알림의 401 은 현재 세션을 끊지 않는다.
- ⚠ **JWT 서명은 검증하지 않는다.** 이 값은 **판단이 아니라 일정**에 쓴다. 위조된 exp 로
  할 수 있는 최악은 갱신을 한 번 더 시도하는 것뿐이고, 진짜 판정은 서버가 한다.

## 토큰이 굴러도 화면은 다시 불러오지 않는다

rolling refresh 는 **같은 세션 안에서** 토큰을 바꾼다. 그러니 "세션이 바뀌었나" 를 토큰으로
가르면 안 된다 — 토큰이 굴러갈 때마다 앱이 새로 로그인한 것처럼 전부 다시 불러온다.
2026-09-29 효율 감사에서 안드로이드 콜드 스타트 한 번에 요청이 **57건**(필요한 것은 그 절반
이하) 나간 주원인이 이것이었다(H3).

- **안드로이드 앱 루트의 세션 효과와 탭 새로고침 스로틀은 계정 + 세션 세대를 키로 쓴다**
  (`SessionEffectKey`). 계정 전환, 로그아웃 뒤 재로그인(**같은 계정 포함** — 세대가 오른다)에서만
  다시 돈다. ⚠ 계정 id 만으로는 부족하다 — 같은 계정 재로그인에서 동의·계정 확인이 다시 돌지
  않는다.
- 키가 토큰이 아니므로 어디서 굴리든 화면을 다시 불러오지 않는다. 그래도 **굴릴 이유가 없는
  자리에서는 굴리지 않는다** — 세션 쓰기·관찰 방출·재구성만 는다.
  - **굴린다**: 콜드 스타트의 첫 진입 갱신(위 「앱 오픈 갱신」), 사용자가 한 일(로그인·구매·
    복원·쿠폰·해지·그룹 나가기) 뒤의 갱신, 플랜 변경 신호(`plan_changed`) 뒤의 갱신과 그 신호로
    도는 워커.
  - **만료가 가까울 때만 굴린다**(위 「백그라운드 갱신」의 90일 판정): 주기 동기화 워커, 기본
    목소리 프리페치 워커. 프리페치 워커는 plan 을 지금 받아야 해서 `/auth/me` 를 늘 부르지만,
    받은 토큰은 이 판정을 거쳐서만 저장한다 — 예전에는 콜드 스타트마다 진입 갱신이 방금 굴린
    토큰을 한 번 더 굴렸다.
  - **굴리지 않는다**: 백그라운드에서 돌아올 때의 `/auth/me`(plan·프로모만 받는다), 프로필·계정 설정
    저장 뒤의 확인 조회(아래 「프로필 저장은 바꾼 칸만 세션에 적는다」 — iOS 는 굴린다, 그 토큰이 옛 답을 가른다), **Play 자동
    정합화 뒤의 갱신**(H4). 정합화는 앱 시작·알람 탭 진입마다 도는 구독 재확인에서 오는데,
    거기서 굴리면 토큰을 키로 쓰던 탭 효과가 다시 돌아 또 정합화하는 고리가 생겼다(Play 로
    결제한 사용자가 홈에 있는 동안 3~5초마다 15건 이상).
- 굴리지 않아도 잃는 것이 없다 — 서버 토큰은 무상태 JWT(365일)라 지금 토큰이 그대로 유효하다.
- **iOS** 는 아직 탭 새로고침 스로틀 키에 토큰이 들어 있다(`MainTabsView.refreshForSelectedTab`
  의 `throttleKey`). 같은 감사의 iOS 묶음에서 계정 기준으로 맞춘다 — 규칙은 두 앱이 같다.

## 프로필 저장은 바꾼 칸만 세션에 적는다

`PATCH /user/me`(닉네임·가족 알람 설정·계정 설정)의 결과를 세션에 적을 때는 **그 저장이 바꾼 칸만**,
**쓰는 순간의 세션** 위에 얹는다. 요청 **전에** 잡아 둔 세션의 사본을 다시 저장하지 않는다(2026-10-05).

- 사본을 저장하면 요청이 도는 사이 다른 경로가 적은 값을 되돌린다 — `/auth/me`(진입·복귀 갱신, 쿠폰·초대
  등록 뒤의 갱신, `plan_changed`, 다른 기기 결제)가 적은 plan·프로모·받은 시각, 다른 기기에서 바꾼 이름·가족
  설정, 계정 설정 올리기가 적은 지역·사주. 다음 `/auth/me` 까지 세션(디스크 포함)에 남는다. plan 은 plan 답만
  쓴다([billing-lifecycle.md](billing-lifecycle.md) 「plan·프로모 쓰기의 순번 가드」의 프로필 저장 항목).
- 토큰도 저장소의 것을 지킨다(Codex #665 P2 — 그 사이 굴러간 토큰을 옛 것으로 덮지 않는다). 세션이 그 사이
  끝났거나 다른 계정이 됐으면 아무것도 적지 않는다(위 「저장 직전에 세션을 다시 확인한다」).
- 안드로이드는 읽기·확인·쓰기를 세션 쓰기 락 안에서 한 덩어리로 한다(`AuthSessionStore.updateUserIfAlive` ←
  `MainViewModelAuthActions` 의 `saveProfileEdit`). 바꾼 칸이 무엇이든 plan·프로모는 저장소의 짝으로 다시
  박는다. iOS 는 `MainActor` 라 응답을 기다린 **뒤에** 읽은 세션 위에 얹는다(`AuthViewModel.updateProfile`).
- 저장이 끝나면 **확인 조회**를 한 번 한다 — 저장 **전에** 떠난 `/auth/me` 가 옛 이름·가족 설정을 싣고 늦게
  와도, 확인 조회가 그 뒤에 덮거나(옛 답이 먼저 온 경우) 옛 답이 순번에 밀려 버려진다(확인 조회가 먼저 온 경우 —
  안드로이드 `claimPlanAnswer`, iOS 는 확인 조회가 굴린 토큰에 걸린 옛 답이 밀린 답이 되어 아무것도 쓰지 않는다).
  안드로이드는 토큰을 굴리지 않는다(`rollToken = false`, 위 「토큰이 굴러도…」). iOS 는 굴린다 — 그 토큰이 옛 답을
  가르는 에폭이다.
  - ⚠ **iOS 에서 옛 답이 먼저 오면 토큰이 이미 굴러 있다**(2026-10-05 리뷰). 서버는 `/auth/me` 마다 토큰을 굴리므로
    (`routes/auth.ts`), 확인 조회의 답은 보낸 토큰이 지금 세션 토큰과 달라 '토큰만 구른 같은 로그인' 갈래
    (`isTokenRolledWithinSignIn`)로 온다. 그 갈래도 밀리지 않은 답이면 plan·프로모와 함께 **프로필 칸(이름·가족 설정·
    계정 설정 — 울타리는 따른다)까지** 지금 토큰 위에 적는다(`AuthViewModel.applyAccountAnswerOnRolledToken` — 토큰·
    탈퇴 유예만 지금 세션 것). 예전에는 그 갈래가 짝만 적어, 저장도 확인 조회도 성공했는데 옛 이름·가족 설정이 다음
    `/auth/me` 까지 남았다. 안드로이드는 토큰이 아니라 세대로 가르므로(`saveSessionIfAlive`) 같은 경우에 응답 전체를 쓴다.
  - 남는 틈(두 앱): 확인 조회까지 실패하면 그 칸은 다음 `/auth/me` 까지 옛 값일 수 있다 — 계정 설정만 울타리가 그
    틈까지 막는다([voice-and-message.md](voice-and-message.md) §5-1). 확인 조회보다 **뒤에 보낸** plan 답(안드로이드
    결제 전 조회, iOS 세션 밖 `/auth/me`·결제 전 조회 — 프로필 칸은 쓰지 않는다)이 확인 조회의 답보다 먼저 반영돼도
    같다 — 확인 조회의 답이 밀린 답이 되어 프로필 칸을 쓰지 않는다.
- **탈퇴 복구 저장도 같다**(iOS — 아래 「탈퇴 예약을 취소해 복구할 때」).

## 세션을 끊는 경우

백그라운드에서 갱신한 세션은 영속 저장소와 전경 메모리에 함께 수렴한다. 갱신 이후의
push/pull은 새 토큰을 사용한다. 옛 요청의 401은 저장소에 이미 갱신된 세션을 지우지 않는다.
인증 실패를 받은 일괄 전송은 그 회차를 멈추고, 아직 시도하지 않은 행을 실패로 표시하지 않는다.

만료가 아니라 **명시적 사건**으로만 끊는다.

| 사건 | 어떻게 |
| --- | --- |
| 로그아웃(이 기기) | 로컬 세션 삭제 + **알람 전부 끄기**([alarm-lifecycle.md](alarm-lifecycle.md) 1-1) |
| 전 기기 로그아웃 · 비밀번호 재설정 | `token_epoch` +1 → 옛 토큰 전부 `TOKEN_REVOKED` |
| 탈퇴 | 계정 삭제 + **알람 전부 끄기**(같은 규칙) |

⚠ **네트워크 실패·5xx 를 세션 만료로 읽지 말 것.** 401 만 만료다. `/auth/me` 는 앱을
열 때마다 도는 자리라 여기서 잘못 판정하면 피해가 크다 — 그래서 백엔드도 DB 장애를
401 이 아니라 **503** 으로 낸다.
JWT 서명 설정 누락도 서버 장애(503)이며 사용자 토큰 만료가 아니다.
JWT 는 유한한 숫자 만료 시각이 필수이고, 현재 시각이 `exp` 에 도달하면 만료다.

## 탈퇴 파기 — 서버가 지우는 것과 남기는 것

탈퇴 신청(`POST /user/me/deletion`)은 계정을 `pending_deletion` 으로 두고 30일 뒤 크론이
파기한다(`index.ts` 의 유예 파기 — 틱당 2건). 즉시 삭제(`DELETE /user/me`)도 같은 두 함수를
같은 순서로 부른다: `pseudonymizeBillingForRetention` → `purgeUserAccount`(한 쓰기 트랜잭션).
처리방침의 약속은 "서버 데이터를 영구 삭제하되, 법정 보존 결제 기록만 가명처리해 분리
보관한다" 이다(`docs/legal/privacy-policy.ko.md` 3장).

**파기 뒤 남는 것은 셋뿐이다.** 그 밖에 사람을 가리키는 값(계정 id·로그인 id·이메일·애플 id·
푸시 토큰·이름)이 남으면 버그다.

| 남는 것 | 왜 남나 | 언제 사라지나 |
| --- | --- | --- |
| `retained_billing_records` | 전자상거래법 5년. 사람 대신 `pseudonym = SHA-256(id:pepper)` 와 스토어 거래 증빙만 | 거래일 + 5년(`retain_until`, 크론) |
| `pending_external_deletions` | 지울 파일·클론의 **주소**(R2 키는 `voices/<id>/…` 처럼 사람 id 로 시작) | 크론이 지우는 순간(`drainExternalDeletions`) |
| 남의 행이 가리키던 옛 id | 받은 사람의 수신 기록(tombstone)·사용 기록 등 **남의 데이터**. 가리키던 내 행이 전부 없어져 더는 풀리지 않는다 | 그 주인의 규칙대로 |

⚠ **키가 사람 id 인 표를 빼먹기 쉽다.** `user_id` 열이 없어도 사람을 가리킬 수 있다 —
직접 입력 월 한도 장부(`manual_tts_usage`)는 풀 키가 **계정 id 그대로**(개인 풀)이거나
**내가 소유한 그룹 id** 라 2026-09-30 까지 파기 뒤에도 남았다. 남은 계정 id 는 서버가 가진
pepper 로 가명 보존 기록까지 곧장 이어져, 분리 보관을 무너뜨린다. 받은 사람 소유의 녹음
문구(`family-voice`)도 `audio_url` 이 내 업로드 키(`voices/<내 id>/…`)라 같은 이유로 남았다 —
지금은 전달 알람이 사라진 고아는 지우고, 남는 행은 키만 비운다. 가족 녹음 원본은 프로필에
안 묶여 7일 TTL 이 `voice_uploads` 행을 먼저 지우므로, 업로드 행이 아니라 **키 앞머리**
(`voices/<id>/`)로도 찾는다. 그렇게 찾은 키는 문구를 지우거나 비우기 **전에** 삭제 큐에
옮긴다 — TTL 은 이제 행 삭제와 큐 적재를 한 트랜잭션으로 묶지만([voice-and-message.md](voice-and-message.md)
§11), 그 전에 따로 커밋하다 끊긴 녹음은 R2 파일의 키를 아는 곳이 그 문구뿐이다.

⚠ **목소리 철회는 구독 취소보다 먼저다.** 그룹 주인의 구독을 끊으면 그 자리에서 그룹이
해체되고 내가 보낸 목소리 알람이 무료 강등으로 문구를 잃는다. 철회(`revokeDeletedVoices`)가
그 뒤에 돌면 **동석 멤버도, 수신 확인 전 알람도 못 찾아** tombstone 도 푸시도 없이 받는
사람 기기에 탈퇴자의 녹음이 남는다(2026-09-30 까지 유료 사용자의 탈퇴가 전부 그랬다).

⚠ **그룹 주인의 탈퇴는 멤버의 등급도 바꾼다.** 구독 취소가 소유 그룹을 해체하므로 멤버는
가족 → 무료 등으로 내려간다. 그 멤버들에게는 **클론 유무와 무관하게** 커밋 뒤 `plan_changed`
(+보관 유예가 걸렸으면 삭제 예고)를 보낸다 — 목소리 철회 통지와 별개다
([billing-lifecycle.md](billing-lifecycle.md) 「그룹 주인이 탈퇴하면」).

**표가 새로 생기면** `test/account-purge-residue.test.ts` 의 `TABLES` 가 먼저 깨진다 —
사용자 데이터가 들어가는 표라면 거기 심고 파기가 지우게 만든 뒤 분류한다.

## 탈퇴 유예 — 다시 로그인하면 철회 (2026-10-15)

**30일 안에 자격증명으로 다시 로그인하면 탈퇴가 철회된다.** 버튼을 한 번 더 누르는 단계는 없다.
앱의 탈퇴 안내 문구가 처음부터 "그 전에 다시 로그인하면 탈퇴를 취소할 수 있어요" 였는데, 실제로는 로그인 뒤
'회원 탈퇴가 진행 중이에요' 화면에서 철회 버튼을 눌러야 했다 — 그 화면을 두 앱에서 지웠다(오너 결정).

- **철회는 자격증명 로그인에서만**(이메일 `/auth/login`·`/auth/google`·`/auth/apple` — `cancelPendingDeletionOnSignIn`).
  토큰 갱신(`GET /auth/me`)은 철회하지 않는다 — 사람이 자격증명을 다시 넣은 순간만 '계속 쓰겠다' 로 읽는다.
  비밀번호가 틀린 로그인은 아무것도 바꾸지 않는다. ⚠ **철회는 응답이 다 준비된 뒤 마지막 쓰기다**(코덱스 #904) —
  토큰 서명·계정 조회·프로모 조회가 실패해 로그인이 실패로 끝났는데 철회만 남으면 안 된다.
  ⚠ **로그인이 처음 읽은 그 상태에 묶는다**(첫 조회의 `deletion_requested_at`·`token_epoch`). active 로 읽은 로그인이
  끝나기 전에 다른 기기가 새로 낸 신청을 조용히 철회하면, 신청한 사람은 성공을 받았는데 파기 예약만 사라진다. 그 사이
  신청·전 기기 로그아웃으로 상태나 세대가 바뀌었으면(`superseded`) 로그인을 실패로 돌린다 — 서명한 토큰을 곧바로 쓸 수
  없다(다시 로그인하면 새 상태를 읽어 처리한다). 파기 크론이 계정을 지웠으면(`missing`) 마찬가지로 실패다.
- **탈퇴 신청은 모든 기기의 세션을 끊고 그 계정의 푸시 등록을 지운다**(`POST /user/me/deletion` 이 한 트랜잭션에서
  `token_epoch + 1` · `push_tokens` 삭제). 그래야 '다시 로그인하면 철회' 가 어느 기기에서나 같다 — 세션이 남은
  기기는 로그인 화면을 거치지 않으니 철회할 길 없이 모든 요청이 403 인 채로 남는다. 2026-10-15 전에는 신청한 기기만
  스스로 로그아웃했다.
- **유예 계정이면 끊긴 토큰에도 401 이 아니라 403 `ACCOUNT_PENDING_DELETION` 으로 답한다**(`authMiddleware`·`/auth/me`
  — 폐기 검사보다 먼저 본다, 코덱스 #904). 다른 기기가 `TOKEN_REVOKED` 를 받으면 자동 만료로 읽어 알람 예약을 남기고,
  로그인 화면 뒤에서 보이지도 끌 수도 없는 알람이 운다. 철회·푸시 해제 두 허용 경로는 그대로 폐기 검사를 지난다 —
  폐기된 토큰으로 철회되면 안 된다. `/auth/me` 의 이 403 에는 계정 내용을 싣지 않는다.
- **앱은 유예를 보면 그 기기에서 계정을 떠난다** — 알람까지 끄는 명시적 로그아웃(탈퇴를 신청한 기기와 같은 로컬 정리),
  자동 만료가 아니다. 안드로이드 `checkAccountStatus` → `leaveAccountForPendingDeletion` / iOS `refreshUser` →
  `leaveAccountForPendingDeletion`(계정 응답의 `pending_deletion` 이든 `/auth/me` 의 403 이든). 서버 쪽 정리는 없다 —
  신청이 이미 세션을 끊고 푸시 등록을 지웠다. **안드로이드 워커도 같은 떠나기를 한다**(`syncWorkerOutcome` →
  `SESSION_EXPIRED` → `endWorkerSession` 이 이 코드를 보고 `leaveAccountAfterPendingDeletion` — 자동 만료가 아니다).
  서버가 푸시 등록을 지워 백그라운드 기기를 깨울 다른 길이 없으니 403 을 본 워커가 그 자리에서 정리해야 한다(코덱스 #904).
- **탈퇴 신청은 그 계정의 다른 기기에 무음 신호 `account_deletion_requested` 를 보낸다**(`sendAccountDeletionRequestedPush`
  — 지우기 전에 읽어 둔 토큰으로, 커밋 뒤 `waitUntil`). 기기는 서버에 다음 요청을 보낼 때까지 세션이 끊긴 줄 모르고
  그 사이 화면은 로그인된 채 알람이 운다 — 이 신호가 그 창을 줄인다. 앱은 **신호만 믿고 떠나지 않는다**(그 사이 철회됐을
  수 있다): 안드로이드는 알람 pull 워커를 곧바로 돌려 403 이면 그 워커가 떠나고, iOS 는 `refreshUser` 로 다시 묻는다.
  최선 노력이다 — iOS 무음 푸시는 배달이 보장되지 않고 강제 종료한 앱은 깨우지 않는다. 옛 앱은 모르는 종류라 무시한다.
  ⚠ 유예 화면·철회 버튼을 되살리지 말 것. 워커가 이 403 을 '성공으로 끝내기' 로 따로 다루던 시도는 입력을 든
  작업(목소리 교체 신호)·요금제 대조를 잃는 땜질을 줄줄이 불렀다(#901~#903).
- **안드로이드는 어느 요청이든 403 `ACCOUNT_PENDING_DELETION` 을 받으면 떠난다** — 응답 쪽 한 곳(`AlarmTalkApiClient` 의
  인터셉터 → `UnauthorizedHandler.onAccountPendingDeletion`). 계정 확인(`checkAccountStatus`)은 세션 키가 바뀔 때만 돌아,
  프로세스가 살아 있는 채 전경으로 돌아오면 닿지 않는다(코덱스 #904). iOS 는 전경 복귀마다 `refreshUser` 가 돈다.
- **푸시 등록은 계정이 active 일 때만 적힌다**(`pushRegisterStatements` 의 `INSERT … SELECT … WHERE EXISTS` — 다른 계정의
  같은 토큰 행을 지우는 DELETE 에도 같은 조건. 유예 계정의 늦은 등록이 그 행만 지우면 다른 계정이 푸시를 놓친다). 미들웨어를
  이미 지난 등록 요청이 탈퇴 신청 뒤에 커밋되면 유예 계정에 푸시 행이 되살아난다 — 조건을 그 문장 안에 둬 원자적으로 막는다.
- **iOS 는 자동 만료(401)에서도 기기의 푸시 등록 확인을 내린다**(`signOut` 의 자동 만료 갈래 → `onServerRemovedPushRegistration`
  → `PushNotificationCoordinator.invalidateRegistration` — 등록·해제와 **같은 줄**에서. 줄 밖에서 비우면 응답을 기다리던 앞선
  등록이 끝나며 확인을 도로 적는다).
  탈퇴 신청으로 서버 행이 지워진 뒤 다른 기기가 철회하면 이 기기는 유예 코드 대신 `TOKEN_REVOKED` 를 받는데, 확인이 남으면
  같은 실행에서 다시 로그인해도 등록을 건너뛴다.
- 탈퇴를 신청한 기기는 푸시 해제를 따로 보내지 않는다 — 서버가 지웠고, 신청 뒤의 토큰은 이미 폐기됐다(iOS 는 기기 쪽
  등록 기록만 비운다 — `onServerRemovedPushRegistration`).
- **파기 직전에 다시 본다.** 파기 크론이 대상을 고른 뒤 트랜잭션에 들어가기 전에 다시 로그인해 철회했을 수 있다 —
  트랜잭션 안에서 **아직 유예이고 기한이 지났는지**를 다시 보고, 아니면 지우지 않는다(`index.ts`). 기한까지 보는 이유:
  철회한 뒤 다시 신청하면 상태는 또 유예지만 기한은 30일 뒤다. **애플 연결 해제는 파기가 커밋된 뒤에** 한다 — 먼저
  끊으면 철회된 계정이 파기는 건너뛰면서 애플 연결만 잃는다(코덱스 #904).
- 옛 앱(1.2.13 이하)의 철회 버튼(`DELETE /user/me/deletion`)은 그대로 받는다. 그 앱도 서버가 로그인에서 철회하므로
  유예 화면을 보지 않는다.
- ⚠ 개인정보 처리방침 3장의 "계정은 즉시 비활성화되어 로그인과 이용이 중단되며, 30일의 유예 기간 동안 철회할 수
  있습니다" 는 **1.2.14 앱 릴리스의 문서 개정(버전 6)에서** "30일 안에 다시 로그인하면 철회된다" 로 고친다 — 문서
  버전은 앱과 짝이다(CLAUDE.md 「법무 문서 버전」).

## 탈퇴 예약을 취소해 복구할 때

> 2026-10-15 부터는 위 「다시 로그인하면 철회」가 기본 경로다. 아래는 1.2.13 이하에서 유예 화면에 머물던 세션이
> 올라왔을 때의 iOS 복구 처리(`completeAccountRecovery`)와 옛 앱의 철회 버튼 경로로 남아 있다.

서버가 복구 성공을 확인한 뒤 **현재 기기의 푸시 등록도 다시 시작한다.** 탈퇴 대기 중에는
푸시 등록 API가 403으로 차단되므로, 같은 계정 id로 정상 화면만 열어서는 등록이 복구되지
않는다. iOS는 launch에서 연결한 복구 준비 훅을 **await**해 기존 등록/해제 큐에 들어간 뒤
**복구 계정과 일치하는 등록 캐시의 서버 확인을 별도 플래그로 영속 무효화**한다.
그 준비가 끝나기 전에는 세션의 active 저장과 미완료 탈퇴 표시 해제를 하지 않는다.
그 뒤 **해당 계정의 미완료 탈퇴 표시·정리용 토큰을 먼저 지우고 active 세션을 저장/게시**한다.
반대로 하면 그 사이 앱 종료 시 active 세션과 옛 탈퇴 표시가 함께 남아 다음 실행에서 알람을
끄고 로그아웃할 수 있다. 표시 해제 뒤 저장 전에 종료되면 저장된 pending 세션이 남아
다음 조회에서 복구를 다시 완료한다. 다른 계정의 표시는 보존한다.
⚠ **복구 저장은 준비를 기다린 뒤의 세션 위에 만든다**(2026-10-05). 탈퇴 상태만 `active` 로 바꾸고 나머지는
**그때의** 세션 것이다 — 기다리기 **전에** 잡은 사본을 저장하면, 준비를 기다리는 사이 반영된 plan·프로모(결제 전
조회·세션 밖 `/auth/me` 처럼 토큰을 굴리지 않고 plan 을 쓰는 답)를 되돌린다(위 「프로필 저장은 바꾼 칸만 세션에
적는다」와 같은 뿌리). `/auth/me` 로 복구를 확인한 경로는 그 응답을 기다린 뒤 **다시 다듬는다** — 밀린 답이면
plan·프로모는 지금 세션의 짝, 계정 설정 울타리 이하면 설정도 지금 세션의 것(`AuthViewModel.reconcileAccountAnswer`
— 일반 조회와 같은 규칙).
이 순서로 로컬 복구 상태를 확정한 뒤 동기 완료 훅으로 APNs 토큰을 다시 요청한다. 해제는 서버에서
성공했지만 응답만 유실된 경우에도 같은 토큰을 POST해야 한다. 기기 토큰과 소유자는 남겨
재등록 실패 후 로그아웃에서도 정확한 계정만 해제할 수 있게 하고, 다른 계정의 등록 캐시는 건드리지 않는다.
무효화는 영속적이므로 재등록이 실패하거나 프로세스가 종료돼도 다음 등록에서 재시도한다.
알림 권한 팝업이나 전체 앱 재시작을 전제로 하지 않는다.
**탈퇴 취소는 재시도 가능해야 한다.** 서버에서 복구됐는데 응답만 유실돼도 같은 요청을 다시
보내면 active 계정에는 성공을 반환한다. 이미 active인 행은 다시 수정하지 않으며, 계정 없음이나
알 수 없는 상태를 active로 되살리지 않는다. 상태 확인과 취소는 같은 쓰기 트랜잭션에서 한다.

iOS는 네트워크/5xx/응답 해석 실패와 구서버의 `NO_PENDING_DELETION`을 받으면 `/auth/me`로
현재 상태를 재확인한다. 응답 해석 실패에는 `APIError.invalidResponse`뿐 아니라 실제 API의
`JSONDecoder`가 전달하는 `DecodingError`(잘린 JSON·필수 필드 누락·타입 불일치·null)도 포함한다.
실패 응답 자체를 복구 성공으로 읽지 않는다. **pending → active가
확인되면 요청 재시도뿐 아니라 일반 계정 조회에서도 동일한 복구 완료 처리**를 수행한다:
푸시 재등록 준비의 영속화, 해당 계정의 미완료 탈퇴 정리 표시 해제, 세션의 active 저장, APNs 시작.
재실행 시에는 저장된 세션의 pending 상태도 전환 근거로 사용한다. active 재조회로 반복
재등록하지 않고, 복구 전에 시작한 늦은 조회가 다시 pending으로 덮어쓰지도 못하게 한다.
재확인이 실패하거나 여전히 pending/알 수 없는 상태이면 복구를 확정하지 않는다.
`/auth/me`의 탈퇴 상태는 명시적 문자열이어야 한다. 누락/null/빈 문자열을 레거시 세션 모델의
기본 active로 보완해 복구 근거로 사용하지 않는다. pending 재확인에서 서버가 새 토큰을
발급한 경우에는 그 조회가 실제 적용한 토큰으로 실패 안내를 계속한다. 외부 세션/토큰 교체와는 구분한다.
취소된 요청 또는 요청 중 세션/토큰이 바뀐 경우에도 복구 상태와 푸시 훅을 적용하지 않는다.

## Apple 서명 키 교체

서버의 Apple JWKS 캐시에 토큰의 `kid`가 없으면 10분 캐시 유효기간과 별개로 재조회하되,
**키 ID·IP와 무관한 isolate 공통 30초 조회 간격**을 지킨다. 첫 조회·실패한 조회도 간격에
포함하여 콜드 캐시에서 연속 두 번 조회하거나 임의 kid를 바꾸어 제한을 우회할 수 없게 한다.
겹친 조회는 공유한다. 간격 제한 중 새 kid는 거절하며, 간격이 지나면 다음 요청에서 다시
조회할 수 있다. 실패로 기존 정상 캐시를 덮지 않으며 아직 유효한 기존 키는 계속 검증한다.
재조회에도 키가 없거나 조회·서명·issuer/audience/nonce 검증이 실패하면 거절한다.

## 이메일 인증 코드 — 가입과 비밀번호 재설정 (2026-10-11)

가입과 비밀번호 재설정은 메일로 보낸 **6자리 코드**로 주소의 주인을 확인한다. 판정은 서버 한 곳
(`routes/auth.ts` 의 `checkEmailVerificationCode`)이고, 인증 확인(`POST /auth/email-code/verify`)·가입
(`POST /auth/register`)·재설정 확정(`POST /auth/password-reset/confirm`) 셋이 **같은 판정**을 지난다.
숫자는 `lib/email-verification.ts` 가 유일 출처다.

| 규칙 | 값 | 서버의 답 |
| --- | --- | --- |
| 유효한 코드 | 그 주소·그 용도(가입 / 재설정)로 보낸, 아직 쓰지 않은 코드 중 **가장 새 것 하나**(같은 초에 보낸 둘이면 나중에 넣은 것) | 다른 숫자는 `400 AUTH_EMAIL_CODE_INVALID` |
| 수명 | 발급 뒤 **10분**(`EMAIL_VERIFICATION_TTL_SECONDS`) | 지나면 `400 AUTH_EMAIL_CODE_EXPIRED` |
| 틀린 횟수 | 코드 하나에 **5번**(`EMAIL_VERIFICATION_MAX_ATTEMPTS`) — 틀릴 때마다 센다. 같은 순간에 온 요청에도 지켜진다(아래) | 다섯 번 틀린 뒤로는 **맞는 코드도** `429 AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED` |
| 다시 받기 간격 | **60초**(`EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS`) | 그 안에 보낸 **가장 새 코드**(판정에 쓰일 코드)를 **아직 쓸 수 있으면** 요청을 **보내지 않고 성공**으로 답한다. 그 코드가 상한에 닿았거나 이미 쓰였으면 기다리지 않고 **새 코드를 보낸다** — 그보다 앞 코드는 간격을 붙잡지 않는다 |
| 하루 발급 수 | 주소·용도마다 최근 24시간에 **10번**(`EMAIL_VERIFICATION_DAILY_CAP`) | 넘으면 **보내지 않고 성공**으로 답한다 |

- **새 코드를 받으면 앞의 코드는 죽는다.** 서버는 가장 새 것만 본다 — 먼저 온 메일의 숫자를 넣으면 숫자가
  멀쩡해도 `AUTH_EMAIL_CODE_INVALID` 이고, **틀린 횟수로 센다.** (60초 안의 다시 받기는 앞의 코드를 아직 쓸
  수 있으면 새 코드를 만들지 않으므로, 그때는 앞의 코드가 그대로 살아 있다.)
- **코드를 쓰면 앞의 코드도 함께 죽는다.** 가입·재설정이 성공하면 그 주소·그 용도의 쓰지 않은 코드를
  **전부** 쓴 것으로 적는다(UPDATE 한 문장). 판정에 쓴 코드 하나만 적으면 바로 앞 코드가 '가장 새 것' 으로
  올라와 제 수명(10분)까지 다시 통한다 — 메일의 "가장 최근에 받은 코드만" 이 거짓이 되고, 재설정이면 방금
  바꾼 비밀번호를 그 앞 코드로 한 번 더 바꿀 수 있다(2026-10-11 까지 그랬다). 다른 용도·다른 주소의 코드는
  건드리지 않는다.
- 판정 순서는 **없음 → 만료 → 상한 → 대조**다. 형식이 틀린 값(6자리 숫자가 아니다)은 판정 **전에**
  `400 AUTH_VALIDATION_FAILED` 로 돌아가고 횟수를 세지 않는다.
- 상한은 **코드마다** 센다. 새 코드는 0부터다 — 상한에 닿은 사람이 할 일은 **다시 받기** 하나다.
- **상한은 같은 순간에 온 요청에도 지켜진다**(2026-10-11). 줄을 읽고(SELECT) 숫자를 대조한 뒤, **상한 확인과
  세기를 한 문장으로** 확정한다 — `UPDATE … SET attempts = attempts + ? WHERE id = ? AND attempts < 5`(틀렸으면
  +1, 맞았으면 +0). 그 문장이 0행이면 읽은 뒤 그 사이에 상한이 찬 것이라 **맞는 숫자도** 429 다. 예전에는 읽은
  횟수로 상한을 보고 틀리면 따로 +1 했다 — 같은 순간에 온 요청은 모두 상한 아래를 읽어 **보낸 수만큼 대조받았고**
  (맞는 숫자가 섞여 있으면 통과했다) 횟수는 5를 넘어 올라갔다. 상한의 일은 코드 하나에 대한 추측을 다섯 번으로
  묶는 것이다.
  - ⚠ 상한 확인과 세기를 두 문장으로 나누지 말 것. **맞는 코드도 그 문장을 지나야 통과한다** — 맞는 코드만 읽은
    값으로 통과시키면, 같은 순간에 온 추측들 가운데 맞는 하나는 상한과 상관없이 통과한다. 맞는 코드는 +0 이라
    횟수를 쓰지 않는다(인증 확인과 가입이 같은 코드를 두 번 판정해도 둘 다 통과한다).
- **다시 받기 간격은 가장 새 코드만 붙잡는다**(2026-10-11). 다시 받기 두 번이 같은 순간에 오면 둘 다 간격을
  지나 코드가 둘 생긴다(간격 확인과 INSERT 사이). 판정은 가장 새 것만 보므로 앞 코드는 이미 쓸 수 없는데,
  예전에는 그 앞 코드가 틀린 횟수 0 인 채로 간격을 붙잡았다 — 가장 새 코드가 상한에 닿은 뒤 최대 60초 동안
  다시 받기가 '보내지 않은 성공' 이었다(아래 막다른 길과 같다). 앞 코드는 판정에도 간격에도 쓰이지 않는다 —
  메일의 "가장 최근에 받은 코드만" 그대로다.
  - '가장 새 것' 은 발급 시각(`created_at` — **초 단위**)으로 고르고, 같은 초면 **나중에 넣은 줄**(`rowid`)이다.
    판정과 간격이 같은 순서(`ORDER BY created_at DESC, rowid DESC`)를 쓴다 — 둘이 서로 다른 줄을 '가장 새 것' 으로
    고르면 판정에 쓰이지 않는 코드가 간격을 붙잡는다.
- **상한에 닿았거나 이미 쓴 코드는 다시 받기 간격을 붙잡지 않는다** — 곧바로 누른 다시 받기가 새 코드를
  받는다. 붙잡으면 막다른 길이다: 두 앱은 상한에서 "다시 받아 주세요" 라고 하는데, 그 다시 받기가 '보내지
  않은 성공' 으로 끝나 앱은 '보냈어요' 라고 하고 메일은 오지 않으며, 든 코드는 맞는 숫자도 429 다
  (2026-10-09 의 그 사람은 코드를 받은 지 34초 만에 상한에 닿았다). 남용(메일 폭탄·추측)은 **하루 상한**과
  인증 요청 한도(`authRateLimitMiddleware`)가 막는다 — 간격은 속도만 늦췄고, 하루 총량은 하루 상한이 정한다.
- 인증 확인은 코드를 **쓰지 않는다**(소모는 가입·재설정이 성공할 때다). 가입은 같은 코드를 **한 번 더**
  판정한다 — 그래서 인증을 통과하고도 가입 버튼을 누를 때 10분이 지났으면 가입이
  `AUTH_EMAIL_CODE_EXPIRED` 로 거절된다(아래 「거절 뒤에 할 일이 화면에 있어야 한다」).
- **보내지 않은 성공은 진짜 발송과 응답이 같다**(`success: true`). 앱은 둘을 구분하지 못한다. 재설정
  요청은 비밀번호 계정이 아닌 주소에도 같은 성공으로 답한다(계정이 있는지 드러내지 않는다). 가입 쪽
  요청은 이미 가입된 주소면 409 다([error-codes.md](error-codes.md) §4).

**왜 이 절이 생겼나.** 2026-10-09 prod(안드로이드 1.2.10)에서 신규 가입자 한 명이 거절된 같은 여섯 자리를
3초 사이에 다섯 번 보내 상한을 태웠고, 그 뒤의 429 에도 "인증 코드가 맞지 않아요" 만 들었다. 그 화면은
코드를 다시 받아도 옛 숫자를 칸에 남겼고(꽉 찬 칸에 치는 새 숫자는 버려진다), 그 사람은 이메일 가입을
끝내지 못했다. 서버 규칙은 그때도 지금도 같다 — 틀린 것은 **앱이 그 규칙을 말하지도 따르지도 않은 것**이다.
(iOS 도 같은 모양인데 이 실패를 Sentry 에 올리지 않아 보이지 않았을 뿐이다 — 2026-10-11 부터 올린다.
인증 코드 다섯 갈래가 안드로이드와 같은 글자로 보고한다([error-codes.md](error-codes.md) §3 「앱의 묶음 키」).)

### 문장은 코드(error_code)로 고른다

세 자리 모두 공용 표를 부른다([error-codes.md](error-codes.md) §4 — 표를 부르는 아홉 자리).

| 서버의 답 | 말하는 것 | 사용자가 할 일 |
| --- | --- | --- |
| `AUTH_EMAIL_CODE_INVALID` | 인증 코드가 맞지 않아요. 다시 확인해 주세요. | 다시 친다 / 다시 받는다 |
| `AUTH_EMAIL_CODE_EXPIRED` | 인증 코드가 만료됐어요. 다시 받아 주세요. | 다시 받는다 |
| `AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED` | 인증 코드를 너무 많이 틀렸어요. 다시 받아 주세요. | 다시 받는다 |
| 그 밖의 코드(`RATE_LIMITED`·`INTERNAL_ERROR` 등) | 표의 그 문장 | 그 문장대로 |
| 표에 없는 코드(세 라우트의 5xx `AUTH_EMAIL_CODE_VERIFY_FAILED`·`AUTH_REGISTER_FAILED`·`AUTH_PASSWORD_RESET_FAILED`, `AUTH_VALIDATION_FAILED` 등) · 코드 없는 응답(워커 앞단의 5xx · 읽지 못한 본문) | 그 화면의 폴백 — 인증 확인은 `잠시 문제가 생겼어요. 잠시 후 다시 시도해 주세요.`, 가입·재설정은 그 화면의 실패 문장 | 같은 숫자로 다시 누른다 |
| 연결 실패(오프라인 · 시간 초과 — 응답이 없다) | 안드로이드는 위와 같은 폴백. **iOS 는 OS 가 준 연결 오류 문장일 수 있다**(오프라인·시간 초과를 시스템의 말로 알린다) — 폴백 헬퍼 `userFacingErrorMessage` 가 `NSURLErrorDomain` 오류의 설명이 있으면 그것을 쓴다([error-codes.md](error-codes.md) §4) | 연결을 확인하고 같은 숫자로 다시 누른다 |

- ⚠ **'맞지 않아요' 를 폴백으로 두지 않는다.** `AUTH_EMAIL_CODE_INVALID` 일 때만 말한다. 폴백으로 두면
  상한(429)도 네트워크 실패도 "틀렸다" 로 읽혀, 맞는 코드를 든 사람이 숫자만 다시 본다.
- 가입 화면에서는 그 문장을 **코드 줄 가까이**(가입 화면의 인라인 오류 자리)에 보인다. 화면 맨 아래 상태
  줄에만 두면 숫자 키패드 뒤에 놓일 수 있다 — iOS 숫자 키패드에는 닫는 키가 없다.
- 같은 요청을 겹쳐 보내지 않는다 — 확인이 도는 동안의 두 번째 탭은 버린다.

### 거절된 숫자를 칸에 남기지 않는다

- 서버가 코드를 거절하면(**`AUTH_EMAIL_CODE_INVALID`·`AUTH_EMAIL_CODE_EXPIRED`·
  `AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED`** — 세 자리 어디서든) **코드 칸을 비운다.**
- **다시 받기가 성공해도** 비운다.
- 왜 둘 다인가:
  - 확인 버튼은 6자리가 찼을 때만 눌린다. 칸이 비면 **방금 거절된 숫자를 그대로 다시 보낼 수 없다** —
    연타가 횟수를 태우지 못한다.
  - 칸은 6자에서 자른다. 꽉 찬 칸에 새 코드를 치면 **한 글자도 안 들어간다** — 비우지 않으면 다시 받은
    뒤에도 옛 숫자가 나간다.
- ⚠ **비우는 것은 그 셋뿐이다.** 네트워크·5xx·`RATE_LIMITED`·`AUTH_VALIDATION_FAILED` 는 코드가 거절된
  것이 아니다 — 숫자를 그대로 두어 다시 누를 수 있게 한다.
- ⚠ **판정은 코드로 한다 — 번역되는 문장으로 하지 않는다.** 화면이 "맞지 않아요" 라는 글자를 비교해
  칸을 비우면 en·ja 기기에서 조용히 어긋난다. 뷰모델이 **신호 하나**를 올리고 화면은 그것만 본다.
  오류 문장 상태에 얹지 않는다 — 그 상태는 쓰는 곳이 여럿이라(요청·확인·가입·화면 전환) 함께 지워지지
  않는다.
- '보내지 않은 성공'(간격·하루 상한)에도 칸은 비워진다 — 앱이 구분할 수 없다.
  - **간격**으로 보내지 않았다면 가장 새 코드를 아직 쓸 수 있다는 뜻이다(상한에 닿았거나 쓴 코드는 간격을
    붙잡지 않는다 — 위 표). 가장 새 메일의 숫자를 치면 된다.
  - **하루 상한**이면 그렇지 않다. 새 코드가 오지 않으므로, 든 코드가 상한에 닿았거나 만료됐으면 최근
    24시간에 보낸 코드 수가 상한 아래로 내려갈 때까지 그 주소로는 그 일(가입 / 재설정)을 마칠 수 없다. 하루
    상한은 남용 한도라 일부러 둔다.
- '거절된 숫자를 기억해 두었다가 막는' 방식은 쓰지 않는다 — 고쳐 친 숫자를 막을 위험이 있고, 비우기가 같은
  일을 상태 없이 한다.

### 거절 뒤에 할 일이 화면에 있어야 한다

문장이 시키는 일(다시 확인 · 다시 받기)을 화면이 막으면 문장을 고친 것이 소용없다.

- **가입 화면 — 인증 확인 단계**: 코드 줄과 `인증 코드 다시 받기` 가 이미 함께 있다.
- **가입 화면 — `POST /auth/register` 가 코드를 거절했을 때**(위 셋): **'인증 완료' 상태를 내린다.** 코드 줄과
  다시 받기가 돌아온다. 예전에는 '이메일 인증 완료' 인 채로 다시 받기가 꺼져 있었다 — 안드로이드는 그
  주소로는 프로세스가 죽을 때까지 풀리지 않았다(코드를 받은 지 10분이 지난 뒤 가입 버튼을 누르면 그렇게 된다).
- **재설정 화면**: 코드를 보낸 뒤에도 요청 버튼이 `인증 코드 다시 받기` 로 **눌린다**(가입 화면과 같은 말).
  코드 칸은 비운 채 남긴다. 예전에는 한 번 보내면 '코드를 보냈어요' 로 잠겨, 다시 받으려면 화면을 나갔다
  와야 했다.
- **가입 화면 — 다시 받기가 실패했을 때**: 코드 줄을 **닫지 않는다.** 실패 문장은 인증 묶음의 인라인 오류
  자리(코드 줄 아래)에 둔다 — 다시 받기를 누르는 사람은 대개 방금 "…다시 받아 주세요" 를 읽은 사람이다. 닫으면
  코드 줄과 그 답을 함께 잃고, 답은 화면 맨 아래 상태 줄(키패드 뒤)로 간다. iOS 가 2026-10-11 까지 그랬다 —
  요청 결과를 코드 줄을 여는 값에 그대로 대입했다. 칸의 숫자도 그대로 둔다(코드가 거절된 것이 아니다).
- `AUTH_EMAIL_TAKEN` 의 로그인 화면 전환은 그대로다([error-codes.md](error-codes.md) §4).

### 코드는 ASCII 숫자 여섯 자다 — 앱 1차 · 서버 2차

서버의 형식 검사는 ASCII 숫자만 받는다. 아라비아-인도·페르시아·전각 숫자를 내는 키보드로 친 코드는
형식에서 떨어져 **횟수도 세지 않고 영영 통과하지 못한다** — 화면은 그동안 "맞지 않아요" 라고 했다.

- **앱 1차 — 새니타이저는 앱마다 하나.** 가입·재설정 두 화면의 코드 칸이 같은 함수를 거친다. 유니코드
  십진 숫자는 **같은 값의 ASCII 숫자**로 바꾸고, 숫자가 아닌 것(공백·하이픈·글자·분수·원문자)은 버리고,
  6자에서 자른다. 메일 본문을 통째로 붙여도 여섯 자리만 남는다. 화면마다 `isDigit`·`isNumber` 필터를 따로
  쓰지 않는다 — 그 둘은 ASCII 가 아닌 숫자를 **그대로** 통과시킨다. 강제: `scripts/check-input-sanitizers.py`
  (CI lint) — 인증 화면에서 숫자를 거르거나 6자로 자르는 입력 핸들러는 이 새니타이저를 불러야 한다.
- **서버 2차 — shared 스키마의 변환 하나.** `EmailVerificationCodeSchema` 가 먼저 **앞뒤 공백**(줄바꿈
  포함 — 붙여 넣은 값)을 걷고, 아라비아-인도(U+0660–0669)·페르시아(U+06F0–06F9)·전각(U+FF10–FF19) 숫자를
  ASCII 로 바꾼 **뒤에** 6자리 검사를 한다. 세 라우트가 같은 스키마를 쓰므로 한 곳에서 끝나고, 해시도 바뀐
  값으로 만든다. **코드 안의 글자**(가운데 공백·하이픈·글자·세 블록 밖의 숫자 — 데바나가리 등)는 손대지
  않는다 — 여전히 `AUTH_VALIDATION_FAILED` 이고 횟수를 세지 않는다. 앞뒤 공백만 붙은 값은 형식 오류가 아니라
  대조까지 간다(틀리면 횟수를 센다). 스토어에 나가 있는 앱에 닿는 길은 이것뿐이다.
- ⚠ 이것은 2026-10-09 의 원인이 **아니다** — 그때는 횟수가 세졌다(ASCII 여섯 자가 대조까지 갔다는 뜻이다).
  같은 화면의 다른 구멍이고, 그런 키보드를 쓰는 지역의 사용자가 이미 들어와 있어 함께 막는다.

### 메일 — 세 언어로, 가장 새 코드만 된다고 말한다

- 한 메일에 **한국어·영어·일본어**를 함께 쓴다. 코드를 요청할 때 서버는 그 사람의 언어를 모른다(요청에는
  주소뿐이다). 예전에는 한국어뿐이었다.
- 본문에 **"가장 최근에 받은 코드만 쓸 수 있어요"** 를 적는다(세 언어). 위 표의 첫 줄을 사용자가 아는
  유일한 자리다.
- **가입 메일은 제목에 코드를 넣는다.** 제목이 메일마다 달라져 메일 앱이 한 대화로 묶지 않고, 알림에서
  바로 읽힌다. 예전 제목은 늘 같았다 — 같은 제목은 한 대화로 묶이기 쉽고, 묶이면 **먼저 온 메일**이 먼저
  보인다(2026-10-09 의 그 사람이 앞의 코드를 넣었는지는 확인하지 못했다 — 서버에는 해시만 남는다).
- ⚠ **재설정 메일은 제목에 코드를 넣지 않는다.** 제목은 잠금 화면 알림에 그대로 뜬다 — 재설정 코드는
  비밀번호를 바꿀 권한이라, 잠긴 폰을 잠깐 손에 넣은 사람이 **계정을 가져갈 수 있다.** 가입 코드는 아직
  없는 계정의 주소 확인이라 그럴 것이 없다. 두 메일을 "같게 맞추자" 며 재설정 제목에 코드를 넣지 말 것.

## 구현 지도

| 규칙 | 백엔드 | 안드로이드 | iOS |
| --- | --- | --- | --- |
| TTL 365일 | `lib/jwt.ts` `DEFAULT_TTL_SECONDS` | — | — |
| Apple 서명 키 교체 | `lib/apple-oauth.ts` `verifyAppleIdToken`·공유 JWKS 재조회 | — | 기존 로그인 응답 소비 |
| rolling refresh | `routes/auth.ts` `GET /me` 의 `rolledToken` | `MainViewModel` 앱 오픈 경로(첫 진입만 — `refreshAppSessionNow` 의 `rollToken`·`sessionTokenToSave`) | `AuthViewModel.refreshUser` |
| 갱신 판정(90일·못 읽으면 갱신) | — | `network/SessionTokenRenewal.kt` | `SessionTokenRenewal.swift` |
| 화면 효과의 세션 키 = 계정 + 세대(토큰 아님) | — | `network/AuthSessionStore.kt` `SessionEffectKey`·`sessionEffectKey` → `AlarmTalkApp` 의 세션 효과·탭 스로틀 | `MainTabsView.tabRefreshThrottleKey`(탭 + 계정 — 재로그인은 `MainTabsView` 가 새로 만들어져 표가 비워진다) · 목소리·더보기 탭은 `EntryRefreshFreshness`(계정 + 앱 진입) |
| 프리페치 워커는 만료가 가까울 때만 토큰 저장 | — | `sync/StockClipPrefetchWorker.kt` `workerRolledTokenToSave` | — |
| 자동 정합화 뒤 갱신은 토큰을 굴리지 않음 | — | `MainViewModelBillingActions.kt` `purchaseConfirmRollsToken` | — |
| 백그라운드 갱신 | — | `sync/RemoteAlarmSyncWorker.renewSessionTokenIfNeeded` | `BackgroundSyncTask.renewSessionTokenIfNeeded` |
| 저장·메모리 세션 수렴 | — | `MainViewModel`의 세션 저장소 관찰 | `AuthViewModel.absorbStoredSession`·`handleUnauthorized` |
| 전경 push의 첫 인증 실패 중단 | — | `AlarmSyncService.syncWithBackend` | `RemoteAlarmPushSync.runOnce` |
| 저장 경합 방지 | — | `AuthSessionStore.saveTokenIfGeneration`·`saveSessionIfAlive` | `AuthViewModel` 의 출처 **토큰** 재확인(`refreshUser`·`applyRolledToken`·`applyFreshPlan`) |
| 프로필 저장은 바꾼 칸만 쓰는 순간의 세션 위에(plan·프로모·받은 시각·토큰은 그대로) + 확인 조회 | `PATCH /user/me`(`user.ts`) | `AuthSessionStore.updateUserIfAlive` ← `MainViewModelAuthActions` 의 `saveProfileEdit`(`updateNickname`·`updateFamilyAlarmSettings`·`uploadDynamicPromptSettings`) → `refreshAppSession(rollToken = false)`·`refreshAppSessionNow(rollToken = false)` · 회귀 `ProfileSaveKeepsAccountAnswerTest.kt` | `AuthViewModel.updateProfile`(응답 뒤 `var updated = current`) → `refreshUser`(옛 답이 먼저 와 토큰이 굴렀으면 `isTokenRolledWithinSignIn` → `applyAccountAnswerOnRolledToken` 이 프로필 칸까지) · 회귀 `AuthViewModelTests`(확인 조회와 옛 답의 두 도착 순서 — 닉네임·가족 설정) |
| 다시 로그인하면 탈퇴 철회 · 신청은 모든 기기 세션·푸시 등록을 끊는다 · 유예 세션은 끝난 세션 · 파기 직전 재확인 | `lib/account-deletion.ts` 의 `cancelPendingDeletionOnSignIn` ← `routes/auth.ts` 의 `/login`·`/google`·`/apple` · `routes/user.ts` 의 `POST /me/deletion`(`token_epoch + 1`·`push_tokens` 삭제, 한 트랜잭션) · `lib/fcm.ts` 의 `sendAccountDeletionRequestedPush`(신청 커밋 뒤) · `index.ts` 파기 트랜잭션의 재확인(유예 + 기한)·커밋 뒤 애플 연결 해제 · `middleware/auth.ts`·`/auth/me` 는 유예면 끊긴 토큰에도 403 · 회귀 `test/sign-in-cancels-deletion.test.ts`·`test/scheduled-purge-isolation.test.ts`·`test/auth-pending-deletion.test.ts` | `ui/main/MainViewModelAuthActions.kt` 의 `checkAccountStatus` → `leaveAccountForPendingDeletion`(알람까지 끄는 떠나기) · 워커 `sync/SyncWorkerFailure.kt` 의 `endWorkerSession` → `leaveAccountAfterPendingDeletion`(백그라운드판) · `fcm/AlarmTalkMessagingService.kt` 의 `account_deletion_requested` → `RemoteAlarmSyncScheduler.runOnce` · 유예 화면 없음 | `AuthViewModel.refreshUser` → `leaveAccountForPendingDeletion` · 탈퇴 신청 뒤 `onServerRemovedPushRegistration`(기기 쪽 등록 기록만, 등록과 같은 줄 — `invalidateRegistration`) · `PushNotificationCoordinator` 의 `accountDeletionRequested` → `refreshUser` · 회귀 `PushRegistrationRecoveryTests`(`test_invalidationQueuesBehindAnInFlightRegistration`·`test_accountDeletionRequestedSignalAsksTheServerAgain`) · `RootView` 에 유예 게이트 없음 |
| 탈퇴 복구 저장은 준비 뒤의 세션 위에(1.2.13 이하에서 올라온 유예 세션) | `user.ts` 탈퇴 취소 | — (유예 화면·철회 버튼을 2026-10-15 에 지웠다) | `AuthViewModel.completeAccountRecovery`(기다린 뒤 `latest` · `/auth/me` 경로는 `reconcileAccountAnswer` 로 다시 다듬기) · 회귀 `AuthViewModelTests` |
| 401 중앙 처리 | — | `UnauthorizedAuthenticator` | `AlarmTalkAPI.unauthorizedNotification`(**실패한 토큰을 싣는다**) → `AuthViewModel.handleUnauthorized` |
| 즉시 폐기 | `authMiddleware` 의 `token_epoch` 비교 | — | — |
| 탈퇴 취소 뒤 푸시 재등록 | `authMiddleware` 탈퇴 대기 허용 경로·`user.ts` 탈퇴 취소 | 로그인(`onSignedIn`) → `registerCurrentToken` — 철회는 로그인 자체다 | `AuthViewModel.prepareAccountRecovery` → `PushNotificationCoordinator.prepareAccountRecovery`를 await한 뒤 상태 확정 → `onAccountRecovered` → `start`(launch에서 연결) |
| 탈퇴 파기 범위(남는 것 셋뿐) | `lib/account-deletion.ts` `purgeUserAccount`(유예 파기 `index.ts`·즉시 삭제 `user.ts` 공용) · 회귀 `test/account-purge-residue.test.ts` | — | — |
| 그룹 주인 탈퇴 — 멤버 등급 통지 | `purgeUserAccount` 가 같은 트랜잭션에서 `pending_plan_notifications` 에 적재 → 커밋 뒤 `sendPlanNotificationsNow`(`user.ts`) · 1분 전용 크론 홀수 분 `runPlanNotificationDrainTurn`(`index.ts`) → `notifyBillingStateChanged` · 회귀 `test/account-purge-plan-push.test.ts`·`test/pending-plan-notifications.test.ts` | 기존 `plan_changed` 처리 | 기존 `plan_changed` 처리 |
| 탈퇴 취소 응답 유실·재확인 | `user.ts` DELETE 멱등 처리(이미 active는 무변경 성공) | — (철회 버튼이 없다) | `cancelAccountDeletion` 재확인·`refreshUser` 전환 감지 → `completeAccountRecovery` |
| 인증 코드 판정(가장 새 것 하나 — 같은 초면 나중에 넣은 것 · 10분 · 틀린 5번 → 429 — 상한 확인과 세기는 한 문장이고 맞는 코드도 지난다(+0) · 다시 받기 60초·하루 10번은 보내지 않는 성공 · 간격은 가장 새 코드만 붙잡는다 · 상한에 닿았거나 쓴 코드는 간격을 붙잡지 않는다 · 쓰면 그 주소·용도의 쓰지 않은 코드가 모두 죽는다) | `routes/auth.ts` 의 `checkEmailVerificationCode`(`/email-code/verify`·`/register`·`/password-reset/confirm` 공용 — 읽기는 `ORDER BY created_at DESC, rowid DESC`, 대조 뒤 상한 확인과 세기는 `UPDATE … SET attempts = attempts + ? WHERE id = ? AND attempts < ?` 한 문장 — 0행이면 맞는 코드도 429)·`shouldSkipEmailCodeSend`(`/email-code`·`/password-reset` 공용 — 간격·하루 상한. 간격은 쓰지 않은 줄 가운데 판정과 같은 순서의 가장 새 것 하나만 본다)·`consumeEmailVerificationCodes`(`/register`·`/password-reset/confirm` 이 성공한 뒤 — 주소·용도의 쓰지 않은 줄 전부를 UPDATE 한 문장으로. 인증 확인은 부르지 않는다) · 숫자는 `lib/email-verification.ts`(`EMAIL_VERIFICATION_TTL_SECONDS`·`EMAIL_VERIFICATION_MAX_ATTEMPTS`·`EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS`·`EMAIL_VERIFICATION_DAILY_CAP`) · `test/auth.test.ts`(「다시 받기 간격」 — 상한에 닿은 코드·쓴 코드는 10초 만에도 새 코드, 4번 틀린 코드는 간격을 붙잡는다, 하루 상한은 그대로 · 「코드를 쓰면…」 — 소모 문장의 대상·인자 · 「POST /auth/email-code/verify」 — 상한 문장의 인자(틀리면 +1, 맞으면 +0)·0행이면 맞는 코드도 429) · `test/auth-email-code-consume.test.ts`(진짜 SQLite — 새 코드로 마친 뒤 앞 코드는 400, 다른 용도·주소의 코드는 그대로, 인증 확인은 쓰지 않는다) · `test/auth-email-code-attempts.test.ts`(진짜 SQLite — 읽은 뒤 상한이 찬 틀린 코드·맞는 코드는 429·횟수 5 그대로 / 같은 순간 열 번 틀리면 400 다섯·429 다섯 / 네 번 틀린 뒤 인증 확인과 가입이 둘 다 통과 / 같은 순간 두 번 보낸 다시 받기의 앞 코드는 간격을 붙잡지 않는다) | 응답 소비 | 응답 소비 |
| 인증 코드 거절 문장은 코드로('맞지 않아요' 는 `AUTH_EMAIL_CODE_INVALID` 만) | 세 라우트가 `errorBody(check.code, …)` 로 같은 코드를 낸다 | `ui/main/MainViewModelAuthActions.kt` 의 `emailCodeFailureMessage` ← `confirmEmailVerification`·`register`·`confirmPasswordReset` · 회귀 `EmailCodeFailureMessageTest` | `AuthViewModel.emailCodeErrorMessage(for:fallback:)` ← `verifyEmailCode`·`performRegisterWithEmail`·`confirmPasswordReset` · 가입 화면은 `LoginView` 의 코드 줄 아래에 그린다 · 회귀 `AlarmTalkTests/EmailCodeErrorMessageTests` |
| 거절된 숫자를 칸에 남기지 않는다(거절 셋 · 다시 받기 성공 → 코드 칸 비우기 · 판정은 코드로 · 겹친 확인은 버린다) | — | `isEmailCodeRefusal(errorCode)`(`ui/main/MainViewModelAuthActions.kt`) → `MainViewModel.emailCodeFieldClearTick` ← 위 세 함수의 거절 갈래 + `requestEmailVerification`·`requestPasswordReset` 의 성공 갈래 → `AuthScreen`·`PasswordResetScreen` 의 `codeFieldClearTick`(바뀌면 칸을 비운다) · `confirmEmailVerification` 의 `authBusy` 가드 · 회귀 `EmailCodeFailureMessageTest`(비우는 판정표). ⚠ 화면 배선은 자동 테스트가 없다 — 실기기로 본다 | `AuthViewModel.isEmailCodeRefusal(_:)`·`emailCodeFieldClearTick`(게시 값 — 세 거절 갈래와 `requestEmailVerification`·`requestPasswordReset` 의 성공에서 올린다) → `LoginView`·`PasswordResetView` 의 `.onChange`(코드 칸 비우기) · 회귀 `AlarmTalkTests/EmailCodeErrorMessageTests`(비우는 판정표 · 뷰모델이 문장을 세우고 신호를 올리는 배선 — 다섯 요청을 `EmailCodeAPIProviding` 으로 주입한다). ⚠ 화면이 그 신호로 칸을 비우는 것은 UI 테스트의 몫이고 CI 에서 돌지 않는다 — 실기기로 본다 |
| 거절 뒤에 다시 확인·다시 받기가 화면에 있다(가입 거절 → '인증 완료' 내리기 · 재설정은 보낸 뒤에도 다시 받기 · 가입의 다시 받기가 실패해도 코드 줄은 남고 실패는 인라인) | `/register` 가 코드를 다시 판정한다(`checkEmailVerificationCode`) | `register` 의 거절 갈래가 `registerEmailVerified = null` · `PasswordResetScreen` 의 요청 버튼(보낸 뒤 `auth_email_verify_resend` 로 눌린다) · 회귀 `EmailCodeFailureMessageTest` · `requestEmailVerification` 의 실패 갈래는 `registerEmailVerificationSentTo` 를 건드리지 않고(코드 줄 유지) 문장을 `registerError`(인증 묶음 아래 인라인)에 둔다 — 이 갈래는 자동 테스트가 없다 | `LoginView` 가 `emailCodeFieldClearTick` 에서 `verificationCompleted = false` · `PasswordResetView.sendCodeButton`(보낸 뒤 `인증 코드 다시 받기` 로 눌린다) · `LoginView.verifyEmailRow` 는 요청이 **성공할 때만** `verificationSent = true`(실패로 코드 줄을 닫지 않는다) · 실패 문장은 `AuthViewModel.requestEmailVerification` 이 `emailCodeError` 에 둔다(코드 줄 아래 — 코드 줄이 없으면 '이메일 인증' 버튼 아래, 하단 `statusMessage` 가 아니다) · 회귀 `AlarmTalkTests/EmailCodeErrorMessageTests`(다시 받기 실패 → 인라인 문장 · 칸 그대로). ⚠ 코드 줄이 남는 화면 배선은 자동 테스트가 없다 — 실기기로 본다 |
| 인증 코드는 ASCII 숫자 여섯 자(앱 1차 · 서버 2차) | `packages/shared/src/schemas/auth.ts` 의 `normalizeVerificationCode`(앞뒤 공백을 걷고 세 숫자 블록을 ASCII 로 — 코드 안의 글자(가운데 공백·하이픈·글자·세 블록 밖의 숫자)는 손대지 않아 `AUTH_VALIDATION_FAILED`) → `EmailVerificationCodeSchema`(변환 뒤 6자리 검사 — 세 요청 스키마가 함께 쓴다) · 회귀 `packages/shared/test/schemas.test.ts`·`test/auth.test.ts`(아라비아-인도 숫자로 친 맞는 코드는 200, 틀린 코드는 횟수를 센다 — 인증 확인·가입·재설정 확정 셋 다) | `ui/components/CodeRedeemField.kt` 의 `sanitizeVerificationCode` ← `AuthScreen`·`PasswordResetScreen` 의 코드 칸 · 회귀 `InputSanitizerTest` · 강제 `scripts/check-input-sanitizers.py`(`ui/auth/` 의 `onValueChange` 가 `isDigit`·`take(6)` 이면 이 함수를 불러야 한다) | `InputSanitizer.sanitizeVerificationCode` ← `LoginView`·`PasswordResetView` 의 코드 칸(키보드 `.asciiCapableNumberPad`) · 회귀 `AlarmTalkTests/InputSanitizerTests` · 강제 `scripts/check-input-sanitizers.py`(`Views/Auth/` 의 `.onChange`·`set:` 가 `isNumber`·`prefix(6)` 이면 이 함수를 불러야 한다) |
| 인증 메일(ko·en·ja 한 통 · '가장 최근 코드만' 한 줄 · 가입은 제목에 코드, 재설정은 제목에 코드 없음) | `lib/email-verification.ts` 의 `buildEmailVerificationMail`·`buildPasswordResetMail`(제목·text·html 을 만드는 순수 함수) ← `sendEmailVerificationCode`·`sendPasswordResetCode` · 회귀 `test/email-verification-mail.test.ts` | — | — |
| 회귀 테스트 | `test/auth.test.ts` (TTL·503) | `network/SessionTokenRenewalTest.kt` · `ColdStartRequestKeysTest.kt` · `EntryRefreshKeepsTokenTest.kt` | `SessionTokenRenewalTests.swift` |

## 의도된 플랫폼 차이

| 차이 | 이유 |
| --- | --- |
| 안드로이드는 세션 **세대**로, iOS 는 **토큰** 으로 경합을 막는다 | 안드로이드는 같은 prefs 를 워커와 뷰모델이 서로 다른 인스턴스로 보므로 세대가 필요했다. iOS 는 Keychain 단일 접근이라 값 비교로 충분한데, **id 로는 부족하다** — 같은 계정으로 재로그인하면 id 가 그대로라 옛 응답을 못 걸러낸다(코덱스 #734) |
| 주기: 안드로이드 15분 고정 / iOS 는 시스템이 정함 | `BGAppRefreshTask` 는 실행 시점을 iOS 가 정한다 — 요청은 15분이지만 보장은 없다 |
