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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * 로그인 후 필수 약관/개인정보 동의를 받는 게이트 화면.
 * 신규 가입자뿐 아니라 기존 가입자도 미동의 시 이 화면을 통과해야 앱을 쓸 수 있다.
 *
 * 필수: 만14세 이상 / 이용약관 / 개인정보 처리방침
 * 선택: 광고성 정보 수신(마케팅)
 *
 * **[collect] 에 든 유형만 그린다.** 서버가 유형별 최소 정책 버전으로 계산해 내려주며,
 * 이미 유효한 동의는 목록에 없다 — 개정 때 필요한 것만 다시 묻고, 묻지 않은 항목의 기존
 * 선택(특히 마케팅 수신)은 그대로 유지된다.
 *
 * 음성 생체정보·국외 이전은 여기서 받지 않는다. 목소리를 실제로 등록할 때
 * [com.alarmtalk.app.ui.components.VoiceConsentSheet] 로 받는다 — 목소리를 등록하지 않을
 * 사용자에게까지 생체정보 처리 동의를 요구하면 별도 동의를 이용 조건으로 강제하는 셈이다.
 */
@Composable
internal fun ConsentScreen(
    contentPadding: PaddingValues,
    busy: Boolean,
    collect: List<String>,
    isReconsent: Boolean,
    onAgree: (marketingAgreed: Boolean) -> Unit,
    onOpenTerms: () -> Unit,
    onOpenPrivacy: () -> Unit,
) {
    var age14 by remember { mutableStateOf(false) }
    var terms by remember { mutableStateOf(false) }
    var privacy by remember { mutableStateOf(false) }
    var marketing by remember { mutableStateOf(false) }

    val showAge14 = "age14" in collect
    val showTerms = "terms" in collect
    val showPrivacy = "privacy" in collect
    val showMarketing = "marketing" in collect
    val shownCount = listOf(showAge14, showTerms, showPrivacy, showMarketing).count { it }

    // 그리지 않은 필수 항목은 이미 동의된 것이므로 통과 조건에서 뺀다.
    val allRequiredChecked =
        (!showAge14 || age14) && (!showTerms || terms) && (!showPrivacy || privacy)
    val allChecked = allRequiredChecked && (!showMarketing || marketing)

    fun setAll(value: Boolean) {
        if (showAge14) age14 = value
        if (showTerms) terms = value
        if (showPrivacy) privacy = value
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
            // '약관 전체 동의' 는 스크롤 밖에 고정한다 — 항목을 펼쳐 읽다가도 한 번에 동의할 수
            // 있어야 한다(항목이 하나뿐이면 같은 말을 두 번 시키는 것이라 그리지 않는다).
            if (shownCount > 1) {
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
                if (showAge14) {
                    ConsentRow(
                        checked = age14,
                        onCheckedChange = { age14 = it },
                        label = stringResource(R.string.auth_consent_age14),
                    )
                }
                if (showTerms) {
                    ConsentRow(
                        checked = terms,
                        onCheckedChange = { terms = it },
                        label = stringResource(R.string.auth_consent_terms),
                        detail = stringResource(R.string.auth_consent_terms_detail),
                        onOpenFullText = onOpenTerms,
                    )
                }
                if (showPrivacy) {
                    ConsentRow(
                        checked = privacy,
                        onCheckedChange = { privacy = it },
                        label = stringResource(R.string.auth_consent_privacy),
                        detail = stringResource(R.string.auth_consent_privacy_detail),
                        onOpenFullText = onOpenPrivacy,
                    )
                }
                if (showMarketing) {
                    ConsentRow(
                        checked = marketing,
                        onCheckedChange = { marketing = it },
                        label = stringResource(R.string.auth_consent_marketing),
                        detail = stringResource(R.string.auth_consent_marketing_detail),
                    )
                }
            }

            Box(Modifier.padding(vertical = 16.dp)) {
                GradientCta(
                    text = if (busy) {
                        stringResource(R.string.auth_consent_processing)
                    } else {
                        stringResource(R.string.auth_consent_agree_and_start)
                    },
                    onClick = { onAgree(marketing) },
                    enabled = allRequiredChecked && !busy,
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
 * 읽는다. 앱 밖 브라우저로 내보내면 동의 흐름이 끊기고 돌아오지 않는 사람이 생긴다.
 * 전문(全文)까지 필요한 사람을 위해 펼친 영역 끝에 [onOpenFullText] 링크를 남긴다.
 */
@Composable
private fun ConsentRow(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    label: String,
    description: String? = null,
    emphasized: Boolean = false,
    detail: String? = null,
    onOpenFullText: (() -> Unit)? = null,
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
                modifier = Modifier.padding(start = 48.dp, end = 8.dp, bottom = 12.dp),
            ) {
                Text(
                    text = detail,
                    style = MaterialTheme.typography.bodySmall,
                    color = AuthTextMuted,
                )
                if (onOpenFullText != null) {
                    TextButton(
                        onClick = onOpenFullText,
                        colors = authTextButtonColors(),
                        contentPadding = PaddingValues(horizontal = 0.dp, vertical = 4.dp),
                    ) {
                        Text(stringResource(R.string.auth_consent_full_text))
                    }
                }
            }
        }
    }
}
