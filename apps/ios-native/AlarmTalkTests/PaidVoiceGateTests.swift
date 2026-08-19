import XCTest
@testable import AlarmTalk

/// `PaidVoiceGate` — 유료 목소리 권한을 **예약 시점에** 재확인하는 게이트.
///
/// 안드로이드는 `RingingService` 가 울릴 때 같은 판단을 한다. iOS 는 발사 시점에 우리 코드가
/// 돌지 않아(AlarmKit 은 해제 시점의 `stopIntent` 뿐) 예약 시점으로 옮겼다.
///
/// **fail-open 이 이 파일의 핵심 계약이다.** 판단이 안 되면 강등하지 않는다 —
/// 잘못된 강등은 사용자가 기대고 자는 것을 흔든다.
final class PaidVoiceGateTests: XCTestCase {

    // MARK: - 헬퍼

    private func paidVoiceAlarm(origin: AlarmOrigin = .localOwned) -> LocalAlarmRecord {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var record = LocalAlarmRecord(
            id: UUID().uuidString,
            label: "아침",
            hour: 7,
            minute: 0,
            fireAtMillis: now + 60_000,
            origin: origin.rawValue,
            createdAtMillis: now,
            updatedAtMillis: now
        )
        record.playMode = AlarmPlayMode.voiceOnly.rawValue
        record.voiceProfileId = "clone-abc"          // 시스템 보이스 prefix 가 아니다 = 유료 클론
        record.audioCacheKey = "abcdef123456"
        record.ttsMessageId = "msg-1"
        return record
    }

    private func freeSystemVoiceAlarm() -> LocalAlarmRecord {
        var record = paidVoiceAlarm()
        record.voiceProfileId = systemVoiceIDPrefix + "000000000101"
        record.audioCacheKey = "stock_msg-1"
        record.localAudioUri = nil
        record.rawAudioUri = nil
        return record
    }

    private func subscription(status: String, expiresAt: String) -> BillingSubscription {
        BillingSubscription(
            id: "sub-1",
            planId: "plan-1",
            planGroupId: nil,
            status: status,
            startsAt: "2026-01-01T00:00:00Z",
            expiresAt: expiresAt,
            cancelAtPeriodEnd: nil,
            canceledAt: nil,
            nextPlanId: nil
        )
    }

    private func snapshot(_ sub: BillingSubscription?, plan: BillingPlan? = nil) -> AccessSnapshot {
        AccessSnapshot(
            subscriptionResponse: BillingSubscriptionResponse(subscription: sub, plan: plan, nextPlan: nil),
            familyGroup: nil
        )
    }

    // MARK: - fail-open

    /// 스냅샷이 아예 없으면(한 번도 조회 못 함) **판단 불가 → 강등하지 않는다.**
    /// 여기서 강등하면 설치 직후·오프라인 사용자의 목소리가 통째로 사라진다.
    func test_noSnapshot_doesNotDowngrade() {
        XCTAssertFalse(
            PaidVoiceGate.shouldDowngrade(record: paidVoiceAlarm(), snapshot: .empty)
        )
    }

    /// 만료 시각을 파싱하지 못해도 강등하지 않는다.
    func test_unparsableExpiry_doesNotDowngrade() {
        let snap = snapshot(subscription(status: "active", expiresAt: "언젠가"))
        XCTAssertFalse(PaidVoiceGate.shouldDowngrade(record: paidVoiceAlarm(), snapshot: snap))
    }

    // MARK: - 강등해야 하는 경우

    func test_expiredSubscription_downgrades() {
        let snap = snapshot(subscription(status: "active", expiresAt: "2020-01-01T00:00:00Z"))
        XCTAssertTrue(PaidVoiceGate.shouldDowngrade(record: paidVoiceAlarm(), snapshot: snap))
    }

    func test_canceledStatus_downgrades() {
        let snap = snapshot(subscription(status: "canceled", expiresAt: "2099-01-01T00:00:00Z"))
        XCTAssertTrue(PaidVoiceGate.shouldDowngrade(record: paidVoiceAlarm(), snapshot: snap))
    }

