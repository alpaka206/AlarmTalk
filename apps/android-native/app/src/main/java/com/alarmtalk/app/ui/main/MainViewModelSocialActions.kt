package com.alarmtalk.app

import com.alarmtalk.app.data.DowngradeNoticeStore
import android.util.Log
import androidx.lifecycle.viewModelScope
import com.alarmtalk.app.R
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

internal fun MainViewModel.refreshSocial() {
    refreshSocialData(showMessage = true)
}

internal fun MainViewModel.preloadSocial() {
    if (authSession == null || socialBusy) return
    refreshSocialData(showMessage = false)
}

private fun MainViewModel.refreshSocialData(showMessage: Boolean) {
    if (socialBusy) return
    val authorization = bearerOrMessage("Login is required to load shared plan data.") ?: return
    // **이 조회를 시작한 계정과 세대.** 응답이 늦게 도착하는 사이 로그아웃·계정 전환이 있었으면
    // 그 응답은 지금 계정의 것이 아니다 — 반영하면 A 의 목록이 B 의 상태로 자리 잡고, 이어지는
    // 강등이 A 의 목록으로 B 의 알람을 훑어 목소리를 영구히 벗긴다(Codex #665 P1).
    val requestOwner = authSession?.user?.id
    val startGeneration = authSessionStore.sessionGeneration()
    socialBusy = true
    // 새 소셜 로드 시작 — 신선-로드 플래그를 내려, 로드 완료 전 fetchVoiceProfiles 가 옛 상태로
    // 강등 판단하지 않게 한다(성공 시 snapshot.familyVoicesFresh 로 다시 설정).
    familyVoicesLoadedFresh = false
    viewModelScope.launch {
        try {
            runCatching {
                coroutineScope {
                    val group = async { api.getFamilyGroup(authorization) }
                    val sharedVoices = async {
                        runCatching {
                            api.listFamilyVoiceProfiles(authorization).profiles
                        }.onFailure { error ->
                            Log.w(TAG, "Failed to refresh family voice profiles", error)
                        }
                    }
                    val sharedVoicesResult = sharedVoices.await()
                    SocialSnapshot(
                        familyGroup = group.await(),
                        familyVoices = sharedVoicesResult.getOrElse { familyVoices },
                        familyVoicesFresh = sharedVoicesResult.isSuccess,
                    )
                }
            }.onSuccess { snapshot ->
                if (!responseStillBelongsToRequester(requestOwner, startGeneration)) {
                    Log.i(TAG, "Dropping stale social snapshot: session ended or switched")
                    return@onSuccess
                }
                familyGroup = snapshot.familyGroup
                saveFamilyGroupSnapshot(snapshot.familyGroup)
                // 공유 목소리 목록이 실제로 바뀌면(새로 공유받음/회수) 스톡 매니페스트도 새로 받는다.
                // 매니페스트는 세션 캐시라 안 갱신하면 새 공유 보이스의 미리듣기가 '준비 중'에 머물고
                // 편집기의 오프라인 프리셋 버킷도 바인딩되지 않는다.
                val sharedIdsChanged = snapshot.familyVoicesFresh &&
                    snapshot.familyVoices.map { it.id }.toSet() != familyVoices.map { it.id }.toSet()
                familyVoices = snapshot.familyVoices
                familyVoicesLoadedFresh = snapshot.familyVoicesFresh
                if (sharedIdsChanged) loadStockClips(forceReload = true)
                // 접근권 잃은 목소리 알람 강등 — 내 음성·공유 목소리 두 로드 중 늦게 끝난 쪽에서
                // 실행되도록 헬퍼로 위임한다(한쪽이 먼저 끝나 스킵돼도 재실행됨).
                // **목록을 가져온 계정을 그대로 넘긴다** — '지금 계정' 이 아니다.
                reconcileInaccessibleVoiceAlarms(requestOwner)
            }.onFailure { error ->
                AlarmTalkLog.reportError("Failed to refresh social data", error)
                if (showMessage) {
                    message = userFacingError(error, "Failed to load shared plan data")
                }
            }
        } finally {
            socialBusy = false
        }
    }
}

