package com.alarmtalk.app

import android.content.Context
import android.content.res.Configuration
import java.util.Locale

/**
 * **스낵바 색은 문구의 종류(리소스)로 정한다 — 글자로 추측하지 않는다.**
 *
 * 예전에는 '실패'·'했어요' 같은 낱말이 글에 들어 있는지로 골랐다. 한국어에 맞춘 규칙을 영어·
 * 일본어 낱말 목록으로 옮기자 뜻이 뒤집혔다 — 일본어 오류 표지 「ません」이 성공 문구
 * (「…以前のコードは使えません。」「…次のお支払いはありません。」)를 빨갛게 칠했고, 영어 성공 표지
 * "sent" 가 "consent" 에, "registered" 가 "This code can't be registered" 에 걸려 동의 요구와
 * 등록 실패가 초록이 됐다. 낱말 목록은 언어마다 따로 맞춰야 하고 맞았는지 확인할 길도 없다.
 *
 * 그래서 스낵바로 가는 문구마다 종류를 **여기 한 곳에** 적고, 화면에 뜬 글을 세 언어(ko·en·ja)로
 * 펼친 그 문구들과 맞춰 본다. 같은 문구는 언어와 무관하게 같은 색이다. 여기 없는 글은 안내다.
 *
 * 분류:
 * - 성공: 사용자가 한 일이 끝났다(저장·등록·발송·해지) 또는 기다리던 것이 도착했다.
 * - 오류: 하려던 일이 실패했거나 거절됐다. 실패 갈래에서 나오는 문구는 이유를 말해도 오류다.
 * - 안내: 그 밖 — 하기 전에 필요한 것(입력·로그인·권한·이용권·동의), 진행 중, 결과 없음.
 *
 * ⚠ **스낵바로 가는 문구를 새로 만들면 셋 중 하나에 넣는다.** `SnackbarSeverityTest` 가 뷰모델
 * 소스(`ui/main/MainViewModel*.kt`)와 공용 오류 표가 쓰는 문구를 전부 훑어 빠진 것을 잡는다.
 */
internal object SnackbarSeverities {
    val success: Set<Int> = setOf(
        R.string.msg_family_alarm_set_for_target,
        R.string.msg_family_alarm_set_for_target_other,
        R.string.msg_verification_code_sent,
        R.string.msg_email_verification_completed,
        R.string.msg_register_success,
        R.string.msg_password_reset_code_sent,
        R.string.msg_password_reset_done,
        R.string.msg_account_deletion_requested,
        R.string.msg_account_deletion_cancelled,
        R.string.msg_family_alarm_settings_saved,
        R.string.msg_account_deleted,
        R.string.msg_voice_consent_withdrawn,
        R.string.msg_gb_promo_redeemed,
        R.string.msg_gb_code_registered,
        R.string.msg_gb_plan_applied,
        R.string.msg_gb_share_code_ready,
        R.string.msg_gb_share_code_regenerated,
        R.string.msg_gb_subscription_cancel_at_period_end,
        R.string.msg_gb_subscription_canceled_voice_locked,
        R.string.msg_member_removed,
    )

    val successPlurals: Set<Int> = setOf(
        R.plurals.msg_received_alarm_arrived,
    )

