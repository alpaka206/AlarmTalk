import Foundation

@MainActor
final class RemoteAlarmSyncViewModel: ObservableObject {
    @Published var remoteAlarms: [RemoteAlarm] = []
    @Published var voiceProfiles: [VoiceProfile] = []
    @Published var statusMessage: String?
    @Published var isBusy = false

    private let api: VoiceAlarmAPI

    init(api: VoiceAlarmAPI = .shared) {
        self.api = api
    }

    func refresh(session: AuthSession?) async {
        guard let token = session?.token else { return }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            async let alarms = api.listAlarms(token: token)
            async let profiles = api.listVoiceProfiles(token: token)
            remoteAlarms = try await alarms
            voiceProfiles = try await profiles
            statusMessage = "서버 동기화 완료"
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func push(record: LocalAlarmRecord, store: LocalAlarmStore, session: AuthSession?) async {
        guard let token = session?.token else {
            statusMessage = "로그인이 필요해요."
            return
        }
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            let body = RemoteAlarmWriteRequest(
                time: record.timeString,
                repeatDays: record.repeatWeekdays,
                snoozeMinutes: record.snoozeMinutes,
                mode: record.hasVoiceAudio ? "tts" : "sound-only",
                vibrationPattern: "default",
                wakeMode: record.playMode.remoteWakeMode,
                isActive: record.enabled,
                messageId: record.messageID,
                voiceProfileId: record.voiceProfileID,
                rawAudioUrl: record.rawAudioURL,
                rawAudioDurationMs: nil
            )
            let remote: RemoteAlarm
            if let remoteID = record.remoteID {
                remote = try await api.updateAlarm(id: remoteID, requestBody: body, token: token)
            } else {
                remote = try await api.createAlarm(body, token: token)
            }
            store.markRemote(localID: record.id, remoteID: remote.id)
            await refresh(session: session)
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func deleteRemote(record: LocalAlarmRecord, session: AuthSession?) async {
        guard let token = session?.token, let remoteID = record.remoteID else { return }
        do {
            try await api.deleteAlarm(id: remoteID, token: token)
            await refresh(session: session)
        } catch {
            statusMessage = error.localizedDescription
        }
    }
}
