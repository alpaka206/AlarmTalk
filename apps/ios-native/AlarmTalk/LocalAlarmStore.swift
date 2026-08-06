import Foundation

// MARK: - Store
@MainActor
final class LocalAlarmStore: ObservableObject {
    @Published private(set) var alarms: [LocalAlarmRecord] = []
    @Published private(set) var hasLoadedFromDisk = false

    private let persistence: LocalAlarmPersistence

    init(storageURL: URL? = nil, loadFromDisk: Bool = true) {
        let resolvedStorageURL: URL
        if let storageURL {
            resolvedStorageURL = storageURL
        } else {
            let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            resolvedStorageURL = directory.appendingPathComponent("voice-alarm-ios-alarms.json")
        }
        self.persistence = LocalAlarmPersistence(storageURL: resolvedStorageURL)
        guard loadFromDisk else {
            self.hasLoadedFromDisk = true
            return
        }
        Task { [persistence] in
            let loaded = await persistence.load()
            await MainActor.run {
                self.alarms = loaded
                self.hasLoadedFromDisk = true
            }
        }
    }

    // MARK: Queries

    func record(id: String) -> LocalAlarmRecord? {
        alarms.first { $0.id == id }
    }

    func record(alarmKitID: String) -> LocalAlarmRecord? {
        alarms.first { $0.alarmKitID == alarmKitID }
    }

    func recordsBy(syncState: AlarmSyncState) -> [LocalAlarmRecord] {
        alarms.filter { $0.syncStateEnum == syncState }
    }

    func recordsBy(origin: AlarmOrigin) -> [LocalAlarmRecord] {
        alarms.filter { $0.originEnum == origin }
    }

    /// 무료 전환 시 정리 대상이 되는 유료 목소리 알람.
    ///
    /// ⚠ **본인 소유(`localOwned`)만 대상이다.** 공유받은 알람의 유료 목소리는 **보낸 사람의
    /// 구독으로 성립**하는 것이라, 받는 쪽이 무료가 됐다고 뺏으면 안 된다
    /// (`PaidVoiceGate.shouldDowngrade` 와 같은 원칙 — 거기만 지키고 여기서 빠뜨리면
    /// 강등이 아니라 **삭제**라 더 나쁘다. 게다가 이 삭제는 decline 을 보내지 않아
    /// 다음 pull 이 새 UUID 로 되살린다).
    func paidAlarmTalks() -> [LocalAlarmRecord] {
        alarms.filter { $0.originEnum == .localOwned && $0.isPaidVoiceForDowngrade }
    }

    func countByAudioCacheKey(_ key: String) -> Int {
        alarms.reduce(0) { acc, record in
            (record.audioCacheKey == key) ? acc + 1 : acc
        }
    }

    /// `AlarmRepository.requireUniqueTime` 와 동일 의미. mask 동일 + 동일 시각이면 중복.
    /// 단순화: hour+minute 만 일치해도 중복으로 본다 (Android 원본 의도와 동일).
    func requireUniqueTime(
        hour: Int,
        minute: Int,
        repeatDaysMask: Int,
        excludingID: String? = nil
    ) throws {
        let collision = alarms.contains { record in
            record.id != excludingID &&
                record.hour == hour &&
                record.minute == minute
        }
        if collision { throw LocalAlarmValidationError.duplicateTime }
    }

    /// 같은 시각(hour+minute)의 기존 알람들. "한 시각에는 알람 하나" 교체 흐름에서
    /// 충돌 대상을 찾아 라벨 표시·삭제에 쓴다.
    func conflictingAlarms(hour: Int, minute: Int, excludingID: String? = nil) -> [LocalAlarmRecord] {
        alarms.filter { record in
            record.id != excludingID && record.hour == hour && record.minute == minute
        }
    }

    // MARK: Validation

