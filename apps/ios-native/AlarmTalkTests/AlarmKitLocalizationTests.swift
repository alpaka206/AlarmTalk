import AlarmKit
import Foundation
import Testing
@testable import AlarmTalk

@MainActor
struct AlarmKitLocalizationTests {
    private func alarm(_ id: String, label: String = "알람", received: Bool = false) -> LocalAlarmRecord {
        LocalAlarmRecord(id: id, label: label, hour: 7, minute: 30, fireAtMillis: 2_000_000_000_000,
                         origin: received ? AlarmOrigin.receivedRemote.rawValue : AlarmOrigin.localOwned.rawValue,
                         alarmKitID: UUID().uuidString)
    }

    @Test("언어 변경은 켜진 예약만, 첫 실행은 받은 알람의 달라진 라벨만 다시 만든다")
    func languageTargets() {
        let local = alarm("local")
        let received = alarm("received", label: "Alarm from Alex", received: true)
        var disabled = alarm("disabled"); disabled.enabled = false
        var unscheduled = alarm("unscheduled"); unscheduled.alarmKitID = nil
        let all = [local, received, disabled, unscheduled]
        #expect(AlarmPresentationLanguage.rearmTargets(stamp: "ko", current: "en", alarms: all) == ["local", "received"])
        #expect(AlarmPresentationLanguage.rearmTargets(stamp: "en", current: "en", alarms: all).isEmpty)
        #expect(AlarmPresentationLanguage.rearmTargets(stamp: nil, current: "ko", alarms: all) == ["received"])
    }

    @Test("같은 언어로 걸린 옛 예약도 받은 알람의 녹음 기본 라벨 표시가 바뀌었으면 한 번 다시 건다")
    func outdatedVoiceCaptionIsRearmedOnceEvenWithSameLanguageStamp() throws {
        let suite = "AlarmKitLocalizationTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let current = AlarmPresentationLanguage.current
        var family = alarm("family-\(UUID().uuidString)", label: "직접 정한 이름", received: true)
        family.voiceText = ReceivedVoiceTextDisplay.familyVoiceDefault
        var typed = alarm("typed-\(UUID().uuidString)", label: "직접 정한 이름", received: true)
        typed.voiceText = "엄마가 깨워 줄게"
        var own = alarm("own-\(UUID().uuidString)")
        own.voiceText = ReceivedVoiceTextDisplay.familyVoiceDefault
        // 이 규칙 이전 릴리스가 지금 언어로 건 예약 — 알람별·계정 언어 기록이 모두 지금과 같다.
        defaults.set(current, forKey: "alarm.presentation.owner.owner")
        for record in [family, typed, own] {
            defaults.set(current, forKey: "alarm.presentation.record.\(record.id)")
        }
        #expect(AlarmPresentationLanguage.pending(owner: "owner", alarms: [family, typed, own], defaults: defaults)
                == [family.id])