    val error: Set<Int> = setOf(
        // 알람
        R.string.msg_alarm_save_failed,
        R.string.msg_alarm_update_failed,
        R.string.msg_alarm_toggle_failed,
        R.string.msg_alarm_delete_failed,
        R.string.msg_family_alarm_set_failed,
        R.string.msg_voice_duration_unknown,
        R.string.msg_sync_pull_partial_failed,
        // 로그인·계정
        R.string.auth_error_invalid_credentials,
        R.string.msg_login_failed,
        R.string.msg_verification_code_send_failed,
        R.string.msg_register_email_taken,
        R.string.msg_register_email_social_google,
        R.string.msg_verification_code_mismatch,
        R.string.msg_register_failed,
        R.string.msg_password_reset_failed,
        R.string.msg_google_login_not_confirmed,
        R.string.msg_google_login_failed,
        R.string.msg_account_deletion_request_failed,
        R.string.msg_account_deletion_cancel_failed,
        R.string.msg_nickname_change_failed,
        R.string.msg_family_alarm_settings_save_failed,
        R.string.msg_account_deleted_google_unlink_failed,
        R.string.msg_account_delete_failed,
        R.string.msg_consent_record_failed,
        R.string.msg_marketing_consent_update_failed,
        R.string.msg_voice_consent_withdraw_failed,
        R.string.r3app_google_signin_failed,
        R.string.r3app_google_signin_no_info,
        R.string.r3ed_google_signin_error_config,
        R.string.r3ed_google_signin_error_network,
        R.string.r3ed_google_signin_error_failed,
        R.string.r3ed_google_signin_error_failed_status,
        // 이용권·코드
        R.string.msg_gb_share_code_info_load_failed,
        R.string.msg_gb_billing_info_load_failed,
        R.string.msg2_billing_fail_same_plan,
        R.string.msg2_billing_fail_no_active_subscription,
        R.string.msg2_billing_fail_plan_not_found,
        R.string.msg2_billing_fail_plan_inactive,
        R.string.msg2_billing_fail_free_not_billable,
        R.string.msg2_billing_fail_checkout_disabled,
        R.string.msg2_billing_fail_user_not_found,
        R.string.msg2_billing_fail_transaction_owned_by_other_user,
        R.string.msg2_code_fail_code_required,
        R.string.msg2_code_fail_invalid_format,
        R.string.msg2_code_fail_code_not_found,
        R.string.msg2_code_fail_code_expired,
        R.string.msg2_code_fail_code_already_used,
        R.string.msg2_code_fail_code_already_redeemed_by_you,
        R.string.msg2_code_fail_self_issued,
        R.string.msg2_code_fail_group_full,
        R.string.msg2_code_fail_invalid_plan_type,
        R.string.msg2_code_fail_plan_not_found,
        R.string.msg2_code_fail_user_not_found,
        R.string.msg2_code_fail_code_revoked,
        R.string.msg2_code_fail_already_member,
        R.string.msg2_promo_fail_code_inactive,
        R.string.msg2_promo_fail_not_in_window,
        R.string.msg2_promo_fail_code_exhausted,
        R.string.msg2_promo_fail_group_already_redeemed,
        R.string.msg2_promo_fail_owns_active_group,
        R.string.msg2_promo_fail_active_subscription,
        R.string.msg_gb_code_register_failed,
        R.string.msg_gb_google_play_start_failed,
        R.string.billing_gift_failed,
        R.string.msg_cross_store_renewal_active,
        R.string.msg_gb_payment_confirm_failed_retry,
        R.string.msg_gb_payment_confirm_failed,
        R.string.msg_gb_share_code_load_failed,
        R.string.msg_gb_subscription_cancel_failed,
        R.string.r3misc_billing_already_owned,
        R.string.r3misc_billing_purchase_failed,
        R.string.msg_leave_group_failed,
        R.string.msg_remove_member_failed,
        // 목소리·오디오
        R.string.msg_voice_fetch_failed,
        R.string.msg_voice_clone_audio_too_short,
        R.string.msg_voice_clone_audio_too_long,
        R.string.msg_voice_invalid_duration,
        R.string.msg_voice_invalid_audio_format,
        R.string.msg_voice_slot_exhausted,
        R.string.msg_voice_create_failed,
        R.string.msg_voice_replace_cleanup_failed,
        R.string.msg_voice_monthly_change_limit,
        R.string.msg_voice_delete_failed,
        R.string.msg_voice_info_update_failed,
        R.string.msg_voice_share_setting_failed,
        R.string.msg_voice_prerender_retry_failed,
        R.string.msg_voice_speech_style_retry_failed,
        R.string.rd_audio_duration_unreadable,
        R.string.rd_audio_extract_failed,
        R.string.rd_audio_mp3_trim_failed,
        R.string.rd_audio_open_failed,
        R.string.rd_audio_over_limit_trim_failed,
        R.string.rd_audio_trim_failed,
        R.string.rd_audio_upload_local_only,
        R.string.rd_audio_upload_path_missing,
        R.string.rd_audio_upload_file_missing,
        // 공용 오류 표(`network/ApiErrorMessages.kt`)
        R.string.api_error_rate_limited,
        R.string.api_error_request_too_large,
        R.string.api_error_server,
        R.string.api_error_schema_upgrading,
        R.string.auth_error_email_invalid,
        R.string.api_error_email_code_invalid,
        R.string.api_error_email_code_expired,
        R.string.api_error_email_code_attempts,
        R.string.api_error_account_pending_deletion,
        R.string.editor_error_manual_tts_quota,
        R.string.api_error_voice_limit_reached,
        R.string.api_error_voice_not_ready,
        R.string.api_error_voice_cloning_failed,
        R.string.api_error_alarm_not_found,
        R.string.api_error_tts_generation_failed,
    )