    /// Android `AlarmRepository.validateDraft` 동일.
    static func validateDraft(_ record: LocalAlarmRecord) throws {
        guard (0...23).contains(record.hour) else { throw LocalAlarmValidationError.invalidHour }
        guard (0...59).contains(record.minute) else { throw LocalAlarmValidationError.invalidMinute }
        guard (0...0x7f).contains(record.repeatDaysMask) else {
            throw LocalAlarmValidationError.invalidRepeatDaysMask
        }
        guard (1...30).contains(record.snoozeMinutes) else {
            throw LocalAlarmValidationError.invalidSnoozeMinutes
        }
        guard SnoozeRepeatLimit.isValid(record.snoozeRepeatLimit) else {
            throw LocalAlarmValidationError.invalidSnoozeRepeatLimit
        }
        guard (0...100).contains(record.alarmVolumePercent) else {
            throw LocalAlarmValidationError.invalidAlarmVolume
        }
        guard (0...100).contains(record.voiceVolumePercent) else {
            throw LocalAlarmValidationError.invalidVoiceVolume
        }
        guard VibrationPattern(rawValue: record.vibrationPattern) != nil else {
            throw LocalAlarmValidationError.unknownVibrationPattern
        }
        guard AlarmPlayMode(rawValue: record.playMode) != nil else {
            throw LocalAlarmValidationError.unknownPlayMode
        }
        guard VoiceSource(rawValue: record.voiceSource) != nil else {
            throw LocalAlarmValidationError.unknownVoiceSource
        }
        if record.playModeEnum != .alarmOnly {
            if record.localAudioUri?.isEmpty ?? true {
                throw LocalAlarmValidationError.voiceAudioRequired
            }
        }
    }

    // MARK: Mutations

    /// **사용자 편집 커밋 전용** 저장. 커밋 직전에 최신 행의 sync 전용 필드를 병합한다.
    ///
    /// 왜 필요한가: 편집기는 `existing` 을 화면 진입 시점에 잡아 두고, TTS 생성(수 초~수십 초)
    /// 을 거쳐 `store.upsert(merged)` 로 **전체 행을 덮는다.** 그 사이에 push 회차가 이 알람을
    /// create 해 `markRemote` 로 `remoteAlarmId` 를 새겨 놓았다면, 편집 커밋이 그 값을
    /// **stale 스냅샷의 nil 로 되돌린다.** 그러면 다음 push 가 같은 알람을 또 create 한다 —
    /// 서버에 두 행이 생기는 **두 번째 경로**다(첫 번째는 겹친 sync, `eb70f2f2` 에서 막았다).
    ///
    /// 병합 대상은 `remoteAlarmId` / `lastSyncedAtMillis` / `syncState` **뿐이다.**
    /// ⚠ `alarmKitID`·`fireAtMillis`·`enabled` 는 절대 병합하지 말 것 — `alarmKitID` 를
    /// 되살리면 방금 재예약한 핸들과 어긋나 취소·재예약이 깨진다(알람이 안 울리는 방향).
    ///
    /// `@MainActor` 라 재조회와 쓰기 사이에 `await` 가 없어 원자적이다.
    @discardableResult
    func upsertPreservingServerSyncFields(_ updated: LocalAlarmRecord) -> LocalAlarmRecord {
        var next = updated
        if let fresh = alarms.first(where: { $0.id == updated.id }) {
            next.remoteAlarmId = fresh.remoteAlarmId
            next.lastSyncedAtMillis = fresh.lastSyncedAtMillis
            next.syncState = nextLocalSyncState(for: next).rawValue
        }
        return upsert(next)
    }

    /// 동일 ID 가 있으면 갱신, 없으면 추가. updatedAtMillis 자동 갱신.
    @discardableResult
    func upsert(_ record: LocalAlarmRecord) -> LocalAlarmRecord {
        var copy = record
        copy.updatedAtMillis = Int64(Date().timeIntervalSince1970 * 1000)
        if let index = alarms.firstIndex(where: { $0.id == copy.id }) {
            alarms[index] = copy
        } else {
            alarms.append(copy)
        }
        persist()
        return copy
    }

