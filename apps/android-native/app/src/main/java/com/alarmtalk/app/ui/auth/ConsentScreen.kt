package com.alarmtalk.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * 이 화면이 그릴 수 있는 동의 유형과 **같은 그룹 안에서의** 나열 순서.
 *
 * 필수/선택 그룹 자체는 서버가 내려준 `optional` 로 갈린다 — 여기 순서는 그룹 안에서만
 * 쓰인다. 목록에 없는 유형(서버가 새 유형을 먼저 추가한 구간)은 그리지 않고, 그게 필수면
 * [ConsentScreen] 의 통과 판정이 막는다.
 */
private val ConsentRowOrder = listOf(
    "age14",
    "terms",
    "privacy",
    "overseas_transfer",
    "voice_biometric",
    "marketing",
)

/**
 * 로그인 후 필수 약관/개인정보 동의를 받는 게이트 화면.
 * 신규 가입자뿐 아니라 기존 가입자도 미동의 시 이 화면을 통과해야 앱을 쓸 수 있다.
 *
 * 필수: 만14세 이상 / 이용약관 / 개인정보 처리방침 / 국외 이전
 * 선택: 음성 생체정보(내 목소리 등록) / 광고성 정보 수신(마케팅)
 *
 * 음성 생체정보를 **선택으로 여기서 함께** 묻는 이유: 내 목소리를 등록하지 않아도 기본
 * 목소리 알람으로 앱을 온전히 쓸 수 있으므로 가입 조건으로 강제하면 개인정보보호법
 * 제22조제5항에 걸린다. 그렇다고 등록하려는 순간에만 모달로 띄우면 그때가 가장 거부감이
 * 큰 자리다. 그래서 가입 화면 안에 선택 항목으로 두어 대부분은 한 번에 끝내고, 여기서
 * 거절한 사람만 목소리 등록 화면에서 인라인으로 다시 만난다.
 *
 * 어떤 항목이 선택인지는 서버가 [optional] 로 내려준다 — 화면이 목록을 따로 들고 있으면
 * 서버가 필수/선택을 바꿀 때 조용히 어긋난다. **나열도 이 값으로 필수 먼저·선택 나중**
 * 으로 가른다(그래서 필수 항목 사이에 선택이 끼지 않는다).
 *
 * **[collect] 에 든 유형만 그린다.** 서버가 유형별 최소 정책 버전으로 계산해 내려주며,
 * 이미 유효한 동의는 목록에 없다 — 개정 때 필요한 것만 다시 묻고, 묻지 않은 항목의 기존
 * 선택(특히 마케팅 수신)은 그대로 유지된다.

 */
