package com.alarmtalk.app

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.alarmtalk.app.network.PersonalPromo
import com.alarmtalk.app.network.normalizePersonalPromo

/** `/auth/me` 를 **보내기 직전에** 뜬 표 — 보낸 진입·순번을 응답까지 들고 간다. */
internal data class AccountRequest(val seq: Long, val entry: Long)

/**
 * 기간 한정 개인 플랜의 **진입별 장부** — 계정 응답(`/auth/me`)이 어느 진입의 몫인가(그 진입의
 * 첫 결과가 성공인가 실패인가), 어느 응답이 plan 을 써도 되는가, 이 진입에 종료 안내를
 * 판정했는가·띄웠는가, 이용권 화면의 프로모 문구가 어느 답을 따르는가.
 *
 * `MainViewModel` 이 하나 들고 같은 이름의 멤버로 위임한다(`recordAccountAnswer`·
 * `recordAccountFailure`·`evaluatePersonalPromoEndNotice` …). 규칙을 여기 모은 이유는
 * **테스트**다 — 뷰모델은 암호화 저장소·Room·워커를 통째로 물고 있어 단위 테스트에서 세울 수
 * 없는데, 이 규칙들(늦게 온 옛 응답 버리기·계정 전환·다른 창에 밀린 안내 다시 띄우기·실패한
 * 진입 끝내기)은 상태를 거쳐야만 드러난다(`PersonalPromoLedgerTest`).
 *
 * 값은 스냅샷 상태라 `AlarmTalkApp` 의 `LaunchedEffect` 키로 그대로 쓴다.
 *
 * @param currentEntry 지금 진입 번호(`AppSignals.appEntries`). 테스트는 손으로 넘긴다.
 */
internal class PersonalPromoLedger(private val currentEntry: () -> Long) {

    /**
     * 이 계정의 **가장 최근 계정 응답**(`/auth/me`)이 준 `personal_promo`. 응답 전이면 null.
     *
     * 종료 안내는 저장된 세션이 아니라 **이 값**으로 판정한다 — 세션의 promo 는 지난 실행의
     * 것이라, 그 사이 다른 기기에서 결제했으면 이미 끝난 프로모의 안내를 띄우게 된다.
     */
    var latestAccountPromo by mutableStateOf<PersonalPromo?>(null)
        private set

    /**
     * 이 진입에 보낸 계정 요청의 **첫 결과**([AccountEntryAnswer]). null 이거나 다른 진입의 것이면
     * 이 진입의 결과는 아직이다. 종료 안내는 이 값이 지금 진입의 것일 때만 판정하고, 실패면 그
     * 진입은 띄우지 않는다([decidePersonalPromoEndNotice] — D11).
     *
     * ⚠ **첫 결과만 적는다.** 실패한 진입의 뒤 성공(쿠폰·`plan_changed`·결제 신호 뒤의 갱신)으로
     *   덮으면 세션 한가운데서 안내가 뜬다. 뒤 성공의 값은 [latestAccountPromo] 에만 들어간다.
     */
    var accountEntryAnswer by mutableStateOf<AccountEntryAnswer?>(null)
        private set

    /**
     * 이 진입의 계정 응답이 **plan 스냅샷에 반영된** 진입 번호. 0 = 아직.
     *
     * [accountEntryAnswer] 와 따로 두는 이유: 계정 응답은 두 경로로 온다 — `checkAccountStatus`
     * 는 탈퇴 유예·프로모만 적고 **plan 은 건드리지 않는다.** 그 응답이 먼저 오면 이 진입의
     * 답이 온 것처럼 보이는데 판정기는 아직 지난 실행의 plan 을 읽고 있다. 전경 무료 잠금의
     * 오프라인 차단 갈래([freePlanLockMayApply])는 **판정기가 읽는 plan** 이 이 진입의 것일 때만
     * 걸어야 하므로 이 값을 본다.
     */
    var planAnsweredEntry by mutableLongStateOf(0L)
        private set