    @discardableResult
    func copyAlarm(
        id: String,
        nowMillis: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
        isHoliday: (Date) -> Bool = { LocalHolidayCalendar.isHoliday($0) },
        idFactory: () -> String = { UUID().uuidString }
    ) throws -> LocalAlarmRecord {
        guard let current = record(id: id) else {
            throw LocalAlarmValidationError.alarmNotFound
        }
        let copiedTime = Self.copyTargetTime(hour: current.hour, minute: current.minute)
        try requireUniqueTime(
            hour: copiedTime.hour,
            minute: copiedTime.minute,
            repeatDaysMask: current.repeatDaysMask
        )

        var copied = current
        copied.id = idFactory()
        copied.label = Self.copyLabel(current.label)
        copied.hour = copiedTime.hour
        copied.minute = copiedTime.minute
        copied.fireAtMillis = try AlarmTimeCalculator.nextFireAtMillis(
            hour: copiedTime.hour,
            minute: copiedTime.minute,
            repeatDaysMask: current.repeatDaysMask,
            holidayOff: current.holidayOff,
            nowMillis: nowMillis,
            isHoliday: isHoliday
        )
        copied.remoteAlarmId = nil
        copied.lastSyncedAtMillis = nil
        copied.syncState = AlarmSyncState.localOnly.rawValue
        copied.origin = AlarmOrigin.localOwned.rawValue
        copied.enabled = true
        copied.state = AlarmRuntimeState.armed.rawValue
        copied.createdAtMillis = nowMillis
        copied.updatedAtMillis = nowMillis
        copied.alarmKitID = nil
        alarms.append(copied)
        persist()
        return copied
    }

    @discardableResult
    func delete(_ alarm: LocalAlarmRecord) -> String? {
        guard let index = alarms.firstIndex(where: { $0.id == alarm.id }) else {
            return nil
        }
        let releasedAudioCacheKey = Self.nonEmptyAudioCacheKey(alarms[index].audioCacheKey)
        alarms.remove(at: index)
        persist()
        guard let releasedAudioCacheKey,
              countByAudioCacheKey(releasedAudioCacheKey) == 0 else {
            return nil
        }
        return releasedAudioCacheKey
    }

    @discardableResult
    func deleteByID(_ id: String) -> String? {
        guard let record = alarms.first(where: { $0.id == id }) else {
            return nil
        }
        return delete(record)
    }

