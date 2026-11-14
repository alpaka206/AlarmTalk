package com.alarmtalk.app

internal data class SubscriptionPlanOption(
    val key: String,
    val name: String,
    val price: String,
    val features: List<String>,
    /** 지금 받을 수 있는 무료 체험 기간 표시("1개월") — 스토어가 체험 오퍼를 줄 때만. */
    val trialPeriod: String? = null,
    /**
     * 체험이 있을 때 결제 버튼 아래에 두는 한 문장 — "12월 9일부터 매월 ₩3,900씩 결제되고, …"(2026-11-09 오너 — 고르기 시안
     * '무료 기간 크게 + 첫 결제일'. 같은 날 "오늘은 결제되지 않아요." 는 뺐다). 날짜는 오늘 + 체험 기간이다.
     */
    val trialDisclosure: String? = null,
)

internal enum class NativeTab {
    Voices,
    Alarms,
    Billing,
    Menu,
}