// 접근권을 잃은 공유/본인 목소리를 쓰는 '내 소유' 알람을 sound-only 로 강등한다(감사 B-3 LOCAL_OWNED 좀비).
// 내 음성 목록(voiceProfiles)·공유 목소리 목록(familyVoices)이 둘 다 신선하게 확보됐을 때만 판단한다.
// 두 로드가 비동기라 늦게 끝난 쪽(refreshSocial·fetchVoiceProfiles 성공)에서 이 함수를 호출해, 한쪽이
// 먼저 끝나 스킵돼도 재실행되게 한다. 로드 실패 시 옛 목록을 유지하므로 신선 로드만 신뢰해 오강등을 막는다.
/**
 * @param listOwner 이 목록들을 **가져온 계정**. 호출부가 조회를 시작한 시점의 값을 그대로
 *   넘긴다 — 여기서 `authSession` 을 읽으면 '지금 계정' 이 되어, 늦게 도착한 A 의 목록이
 *   B 의 이름표를 달게 된다. 그러면 저장소 가드(expectedOwnerUserId)가 통과해 **B 의 목소리
 *   참조와 캐시 오디오를 영구히 벗긴다**(Codex #665 P1). 되돌릴 수 없는 변경이다.
 */
internal fun MainViewModel.reconcileInaccessibleVoiceAlarms(listOwner: String?) {
    if (!familyVoicesLoadedFresh || !voiceProfilesLoadedFresh) return
    val accessibleVoiceIds = (voiceProfiles.map { it.id } + familyVoices.map { it.id }).toSet()
    // 제자리 교체는 프로필 id 를 재사용해 위 대조로는 **절대** 안 걸린다. 서버가 준
    // `custom_audio_invalidated_at` 이 지난번과 다르면 그 목소리의 직접 입력 알람만 내린다 —
    // 푸시를 놓친 기기가 스스로 수렴하는 유일한 경로다(정확성은 폴백이 맡는다).
    val markers = com.alarmtalk.app.data.VoiceReplacementMarkerStore(getApplication())
    // ⚠ **공유받은 목소리도 본다** — 그 목소리로 만든 내 직접 입력 알람도 함께 무효가 되는데,
    // 내 목록만 보면 공유받은 쪽 기기는 푸시를 놓쳤을 때 영영 모른다.
    val markerCandidates = voiceProfiles.map { it.id to it.customAudioInvalidatedAt } +
        familyVoices.map { it.id to it.customAudioInvalidatedAt }
    viewModelScope.launch {
        runCatching {
            val lostAccess = repository.degradeAlarmsWithInaccessibleVoice(accessibleVoiceIds, listOwner)
            var replacedCount = 0
            // ⚠ **판정을 코루틴 밖에서 미리 하지 말 것.** 예전에는 여기 오기 전에 걸러 뒀는데,
            // 그 사이 더 새 세대가 강등·확정되고 사용자가 새 목소리로 알람을 만들면 뒤늦게
            // 깨어난 이 회차가 그 알람을 지웠다. 저장소가 판정·강등·확정을 함께 잠근다.
            for ((profileId, invalidatedAt) in markerCandidates) {
                var degradedNow = 0
                markers.applyIfChanged(listOwner, profileId, invalidatedAt) {
                    degradedNow =
                        repository.degradeCustomMessageAlarmsUsingVoiceProfile(profileId, listOwner)
                    // 그 사이 계정이 바뀌었으면 확정하지 않는다 — 저장소가 소유자 불일치로
                    // 돌려준 0을 '처리 완료' 로 적으면 그 계정은 영영 재시도하지 않는다.
                    if (authSession?.user?.id == listOwner) degradedNow else null
                }
                // 확정을 미뤘어도 이미 내린 것은 센다 — 안내는 여기서만 남길 수 있다.
                replacedCount += degradedNow
            }
            lostAccess to replacedCount
        }
            .onSuccess { (lostAccess, replacedCount) ->
                // 목소리를 잃은 알람 — 이유를 알려 줄 곳이 여기뿐이다. **원인별로 따로 적는다** —
                // 대기표가 우선순위로 합치므로(안내할 액션이 있는 쪽이 이긴다) 여기서 뭉치면
                // 공유 해제의 '이용권 보기' 안내를 잃는다.
                val notices = DowngradeNoticeStore(getApplication())
                notices.record(listOwner, DowngradeNoticeStore.Cause.SHARED_RELEASED, lostAccess)
                notices.record(listOwner, DowngradeNoticeStore.Cause.VOICE_REPLACED, replacedCount)
                val total = lostAccess + replacedCount
                if (total > 0) Log.i(TAG, "Degraded $total alarm(s): access=$lostAccess replaced=$replacedCount")
            }
            .onFailure { error ->
                Log.w(TAG, "Failed to reconcile inaccessible-voice alarms", error)
            }
    }
}