    /** 떠 있는 **종료 안내**. null 이면 닫혀 있다. */
    var shownEndNotice by mutableStateOf<PersonalPromo?>(null)
        private set

    /** 판정을 끝낸 진입 번호. 같은 진입에서 두 번 판정하지 않는다. */
    private var handledEntry: Long = 0L

    /** 계정 응답 요청의 순번 — 늦게 도착한 옛 응답이 새 응답을 덮지 않게 한다. */
    private var requestSeq: Long = 0L

    /** [latestAccountPromo] 에 적은 가장 새 계정 응답의 순번. */
    private var answerSeq: Long = 0L

    /**
     * plan(세션·권한 스냅샷의 plan 과 프로모 표지)에 쓴 가장 새 `/auth/me` 응답의 순번([claimPlanAnswer]).
     *
     * [answerSeq] 와 따로 두는 이유: `checkAccountStatus` 의 응답은 계정 응답으로는 세지만 plan 을
     * 쓰지 않는다. 한 순번으로 두면 그 응답이 먼저 온 것만으로 먼저 보낸 `refreshAppSessionNow` 의
     * 답이 버려져, 세션에는 **지난 실행의** plan 이 남는다(더 새 답이 아니라 더 옛 캐시가 이긴다).
     */
    private var planAnswerSeq: Long = 0L

    /**
     * 이 프로세스에서 계정 응답·구독 응답을 **받은 순서**(이용권 화면의 프로모 문구 — [planScreenPromo]).
     * 0 = 이번 실행에서 아직 받지 않았다(저장본뿐이다). 시계가 아니라 순번이라 기기 시계와 서버
     * 시계를 섞지 않는다.
     */
    private var answerOrder: Long = 0L
    private var accountAnswerOrder by mutableLongStateOf(0L)
    private var billingAnswerOrder by mutableLongStateOf(0L)

    fun beginAccountRequest(): AccountRequest = AccountRequest(seq = ++requestSeq, entry = currentEntry())

    /**
     * 계정 응답을 적는다. **지금 이 계정의 응답일 때만** 부른다(부르는 쪽이 세션·세대를 본다).
     *
     * - 늦게 도착한 옛 요청의 응답은 버린다(순번).
     * - 보낸 진입과 도착한 진입이 같을 때만 그 진입의 결과로 센다([accountAnswerEntryFor]) — 그
     *   진입의 **첫 결과**일 때만([accountEntryAnswer]).
     * - 떠 있는 안내가 새 응답과 맞지 않으면 닫는다 — 쿠폰·결제로 원시 유료가 됐으면
     *   `personal_promo` 가 사라진다([reconcileShownPersonalPromoNotice]).
     *
     * @return 적었으면 true, 옛 응답이라 버렸으면 false.
     */
    fun recordAccountAnswer(request: AccountRequest, promo: PersonalPromo?, nowMillis: Long): Boolean {
        if (request.seq < answerSeq) return false
        answerSeq = request.seq
        val normalized = normalizePersonalPromo(promo)
        latestAccountPromo = normalized
        accountAnswerOrder = ++answerOrder
        noteEntryOutcome(request, AccountEntryAnswer.Outcome.Answered)
        if (shownEndNotice != null) {
            shownEndNotice = reconcileShownPersonalPromoNotice(shownEndNotice, normalized, nowMillis)
        }
        return true
    }

    /**
     * 계정 요청이 **실패했다**(네트워크·5xx 등 — 세션이 끝난 실패는 부르지 않는다). 그 요청을 보낸
     * 진입의 첫 결과면 그 진입의 종료 안내 판정은 '띄울 것 없음' 으로 끝난다(D11 — iOS
     * `AccountEntryAnswer.failed` 와 같다). 값은 없으므로 [latestAccountPromo] 는 그대로다.
     *
     * 옛 순번(더 새 답이 이미 적혔거나, 계정 전환 전에 뜬 요청)의 실패는 버린다 — 앞 계정의 요청이
     * 새 계정의 진입을 끝내면 안 된다.
     *
     * @return 적었으면 true, 옛 요청이라 버렸으면 false.
     */
    fun recordAccountFailure(request: AccountRequest): Boolean {
        if (request.seq < answerSeq) return false
        noteEntryOutcome(request, AccountEntryAnswer.Outcome.Failed)
        return true
    }