@Composable
internal fun ConsentScreen(
    contentPadding: PaddingValues,
    busy: Boolean,
    collect: List<String>,
    optional: List<String>,
    // **이미 동의해 둔** 유형 — 초기 체크 상태로 쓴다(서버 prechecked).
    prechecked: List<String>,
    isReconsent: Boolean,
    onAgree: (agreedOptional: Set<String>) -> Unit,
) {
    var age14 by remember { mutableStateOf(false) }
    var terms by remember { mutableStateOf(false) }
    var privacy by remember { mutableStateOf(false) }
    var overseasTransfer by remember { mutableStateOf(false) }
    // ⚠ **이미 동의해 둔 선택 항목은 체크된 채로 시작한다.**
    // 선택 동의는 체크 없이도 CTA 가 통과되므로, 초기 상태를 항상 미체크로 두면 이미
    // 동의한 사용자가 화면을 그냥 지나가는 순간 그 동의가 agreed=false 로 제출돼 사라진다
    // — 목소리 기능이 막히고(sensitive_missing) 마케팅 수신 동의가 없어진다.
    // 미리 눌러 주는 게 아니라 **가진 것을 보여주는 것**이다(필수 유형은 서버가 prechecked
    // 에 담지 않으므로 여기 들어오지 않는다). key 를 prechecked 로 둬 응답이 늦게 와도 반영된다.
    var voiceBiometric by remember(prechecked) { mutableStateOf("voice_biometric" in prechecked) }
    var marketing by remember(prechecked) { mutableStateOf("marketing" in prechecked) }

    // 전문은 앱에 실려 있어 네트워크가 없어도 읽힌다. 문서가 바뀌지 않으니 한 번만 파싱한다.
    val context = LocalContext.current
    val termsText = remember(context) { context.readLegalDocument(LegalDocument.Terms) }
    val privacyText = remember(context) { context.readLegalDocument(LegalDocument.Privacy) }

    val showAge14 = "age14" in collect
    val showTerms = "terms" in collect
    val showPrivacy = "privacy" in collect
    val showVoiceBiometric = "voice_biometric" in collect
    val showOverseas = "overseas_transfer" in collect
    val showMarketing = "marketing" in collect
    // 구버전 서버(optional 없음)와 섞여 돌 수 있다. 비어 있으면 마케팅만 선택으로 본다 —
    // 그쪽이 안전한 폴백이다(선택을 필수로 잘못 그리면 사용자가 화면을 못 벗어난다).
    val optionalTypes = optional.ifEmpty { listOf("marketing") }.toSet()

    // 실제로 그릴 항목과 그 순서. **필수를 먼저 세우고 선택을 뒤로 민다** — 통과 조건이
    // 되는 항목이 선택 항목 아래로 밀리면 무엇을 체크해야 버튼이 켜지는지 스크롤해야
    // 알 수 있다. `sortedBy` 는 안정 정렬이라 그룹 안에서는 [ConsentRowOrder] 그대로다.
    val shownTypes = ConsentRowOrder.filter { it in collect }.sortedBy { it in optionalTypes }
    val shownCount = shownTypes.size
    // 통과 판정은 **그리는 목록이 아니라 [collect] 원본**으로 한다. 이 앱이 모르는 필수
    // 유형(서버가 새 유형을 먼저 추가한 구간)은 그려지지 않지만 아래 when 의 else 에서
    // 막혀 CTA 가 켜지지 않아야 한다 — 목록을 좁히면 그 방어가 사라진다.
    val requiredShown = collect.filter { it !in optionalTypes }
    val shownRequired = requiredShown.isNotEmpty()
    // '전체 동의' 가 실제로 다루는 집합 — **선택까지 포함**한다(2026-08-18 결정).
    // 라벨이 '필수 약관 전체 동의' 라 '전체' 라고 써 놓고 일부만 켜는 화면이었다.
    // 개별 체크박스와 [필수]/[선택] 표기는 그대로라 선택을 따로 끌 수 있다(제22조제5항).
    // 마스터 행 표시·`allChecked`·`setAll` 이 **모두 이 집합**을 본다(iOS `ConsentView.masterTypes`).
    val masterTypes = shownTypes

    /** 화면의 체크 상태를 유형 이름으로 읽는다. 모르는 유형은 그리지 못했으므로 false. */
    fun isChecked(type: String): Boolean = when (type) {
        "age14" -> age14
        "terms" -> terms
        "privacy" -> privacy
        "voice_biometric" -> voiceBiometric
        "overseas_transfer" -> overseasTransfer
        "marketing" -> marketing
        else -> false
    }

    // 그리지 않은 필수 항목은 이미 동의된 것이므로 통과 조건에서 뺀다.
    // 모르는 유형(서버가 새 유형을 먼저 추가한 구간)은 else -> false 로 통과를 막는다.
    // 그런 상태는 checkConsentStatus 가 consentUnsupported 로 잡아 이 화면 대신 업데이트
    // 차단 화면을 띄우므로 여기까지 오지 않는다 — 통과시키면 사용자가 본 적 없는 동의가
    // '체크됨' 으로 기록되기에 남겨 두는 이중 방어다(Codex #660).
    val allRequiredChecked = requiredShown.all { isChecked(it) }
    // ⚠ **마스터 행의 체크 상태는 `setAll` 과 같은 집합을 본다.** 한쪽만 바꾸면 전체 동의
    // 표시가 영영 안 켜지거나, 켜져 있는데 아무것도 안 하는 행이 된다.
    // ⚠ **CTA 판정(`allRequiredChecked`)과 섞지 말 것** — 그건 필수만 본다. 선택을 안 켰다고
    // 가입을 막으면 제22조제5항(거부해도 서비스 거부 불가) 위반이다.
    val allChecked = masterTypes.isNotEmpty() && masterTypes.all { isChecked(it) }

    // 화면에서 사용자가 실제로 체크한 '선택' 유형 — 제출은 이 값으로 agreed 를 정한다.
    val agreedOptional = buildSet {
        if (showVoiceBiometric && voiceBiometric) add("voice_biometric")
        if (showMarketing && marketing) add("marketing")
    }

    // ⚠ **끄는 것도 전체다** — 위 `allChecked` 와 **같은 집합**(`masterTypes`)을 본다.
    // 선택까지 한 번에 켜는 것이 「한 번 받은 동의는 다시 묻지 않는다」를 돕는다: 여기서
    // 생체정보를 켠 사람은 첫 목소리 등록에서도 인라인 동의를 만나지 않는다.
    fun setAll(value: Boolean) {
        if (showAge14) age14 = value
        if (showTerms) terms = value
        if (showPrivacy) privacy = value
        if (showOverseas) overseasTransfer = value
        if (showVoiceBiometric) voiceBiometric = value
        if (showMarketing) marketing = value
    }

    AuthBackdrop {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(contentPadding)
                .padding(horizontal = 24.dp),
        ) {
            Spacer(Modifier.height(24.dp))
            Text(
                text = stringResource(
                    if (isReconsent) R.string.auth_consent_title_updated else R.string.auth_consent_title,
                ),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                color = TextOnScene,
            )
            // 이미 동의했던 사람에게는 '왜 또 묻는지' 를 먼저 말해 준다. 신규 가입자에게는
            // 제목만으로 충분해 덧붙이지 않는다.
            if (isReconsent) {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = stringResource(R.string.auth_consent_subtitle_updated),
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextOnSceneDim,
                )
            }
            // '필수 약관 전체 동의' 는 스크롤 밖에 고정한다 — 항목을 펼쳐 읽다가도 한 번에
            // 동의할 수 있어야 한다. 필수가 하나뿐이면 같은 말을 두 번 시키는 것이라 그리지
            // 않는다(선택 항목은 마스터가 다루지 않으므로 개수에 넣지 않는다).
            if (masterTypes.size > 1) {
                Spacer(Modifier.height(24.dp))
                ConsentRow(
                    checked = allChecked,
                    onCheckedChange = ::setAll,
                    label = stringResource(R.string.auth_consent_agree_all),
                    emphasized = true,
                )
                Spacer(Modifier.height(4.dp))
                HorizontalDivider(color = AuthLineSoft)
            }

            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState()),
            ) {
                Spacer(Modifier.height(4.dp))
                // 순서가 바뀔 수 있으니 key 로 묶는다 — 없으면 자리(위치)로 기억되는 각 행의
                // 펼침 상태가 옆 항목으로 옮겨 붙는다.
                shownTypes.forEach { type ->
                    key(type) {
                        when (type) {
                            "age14" -> ConsentRow(
                                checked = age14,
                                onCheckedChange = { age14 = it },
                                label = stringResource(R.string.auth_consent_age14),
                            )
                            "terms" -> ConsentRow(
                                checked = terms,
                                onCheckedChange = { terms = it },
                                label = stringResource(R.string.auth_consent_terms),
                                detail = termsText,
                                scrollableDetail = true,
                            )
                            "privacy" -> ConsentRow(
                                checked = privacy,
                                onCheckedChange = { privacy = it },
                                label = stringResource(R.string.auth_consent_privacy),
                                detail = privacyText,
                                scrollableDetail = true,
                            )
                            "overseas_transfer" -> ConsentRow(
                                checked = overseasTransfer,
                                onCheckedChange = { overseasTransfer = it },
                                label = stringResource(R.string.auth_consent_overseas_transfer),
                                detail = AnnotatedString(
                                    stringResource(R.string.auth_consent_overseas_transfer_desc),
                                ),
                            )
                            "voice_biometric" -> ConsentRow(
                                checked = voiceBiometric,
                                onCheckedChange = { voiceBiometric = it },
                                label = stringResource(R.string.auth_consent_voice_biometric),
                                // 필수로 보이면 안 된다 — 체크하지 않아도 CTA 는 눌린다.
                                detail = AnnotatedString(
                                    stringResource(R.string.auth_consent_voice_biometric_desc),
                                ),
                            )
                            "marketing" -> ConsentRow(
                                checked = marketing,
                                onCheckedChange = { marketing = it },
                                label = stringResource(R.string.auth_consent_marketing),
                                detail = AnnotatedString(
                                    stringResource(R.string.auth_consent_marketing_detail),
                                ),
                            )
                        }
                    }
                }
            }

            Box(Modifier.padding(vertical = 16.dp)) {
                GradientCta(
                    // 받을 게 선택 동의뿐이면 '동의하고 시작하기' 라고 하면 안 된다 —
                    // 체크를 안 한 채 눌러도 눌리는데(선택이라 통과 조건이 아니다), 그때
                    // 기록되는 값은 '거절' 이다. 화면은 동의한다고 말하고 기록은 거절이라고
                    // 남는 어긋남이 생긴다. 필수가 하나도 없으면 중립 문구를 쓴다.
                    text = if (busy) {
                        stringResource(R.string.auth_consent_processing)
                    } else if (shownRequired) {
                        stringResource(R.string.auth_consent_agree_and_start)
                    } else {
                        stringResource(R.string.auth_consent_continue)
                    },
                    onClick = { onAgree(agreedOptional) },
                    // 그릴 항목이 하나도 없으면 동의할 대상도 없다 — 빈 화면에서 버튼이
                    // 눌려 사용자가 못 본 동의가 기록되는 일이 없게 막는다.
                    enabled = shownCount > 0 && allRequiredChecked && !busy,
                )
            }
        }
    }
}

