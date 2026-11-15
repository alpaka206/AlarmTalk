package com.alarmtalk.app

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material3.Button
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.TextButton
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alarmtalk.app.billing.PlayBillingProducts
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.BillingSubscription
import com.alarmtalk.app.network.PersonalPromo
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.LineBreak

@Composable
internal fun SubscriptionPanel(
    billingBusy: Boolean,
    subscriptionResponse: BillingSubscriptionResponse?,
    /// planKey → **Play 가 준 표시가격**(`formattedPrice`, 지역 통화·세금 포함).
    ///
    /// 스토어 값이 권위이며, 아직 못 받았을 때만 백엔드의 한국 가격표와 같은 폴백을 쓴다.
    planPrices: Map<String, String>,
    /** 플랜 key → 무료 체험 기간(ISO 8601 `P1M`). 있으면 그 카드에 체험 조건을 말한다. */
    planTrials: Map<String, String> = emptyMap(),
    onPurchasePlay: (Activity, String) -> Unit,
    onCancelSubscription: (Boolean) -> Unit,
    onRestorePurchases: () -> Unit,
    /**
     * 지금 살아 있는 기간 한정 개인 플랜 — 계정 응답과 구독 응답 중 **나중에 받은 답**의 것
     * (`planScreenPersonalPromoOf`). 날짜는 서버 `ends_at − 1초` 의 기기 날짜다.
     *
     * 어디에 보이는지는 [planScreenCurrentOf] 가 정한다: 프로모만 쓰는 계정은 **개인 카드가
     * '현재 이용권'** 이고 문구는 그 카드의 상태 한 줄이다. 산 이용권·보류 행이 있는 계정은
     * 예전처럼 카드 목록 위의 한 줄이다.
     *
     * ⚠ **구독처럼 그리지 말 것.** 서버가 구독 객체를 만들지 않으므로(`subscription` 은 null)
     * 해지 버튼은 산 이용권으로만 가른다 — 원시 plan 은 여전히 무료이고, 개인 결제도 그대로
     * 열려 있다(개인 카드의 결제 버튼이 남는다).
     */
    personalPromo: PersonalPromo? = null,
    /**
     * 관리자 기간 지급의 끝(`plan_grant.ends_at`, 배타). 지금 지급 중이면 프로모와 같은 자리에 "플러스 이용 중 · …까지" 를
     * 말한다 — 구독처럼 그리지 않는다(해지 버튼은 산 이용권으로만 가른다). 프로모와 함께 오지 않는다.
     */
    planGrantEndsAt: String? = null,
    /** 탭 화면이 남은 높이를 준다(`weight(1f)`) — 아래 시작 버튼 영역을 화면 바닥에 고정하려면 높이가 정해져야 한다. */
    modifier: Modifier = Modifier,
) {
    var purchaseTarget by remember { mutableStateOf<SubscriptionPlanOption?>(null) }
    var showCancelDialog by remember { mutableStateOf(false) }
    val subscription = subscriptionResponse?.subscription
    val currentPlan = subscriptionResponse?.plan
    val nextPlan = subscriptionResponse?.nextPlan
    val hasActive = subscription != null && currentPlan != null
    val cancelScheduled = subscription?.cancelAtPeriodEnd == true
    val context = LocalContext.current
    val options = listOf(
        // 감성 설명문 없이 핵심 혜택만 짧게 — 판단에 필요한 사실 위주로 적는다.
        // ⚠ 무료에도 있는 것을 유료 혜택처럼 적지 말 것. 날씨·운세 문구는 기본 목소리로 무료다
        // (docs/spec/voice-and-message.md §2) — 개인 카드가 파는 것은 그 문구를 **등록한 목소리로** 듣는 것이다.
        SubscriptionPlanOption(
            key = "free",
            name = stringResource(R.string.billing_plan_free_name),
            price = stringResource(R.string.billing_plan_free_price),
            features = listOf(
                stringResource(R.string.billing_plan_free_feature_basic_alarm),
                stringResource(R.string.billing_plan_free_feature_stock_voice),
                // 직접 입력 횟수(무료 3 · 플러스 30)는 shared `MANUAL_TTS_MONTHLY_LIMIT` 의 값이다(voice-and-message.md §8).
                // 카드는 등급 비교라 서버 현황(`/tts/manual-quota`)이 아니라 정해진 기본분을 적는다 — 값이 바뀌면 같이 고친다.
                stringResource(R.string.billing_plan_free_feature_manual),
            ),
        ),
        SubscriptionPlanOption(
            key = "personal",
            name = stringResource(R.string.billing_plan_personal_name),
            price = planPriceLabel(context, planPrices, "personal"),
            trialPeriod = planTrials["personal"]?.let { trialPeriodLabel(context, it) },
            trialDisclosure = planTrials["personal"]?.let { iso ->
                trialDisclosureText(context, iso, planRawPrice(context, planPrices, "personal"))
            },
            features = listOf(
                stringResource(R.string.billing_plan_personal_feature_voice),
                stringResource(R.string.billing_plan_personal_feature_messages_in_voice),
                stringResource(R.string.billing_plan_personal_feature_manual),
                // 플러스는 광고를 보지 않는다(보상형 광고는 무료 계정에게만 — `docs/spec/ad-rewards.md` §1). 2026-11-15 오너:
                // 나중에 무료 화면 중간중간에도 광고를 넣을 예정이라 플러스 혜택으로 적는다. iOS `PlanCard.features(for:)` 와 같은 줄이다.
                stringResource(R.string.billing_plan_personal_feature_no_ads),
            ),
        ),
    )

    // ── 요금제 화면 A안(2026-11-15 오너 — 고르기 시안 '플러스 한 장 + 아래 고정 버튼', 캔버스 proposal-10) ──
    // 위: 플러스를 큰 카드 한 장으로, 무료는 그 아래 한 줄 카드로. 아래(고정): 시작 버튼 · 자동 결제 안내 · 복원 · 해지.
    // iOS 짝은 `BillingPanel`(같은 배치 — 아래 영역은 `safeAreaInset`).
    // 기간 한정 플러스 무료 이용 — "플러스 무료 이용 중 · 10월 31일까지". 날짜는 서버 값.
    val promoLastDay = personalPromoLastDay(personalPromo, java.time.ZoneId.systemDefault())
    val promoLineText = promoLastDay?.let { lastDay ->
        val locale = LocalConfiguration.current.locales[0]
            ?: java.util.Locale.getDefault()
        stringResource(R.string.personal_promo_plan_line, formatPersonalPromoDay(lastDay, locale))
    } ?: planGrantLastDay(planGrantEndsAt, java.time.ZoneId.systemDefault(), System.currentTimeMillis())?.let { lastDay ->
        val locale = LocalConfiguration.current.locales[0]
            ?: java.util.Locale.getDefault()
        // 지급도 같은 문구다 — 결제 없이 쓰는 플러스라 iOS(같은 자리로 읽는다)와 같은 말을 한다.
        stringResource(R.string.personal_promo_plan_line, formatPersonalPromoDay(lastDay, locale))
    }
    // '현재 이용권' 카드와 프로모 문구의 자리 — 규칙은 [planScreenCurrentOf] 한 곳이다(스펙 D4).
    // ⚠ 산 이용권(`currentPlan`·`hasActive`)은 그대로 둔다 — 해지 버튼은 그 값으로만 가른다.
    //   프로모는 산 이용권이 아니다.
    val planScreen = planScreenCurrentOf(
        purchasedPlanKey = currentPlan?.key,
        promoActive = promoLineText != null,
        hasHeldSubscriptionRow = personalPromo?.deletesVoicesAtEnd == false,
    )
    val statusContext = LocalContext.current
    val currentExpiresAt = formatPass(subscription?.expiresAt, PassDateFormatter)
    val currentStatusText = when {
        // 프로모만 쓰는 계정 — 플러스 카드가 현재이고, 그 카드의 상태 문구가 프로모 한 줄이다.
        planScreen.promoOnPersonalCard -> promoLineText
        cancelScheduled && nextPlan != null -> {
            val nextName = passPlanName(statusContext, nextPlan.key, nextPlan.name)
            if (currentExpiresAt != null) {
                stringResource(R.string.billing_status_change_to_next_after_date, currentExpiresAt, nextName)
            } else {
                stringResource(R.string.billing_status_change_to_next_scheduled, nextName)
            }
        }
        cancelScheduled -> {
            if (currentExpiresAt != null) {
                stringResource(R.string.billing_status_end_after_date, currentExpiresAt)
            } else {
                stringResource(R.string.billing_status_end_scheduled)
            }
        }
        hasActive && currentExpiresAt != null -> stringResource(R.string.billing_status_available_until, currentExpiresAt)
        hasActive -> stringResource(R.string.billing_status_in_use)
        else -> null
    }
    val freeOption = options.first { it.key == PlanScreenCurrent.FREE_PLAN_KEY }
    val plusOption = options.first { it.key == PlanScreenCurrent.PERSONAL_PLAN_KEY }
    val plusIsCurrent = planScreen.isCurrent(plusOption.key)
    val plusShowsPurchase = planScreen.showsPurchase(plusOption.key)
    val trial = plusOption.trialPeriod?.takeIf { plusShowsPurchase }
    // 카드 위 한 줄은 산 이용권·보류 행이 있는 계정의 프로모 줄뿐이다(예전 자리 그대로). 지금 무료인 것은 무료 카드의
    // '현재 이용권' 배지가 말한다 — 같은 사실을 두 번 말하지 않는다(iOS UI 테스트 `PersonalPromoNoticeUITests` 가 지킨다).
    val topLine = promoLineText.takeIf { planScreen.promoLineAboveList }

    Column(modifier = modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (topLine != null) {
                Text(
                    text = topLine,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp),
                )
            }
            PlusPlanHeroCard(
                option = plusOption,
                isCurrent = plusIsCurrent,
                trial = trial,
                statusText = currentStatusText.takeIf { plusIsCurrent },
            )
            FreePlanSummaryCard(option = freeOption, isCurrent = planScreen.isCurrent(freeOption.key))
            // ⚠ 코드를 쳐서 유료 기능을 여는 길(선물·코드 입력·코드 공유)을 되살리지 말 것 — 지침 3.1.1, `docs/spec/plan-gates.md`.
        }

        // ── 아래 고정 영역 ── 스크롤과 무관하게 늘 보인다(A안). 자동 결제 안내는 **시작 버튼 바로 아래 한 문장**이다
        // (스토어 정책: 체험 기간, 체험 뒤 가격·주기, 결제 시점, 해지 방법을 결제 전에 보인다).
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // ⚠ **`!isCurrent` 로 되돌리지 말 것**(2026-09-29). 프로모만 쓰는 계정은 플러스가 '현재' 인데 산 이용권이 아니라
            //   시작 버튼이 남아야 한다 — 끝난 뒤 이어 쓰려면 사야 한다([PlanScreenCurrent.showsPurchase]).
            if (plusShowsPurchase) {
                Button(
                    onClick = { purchaseTarget = plusOption },
                    enabled = !billingBusy,
                    colors = wakerButtonColors(),
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 52.dp),
                    shape = WakerButtonShape,
                ) {
                    Text(
                        text = if (trial != null) {
                            stringResource(R.string.billing_plan_trial_start, trial)
                        } else {
                            stringResource(R.string.billing_select_button)
                        },
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                if (trial != null && plusOption.trialDisclosure != null) {
                    Text(
                        text = plusOption.trialDisclosure,
                        style = MaterialTheme.typography.bodySmall.copy(lineBreak = LineBreak.Heading),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            // **이전 구매 복원 — 항상 보인다.** 기기를 바꾸거나 다른 경로로 로그인해 서버에 결제 기록이 없을 때, 여기가
            // 없으면 '다시 결제' 뿐이라 같은 구독을 두 번 사게 된다(애플은 심사 지침 3.1.1 로 요구한다).
            // A안(2026-11-15)부터 **작은 글자 버튼**이다 — 화면 폭 버튼이던 2026-08-17 지시를 오너가 시안으로 바꿨다.
            // ⚠ **해지보다 앞이다**(2026-08-24 지시) — 되돌릴 수 있는 액션이 먼저, 되돌릴 수 없는 액션이 마지막.
            Row(
                horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth(),
            ) {
                TextButton(onClick = onRestorePurchases, enabled = !billingBusy) {
                    Text(
                        text = stringResource(R.string.billing_restore_purchases),
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                    )
                }
                if (hasActive) {
                    TextButton(onClick = { showCancelDialog = true }, enabled = !billingBusy) {
                        Text(
                            text = stringResource(R.string.billing_cancel_pass),
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Medium,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }
            }
            // 상시 'Google Play 구독 관리' 링크는 두지 않는다 — 서버 부여 이용권 사용자에겐 Play 구독이 없어 빈 화면만 열린다.
            // 스토어 해지가 필요한 경우(PLAY_CANCEL_FAILED 등)는 해지 실패 다이얼로그가 manage URL 로 안내한다.
        }
    }

    purchaseTarget?.let { option ->
        PlayPurchaseDialog(
            target = option,
            busy = billingBusy,
            onDismiss = { purchaseTarget = null },
            onPurchase = {
                val productId = PlayBillingProducts.productIdFor(option.key)
                purchaseTarget = null
                val activity = context.findActivity()
                if (productId != null && activity != null) {
                    onPurchasePlay(activity, productId)
                }
            },
        )
    }

    if (showCancelDialog) {
        CancelSubscriptionDialog(
            subscription = subscription,
            onDismiss = { showCancelDialog = false },
            onConfirm = { atPeriodEnd ->
                showCancelDialog = false
                onCancelSubscription(atPeriodEnd)
            },
        )
    }
}

/**
 * Google Play 구독 결제 시작 다이얼로그 (월간 구독만 판매).
 * 제목=결론("시작할까요?"), 본문=가격·해지 안내 규칙을 따른다.
 */
@Composable
private fun PlayPurchaseDialog(
    target: SubscriptionPlanOption,
    busy: Boolean,
    onDismiss: () -> Unit,
    onPurchase: () -> Unit,
) {
    IosAlertDialog(
        title = stringResource(R.string.billing_play_purchase_title, target.name),
        // ⚠ 가격은 스토어가 권위라 **없을 수도 있다**(Play 조회 실패·미출시 상품).
        // 그때 가격 자리에 빈 문자열을 끼우면 "개인 이용권은 이에요." 가 된다 —
        // 숫자를 모를 땐 가격을 말하지 않는 문장을 쓴다. 실제 금액은 Play 결제
        // 시트가 어차피 다시 보여준다.
        message = target.trialDisclosure ?: if (target.price.isBlank()) {
            stringResource(R.string.billing_play_purchase_description_no_price, target.name)
        } else {
            stringResource(R.string.billing_play_purchase_description, target.name, target.price)
        },
        onDismiss = onDismiss,
        actions = listOf(
            IosAlertAction(
                label = stringResource(R.string.social_cancel_button),
                onClick = onDismiss,
            ),
            IosAlertAction(
                label = stringResource(R.string.billing_monthly_subscription),
                emphasized = true,
                // 결제 요청이 도는 동안 잠근다 — 두 번 눌러 같은 결제가 두 번 열리면 안 된다.
                enabled = !busy,
                onClick = onPurchase,
            ),
        ),
    )
}

/**
 * 이용권 화면의 **'현재 이용권' 카드**와 기간 한정 개인 플랜 문구의 자리 — [planScreenCurrentOf] 의 답.
 * 규칙은 `docs/spec/billing-lifecycle.md` 「기간 한정 개인 플랜」 D4 「이용권 화면의 프로모 문구」 이고,
 * iOS `PlanScreenCurrent.resolve`(`Views/Common/PlanTier.swift`)가 같은 입력에 같은 답을 낸다.
 */
internal data class PlanScreenCurrent(
    /** '현재 이용권' 뱃지·강조를 다는 카드의 key(`free`·`personal`). */
    val currentKey: String,
    /**
     * 프로모가 이 계정의 **유일한** 이용권이라 개인 카드가 현재가 됐다 — 그 카드의 상태 문구가
     * 프로모 한 줄이고, 결제 버튼은 남는다(산 이용권이 아니다).
     */
    val promoOnPersonalCard: Boolean,
    /**
     * 프로모 한 줄을 카드 목록 **위에** 그린다 — 프로모가 있는데 개인 카드에 앉지 않는 계정
     * (산 이용권·보류 행). 예전 그대로다. [promoOnPersonalCard] 와 동시에 참이 되지 않는다.
     */
    val promoLineAboveList: Boolean,
) {
    fun isCurrent(planKey: String): Boolean = planKey == currentKey

    /**
     * 결제 버튼 — 무료 카드엔 없고, **산** 현재 이용권 카드에도 없다(다시 살 것이 없다).
     * 프로모로 현재가 된 개인 카드에는 **있다** — '현재' 와 '결제 버튼 숨김' 은 다른 질문이다.
     */
    fun showsPurchase(planKey: String): Boolean =
        planKey != FREE_PLAN_KEY && (!isCurrent(planKey) || promoOnPersonalCard)

    companion object {
        const val FREE_PLAN_KEY = "free"
        const val PERSONAL_PLAN_KEY = "personal"
    }
}

/**
 * 이용권 화면에서 어느 카드가 **'현재 이용권'** 인가, 기간 한정 개인 플랜 문구는 **어디에** 앉나.
 *
 * 프로모가 이 계정의 **유일한 이용권**일 때만 개인 카드가 현재가 된다 — 산 이용권이 없고
 * ([purchasedPlanKey] 가 없거나 free), 보류 행도 없다. 그 밖(산 이용권·보류 행·프로모 없음/끝남)은
 * 예전 그대로다 — 현재 카드는 산 이용권, 프로모는 카드 위 한 줄.
 *
 * ⚠ **여기 답으로 해지를 가르지 말 것.** 해지 버튼은 산 이용권(구독 응답)으로만 가른다 — 프로모는
 *   산 이용권이 아니다.
 *
 * @param purchasedPlanKey 산 이용권의 key — 구독 응답의 `plan.key`(없으면 null = 무료). 예전에 현재
 *   카드를 고르던 값 그대로다.
 * @param promoActive 이용권 화면에 보일 프로모가 **지금** 살아 있다(`planScreenPersonalPromoOf` 가
 *   끝난 것을 이미 걸렀고, 마지막 날을 읽을 수 있다).
 * @param hasHeldSubscriptionRow 그 프로모의 `deletes_voices_at_end == false` — 원시 free 인데 `active`
 *   구독 행이 남은 계정(결제 보류 등). 보류 행은 구독 응답에 실리지 않아(`strongestPaidSubscription`)
 *   이 값이 아니면 프로모 계정과 구별되지 않는다. 키를 모르는 서버(null)는 보류가 아닌 것으로 읽는다.
 */
internal fun planScreenCurrentOf(
    purchasedPlanKey: String?,
    promoActive: Boolean,
    hasHeldSubscriptionRow: Boolean,
): PlanScreenCurrent {
    val purchasedKey = purchasedPlanKey ?: PlanScreenCurrent.FREE_PLAN_KEY
    val promoIsOnlyPlan = promoActive &&
        purchasedKey == PlanScreenCurrent.FREE_PLAN_KEY &&
        !hasHeldSubscriptionRow
    return PlanScreenCurrent(
        currentKey = if (promoIsOnlyPlan) PlanScreenCurrent.PERSONAL_PLAN_KEY else purchasedKey,
        promoOnPersonalCard = promoIsOnlyPlan,
        promoLineAboveList = promoActive && !promoIsOnlyPlan,
    )
}

/** Compose Context 에서 결제 시트 호출에 필요한 Activity 를 찾는다. */
private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

/** 플러스 혜택 한 줄 — 강조색 체크 + 글자(A안). */
@Composable
private fun PlanCheckRow(text: String) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = Icons.Rounded.Check,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(18.dp),
        )
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp),
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

/**
 * 플러스 큰 카드(A안). 배지는 지금 쓰는 중이면 '현재 이용권', 체험을 줄 수 있으면 '1개월 무료'.
 * 가격 줄은 체험이 있으면 "1개월 무료, 이후 월 ₩3,900", 없으면 "월 ₩3,900". 상태 한 줄(만료·해지 예정·프로모)은 가격 아래다.
 */
@Composable
internal fun PlusPlanHeroCard(
    option: SubscriptionPlanOption,
    isCurrent: Boolean,
    /** 지금 받을 수 있는 체험 기간("1개월") — 시작 버튼이 있을 때만([PlanScreenCurrent.showsPurchase]). */
    trial: String?,
    statusText: String?,
) {
    OutlinedCard(
        shape = WakerHeroShape,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.48f)),
        colors = CardDefaults.outlinedCardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.44f),
        ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = option.name,
                    style = MaterialTheme.typography.titleMedium.copy(fontSize = 17.sp),
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                val badge = when {
                    isCurrent -> stringResource(R.string.billing_current_pass_label)
                    trial != null -> stringResource(R.string.billing_plan_trial_headline, trial)
                    else -> null
                }
                if (badge != null) {
                    Surface(
                        shape = WakerPillShape,
                        color = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary,
                    ) {
                        Text(
                            text = badge,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    text = stringResource(R.string.billing_plan_personal_headline),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                if (option.price.isNotBlank()) {
                    Text(
                        text = if (trial != null) {
                            stringResource(R.string.billing_plan_trial_price_line, trial, option.price)
                        } else {
                            option.price
                        },
                        style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp),
                        color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                if (statusText != null) {
                    Text(
                        text = statusText,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.primary.copy(alpha = 0.24f))
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                option.features.forEach { feature -> PlanCheckRow(feature) }
            }
        }
    }
}

/** 무료 한 줄 카드(A안) — 이름·가격 한 줄(지금 쓰는 중이면 '현재 이용권' 배지), 아래에 혜택을 " · " 로 이은 한 줄. */
@Composable
internal fun FreePlanSummaryCard(option: SubscriptionPlanOption, isCurrent: Boolean) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = WakerPanelShape,
        color = MaterialTheme.colorScheme.surface,
        border = wakerCardBorder(),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = option.name,
                    style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp),
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = option.price,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                if (isCurrent) {
                    Surface(
                        shape = WakerPillShape,
                        color = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary,
                    ) {
                        Text(
                            text = stringResource(R.string.billing_current_pass_label),
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
            Text(
                text = option.features.joinToString(" · "),
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * 해지 2단계 플로우: (1) 해지 시점 선택 → (2) 즉시 해지는 비례 환불·음성 30일 보관을
 * 한 번 더 확인하고 나서야 실행한다(파괴적 액션 재확인).
 */
@Composable
private fun CancelSubscriptionDialog(
    subscription: BillingSubscription?,
    onDismiss: () -> Unit,
    onConfirm: (atPeriodEnd: Boolean) -> Unit,
) {
    var confirmImmediate by remember { mutableStateOf(false) }
    val endDate = formatPass(subscription?.expiresAt, PassShortDateFormatter)
    // 로그아웃 확인과 같은 iOS 알럿 스타일(IosAlertDialog)로 통일 — 확인형 모달은 전부 이 계열.
    if (confirmImmediate) {
        IosAlertDialog(
            title = stringResource(R.string.billing_cancel_immediate_title),
            message = stringResource(R.string.billing_cancel_immediate_description),
            onDismiss = onDismiss,
            actions = listOf(
                IosAlertAction(
                    label = stringResource(R.string.social_cancel_button),
                    onClick = onDismiss,
                ),
                IosAlertAction(
                    label = stringResource(R.string.billing_cancel_now),
                    emphasized = true,
                    destructive = true,
                    onClick = { onConfirm(false) },
                ),
            ),
        )
        return
    }
    val finalDescription = if (endDate != null) {
        stringResource(R.string.billing_cancel_description_with_date, endDate)
    } else {
        stringResource(R.string.billing_cancel_description_no_date)
    }
    IosAlertDialog(
        title = stringResource(R.string.billing_cancel_dialog_title),
        message = finalDescription,
        onDismiss = onDismiss,
        actions = listOf(
            IosAlertAction(
                label = endDate?.let { stringResource(R.string.billing_cancel_at_date, it) }
                    ?: stringResource(R.string.billing_cancel_at_end_date),
                onClick = { onConfirm(true) },
            ),
            IosAlertAction(
                label = stringResource(R.string.billing_cancel_now),
                destructive = true,
                onClick = { confirmImmediate = true },
            ),
            IosAlertAction(
                label = stringResource(R.string.social_cancel_button),
                onClick = onDismiss,
            ),
        ),
    )
}

/**
 * 서버가 스토어 구독을 직접 해지하지 못했을 때(PLAY_CANCEL_FAILED 등)의 안내.
 * 앱·서버 상태는 무변경이므로 여기서는 Google Play 구독 관리로 보내기만 한다.
 */
@Composable
internal fun PlayStoreManageDialog(
    manageUrl: String,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    IosAlertDialog(
        title = stringResource(R.string.billing_play_manage_title),
        message = stringResource(R.string.billing_play_manage_description),
        onDismiss = onDismiss,
        actions = listOf(
            IosAlertAction(
                label = stringResource(R.string.social_cancel_button),
                onClick = onDismiss,
            ),
            IosAlertAction(
                label = stringResource(R.string.billing_play_manage_open),
                emphasized = true,
                onClick = {
                    onDismiss()
                    runCatching {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(manageUrl)))
                    }
                },
            ),
        ),
    )
}


/**
 * 스토어에서 가격을 못 받았을 때 쓰는 **폴백 가격**.
 *
 * ⚠ **스토어 가격이 언제나 이긴다.** 이건 "값이 아예 없어서 빈칸으로 보이는" 것을 막는
 * 안전망일 뿐이다(2026-08-11 결정). 스토어가 값을 주면 그걸 쓴다 — 지역 통화·세금·
 * 프로모션이 반영된 값이라 그쪽이 정확하다.
 *
 * ⚠ **숫자의 출처는 백엔드 `plans.price_krw` 다**(`packages/backend/src/lib/migrations.ts`
 * 의 personal 3900). 거기를 바꾸면 여기도 바꾼다 — 서버는 **현재 플랜 하나**만 내려주기
 * 때문에 목록 화면에서는 이 표가 필요하다.
 *
 * ⚠ 한국 밖 사용자에게는 이 값이 틀릴 수 있다. 그래서 폴백이고, 실제 결제 금액은
 * 스토어 결제 시트가 다시 보여준다.
 */
private val FallbackPlanPriceKrw = mapOf(
    "personal" to 3900,
)

/** 스토어 가격이 있으면 그걸, 없으면 현재 언어의 월 가격 문구로 준다. */
/**
 * ISO 8601 기간(`P1M`·`P7D`·`P1W`·`P1Y`) → "1개월"·"7일"·"1주"·"1년". 못 읽으면 null(체험 문구를 그리지 않는다 — 기간을
 * 지어내지 않는다).
 */
internal fun trialPeriodLabel(context: Context, iso: String): String? {
    val match = Regex("^P(\\d+)([DWMY])$").matchEntire(iso.trim().uppercase()) ?: return null
    val count = match.groupValues[1].toIntOrNull()?.takeIf { it > 0 } ?: return null
    val res = when (match.groupValues[2]) {
        "D" -> R.plurals.billing_trial_days
        "W" -> R.plurals.billing_trial_weeks
        "M" -> R.plurals.billing_trial_months
        else -> R.plurals.billing_trial_years
    }
    return context.resources.getQuantityString(res, count, count)
}

/** 주기를 붙이지 않은 가격("₩3,900") — 체험 안내 문장("…매월 ₩3,900씩…")에 쓴다. 스토어 값이 없으면 폴백. */
private fun planRawPrice(context: Context, planPrices: Map<String, String>, key: String): String {
    planPrices[key]?.takeIf { it.isNotBlank() }?.let { return it }
    val krw = FallbackPlanPriceKrw[key] ?: return ""
    return context.getString(R.string.billing_plan_price_fallback, krw)
}

/**
 * 체험 안내 한 문장 — 첫 결제일은 **오늘 + 체험 기간**(스토어가 체험을 지금 시작하므로). ISO 기간을 못 읽으면 null(날짜를
 * 지어내지 않는다 — 그때는 카드가 문장 없이 그려지고 결제 시트가 날짜를 보여 준다).
 */
internal fun trialDisclosureText(context: Context, iso: String, rawPrice: String, today: java.time.LocalDate = java.time.LocalDate.now()): String? {
    if (rawPrice.isBlank()) return null
    val period = runCatching { java.time.Period.parse(iso.trim().uppercase()) }.getOrNull() ?: return null
    if (period.isZero || period.isNegative) return null
    val firstCharge = today.plus(period)
    val locale = context.resources.configuration.locales[0]
    val pattern = android.text.format.DateFormat.getBestDateTimePattern(locale, "MMMMd")
    val date = java.time.format.DateTimeFormatter.ofPattern(pattern, locale).format(firstCharge)
    return context.getString(R.string.billing_plan_trial_disclosure, date, rawPrice)
}

private fun planPriceLabel(context: Context, planPrices: Map<String, String>, key: String): String {
    // ⚠ **결제 주기를 붙인다**(2026-11-09). Play 의 `formattedPrice` 는 "₩3,900" 뿐이라 그대로 쓰면 카드가
    // "1개월 무료 체험, 이후 ₩3,900" 이 돼 **얼마마다** 내는지가 빠진다(스토어 정책은 체험 뒤 가격과 주기를 함께
    // 말하라고 한다). 상품은 월 구독 하나(`PlayBillingProducts.PERSONAL_MONTHLY`)다. iOS 짝은 `"월 \(price)"`.
    planPrices[key]?.takeIf { it.isNotBlank() }?.let { return context.getString(R.string.billing_plan_monthly_price, it) }
    val krw = FallbackPlanPriceKrw[key] ?: return ""
    return context.getString(R.string.billing_plan_monthly_price_fallback, krw)
}