    /** 이 진입에 보낸 요청의 결과를 적는다 — **첫 결과만**([accountEntryAnswer]). */
    private fun noteEntryOutcome(request: AccountRequest, outcome: AccountEntryAnswer.Outcome) {
        val entry = accountAnswerEntryFor(request.entry, currentEntry()) ?: return
        if (accountEntryAnswer?.entry == entry) return
        accountEntryAnswer = AccountEntryAnswer(entry, outcome)
    }

    /**
     * [request] 의 `/auth/me` 응답으로 **plan 을 써도 되는가**(세션의 plan·프로모와 권한 스냅샷의
     * plan·프로모 표지). 나중에 보낸 요청의 답이 이미 plan 에 쓰였으면 false — 늦게 도착한 옛 답이
     * 새 답을 되돌리면 안 된다(iOS `AuthViewModel.applyFreshPlan` 의 순번 가드와 같다).
     *
     * 예: 진입 갱신이 떠 있는 동안 쿠폰·결제 뒤의 갱신이 먼저 돌아와 가족·프로모 없음을 적었는데,
     * 진입 갱신의 옛 `plus`·프로모가 뒤에 도착해 표지를 되살리면 보류 규칙(D9)이 방금 가족이 된
     * 사람의 가족 기능을 닫고, 옛 plan 으로 [planAnsweredEntry] 까지 세워 잠금 대기를 풀어 버린다.
     *
     * ⚠ **쓰기 전에** 부른다. true 면 그 순번을 잡는다 — 쓰기가 뒤에 문에서 거절돼도 옛 답이 그
     * 자리를 차지하지 못한다.
     */
    fun claimPlanAnswer(request: AccountRequest): Boolean {
        if (request.seq < planAnswerSeq) return false
        planAnswerSeq = request.seq
        return true
    }

    /**
     * [request] 의 응답이 **plan 스냅샷에 반영됐다**([planAnsweredEntry]). [claimPlanAnswer] 를 지난
     * 답만 부른다 — 그래도 한 번 더 본다: 더 새 답이 plan 을 차지했으면 옛 답은 이 진입의 plan 이
     * 아니다(옛 plan 으로 잠금 대기를 풀면 안 된다).
     */
    fun recordPlanApplied(request: AccountRequest) {
        if (request.seq < planAnswerSeq) return
        accountAnswerEntryFor(request.entry, currentEntry())?.let { planAnsweredEntry = it }
    }

    /**
     * 구독 응답(`/billing/subscription`)을 스냅샷에 쓴 결과 — 이용권 화면 프로모 문구의 순서.
     *
     * **문을 지났을 때만**([EntitlementWrite.Applied]) 센다. 부르는 쪽은 그때만 화면 사본
     * (`subscriptionResponse`)을 이 응답으로 바꾸므로, 문이 거절한 응답(그 사이 로그아웃·계정 전환)을
     * 세면 화면에 없는 답이 '나중에 받은 답' 으로 이겨 계정 응답의 한 줄을 가린다.
     */
    fun recordBillingAnswer(result: EntitlementWrite) {
        if (result != EntitlementWrite.Applied) return
        billingAnswerOrder = ++answerOrder
    }

    /**
     * 이용권 화면에 보일 프로모 — **나중에 받은 답이 이긴다**([planScreenPersonalPromoOf]).
     *
     * @param sessionPromo 저장된 세션의 promo. 이번 실행에서 계정 응답을 아직 못 받았을 때만 쓴다.
     * @param billingPromo 화면이 들고 있는 구독 응답의 promo.
     */
    fun planScreenPromo(sessionPromo: PersonalPromo?, billingPromo: PersonalPromo?, nowMillis: Long): PersonalPromo? =
        planScreenPersonalPromoOf(
            accountPromo = if (accountAnswerOrder > 0L) latestAccountPromo else sessionPromo,
            accountAnswerOrder = accountAnswerOrder,
            billingPromo = billingPromo,
            billingAnswerOrder = billingAnswerOrder,
            nowMillis = nowMillis,
        )