    val info: Set<Int> = setOf(
        // 하기 전에 필요한 것 — 로그인
        R.string.r3misc_login_required_generic,
        R.string.msg_login_required_to_use,
        R.string.msg_family_alarm_login_required,
        R.string.msg_sync_login_required,
        R.string.msg_gb_login_required_share_code_info,
        R.string.msg_gb_login_required_billing_info,
        R.string.msg_gb_login_required_register_code,
        R.string.msg_gb_login_required_purchase_plan,
        R.string.msg_gb_login_required_apply_plan,
        R.string.msg_gb_login_required_create_share_code,
        R.string.msg_gb_login_required_generic,
        R.string.msg_leave_group_login_required,
        R.string.msg_remove_member_login_required,
        R.string.msg_voice_fetch_login_required,
        R.string.msg_voice_create_login_required,
        R.string.msg_voice_edit_login_required,
        R.string.msg_voice_share_login_required,
        R.string.msg_voice_delete_login_required,
        R.string.msg_voice_tts_generate_login_required,
        R.string.msg_voice_tts_audio_load_login_required,
        R.string.r3misc_session_expired,
        R.string.api_error_session_expired,
        R.string.r3misc_google_signin_unavailable,
        R.string.r3ed_google_signin_error_canceled,
        R.string.r3ed_google_signin_error_in_progress,
        // 하기 전에 필요한 것 — 입력
        R.string.msg_login_email_password_required,
        R.string.msg_email_required,
        R.string.msg_verification_code_six_digits_required,
        R.string.msg_register_all_fields_required,
        R.string.msg_register_verify_email_first,
        R.string.msg_nickname_length_invalid,
        R.string.msg_time_format_required,
        R.string.msg_voice_name_required,
        R.string.msg_gb_code_input_required_period,
        // 하기 전에 필요한 것 — 권한·이용권·동의
        R.string.msg_permission_notifications_required,
        R.string.msg_permission_exact_alarms_required,
        R.string.msg_permission_full_screen_intent_required,
        R.string.msg_permission_record_audio_required,
        R.string.plan_gate_paid_message,
        R.string.msg_family_alarm_couple_family_only,
        R.string.msg_voice_share_couple_family_required,
        R.string.msg_voice_preset_only,
        R.string.msg_voice_locked_free_plan,
        R.string.msg_voice_consent_required,
        R.string.msg_voice_preview_required,
        R.string.r3misc_consent_required,
        R.string.msg_consent_update_required,
        // 진행 중·결과 없음
        R.string.r3misc_billing_purchase_pending,
        R.string.billing_restore_checking,
        R.string.billing_restore_none,
        R.string.msg_voice_replacement_settling,
        R.string.msg_verification_code_debug,
        R.string.r3app_update_downloaded,
    )