        // 다시 걸면 실은 표시를 적으므로 되풀이되지 않는다.
        AlarmPresentationLanguage.didSchedule(family, defaults: defaults)
        #expect(AlarmPresentationLanguage.pending(owner: "owner", alarms: [family, typed, own], defaults: defaults).isEmpty)
        // 지우면 그 기록도 지운다.
        AlarmPresentationLanguage.forget(family.id, defaults: defaults)
        #expect(defaults.string(forKey: "alarm.presentation.caption.\(family.id)") == nil)
    }

    @Test("첫 실행(기록 없음)도 받은 알람의 녹음 기본 라벨 표시가 다르면 다시 건다")
    func firstRunRearmsReceivedFamilyVoiceText() {
        var family = alarm("family", label: "직접 정한 이름", received: true)
        family.voiceText = ReceivedVoiceTextDisplay.familyVoiceDefault
        var typed = alarm("typed", label: "직접 정한 이름", received: true)
        typed.voiceText = "엄마가 깨워 줄게"
        #expect(AlarmPresentationLanguage.rearmTargets(stamp: nil, current: "ko", alarms: [family, typed]) == ["family"])
    }

    @Test("가족 알람의 기본 녹음 라벨은 계약값으로 보내고 받는 기기 언어로 보여 준다", arguments: ["ko", "en", "ja"])
    func familyVoiceText(language: String) throws {
        #expect(ReceivedVoiceTextDisplay.familyVoiceDefault == "가족이 보낸 음성")
        let path = try #require(Bundle.main.path(forResource: language, ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        let expected = ["ko": "상대가 보낸 음성", "en": "Voice from someone", "ja": "相手から届いた音声"][language]
        // 계약값과, 번역문을 보내던 옛 안드로이드 빌드가 남긴 값.
        for stored in ["가족이 보낸 음성", " 가족이 보낸 음성 ", "Voice from family", "家族からの音声"] {
            #expect(ReceivedVoiceTextDisplay.text(stored, bundle: bundle) == expected)
        }
        #expect(ReceivedVoiceTextDisplay.text("엄마가 깨워 줄게", bundle: bundle) == "엄마가 깨워 줄게")
    }

    @Test("자기 알람의 녹음 문구는 기본 라벨과 글자가 같아도 바꾸지 않는다")
    func ownVoiceTextIsNotRewritten() {
        var own = alarm("own")
        own.voiceText = ReceivedVoiceTextDisplay.familyVoiceDefault
        #expect(own.localizedVoiceText == ReceivedVoiceTextDisplay.familyVoiceDefault)
        var received = alarm("received", received: true)
        received.voiceText = ReceivedVoiceTextDisplay.familyVoiceDefault
        #expect(received.localizedVoiceText == String(localized: "상대가 보낸 음성"))
    }

    @Test("부분 성공한 예약은 반복하지 않고 남은 대상만 이어간다")
    func partialCompletion() throws {
        let suite = "AlarmKitLocalizationTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let a = alarm("a", label: "Alarm from Alex", received: true)
        let b = alarm("b", label: "Alarm from Sam", received: true)
        AlarmPresentationLanguage.didSchedule(a, defaults: defaults)
        AlarmPresentationLanguage.finishIfComplete(owner: "owner", alarms: [a, b], defaults: defaults)
        #expect(AlarmPresentationLanguage.pending(owner: "owner", alarms: [a, b], defaults: defaults) == [b.id])
        AlarmPresentationLanguage.didSchedule(b, defaults: defaults)
        AlarmPresentationLanguage.finishIfComplete(owner: "owner", alarms: [a, b], defaults: defaults)
        #expect(AlarmPresentationLanguage.pending(owner: "owner", alarms: [a, b], defaults: defaults).isEmpty)
    }

    @Test("표시 언어가 바뀌면 소리 지문이 같아도 다시 건다")
    func presentationRearmIgnoresSoundFingerprint() {
        var record = alarm("local")
        let kit = AlarmKitViewModel()
        record.scheduledSoundFingerprint = AlarmSoundResolver.plan(for: record, audioCache: .shared).fingerprint
        #expect(!AlarmScheduleReconciler.needsReschedule(record, alarmKit: kit, audioCache: .shared))
        #expect(AlarmScheduleReconciler.needsReschedule(record, alarmKit: kit, audioCache: .shared,
                                                       presentationRearmIds: [record.id]))
        record.enabled = false
        #expect(!AlarmScheduleReconciler.needsReschedule(record, alarmKit: kit, audioCache: .shared,
                                                        presentationRearmIds: [record.id]))
    }

    // MARK: - 언어 재예약은 AlarmKit 이 대기 상태로 든 핸들만 다시 건다

    /// 기기에 남는 기록의 형식이다 — 바꾸면 이미 적힌 기록이 고아가 된다.
    private func ownerKey(_ owner: String) -> String { "alarm.presentation.owner.\(owner)" }
    private func recordKey(_ id: String) -> String { "alarm.presentation.record.\(id)" }
    /// 지금 언어일 수 없는 값.
    private let otherLanguage = "xx-stale"

    private func makeStore() -> LocalAlarmStore {
        LocalAlarmStore(
            storageURL: FileManager.default.temporaryDirectory
                .appendingPathComponent("presentation-rearm-\(UUID().uuidString).json"),
            loadFromDisk: false
        )
    }

    private func owned(_ id: String, by owner: String) -> LocalAlarmRecord {
        var record = alarm("\(id)-\(UUID().uuidString)")
        record.ownerUserId = owner
        return record
    }

    /// OS 접점 호출 기록. 가짜 예약은 진짜 `schedule` 처럼 새 핸들과 알람별 언어를 적는다.
    @MainActor
    private final class OSCalls {
        var scheduled: [String] = []
        var cancelledHandles: [String] = []
    }

    private func reconcile(
        _ store: LocalAlarmStore, owner: String, idle: Set<String>?, calls: OSCalls
    ) async -> Int {
        await AlarmScheduleReconciler.reconcile(
            store: store, alarmKit: AlarmKitViewModel(), ownerUserId: owner,
            readIdleHandles: { idle },
            scheduleAlarm: { record in
                calls.scheduled.append(record.id)
                store.markScheduled(localID: record.id, alarmKitID: UUID().uuidString)
                AlarmPresentationLanguage.didSchedule(record)
                return true
            },
            cancelAlarm: { record in calls.cancelledHandles.append(record.alarmKitID ?? "") }
        )
    }

    private func forget(owner: String, ids: [String]) {
        UserDefaults.standard.removeObject(forKey: ownerKey(owner))
        ids.forEach { UserDefaults.standard.removeObject(forKey: recordKey($0)) }
    }

    @Test("AlarmKit 의 대기 상태만 다시 걸 수 있다 — 울리는 중·카운트다운·일시정지는 뺀다")
    func idleHandlesAreOnlyScheduledState() {
        let (scheduled, countdown, paused, alerting) = (UUID(), UUID(), UUID(), UUID())
        let idle = AlarmKitViewModel.idleHandles([
            (id: scheduled, state: .scheduled), (id: countdown, state: .countdown),
            (id: paused, state: .paused), (id: alerting, state: .alerting),
        ])
        #expect(idle == [scheduled.uuidString])
    }

    @Test("잠금 화면에서 끈 1회성·다시 울림 중인 알람은 언어 때문에 다시 걸지 않는다")
    func languageRearmSkipsHandlesNotIdleInAlarmKit() async throws {
        let owner = "owner-\(UUID().uuidString)"
        let store = makeStore()
        // 앱이 꺼진 채 잠금 화면에서 끈 1회성 — 인텐트가 행을 못 고쳐 켜진 채 옛 핸들을 든다.
        // AlarmKit 에는 이미 없다.
        let dismissed = store.upsert(owned("dismissed", by: owner))
        // 앱이 꺼진 채 다시 울림 — AlarmKit 은 카운트다운인데 행은 `.snoozed` 가 아니다.
        let snoozed = store.upsert(owned("snoozed", by: owner))
        let live = store.upsert(owned("live", by: owner))
        let liveHandle = try #require(live.alarmKitID)
        UserDefaults.standard.set(otherLanguage, forKey: ownerKey(owner))
        defer { forget(owner: owner, ids: [dismissed.id, snoozed.id, live.id]) }

        let calls = OSCalls()
        let repaired = await reconcile(store, owner: owner, idle: [liveHandle], calls: calls)

        #expect(repaired == 1)
        #expect(calls.scheduled == [live.id])
        #expect(calls.cancelledHandles == [liveHandle])
        #expect(store.record(id: dismissed.id)?.alarmKitID == dismissed.alarmKitID)
        #expect(store.record(id: snoozed.id)?.alarmKitID == snoozed.alarmKitID)
        // 건너뛴 대상이 남아 있으니 계정 기록은 그대로다 — 다음 회차에 다시 본다.
        #expect(UserDefaults.standard.string(forKey: ownerKey(owner)) == otherLanguage)

        // 관찰자가 둘을 끝난 알람으로 처리하면(1회성은 꺼진다) 남은 대상이 없어 기록이 끝난다.
        store.markStopped(alarmKitID: try #require(dismissed.alarmKitID))
        store.markStopped(alarmKitID: try #require(snoozed.alarmKitID))
        let next = OSCalls()
        #expect(await reconcile(store, owner: owner, idle: [], calls: next) == 0)
        #expect(next.scheduled.isEmpty)
        #expect(UserDefaults.standard.string(forKey: ownerKey(owner)) == AlarmPresentationLanguage.current)
    }

    @Test("AlarmKit 목록을 못 읽으면 언어 때문에 다시 걸지 않는다")
    func languageRearmWaitsWhenAlarmKitListIsUnreadable() async {
        let owner = "owner-\(UUID().uuidString)"
        let store = makeStore()
        let record = store.upsert(owned("live", by: owner))
        UserDefaults.standard.set(otherLanguage, forKey: ownerKey(owner))
        defer { forget(owner: owner, ids: [record.id]) }

        let calls = OSCalls()
        #expect(await reconcile(store, owner: owner, idle: nil, calls: calls) == 0)
        #expect(calls.scheduled.isEmpty)
        #expect(calls.cancelledHandles.isEmpty)
        #expect(UserDefaults.standard.string(forKey: ownerKey(owner)) == otherLanguage)
    }

    @Test("계정 기록이 지금 언어여도 다른 언어로 걸린 알람은 대상이다")
    func perAlarmStampWinsOverOwnerStamp() throws {
        let suite = "AlarmKitLocalizationTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let current = AlarmPresentationLanguage.current
        // 일부만 다시 건 뒤 언어를 되돌린 상태 — 먼저 다시 건 알람만 다른 언어로 걸려 있다.
        let rearmed = alarm("rearmed")
        let same = alarm("same")
        let legacy = alarm("legacy")   // 알람별 기록이 없는 옛 예약
        defaults.set(current, forKey: ownerKey("owner"))
        defaults.set(otherLanguage, forKey: recordKey(rearmed.id))
        defaults.set(current, forKey: recordKey(same.id))
        #expect(AlarmPresentationLanguage.pending(owner: "owner", alarms: [rearmed, same, legacy], defaults: defaults)
                == [rearmed.id])
        // 계정 기록이 낡았으면 알람별 기록이 없는 옛 예약도 대상이다. 알람별 기록이 지금 언어면 아니다.
        defaults.set(otherLanguage, forKey: ownerKey("owner"))
        #expect(AlarmPresentationLanguage.pending(owner: "owner", alarms: [rearmed, same, legacy], defaults: defaults)
                == [rearmed.id, legacy.id])
    }

    @Test("언어를 되돌리면 다른 언어로 걸린 알람을 다시 건다")
    func languageSwitchedBackRearmsPerAlarmStamped() async throws {
        let owner = "owner-\(UUID().uuidString)"
        let store = makeStore()
        let rearmed = store.upsert(owned("rearmed", by: owner))
        let untouched = store.upsert(owned("untouched", by: owner))
        let handle = try #require(rearmed.alarmKitID)
        let current = AlarmPresentationLanguage.current
        UserDefaults.standard.set(current, forKey: ownerKey(owner))
        UserDefaults.standard.set(otherLanguage, forKey: recordKey(rearmed.id))
        defer { forget(owner: owner, ids: [rearmed.id, untouched.id]) }

        let calls = OSCalls()
        let idle = Set([handle, try #require(untouched.alarmKitID)])
        #expect(await reconcile(store, owner: owner, idle: idle, calls: calls) == 1)
        #expect(calls.scheduled == [rearmed.id])
        #expect(calls.cancelledHandles == [handle])
        #expect(UserDefaults.standard.string(forKey: recordKey(rearmed.id)) == current)
    }

    @Test("지운 알람의 알람별 언어 기록은 함께 지운다")
    func deletingAlarmForgetsItsPresentationStamp() {
        let store = makeStore()
        let record = store.upsert(alarm("deleted-\(UUID().uuidString)"))
        AlarmPresentationLanguage.didSchedule(record)
        defer { UserDefaults.standard.removeObject(forKey: recordKey(record.id)) }
        #expect(UserDefaults.standard.string(forKey: recordKey(record.id)) != nil)
        store.delete(record)
        #expect(UserDefaults.standard.string(forKey: recordKey(record.id)) == nil)
    }

    @Test("받은 자동 라벨은 현재 언어로 만들고 직접 쓴 라벨은 보존한다", arguments: ["en", "ja"])
    func receivedLabels(language: String) throws {
        let path = try #require(Bundle.main.path(forResource: language, ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        let expected = language == "en" ? "Alarm from Alex" : "Alexさんから届いたアラーム"
        for stored in ["Alex님이 보낸 알람", "Alexさんさんから届いたアラーム", "Alarm from Alex"] {
            #expect(ReceivedAlarmLabelDisplay.label(stored, bundle: bundle) == expected)
        }
        #expect(ReceivedAlarmLabelDisplay.label("선생님이 보낸 알람", bundle: bundle)
                == (language == "en" ? "Alarm from 선생" : "선생さんから届いたアラーム"))
        #expect(ReceivedAlarmLabelDisplay.label("직접 정한 이름", bundle: bundle) == "직접 정한 이름")
        #expect(ReceivedAlarmLabelDisplay.label("Alarm from your friend", bundle: bundle)
                == (language == "en" ? "Alarm from someone" : "相手から届いたアラーム"))
    }

    @Test("성공 문구에 기본 이름의 한국어가 섞이지 않는다", arguments: ["알람", "Alarm", "アラーム"])
    func defaultScheduleStatus(label: String) {
        #expect(AlarmKitViewModel.describeScheduleStatus(record: alarm("a", label: label), resolution: .systemDefault)
                == String(localized: "알람을 예약했어요."))
    }
}