    /**
     * 종료 안내 이펙트(`AlarmTalkApp`)가 **입력이 바뀔 때마다** 부른다 — 준비 신호·다른 창
     * (`PersonalPromoNoticeGates.ready`)이 막혀 있으면 떠 있는 안내를 걷고 이 진입을 '판정 전' 으로
     * 되돌리고([deferEndNotice]), 열려 있으면 판정한다([maybeShowEndNotice]).
     *
     * 이펙트 안에 이 갈래를 두지 않고 여기 두는 이유는 테스트다 — 목소리 등록 창·권한 창이 떴다
     * 닫히는 순서를 장부만으로 재현할 수 있다(`PersonalPromoLedgerTest`).
     */
    fun evaluateEndNotice(gatesReady: Boolean, entry: Long, optedOutEndsAt: String?, nowMillis: Long) {
        if (!gatesReady) {
            deferEndNotice()
            return
        }
        maybeShowEndNotice(entry, optedOutEndsAt, nowMillis)
    }

    /**
     * 이번 진입에서 종료 안내를 띄울지 판정한다. **준비 신호·차단 게이트는 부르는 쪽이 본다**
     * ([evaluateEndNotice]). 규칙은 [decidePersonalPromoEndNotice] 하나다.
     */
    fun maybeShowEndNotice(entry: Long, optedOutEndsAt: String?, nowMillis: Long) {
        if (shownEndNotice != null) return
        when (
            val decision = decidePersonalPromoEndNotice(
                entry = entry,
                handledEntry = handledEntry,
                entryAnswer = accountEntryAnswer,
                latestPromo = latestAccountPromo,
                nowMillis = nowMillis,
                optedOutEndsAt = optedOutEndsAt,
            )
        ) {
            PersonalPromoNoticeDecision.NotNow -> Unit
            PersonalPromoNoticeDecision.NothingToShow -> handledEntry = entry
            is PersonalPromoNoticeDecision.Show -> {
                handledEntry = entry
                shownEndNotice = decision.promo
            }
        }
    }

    /**
     * 떠 있는 안내 위로 **다른 모달·게이트·시스템 권한 창이 올라왔다** — 안내를 걷고 이 진입을
     * 다시 '판정 전' 으로 돌린다. 가린 것이 닫히면 같은 진입 안에서 다시 뜬다.
     *
     * 안내를 들고 기다리지 않는 이유: 떠 있는 동안에는 강등 안내가 뒤에서 기다린다. 가려진 채
     * 들고 있으면 그 기다림이 끝없이 길어진다 — 대기 중인 안내가 다른 안내를 막으면 안 된다.
     */
    fun deferEndNotice() {
        if (shownEndNotice == null) return
        shownEndNotice = null
        handledEntry = 0L
    }

    /** 떠 있는 안내를 닫고 그 값을 돌려준다('다시 보지 않기' 저장은 부르는 쪽이 한다). */
    fun dismissEndNotice(): PersonalPromo? {
        val promo = shownEndNotice
        shownEndNotice = null
        return promo
    }

    /**
     * 계정이 바뀐다(세션 정리) — 앞 계정의 값이 새 계정에 새면 안 된다. 새 계정은 이번 진입에서
     * 자기 기준으로 한 번 판정받는다.
     *
     * ⚠ **순번은 되돌리지 않고 앞지른다.** 떠 있던 요청의 응답은 앞 계정의 것이다 — 응답 순번을
     * 지금까지 뜬 요청보다 크게 두면 그 응답들이 전부 옛 것으로 버려지고, 이 뒤에 뜨는 요청은
     * 그 값과 같은 순번을 받아 통과한다.
     */
    fun resetForAccountSwitch() {
        shownEndNotice = null
        handledEntry = 0L
        latestAccountPromo = null
        accountEntryAnswer = null
        planAnsweredEntry = 0L
        answerSeq = requestSeq + 1
        planAnswerSeq = requestSeq + 1
        accountAnswerOrder = 0L
        billingAnswerOrder = 0L
    }
}