    @Volatile
    private var index: SnackbarSeverityIndex? = null

    fun of(context: Context, text: String): MessageSeverity {
        val current = index ?: synchronized(this) {
            index ?: SnackbarSeverityIndex.build(context.applicationContext ?: context).also { index = it }
        }
        return current.severityOf(text)
    }
}

internal fun snackbarSeverity(context: Context, text: String): MessageSeverity =
    SnackbarSeverities.of(context, text)

/**
 * 세 언어로 펼친 문구 → 종류. 자리표시자가 없는 문구는 글자 그대로, 있는 문구는 그 자리를
 * 아무 글자로 받는 틀로 맞춘다. 틀은 고정 글자가 긴 것부터 본다(더 구체적인 쪽이 이긴다).
 *
 * 앱 언어와 무관하게 세 언어를 다 펼치는 이유: 문구를 만든 컨텍스트(뷰모델의 Application)와
 * 스낵바를 그리는 컨텍스트(Activity)의 언어가 언어 변경 직후 잠깐 다를 수 있다.
 */
internal class SnackbarSeverityIndex private constructor(
    private val exact: Map<String, MessageSeverity>,
    private val templates: List<Pair<Regex, MessageSeverity>>,
) {
    fun severityOf(text: String): MessageSeverity =
        exact[text] ?: templates.firstOrNull { (pattern, _) -> pattern.matches(text) }?.second ?: MessageSeverity.Info

    companion object {
        private val LANGUAGES = listOf("ko", "en", "ja")
        private val PLURAL_SAMPLES = listOf(0, 1, 2, 5, 21)
        private val FORMAT_SPECIFIER = Regex("""%(?:\d+\$)?[-#+ 0,(]*\d*(?:\.\d+)?([a-zA-Z%])""")

        fun build(base: Context): SnackbarSeverityIndex {
            val exact = HashMap<String, MessageSeverity>()
            val templates = mutableListOf<Triple<Regex, Int, MessageSeverity>>()
            fun add(raw: String, severity: MessageSeverity) {
                if (!FORMAT_SPECIFIER.containsMatchIn(raw)) {
                    exact[raw] = severity
                    return
                }
                val pattern = StringBuilder()
                var literalLength = 0
                var last = 0
                for (match in FORMAT_SPECIFIER.findAll(raw)) {
                    val literal = raw.substring(last, match.range.first)
                    pattern.append(Regex.escape(literal))
                    literalLength += literal.length
                    if (match.groupValues[1] == "%") {
                        pattern.append(Regex.escape("%"))
                        literalLength += 1
                    } else {
                        pattern.append("(.+?)")
                    }
                    last = match.range.last + 1
                }
                val tail = raw.substring(last)
                pattern.append(Regex.escape(tail))
                literalLength += tail.length
                templates += Triple(Regex(pattern.toString(), RegexOption.DOT_MATCHES_ALL), literalLength, severity)
            }
            for (language in LANGUAGES) {
                val configuration = Configuration(base.resources.configuration).apply {
                    setLocale(Locale.forLanguageTag(language))
                }
                val resources = base.createConfigurationContext(configuration).resources
                for ((ids, severity) in listOf(
                    SnackbarSeverities.success to MessageSeverity.Success,
                    SnackbarSeverities.error to MessageSeverity.Error,
                    SnackbarSeverities.info to MessageSeverity.Info,
                )) {
                    ids.forEach { add(resources.getText(it).toString(), severity) }
                }
                for (id in SnackbarSeverities.successPlurals) {
                    PLURAL_SAMPLES.map { resources.getQuantityText(id, it).toString() }.distinct()
                        .forEach { add(it, MessageSeverity.Success) }
                }
            }
            return SnackbarSeverityIndex(
                exact = exact,
                templates = templates.sortedByDescending { it.second }.map { it.first to it.third },
            )
        }
    }
}