/**
 * 로그인 직후 서버에 필수 동의 여부를 확인하는 동안 잠깐 보여주는 로딩 화면.
 * 이 게이트 덕분에 동의가 필요한 사용자에게 온보딩·홈이 먼저 깜빡이지 않고
 * 동의 화면이 항상 먼저 뜬다.
 */
@Composable
internal fun ConsentCheckLoadingScreen(contentPadding: PaddingValues) {
    AuthBackdrop {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(contentPadding),
            contentAlignment = Alignment.Center,
        ) {
            CircularProgressIndicator(color = BrandAccentOnScene)
        }
    }
}

/**
 * 동의 항목 한 줄.
 *
 * [detail] 이 있으면 오른쪽에 펼침 화살표가 붙고, 누르면 **이 자리 바로 아래에서** 내용을
 * 읽는다. 앱 밖 브라우저로 내보내면 동의 흐름이 끊기고 돌아오지 않는 사람이 생기며,
 * 네트워크가 없으면 동의 화면에서 전문을 아예 못 읽는다.
 *
 * 약관·처리방침은 요약이 아니라 **전문**이 들어온다(빌드 시 docs/legal 에서 실어 온 원문).
 * 길이가 길어 자체 스크롤 영역에 담고, 바깥 목록 스크롤과 섞이지 않게 높이를 제한한다.
 */