/**
 * 이용권 화면의 프로모 문구(`personal_promo_plan_line` — 개인 카드에 앉을지 카드 위 한 줄일지는
 * `planScreenCurrentOf` 가 가른다)의 프로모 — 계정 응답과 구독 응답 중 **나중에 받은 답**의 것. 둘 다 서버가 같은 규칙으로 계산한 값이라, 더 새 답이 곧 지금의 사실이다.
 *
 * 예전에는 둘을 OR 로 봤다(세션에 없으면 구독 응답). 그러면 방금 결제·쿠폰을 등록해 새 계정 응답에
 * promo 가 **없는** 사람에게, 결제 전에 캐시된 구독 응답의 promo 가 대신 보여 "개인 플랜 무료
 * 이용 중" 이 남았다(탭 새로고침은 60초 스로틀이라 한동안 그대로다).
 *
 * @param accountAnswerOrder·billingAnswerOrder 이번 실행에서 받은 순번. 0 = 아직(저장본뿐).
 *   둘 다 0 이면 어느 쪽이 새로운지 모르므로 예전처럼 둘 중 살아 있는 것을 보인다.
 */
internal fun planScreenPersonalPromoOf(
    accountPromo: PersonalPromo?,
    accountAnswerOrder: Long,
    billingPromo: PersonalPromo?,
    billingAnswerOrder: Long,
    nowMillis: Long,
): PersonalPromo? = when {
    accountAnswerOrder == 0L && billingAnswerOrder == 0L ->
        activePersonalPromoOf(sessionPromo = accountPromo, billingPromo = billingPromo, nowMillis = nowMillis)
    accountAnswerOrder >= billingAnswerOrder ->
        activePersonalPromoOf(sessionPromo = accountPromo, billingPromo = null, nowMillis = nowMillis)
    else ->
        activePersonalPromoOf(sessionPromo = null, billingPromo = billingPromo, nowMillis = nowMillis)
}

/**
 * 전경의 무료 잠금(`AlarmTalkApp` 의 잠금 이펙트)을 **지금** 걸어도 되는가.
 *
 * 무료 판정이 기간 한정 개인 플랜의 오프라인 차단(D1) **때문만**이면([freeOnlyByPromoLapse]),
 * **이 진입의 `/auth/me` 가 plan 에 반영된 뒤에만** 건다([planAnsweredEntry] == [entry]). 그 전의
 * plan 은 지난 실행의 캐시다 — 그 사이 다른 기기에서 쿠폰·iOS 결제·가족 합류로 원시 유료가 된
 * 사람도 종료 시각만 지나면 잠기고, 잠금은 새 응답이 오면 풀리지만 이미 적힌 강등 안내가
 * 결제자에게 "목소리 알람이 바뀌었어요" 를 말한다.
 *
 * 서버가 무료라고 답한 무료(`users.plan = free`)·구독 만료 같은 다른 갈래는 예전 그대로다.
 */
internal fun freePlanLockMayApply(freeOnlyByPromoLapse: Boolean, planAnsweredEntry: Long, entry: Long): Boolean =
    !freeOnlyByPromoLapse || (entry > 0L && planAnsweredEntry == entry)

/** 전경 잠금 이펙트(`AlarmTalkApp`)가 **이번에** 할 일([foregroundPlanLockAction]). */
internal enum class ForegroundPlanLockAction {
    /** 유료 목소리 알람을 기본 알람으로 바꾼다(`MainViewModel.applyFreePlanVoiceLock`). */
    Lock,

