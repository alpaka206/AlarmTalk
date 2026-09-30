package com.alarmtalk.app.data

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * 계정 설정(`dynamic_prompt_settings` — 지역·사주) 올리기를 **한 번에 하나씩, 부른 순서대로** 돌린다.
 *
 * 한 요청은 설정 **전체**를 싣는다. 지역을 고르고 곧바로 운세를 고치면 요청이 둘 뜨는데, 따로 돌게 두면
 * (Codex #837):
 *  - 서버가 늦게 받은 옛 요청(지역만 바뀐 값)으로 새 값(운세까지 바뀐 값)을 덮을 수 있고,
 *  - 새 요청이 먼저 끝나 '안 올라간 변경' 표시를 내린 뒤 옛 요청의 응답이 세션을 옛 값으로 되돌리면,
 *    받아 적기([DynamicPromptPreferenceStore.adoptAccountSettings])가 표시 없이 그 옛 값을 이 기기에 적어
 *    방금 고친 값과 공휴일 국가가 조용히 되돌아간다.
 *
 * 차례대로 돌리면 서버도 세션도 마지막에 부른 값으로 끝난다. [Mutex] 는 공정하다 — 기다린 순서대로 들어간다.
 * iOS 는 `AuthViewModel.updateProfile` 이 `isBusy` 로 겹친 호출을 받지 않고, 받지 못한 변경은 '안 올라간 변경'
 * 표시가 다음 계정 응답에서 다시 올린다.
 */
class PromptSettingsUploadQueue {
    private val mutex = Mutex()

    suspend fun <T> enqueue(block: suspend () -> T): T = mutex.withLock { block() }
}