@Composable
private fun ConsentRow(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    label: String,
    description: String? = null,
    emphasized: Boolean = false,
    detail: AnnotatedString? = null,
    scrollableDetail: Boolean = false,
) {
    var expanded by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { onCheckedChange(!checked) }
                .padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Checkbox(
                checked = checked,
                onCheckedChange = onCheckedChange,
                colors = CheckboxDefaults.colors(
                    checkedColor = BrandAccentOnScene,
                    checkmarkColor = Color(0xFF0A1428),
                    uncheckedColor = AuthLine,
                ),
            )
            Column(
                modifier = Modifier.weight(1f),
            ) {
                Text(
                    text = label,
                    style = if (emphasized) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyLarge,
                    fontWeight = if (emphasized) FontWeight.Bold else FontWeight.Normal,
                    color = TextOnScene,
                )
                if (description != null) {
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = description,
                        style = MaterialTheme.typography.bodySmall,
                        color = AuthTextMuted,
                    )
                }
            }
            // ⚠ 민감 동의(생체정보·국외이전)의 긴 설명은 `description` 이 아니라 **`detail`**
            // 로 넘긴다 — 그래야 이 화살표로 접힌다. iOS 는 같은 일을
            // `ConsentRow.collapsibleDescription` 으로 한다(구조가 달라 이름이 다르다).
            if (detail != null) {
                IconButton(onClick = { expanded = !expanded }) {
                    Icon(
                        imageVector = if (expanded) {
                            Icons.Outlined.KeyboardArrowUp
                        } else {
                            Icons.Outlined.KeyboardArrowDown
                        },
                        contentDescription = stringResource(
                            if (expanded) R.string.auth_consent_collapse else R.string.auth_consent_expand,
                        ),
                        tint = AuthTextMuted,
                    )
                }
            }
        }
        if (detail != null && expanded) {
            Column(
                modifier = Modifier
                    .padding(start = 48.dp, end = 8.dp, bottom = 12.dp)
                    .then(
                        if (scrollableDetail) {
                            Modifier
                                .heightIn(max = 260.dp)
                                .verticalScroll(rememberScrollState())
                        } else {
                            Modifier
                        },
                    ),
            ) {
                Text(
                    text = detail,
                    style = MaterialTheme.typography.bodySmall,
                    color = AuthTextMuted,
                )
            }
        }
    }
}
