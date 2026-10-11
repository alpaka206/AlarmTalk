import Foundation

/// OS(AlarmKit)가 보관하는 알람 표시 문구의 **언어**를 예약과 맞춘다 — `docs/spec/localization.md` §5.
///
/// 기록은 둘이다: 알람별 예약 언어(예약할 때마다 적는다)와 계정별 마지막 표시 언어(대상이 다
/// 끝났을 때만 적는다). 계정 기록은 **알람별 기록이 없는 옛 예약**(이 기능 이전)의 언어를
/// 대신할 뿐이다.
enum AlarmPresentationLanguage {
    static var current: String { Bundle.main.preferredLocalizations.first ?? "ko" }
    private static func ownerKey(_ owner: String) -> String { "alarm.presentation.owner.\(owner)" }
    private static func alarmKey(_ id: String) -> String { "alarm.presentation.record.\(id)" }
    private static func captionKey(_ id: String) -> String { "alarm.presentation.caption.\(id)" }

    /// 표시 언어가 지금과 다른 켜진 예약 — AlarmKit 의 상태는 보지 않는다(그건 `reconcile` 이 본다).
    ///
    /// ⚠ **알람별 기록이 있으면 그것만 본다.** 계정 기록이 지금 언어와 같다고 건너뛰면, 일부만
    /// 다시 건 뒤 언어를 되돌렸을 때 먼저 다시 건 알람이 **다른 언어로 영영 남는다** — 계정
    /// 기록은 대상이 다 끝나야 바뀌므로 되돌린 언어 그대로다.
    static func rearmTargets(
        stamp: String?,
        current: String,
        alarms: [LocalAlarmRecord],
        recordStamp: (String) -> String? = { _ in nil },
        recordCaption: (String) -> String? = { _ in nil }
    ) -> Set<String> {
        Set(alarms.filter { record in
            guard record.enabled, record.alarmKitID != nil else { return false }
            // 언어 기록보다 **먼저** 본다 — 같은 언어로 걸린 옛 예약도 표시 규칙이 바뀌었으면 다시 건다.
            if voiceCaptionOutdated(record, scheduledCaption: recordCaption(record.id)) { return true }
            if let recorded = recordStamp(record.id) { return recorded != current }
            if let stamp { return stamp != current }
            return record.originEnum == .receivedRemote && record.localizedDisplayLabel != record.label
        }.map(\.id))
    }

    /// 받은 알람의 녹음 문구를 예약에 실은 표시와 지금 표시가 다른가(가족 알람 녹음 기본 라벨, §2).
    ///
    /// 언어 기록만으로는 못 잡는다 — 이 규칙 이전에 같은 언어로 걸린 예약은 언어 기록이 지금과
    /// 같아서, 원문(「가족이 보낸 음성」·「Voice from family」)을 실은 채 다른 이유로 다시 걸릴 때까지
    /// 남는다. 그래서 예약할 때 실은 표시를 알람별로 적고(`didSchedule`), 기록이 없으면 원문을
    /// 실었다고 본다. 비교 양쪽이 같은 행에서 나오므로 다시 건 뒤에는 같아져 되풀이되지 않는다.
    static func voiceCaptionOutdated(_ record: LocalAlarmRecord, scheduledCaption: String?) -> Bool {
        record.originEnum == .receivedRemote && record.localizedVoiceText != (scheduledCaption ?? record.voiceText)
    }

    static func pending(owner: String, alarms: [LocalAlarmRecord], defaults: UserDefaults = .standard) -> Set<String> {
        rearmTargets(
            stamp: defaults.string(forKey: ownerKey(owner)),
            current: current,
            alarms: alarms,
            recordStamp: { defaults.string(forKey: alarmKey($0)) },
            recordCaption: { defaults.string(forKey: captionKey($0)) }
        )
    }

    /// 예약에 성공한 행의 언어와 녹음 문구 표시를 적는다. 표시가 원문과 같으면 적지 않는다 —
    /// 기록이 없으면 원문을 실었다고 보므로(`voiceCaptionOutdated`) 같은 뜻이다.
    static func didSchedule(_ record: LocalAlarmRecord, defaults: UserDefaults = .standard) {
        defaults.set(current, forKey: alarmKey(record.id))
        if record.originEnum == .receivedRemote, let caption = record.localizedVoiceText, caption != record.voiceText {
            defaults.set(caption, forKey: captionKey(record.id))
        } else {
            defaults.removeObject(forKey: captionKey(record.id))
        }
    }

    /// 지운 알람의 기록을 지운다(`LocalAlarmStore.delete`). 꺼진 알람의 기록은 남긴다 — 행이
    /// 남아 있는 동안은 기록 수가 알람 수를 넘지 않고, 다시 켜면 새 예약이 덮어쓴다.
    static func forget(_ id: String, defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: alarmKey(id))
        defaults.removeObject(forKey: captionKey(id))
    }

    /// 남은 대상이 없을 때만 계정 기록을 지금 언어로 적는다. AlarmKit 상태 때문에 이번에 건너뛴
    /// 알람도 '남은 대상' 이다 — 여기서 끝내면 그 알람이 옛 언어로 남는다.
    static func finishIfComplete(owner: String, alarms: [LocalAlarmRecord], defaults: UserDefaults = .standard) {
        guard pending(owner: owner, alarms: alarms, defaults: defaults).isEmpty else { return }
        defaults.set(current, forKey: ownerKey(owner))
    }
}
