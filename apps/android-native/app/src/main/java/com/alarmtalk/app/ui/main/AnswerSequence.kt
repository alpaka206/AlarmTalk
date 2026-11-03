package com.alarmtalk.app

/**
 * **겹쳐 떠난 조회의 답 순번**(2026-10-29) — 더 나중에 떠난 답이 이미 실렸으면 그 전에 떠난 답은 버린다. 나중 답이 실패해
 * 실리지 않았으면 앞 답은 실린다(아무것도 없는 것보다 낫다). iOS 짝은 `ListAnswerSequence`(목소리 목록).
 *
 * 메인 스레드에서만 쓴다(뷰모델 상태와 같다).
 */
internal class AnswerSequence {
    private var requested = 0
    private var applied = 0

    /** 요청을 내기 직전에 번호를 뽑는다. */
    fun begin(): Int {
        requested += 1
        return requested
    }

    /** 이 답이 아직 실을 만한가 — 더 나중에 떠난 답이 실렸으면 false. */
    fun isCurrent(seq: Int): Boolean = seq > applied

    /** 이 답을 실었다. */
    fun markApplied(seq: Int) {
        if (seq > applied) applied = seq
    }
}