    private static func nonEmptyAudioCacheKey(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func copyTargetTime(hour: Int, minute: Int) -> (hour: Int, minute: Int) {
        let totalMinutes = (hour * 60 + minute + 10) % (24 * 60)
        return (totalMinutes / 60, totalMinutes % 60)
    }

    private static func copyLabel(_ label: String) -> String {
        let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "복사한 알람" : "\(trimmed) 복사본"
    }

    // MARK: State transitions
    // Android `AlarmRepository` 의 markRinging / dismiss / snooze / setEnabled 흐름 이식.

    func markScheduled(localID: String, alarmKitID: String) {
        guard let index = alarms.firstIndex(where: { $0.id == localID }) else { return }
        alarms[index].alarmKitID = alarmKitID
        alarms[index].enabled = true
        alarms[index].state = AlarmRuntimeState.armed.rawValue
        alarms[index].updatedAtMillis = Int64(Date().timeIntervalSince1970 * 1000)
        persist()
    }

    func markRinging(id: String) {
        guard let index = alarms.firstIndex(where: { $0.id == id }) else { return }
        alarms[index].state = AlarmRuntimeState.ringing.rawValue
        alarms[index].enabled = true
        alarms[index].updatedAtMillis = Int64(Date().timeIntervalSince1970 * 1000)
        persist()
    }

    /// AlarmKit alarmUpdates 에서 알람이 사라졌을 때 호출.
    /// - Parameter isHoliday: 다음 발화 시각 재계산에 쓰는 공휴일 술어. 기본은
    ///   `LocalHolidayCalendar` 고정 규칙. 호출자(handleAlarmStopped/disappearance)는
    ///   서버 sync 공휴일까지 반영하도록 `HolidayStore.holidayPredicate()` 를 넘긴다
    ///   (Android dismiss 가 full holiday predicate 로 recompute 하는 것과 동일).
    func markStopped(
        alarmKitID: String,
        isHoliday: (Date) -> Bool = { LocalHolidayCalendar.isHoliday($0) }
    ) {
        guard let index = alarms.firstIndex(where: { $0.alarmKitID == alarmKitID }) else { return }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        if alarms[index].repeatDaysMask != 0,
           let nextFireAt = try? AlarmTimeCalculator.nextFireAtMillis(
            hour: alarms[index].hour,
            minute: alarms[index].minute,
            repeatDaysMask: alarms[index].repeatDaysMask,
            holidayOff: alarms[index].holidayOff,
            nowMillis: now,
            isHoliday: isHoliday
           ) {
            alarms[index].fireAtMillis = nextFireAt
            alarms[index].state = AlarmRuntimeState.armed.rawValue
            alarms[index].enabled = true
            alarms[index].snoozeCount = 0
            // PR3: `.fixed` 서브셋만 alarmKitID 를 비워 "OS 재무장 필요" 신호를 남긴다.
            // rearmIfHolidayOffOneShot 가 이 nil 을 guard 로 보고 schedule() 한다.
            // 네이티브 `.relative` 반복 알람은 AlarmKit 이 여전히 소유하므로 비우지 않는다.
            if alarms[index].isHolidayOffRecurring {
                alarms[index].alarmKitID = nil
            }
        } else {
            alarms[index].state = AlarmRuntimeState.dismissed.rawValue
            alarms[index].enabled = false
        }
        alarms[index].updatedAtMillis = now
        persist()
    }

    /// Snooze 갱신. fireAtMillis 는 호출자가 미리 계산해서 전달 (now + snoozeMinutes*60s).
    func markSnoozed(id: String, newFireAtMillis: Int64, incrementCount: Bool = true) {
        guard let index = alarms.firstIndex(where: { $0.id == id }) else { return }
        alarms[index].fireAtMillis = newFireAtMillis
        alarms[index].state = AlarmRuntimeState.snoozed.rawValue
        alarms[index].enabled = true
        if incrementCount {
            alarms[index].snoozeCount += 1
        }
        alarms[index].updatedAtMillis = Int64(Date().timeIntervalSince1970 * 1000)
        persist()
    }

    func markFailed(id: String) {
        guard let index = alarms.firstIndex(where: { $0.id == id }) else { return }
        alarms[index].state = AlarmRuntimeState.failed.rawValue
        alarms[index].updatedAtMillis = Int64(Date().timeIntervalSince1970 * 1000)
        persist()
    }

    /// Mirrors Android boot restore preparation before AlarmKit rescheduling.
    /// Returns nil when an expired one-shot alarm can no longer be restored.
    func prepareForScheduleRecovery(
        id: String,
        nowMillis: Int64,
        isHoliday: (Date) -> Bool = { LocalHolidayCalendar.isHoliday($0) }
    ) -> LocalAlarmRecord? {
        guard let index = alarms.firstIndex(where: { $0.id == id }) else { return nil }

        if alarms[index].fireAtMillis <= nowMillis {
            if alarms[index].repeatDaysMask != 0,
               let nextFireAt = try? AlarmTimeCalculator.nextFireAtMillis(
                hour: alarms[index].hour,
                minute: alarms[index].minute,
                repeatDaysMask: alarms[index].repeatDaysMask,
                holidayOff: alarms[index].holidayOff,
                nowMillis: nowMillis,
                isHoliday: isHoliday
               ) {
                alarms[index].fireAtMillis = nextFireAt
                alarms[index].state = AlarmRuntimeState.armed.rawValue
                alarms[index].enabled = true
                alarms[index].snoozeCount = 0
            } else {
                alarms[index].enabled = false
                alarms[index].state = AlarmRuntimeState.failed.rawValue
                alarms[index].alarmKitID = nil
                alarms[index].updatedAtMillis = nowMillis
                persist()
                return nil
            }
        } else if alarms[index].runtimeStateEnum == .failed {
            alarms[index].state = AlarmRuntimeState.armed.rawValue
            alarms[index].enabled = true
        }

        alarms[index].updatedAtMillis = nowMillis
        persist()
        return alarms[index]
    }

    func setEnabled(
        id: String,
        enabled: Bool,
        nowMillis: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
        isHoliday: (Date) -> Bool = { LocalHolidayCalendar.isHoliday($0) }
    ) {
        guard let index = alarms.firstIndex(where: { $0.id == id }) else { return }
        if enabled {
            let nextFireAt = (try? AlarmTimeCalculator.nextFireAtMillis(
                hour: alarms[index].hour,
                minute: alarms[index].minute,
                repeatDaysMask: alarms[index].repeatDaysMask,
                holidayOff: alarms[index].holidayOff,
                nowMillis: nowMillis,
                isHoliday: isHoliday
            )) ?? LocalAlarmRecord.fallbackFireAtMillis(
                hour: alarms[index].hour,
                minute: alarms[index].minute,
                referenceMillis: nowMillis
            )
            alarms[index].fireAtMillis = nextFireAt
            alarms[index].enabled = true
            alarms[index].snoozeCount = 0
            alarms[index].state = AlarmRuntimeState.armed.rawValue
            alarms[index].alarmKitID = nil
        } else {
            alarms[index].enabled = false
            alarms[index].state = AlarmRuntimeState.disabled.rawValue
            alarms[index].alarmKitID = nil
        }
        alarms[index].syncState = nextLocalSyncState(for: alarms[index]).rawValue
        alarms[index].updatedAtMillis = nowMillis
        persist()
    }

    // MARK: Sync transitions (Phase 2-B3 가 사용)

    /// 서버에 push/pull 이 성공하여 remote id 와 sync 시각을 기록.
    func markRemote(localID: String,
                    remoteID: String,
                    lastSyncedAtMillis: Int64,
                    syncState: AlarmSyncState = .synced) {
        guard let index = alarms.firstIndex(where: { $0.id == localID }) else { return }
        alarms[index].remoteAlarmId = remoteID
        alarms[index].lastSyncedAtMillis = lastSyncedAtMillis
        alarms[index].syncState = syncState.rawValue
        alarms[index].updatedAtMillis = Int64(Date().timeIntervalSince1970 * 1000)
        persist()
    }

    /// 오프라인 수정 시 dirty 표시.
    func markDirty(id: String) {
        guard let index = alarms.firstIndex(where: { $0.id == id }) else { return }
        alarms[index].syncState = nextLocalSyncState(for: alarms[index]).rawValue
        alarms[index].updatedAtMillis = Int64(Date().timeIntervalSince1970 * 1000)
        persist()
    }

    /// 동기화 실패 시 호출.
    func markSyncFailed(id: String) {
        guard let index = alarms.firstIndex(where: { $0.id == id }) else { return }
        alarms[index].syncState = AlarmSyncState.syncFailed.rawValue
        alarms[index].updatedAtMillis = Int64(Date().timeIntervalSince1970 * 1000)
        persist()
    }

    func updateDynamicVoiceAudio(
        id: String,
        localAudioUri: String,
        audioCacheKey: String?,
        rawAudioUri: String?,
        voiceText: String,
        ttsMessageId: String?,
        preparedForFireAtMillis: Int64,
        nowMillis: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    ) {
        guard let index = alarms.firstIndex(where: { $0.id == id }) else { return }
        alarms[index].localAudioUri = localAudioUri
        alarms[index].audioCacheKey = audioCacheKey
        alarms[index].rawAudioUri = rawAudioUri
        alarms[index].voiceText = voiceText
        alarms[index].ttsMessageId = ttsMessageId
        alarms[index].dynamicVoicePreparedForFireAtMillis = preparedForFireAtMillis
        alarms[index].updatedAtMillis = nowMillis
        persist()
    }

    /// Android `AlarmRepository.nextLocalSyncState` 동일.
    /// - received_remote 는 항상 synced 로 회귀
    /// - remoteAlarmId 없으면 local_only
    /// - 그 외엔 dirty
    func nextLocalSyncState(for record: LocalAlarmRecord) -> AlarmSyncState {
        if record.originEnum == .receivedRemote { return .synced }
        if record.remoteAlarmId == nil { return .localOnly }
        return .dirty
    }

    // MARK: Persistence

    private func persist() {
        let snapshot = alarms
        Task { [persistence] in
            await persistence.save(snapshot)
        }
    }
}