    /// 서버가 '본인 구독 없음' 이라고 답했고 그룹 접근도 없으면 무료다.
    func test_noSubscriptionAndNoGroup_downgrades() {
        let snap = snapshot(nil)
        XCTAssertTrue(PaidVoiceGate.shouldDowngrade(record: paidVoiceAlarm(), snapshot: snap))
    }

    // MARK: - 강등하면 안 되는 경우

    func test_activeSubscription_doesNotDowngrade() {
        let snap = snapshot(subscription(status: "active", expiresAt: "2099-01-01T00:00:00Z"))
        XCTAssertFalse(PaidVoiceGate.shouldDowngrade(record: paidVoiceAlarm(), snapshot: snap))
    }

    /// 회복형 상태(ON_HOLD/PAUSED)는 서버가 그룹·공유를 그대로 두므로 권한을 회수하지 않는다
    /// (`resolvePlanAfterSuspend` 와 같은 취급).
    func test_onHoldOrPaused_doesNotDowngrade() {
        for status in ["on_hold", "paused", "ON_HOLD", "PAUSED"] {
            let snap = snapshot(subscription(status: status, expiresAt: "2020-01-01T00:00:00Z"))
            XCTAssertFalse(
                PaidVoiceGate.shouldDowngrade(record: paidVoiceAlarm(), snapshot: snap),
                "\(status) 는 회복형이라 회수하지 않는다"
            )
        }
    }

    /// 본인 구독이 없어도 커플/가족 그룹 멤버면 유료 목소리를 쓴다.
    func test_groupMemberWithoutOwnSubscription_doesNotDowngrade() {
        let plan = BillingPlan(
            id: "p", key: "family", name: "가족", planType: "family",
            periodDays: 30, maxMembers: 4, priceKrw: 5900
        )
        let snap = snapshot(nil, plan: plan)
        XCTAssertFalse(PaidVoiceGate.shouldDowngrade(record: paidVoiceAlarm(), snapshot: snap))
    }

    /// **공유받은 알람은 받는 쪽 구독으로 판단하지 않는다.** 보낸 사람의 구독으로
    /// 성립하는 것이라, 받는 사람이 무료라고 목소리를 뺏으면 안 된다.
    func test_receivedRemote_neverDowngrades() {
        let snap = snapshot(nil)
        XCTAssertTrue(PaidVoiceGate.shouldDowngrade(record: paidVoiceAlarm(), snapshot: snap))
        XCTAssertFalse(
            PaidVoiceGate.shouldDowngrade(record: paidVoiceAlarm(origin: .receivedRemote), snapshot: snap)
        )
    }

    /// 무료 시스템 보이스는 애초에 강등 대상이 아니다 — 무료 플랜에서도 쓸 수 있다.
    func test_freeSystemVoice_neverDowngrades() {
        let snap = snapshot(nil)
        XCTAssertTrue(PaidVoiceGate.usesFreeSystemVoice(freeSystemVoiceAlarm()))
        XCTAssertFalse(PaidVoiceGate.shouldDowngrade(record: freeSystemVoiceAlarm(), snapshot: snap))
    }

    /// 목소리를 아예 안 쓰는 알람은 판단할 것이 없다.
    func test_alarmOnly_neverDowngrades() {
        var record = paidVoiceAlarm()
        record.playMode = AlarmPlayMode.alarmOnly.rawValue
        record.voiceProfileId = nil
        record.ttsMessageId = nil
        record.audioCacheKey = nil
        XCTAssertFalse(PaidVoiceGate.usesPaidVoice(record))
        XCTAssertFalse(PaidVoiceGate.shouldDowngrade(record: record, snapshot: snapshot(nil)))
    }

    // MARK: - 강등 결과

