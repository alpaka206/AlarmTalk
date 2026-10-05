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

    @Test("부분 성공한 예약은 반복하지 않고 남은 대상만 이어간다")
    func partialCompletion() throws {
        let suite = "AlarmKitLocalizationTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let a = alarm("a", label: "Alarm from Alex", received: true)
        let b = alarm("b", label: "Alarm from Sam", received: true)
        AlarmPresentationLanguage.didSchedule(a.id, defaults: defaults)
        AlarmPresentationLanguage.finishIfComplete(owner: "owner", alarms: [a, b], defaults: defaults)
        #expect(AlarmPresentationLanguage.pending(owner: "owner", alarms: [a, b], defaults: defaults) == [b.id])
        AlarmPresentationLanguage.didSchedule(b.id, defaults: defaults)
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