internal fun MainViewModel.leaveFamilyGroup(groupId: String) {
    val authorization = bearerOrMessage(
        getApplication<android.app.Application>().getString(R.string.msg_leave_group_login_required),
    ) ?: return
    viewModelScope.launch {
        socialBusy = true
        runCatching {
            api.leaveFamilyGroup(authorization, groupId, emptyMap())
        }.onSuccess {
            // ⚠ **성공 토스트를 다시 넣지 말 것**(2026-08-15 지시).
            // 나가면 이용권 카드가 곧바로 '무료' 로 바뀐다 — 화면이 이미 그 사실을 말한다.
            // 토스트는 같은 말을 한 번 더 하면서 화면을 가리기만 한다.
            // 실패는 계속 알린다(아래 onFailure) — 그건 화면에 안 나타나는 사실이다.
            // 성공 시엔 refreshSocial 이 busy 소유권을 이어받는다. 여기서 먼저 내려
            // refreshSocialData 의 `if (socialBusy) return` 가드를 통과시키고, 이후 무조건적인
            // `socialBusy = false` 로 진행 중인 refresh 의 true 를 덮어쓰지 않는다(가드 무력화 회귀 방지).
            socialBusy = false
            refreshSocial()
            refreshBilling()
            refreshAppSession()
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to leave family group id=$groupId", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_leave_group_failed))
            // 실패 시에만 여기서 busy 를 리셋(성공 시엔 refreshSocial 이 소유).
            socialBusy = false
        }
    }
}

internal fun MainViewModel.removeFamilyMember(groupId: String, userId: String) {
    val authorization = bearerOrMessage(
        getApplication<android.app.Application>().getString(R.string.msg_remove_member_login_required),
    ) ?: return
    viewModelScope.launch {
        socialBusy = true
        runCatching {
            api.removeFamilyMember(authorization, groupId, userId)
        }.onSuccess {
            message = getApplication<android.app.Application>().getString(R.string.msg_member_removed)
            // 성공 시엔 refreshSocial 이 busy 소유권을 이어받는다. 여기서 먼저 내려
            // refreshSocialData 의 `if (socialBusy) return` 가드를 통과시키고, 이후 무조건적인
            // `socialBusy = false` 로 진행 중인 refresh 의 true 를 덮어쓰지 않는다(가드 무력화 회귀 방지).
            socialBusy = false
            refreshSocial()
            refreshBilling()
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to remove family member group=$groupId user=$userId", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_remove_member_failed))
            // 실패 시에만 여기서 busy 를 리셋(성공 시엔 refreshSocial 이 소유).
            socialBusy = false
        }
    }
}
