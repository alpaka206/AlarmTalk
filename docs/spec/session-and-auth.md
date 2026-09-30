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
  - **굴리지 않는다**: 백그라운드에서 돌아올 때의 `/auth/me`(plan·프로모만 받는다), **Play 자동
    정합화 뒤의 갱신**(H4). 정합화는 앱 시작·알람 탭 진입마다 도는 구독 재확인에서 오는데,
    거기서 굴리면 토큰을 키로 쓰던 탭 효과가 다시 돌아 또 정합화하는 고리가 생겼다(Play 로
    결제한 사용자가 홈에 있는 동안 3~5초마다 15건 이상).
- 굴리지 않아도 잃는 것이 없다 — 서버 토큰은 무상태 JWT(365일)라 지금 토큰이 그대로 유효하다.
- **iOS** 는 아직 탭 새로고침 스로틀 키에 토큰이 들어 있다(`MainTabsView.refreshForSelectedTab`
  의 `throttleKey`). 같은 감사의 iOS 묶음에서 계정 기준으로 맞춘다 — 규칙은 두 앱이 같다.

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
옮긴다 — TTL 은 행 삭제와 큐 적재를 따로 커밋하므로, 그 사이가 끊기면 R2 파일의 키를 아는
곳이 그 문구뿐이다.

⚠ **목소리 철회는 구독 취소보다 먼저다.** 그룹 주인의 구독을 끊으면 그 자리에서 그룹이
해체되고 내가 보낸 목소리 알람이 무료 강등으로 문구를 잃는다. 철회(`revokeDeletedVoices`)가
그 뒤에 돌면 **동석 멤버도, 수신 확인 전 알람도 못 찾아** tombstone 도 푸시도 없이 받는
사람 기기에 탈퇴자의 녹음이 남는다(2026-09-30 까지 유료 사용자의 탈퇴가 전부 그랬다).

**표가 새로 생기면** `test/account-purge-residue.test.ts` 의 `TABLES` 가 먼저 깨진다 —
사용자 데이터가 들어가는 표라면 거기 심고 파기가 지우게 만든 뒤 분류한다.

## 탈퇴 예약을 취소해 복구할 때

서버가 복구 성공을 확인한 뒤 **현재 기기의 푸시 등록도 다시 시작한다.** 탈퇴 대기 중에는
푸시 등록 API가 403으로 차단되므로, 같은 계정 id로 정상 화면만 열어서는 등록이 복구되지
않는다. iOS는 launch에서 연결한 복구 준비 훅을 **await**해 기존 등록/해제 큐에 들어간 뒤
**복구 계정과 일치하는 등록 캐시의 서버 확인을 별도 플래그로 영속 무효화**한다.
그 준비가 끝나기 전에는 세션의 active 저장과 미완료 탈퇴 표시 해제를 하지 않는다.
그 뒤 **해당 계정의 미완료 탈퇴 표시·정리용 토큰을 먼저 지우고 active 세션을 저장/게시**한다.
반대로 하면 그 사이 앱 종료 시 active 세션과 옛 탈퇴 표시가 함께 남아 다음 실행에서 알람을
끄고 로그아웃할 수 있다. 표시 해제 뒤 저장 전에 종료되면 저장된 pending 세션이 남아
다음 조회에서 복구를 다시 완료한다. 다른 계정의 표시는 보존한다.
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
| 저장 경합 방지 | — | `AuthSessionStore.saveTokenIfGeneration` | `AuthViewModel` 의 출처 **토큰** 재확인(`refreshUser`·`applyRolledToken`·`applyFreshPlan`) |
| 401 중앙 처리 | — | `UnauthorizedAuthenticator` | `AlarmTalkAPI.unauthorizedNotification`(**실패한 토큰을 싣는다**) → `AuthViewModel.handleUnauthorized` |
| 즉시 폐기 | `authMiddleware` 의 `token_epoch` 비교 | — | — |
| 탈퇴 취소 뒤 푸시 재등록 | `authMiddleware` 탈퇴 대기 허용 경로·`user.ts` 탈퇴 취소 | `MainViewModelAuthActions.cancelAccountDeletion` → `registerCurrentToken` | `AuthViewModel.prepareAccountRecovery` → `PushNotificationCoordinator.prepareAccountRecovery`를 await한 뒤 상태 확정 → `onAccountRecovered` → `start`(launch에서 연결) |
| 탈퇴 파기 범위(남는 것 셋뿐) | `lib/account-deletion.ts` `purgeUserAccount`(유예 파기 `index.ts`·즉시 삭제 `user.ts` 공용) · 회귀 `test/account-purge-residue.test.ts` | — | — |
| 탈퇴 취소 응답 유실·재확인 | `user.ts` DELETE 멱등 처리(이미 active는 무변경 성공) | 기존 취소 재시도 응답 소비 | `cancelAccountDeletion` 재확인·`refreshUser` 전환 감지 → `completeAccountRecovery` |
| 회귀 테스트 | `test/auth.test.ts` (TTL·503) | `network/SessionTokenRenewalTest.kt` · `ColdStartRequestKeysTest.kt` · `EntryRefreshKeepsTokenTest.kt` | `SessionTokenRenewalTests.swift` |

## 의도된 플랫폼 차이

| 차이 | 이유 |
| --- | --- |
| 안드로이드는 세션 **세대**로, iOS 는 **토큰** 으로 경합을 막는다 | 안드로이드는 같은 prefs 를 워커와 뷰모델이 서로 다른 인스턴스로 보므로 세대가 필요했다. iOS 는 Keychain 단일 접근이라 값 비교로 충분한데, **id 로는 부족하다** — 같은 계정으로 재로그인하면 id 가 그대로라 옛 응답을 못 걸러낸다(코덱스 #734) |
| 주기: 안드로이드 15분 고정 / iOS 는 시스템이 정함 | `BGAppRefreshTask` 는 실행 시점을 iOS 가 정한다 — 요청은 15분이지만 보장은 없다 |