    /// **알람 자체는 그대로 울린다.** 목소리만 빼고 기본 톤으로 떨어뜨린다 —
    /// 시각·요일·켜짐을 건드리면 그날 못 일어난다.
    func test_downgraded_keepsScheduleAndOnlyDropsVoice() {
        let record = paidVoiceAlarm()
        let downgraded = PaidVoiceGate.downgraded(record)

        XCTAssertEqual(downgraded.playMode, AlarmPlayMode.alarmOnly.rawValue)
        XCTAssertEqual(downgraded.hour, record.hour)
        XCTAssertEqual(downgraded.minute, record.minute)
        XCTAssertEqual(downgraded.repeatDaysMask, record.repeatDaysMask)
        XCTAssertEqual(downgraded.enabled, record.enabled)
        XCTAssertEqual(downgraded.id, record.id)
        // 원본 값은 남겨 둔다 — 구독을 되살리면 그대로 돌아와야 한다.
        XCTAssertEqual(downgraded.voiceProfileId, record.voiceProfileId)
        XCTAssertEqual(downgraded.audioCacheKey, record.audioCacheKey)
    }

    // MARK: - 타임스탬프 파싱

    /// 서버는 ISO8601 과 SQLite `datetime('now')` 형식을 섞어 내려준다.
    func test_parseTimestamp_acceptsBothServerFormats() {
        XCTAssertNotNil(PaidVoiceGate.parseTimestamp("2026-08-06T01:02:03Z"))
        XCTAssertNotNil(PaidVoiceGate.parseTimestamp("2026-08-06T01:02:03.500Z"))
        XCTAssertNotNil(PaidVoiceGate.parseTimestamp("2026-08-06 01:02:03"))
        XCTAssertNil(PaidVoiceGate.parseTimestamp("아무거나"))
    }
}

// MARK: - 자원 없는 알람은 유료가 아니다 (2026-08-18 회귀)

extension PaidVoiceGateTests {
    /// ⚠ **한 번도 유료였던 적 없는 계정**이 "무료 이용권으로 바뀌었어요" 를 받은 원인.
    /// 재생 방식만 목소리이고 말할 자원(profileId·ttsMessageId·오디오)이 하나도 없는
    /// 알람이 유료로 분류돼 잠겼다. 실계정 `ronald@estsoft.com`(구독 이력 0건)의 07:30
    /// 알람이 서버에 `mode=sound-only` 로 박혀 있었다.
    func test_말할_자원이_없으면_유료_목소리가_아니다() {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var record = LocalAlarmRecord(
            id: UUID().uuidString,
            label: "아침",
            hour: 7,
            minute: 30,
            fireAtMillis: now + 60_000,
            origin: AlarmOrigin.localOwned.rawValue,
            createdAtMillis: now,
            updatedAtMillis: now
        )
        record.playMode = AlarmPlayMode.voiceOnly.rawValue
        record.voiceProfileId = nil
        record.ttsMessageId = nil
        record.localAudioUri = nil
        record.rawAudioUri = nil

        XCTAssertFalse(PaidVoiceGate.usesPaidVoice(record), "자원이 없는데 유료로 잡혔다")
        XCTAssertFalse(record.isPaidVoiceForDowngrade, "자원이 없는데 강등 대상으로 잡혔다")
    }

    /// 반대 방향 — 자원이 있으면 그대로 대상이다(위 수정이 게이트를 뚫지 않았는지).
    func test_클론_목소리_알람은_여전히_강등_대상이다() {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var record = LocalAlarmRecord(
            id: UUID().uuidString,
            label: "아침",
            hour: 7,
            minute: 30,
            fireAtMillis: now + 60_000,
            origin: AlarmOrigin.localOwned.rawValue,
            createdAtMillis: now,
            updatedAtMillis: now
        )
        record.playMode = AlarmPlayMode.voiceOnly.rawValue
        record.voiceProfileId = "clone-abc"
        record.ttsMessageId = "msg-1"

        XCTAssertTrue(PaidVoiceGate.usesPaidVoice(record))
        XCTAssertTrue(record.isPaidVoiceForDowngrade)
    }
}