    /**
     * 확실히 무료지만 근거가 낡은 프로모 하나라 **이 진입의 plan 반영을 기다린다**
     * ([freePlanLockMayApply]). 아무 갈래도 타지 않는다 — 토큰을 굴리는 plan 재조회도 부르지
     * 않는다(진입마다의 갱신이 이미 나가 있다). 답이 오면 [deferredPromoLapseLockDue] 가 다시 본다.
     */
    WaitForEntryPlan,

    /** 유료로 확정됐다 — 잠근 것을 되돌린다(`MainViewModel.restorePaidVoiceAlarmsIfLocked`). */
    Restore,

    /** 구독 응답은 무권한인데 plan 이 아직 유료일 수 있다 — `/auth/me` 로 plan 을 다시 받는다. */
    RefreshPlan,

    /** 할 일 없다. */
    None,
}

/**
 * 전경 잠금 이펙트의 갈래 — 이펙트는 입력을 모아 이걸 부르고 답대로만 움직인다.
 *
 * 순서가 규칙이다: **확실한 무료가 먼저**(살아 있는 구독 행이 있으면 보류라 잠그지 않는다),
 * 그다음 유료 확정이면 복원, 그다음 구독 응답과 plan 이 어긋나면 plan 재조회.
 *
 * @param definitelyFree `MainViewModel.isDefinitelyFreePlan` — 스토어 확인이 끝났고 판정기가 무료.
 * @param subscriptionRowAlive 구독 응답에 유료 행이 살아 있다(보류 — 되돌릴 수 없는 잠금 금지).
 * @param freeOnlyByPromoLapse `MainViewModel.isFreeOnlyByPromoLapse`.
 * @param paidEntitled 판정기가 유료로 확정했다(`PaidVoiceAccess.Entitled`).
 * @param billingNotEntitled 구독 응답이 무권한이고 커플·가족 접근도 없다.
 */
internal fun foregroundPlanLockAction(
    signedIn: Boolean,
    definitelyFree: Boolean,
    subscriptionRowAlive: Boolean,
    freeOnlyByPromoLapse: Boolean,
    planAnsweredEntry: Long,
    entry: Long,
    paidEntitled: Boolean,
    billingNotEntitled: Boolean,
): ForegroundPlanLockAction = when {
    signedIn && definitelyFree && !subscriptionRowAlive ->
        if (freePlanLockMayApply(freeOnlyByPromoLapse, planAnsweredEntry, entry)) {
            ForegroundPlanLockAction.Lock
        } else {
            ForegroundPlanLockAction.WaitForEntryPlan
        }
    signedIn && paidEntitled -> ForegroundPlanLockAction.Restore
    billingNotEntitled -> ForegroundPlanLockAction.RefreshPlan
    else -> ForegroundPlanLockAction.None
}

/**
 * [ForegroundPlanLockAction.WaitForEntryPlan] 으로 **미뤄 둔 잠금을 지금 걸 때인가** — 이 진입의
 * `/auth/me` 가 plan 에 반영된 순간(`planAnsweredEntry` 가 바뀔 때 — `AlarmTalkApp` 의 재확인
 * 이펙트) 다시 본다. 답이 plan 을 바꾸지 않아도(여전히 `plus`) 다시 봐야 해서 따로 둔다.
 *
 * 미뤄 둔 갈래(무료의 근거가 낡은 프로모 하나)만 여기서 건다 — 다른 갈래는 위 이펙트가 이미
 * 곧바로 처리했다. 진입 전(0)의 답은 어느 진입의 답도 아니다([freePlanLockMayApply]).
 */
internal fun deferredPromoLapseLockDue(
    signedIn: Boolean,
    planAnsweredEntry: Long,
    entry: Long,
    freeOnlyByPromoLapse: Boolean,
    definitelyFree: Boolean,
    subscriptionRowAlive: Boolean,
): Boolean =
    signedIn && freeOnlyByPromoLapse && definitelyFree && !subscriptionRowAlive &&
        freePlanLockMayApply(freeOnlyByPromoLapse = true, planAnsweredEntry = planAnsweredEntry, entry = entry)
