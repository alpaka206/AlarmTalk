package com.alarmtalk.app.sync

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * **기본 목소리 교체가 아직 안 끝났는가.**
 *
 * 목소리 4종을 갈아 끼우는 회차에는 순서가 있다 — **다 받고 → 다 묶고 → 그 다음에 지운다**
 * (`StockClipPrefetchWorker`). 그 중간에 앱을 쓰면 알람이 **이름은 새 이름인데 소리는 옛
 * 목소리**인 상태로 울 수 있다. 그래서 남은 것이 있으면 화면을 막고 다시 시도하게 한다
 * (2026-09-03 지시). 삭제는 실패해도 막지 않는다 — 교체는 이미 끝난 상태라서다.
 *
 * ⚠ **기본값 `false` 는 '아니오' 가 아니라 '아직 모른다' 다.** 그래서 기본값을 **막지 않는
 *   쪽**으로 뒀다. 반대로 두면 매니페스트를 받기 전(콜드 스타트·비행기모드)에 **아무 일도
 *   없는 사용자까지 차단 화면에 가둔다** — 그 화면의 탈출구는 재시도뿐인데 네트워크가 없으면
 *   영영 못 나온다. 판정은 워커가 실제로 매니페스트를 받아 본 뒤에만 갱신한다.
 *
 * 프로세스 안에서만 산다(워커와 UI 가 같은 프로세스다). 프로세스가 죽으면 다시 '모른다' 로
 * 돌아가고, 다음 워커 실행이 곧바로 다시 판정한다 — 굳은 채로 남지 않는다.
 */
object StockReplacementStatus {
    /**
     * **교체가 미완료인 계정 id.** 없으면 null.
     *
     * ⚠ **`Boolean` 하나로 두지 말 것**(2026-09-03 리뷰 18차). 이 값은 **프로세스 전역**인데
     *   작업은 `WORK_NAME` 하나에 `KEEP` 이라, A 의 실행 중에 B 가 로그인하면 B 의 enqueue 가
     *   버려지고 A 의 결과만 남는다. 계정을 함께 들고 있어야 **A 의 미완료로 B 를 가두는**
     *   일이 없다 — 화면은 "지금 계정과 같은가" 로만 판단한다.
     */
    private val _pendingUserId = MutableStateFlow<String?>(null)
    val pendingUserId: StateFlow<String?> = _pendingUserId.asStateFlow()

    /**
     * **판정이 한 번이라도 끝났는가**(준비 신호).
     *
     * ⚠ **1회성 오버레이는 이 값을 기다려야 한다**(2026-09-03 리뷰 21차). 콜드 스타트에는
     *   미완료 여부를 아직 모르는데, 그 틈에 웰컴 프로모·첫 권한 안내가 뜨면 **소진 플래그를
     *   태우고** 뒤늦게 온 차단 화면이 그 위를 덮는다 — 사용자는 본 적도 없이 잃는다.
     *   CLAUDE.md 「1회성 오버레이는 확인이 끝난 뒤에만 판단한다」가 못 박은 자리이고,
     *   같은 사고가 이 저장소에서 다섯 번째다.
     *
     * ⚠ **계정별이다**(2026-09-03 리뷰 22차). 프로세스 전역 Boolean 이면 계정 A 가 한 번
     *   확인한 뒤 B 가 로그인해도 true 로 남아, **B 의 판정이 오기 전에** B 의 오버레이가
     *   소진된다. `pendingUserId` 와 같은 축으로 맞춘다.
     * ⚠ **실패한 시도도 '끝났다' 로 센다**(같은 회차). 매니페스트를 못 받았다고 이 값을
     *   false 로 두면 오프라인·서버 오류에서 **오버레이가 영영 안 뜬다** — 판정을 못 한
     *   것과 시도가 안 끝난 것은 다르다. 앞 판정은 그대로 지키고(그건 `report` 가 막는다)
     *   준비 신호만 세운다.
     */
    private val _checkedUserId = MutableStateFlow<String?>(null)
    val checkedUserId: StateFlow<String?> = _checkedUserId.asStateFlow()

    /** true 면 지금 워커가 돌고 있다(재시도 버튼을 잠근다). */
    private val _working = MutableStateFlow(false)
    val working: StateFlow<Boolean> = _working.asStateFlow()

    /**
     * 판정을 기록한다. **매니페스트를 못 받았으면 아무것도 하지 않는다.**
     *
     * ⚠ **판단 근거가 없을 때 '완료' 를 적으면 안 된다**(2026-09-03 리뷰 16차).
     *   앞 회차가 세워 둔 문을 오프라인 재시도 한 번이 **열어 버린다** — 옛 목소리를 물고
     *   있는 알람은 그대로인데 앱이 쓸 수 있게 된다. 그래서 그 판정을 호출부에 맡기지 않고
     *   **여기서** 막는다. 호출부마다 가드를 적게 하면 언젠가 한 곳이 빠진다.
     *   iOS 짝(`StockReplacementStatus.swift`)도 같다.
     */
    fun report(userId: String?, pending: Boolean, manifestFetched: Boolean) {
        // 판정은 근거가 있을 때만 갱신한다 — 못 받았으면 앞 판정을 그대로 지킨다.
        if (manifestFetched) {
            _pendingUserId.value = if (pending) userId else null
        }
        // 준비 신호는 **시도가 끝났으면** 세운다(성공·실패 모두).
        _checkedUserId.value = userId
    }

    fun setWorking(working: Boolean) {
        _working.value = working
    }
}
