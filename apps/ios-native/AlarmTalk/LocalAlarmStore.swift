import Foundation

// MARK: - Store
@MainActor
final class LocalAlarmStore: ObservableObject {
    @Published private(set) var alarms: [LocalAlarmRecord] = []
    @Published private(set) var hasLoadedFromDisk = false

    private let persistence: LocalAlarmPersistence

    /// 저장 위치를 지정하지 않았을 때 쓰는 기본 파일.
    ///
    /// ⚠ 기본 생성자를 쓰는 테스트가 사용자의 알람 파일을 그대로 잡지 않게 가른다
    /// (`AlarmAppContextTests` 가 실제로 그랬다) — 근거는 `TestIsolation`.
    nonisolated static func defaultStorageURL() -> URL {
        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return directory.appendingPathComponent(
            "voice-alarm-ios-alarms\(TestIsolation.storageSuffix).json"
        )
    }

    init(storageURL: URL? = nil, loadFromDisk: Bool = true) {
        let resolvedStorageURL: URL
        if let storageURL {
            resolvedStorageURL = storageURL
        } else {
            resolvedStorageURL = Self.defaultStorageURL()
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

    /// 디스크 로드가 끝날 때까지 기다린다(최대 `timeout` 초).
    ///
    /// ⚠ **백그라운드로 깨어난 실행에는 "로드되면 다시 하기" 를 걸어 줄 화면이 없다.**
    /// 로드는 `init` 안의 `Task` 라 비동기인데, 그 사이에 판단하면 `alarms` 가 비어 있어
    /// 강등 대상이 **0건으로 보이고 그 회차가 조용히 지나간다** — 철회된 목소리가 다음
    /// 깨어남까지 예약된 채 남는다(2026-08-18 Codex #697 P1).
    /// 화면이 있는 경로는 `.task(id: alarmStore.hasLoadedFromDisk)` 로 다시 도는 반면,
    /// 주기 사이클에는 그런 재시도가 없다.
    ///
    /// 상한을 두는 이유: BGTask 예산이 ~25초라 여기서 무한정 기다리면 사이클 전체를
    /// 날린다. 못 기다렸으면 그 회차만 건너뛰고 다음 깨어남이 다시 한다.
    func waitUntilLoadedFromDisk(timeout: TimeInterval = 3) async {
        guard !hasLoadedFromDisk else { return }
        let deadline = Date().addingTimeInterval(timeout)
        while !hasLoadedFromDisk, Date() < deadline {
            // ⚠ **취소를 삼키지 말 것**(2026-08-18 Codex #697 P2). `try?` 로 무시하면
            // BGTask 가 만료돼 취소된 뒤에도 `Task.sleep` 이 즉시 던지며 돌아와,
            // 마감까지 **MainActor 에서 계속 돈다** — 예산이 이미 회수된 바로 그 순간에
            // launch·델리게이트 작업을 막는다. 던지면 그대로 물러선다.
            //
            // ⚠ 이 갈래에는 **회귀 테스트가 없다.** 붙여 봤지만 `persistence` 를 주입할 수
            // 없어 "끝나지 않는 로드" 를 만들 수 없었고, 그렇게 쓴 테스트는 `try?` 로
            // 되돌려도 그대로 통과했다(빈 파일이라 로드가 즉시 끝난다). 아무것도 지키지
            // 못하는 초록은 없느니만 못해 지웠다 — 고칠 사람은 이 주석을 근거로 삼는다.
            do {
                try await Task.sleep(nanoseconds: 20_000_000)
            } catch {
                return
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

    /// **이 계정에게 보여도 되는 알람.** 안드로이드 `AlarmDao` 의
    /// `(ownerUserId IS NULL OR ownerUserId = :callerUserId)` 와 같은 조건이다.
    ///
    /// ⚠ 없으면 로그아웃 뒤 다른 계정으로 들어왔을 때 **앞 계정 알람이 목록에 그대로
    /// 보인다**(2026-08-19 지적). 예약은 `stopAllScheduledAlarms` 가 끊어 두지만 화면은
    /// 그것과 별개다 — 남의 알람을 보고 끄거나 지울 수 있으면 안 된다.
    ///
    /// 로그아웃 상태(`nil`)에서는 **아무것도 보이지 않는다.** 그 화면은 로그인 게이트라
    /// 목록 자체가 뜨지 않지만, 판정을 여기서 한 번에 끝내 둔다.
    /// 소유자 미기록(옛 행)은 이 계정 것으로 본다 — 저장소의 다른 경로와 같은 관용.
    func alarms(visibleTo ownerUserId: String?) -> [LocalAlarmRecord] {
        guard let owner = ownerUserId?.nilIfBlank else { return [] }
        return alarms.filter { $0.ownerUserId == nil || $0.ownerUserId == owner }
    }

    /// **소유자 미기록(옛 행)에 지금 떠나는 계정을 새긴다.** 안드로이드
    /// `data/AlarmRepository.claimUnownedAlarmsFor` 의 짝이다.
    ///
    /// ⚠ 없으면 이렇게 된다(Codex #699 P1): 실제로 쓰이던 알람들은 소유자 없이 저장돼
    /// 있었는데(`ownerUserId == nil`), A 의 세션이 자동 401 로 끊겨도 그 행들은 계속
    /// `nil` 이다. 그 뒤 B 가 로그인했다 **명시적으로 로그아웃**하면, `nil` 을 '떠나는 계정
    /// 것' 으로 보는 규칙이 **A 의 알람을 B 것으로 오인해 영구히 끈다** — A 가 돌아와도
    /// 꺼진 채다.
    ///
    /// `nil` 을 현재 계정으로 보는 관용은 **읽기**에서는 맞다(옛 행을 보여 줘야 하니까).
    /// 파괴적 경로에서 같은 관용을 쓰려면, 그전에 **누구 것인지 확정**해 둬야 한다.
    /// 세션이 끝나는 순간이 그 마지막 기회다 — 그 뒤로는 누가 주인이었는지 알 길이 없다.
    ///
    /// - Returns: 새긴 행 수.
    @discardableResult
    func claimUnownedAlarms(for ownerUserId: String?) -> Int {
        guard let owner = ownerUserId?.nilIfBlank else { return 0 }
        var claimed = 0
        for index in alarms.indices where alarms[index].ownerUserId?.nilIfBlank == nil {
            alarms[index].ownerUserId = owner
            claimed += 1
        }
        if claimed > 0 { persist() }
        return claimed
    }

    func countByAudioCacheKey(_ key: String) -> Int {
        alarms.reduce(0) { acc, record in
            (record.audioCacheKey == key) ? acc + 1 : acc
        }
    }

    /// `AlarmRepository.requireUniqueTime` 와 동일 의미. mask 동일 + 동일 시각이면 중복.
    /// 단순화: hour+minute 만 일치해도 중복으로 본다 (Android 원본 의도와 동일).
    ///
    /// ⚠ **소유자를 반드시 넘긴다 — 목록만 거르면 뚫린다**(Codex #699 P1).
    /// 목록에서 남의 알람을 감춰도 이 판정이 저장소 전체를 보면, B 가 A 의 **숨은** 알람과
    /// 같은 시각을 고르는 순간 "중복" 으로 막힌다. 보이지도 않는 알람 때문에 막히니
    /// 사용자는 이유를 알 길이 없다.
    func requireUniqueTime(
        hour: Int,
        minute: Int,
        repeatDaysMask: Int,
        excludingID: String? = nil,
        ownerUserId: String?
    ) throws {
        let collision = alarms(visibleTo: ownerUserId).contains { record in
            record.id != excludingID &&
                record.hour == hour &&
                record.minute == minute
        }
        if collision { throw LocalAlarmValidationError.duplicateTime }
    }

    /// 같은 시각(hour+minute)의 기존 알람들. "한 시각에는 알람 하나" 교체 흐름에서
    /// 충돌 대상을 찾아 라벨 표시·삭제에 쓴다.
    /// ⚠ **소유자를 반드시 넘긴다**(Codex #699 P1). 이 결과는 화면에 **남의 알람 이름을
    /// 그대로 띄우고**(교체 모달의 `existingLabel`), 사용자가 '교체' 를 누르면
    /// `cancel(record:store:)` 로 **그 알람을 지운다.** 소유자를 안 거르면 B 가 A 의 숨은
    /// 알람 이름을 보고, 그것을 **영구히 삭제**할 수 있다 — 목록에서 감춘 의미가 사라진다.
    func conflictingAlarms(
        hour: Int,
        minute: Int,
        excludingID: String? = nil,
        ownerUserId: String?
    ) -> [LocalAlarmRecord] {
        alarms(visibleTo: ownerUserId).filter { record in
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
    ///
    /// `syncedNow: true` 는 **pull 이 서버본을 그대로 쓴 경우**다. `lastSyncedAtMillis` 를
    /// 같은 값으로 맞춰 `updatedAtMillis == lastSyncedAtMillis` 불변식을 세운다 —
    /// `RemoteAlarmPullSync.locallyEditedByRecipient` 가 이 등식으로 '수신자가 손댔는가' 를
    /// 판정하므로, 두 값이 몇 ms 라도 어긋나면 갓 받은 알람이 편집된 것으로 읽힌다.
    /// (Android `buildReceivedAlarmRow` 는 둘 다 같은 `now` 를 넣어 같은 불변식을 만든다.)
    @discardableResult
    func upsert(_ record: LocalAlarmRecord, syncedNow: Bool = false) -> LocalAlarmRecord {
        var copy = record
        copy.updatedAtMillis = Int64(Date().timeIntervalSince1970 * 1000)
        if syncedNow {
            copy.lastSyncedAtMillis = copy.updatedAtMillis
        }
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
        ownerUserId: String?,
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
            repeatDaysMask: current.repeatDaysMask,
            ownerUserId: ownerUserId
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

    /// OS 예약 핸들을 기록한다.
    ///
    /// ⚠ **`updatedAtMillis` 를 올리지 않는다.** 이건 사용자가 고친 게 아니라 우리가 OS 에
    /// 건 예약을 적어 두는 것이다. 올리면 `RemoteAlarmPullSync.locallyEditedByRecipient`
    /// 가 **갓 받은 알람을 곧바로 '수신자가 고친 행' 으로** 읽는다 — pull 이
    /// `upsert(_:syncedNow:)` 로 세워 둔 `updatedAt == lastSynced` 등식을 바로 뒤따르는
    /// 예약이 깨기 때문이다. 그러면 서버 내용(음성·문구)이 영영 안 들어오고, 특히 첫
    /// 수신 때 음성 다운로드가 실패한 행의 **재시도 경로가 죽는다.**
    /// 같은 이유로 `applyWeatherVariant` 도 올리지 않는다.
    /// - Parameter soundFingerprint: 이 예약에 실어 보낸 소리의 지문
    ///   (`AlarmSoundPlan.fingerprint`). 나중에 행이 바뀌었는지 비교하는 기준이 된다.
    ///   **예약과 지문은 여기서 한 번에 기록된다** — 따로 쓰면 어긋난다.
    func markScheduled(localID: String, alarmKitID: String, soundFingerprint: String? = nil) {
        guard let index = alarms.firstIndex(where: { $0.id == localID }) else { return }
        alarms[index].alarmKitID = alarmKitID
        alarms[index].scheduledSoundFingerprint = soundFingerprint
        alarms[index].enabled = true
        alarms[index].state = AlarmRuntimeState.armed.rawValue
        persist()
    }

    /// OS 예약 핸들만 지운다. **`enabled` 과 상태는 건드리지 않는다.**
    ///
    /// 로그아웃·탈퇴에서 예약을 끊은 뒤 부른다 — 핸들이 남아 있으면
    /// `recoverScheduledAlarms` 의 `alarmKitUUID == nil` 조건에 걸리지 않아
    /// **재로그인해도 다시 걸리지 않는다.**
    func clearScheduleHandle(id: String) {
        guard let index = alarms.firstIndex(where: { $0.id == id }) else { return }
        alarms[index].alarmKitID = nil
        alarms[index].scheduledSoundFingerprint = nil
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
    /// 울린 뒤 다음에 쓸 클립 자리. 테마가 아니거나 클립이 하나뿐이면 그대로 둔다.
    ///
    /// ⚠ **날씨·운세는 전진시키지 않는다.** 그 둘은 순서가 아니라 **조건**으로 클립을
    /// 고른다(비 오는 날엔 비 문구, 오늘 운세엔 오늘 것). 돌려 버리면 조건과 무관한
    /// 문구가 나온다 — 안드로이드 `MATCHING_BUCKET_IDS` 와 같은 이유다.
    static func advancedBucketRotationIndex(_ record: LocalAlarmRecord) -> Int? {
        guard let bucketId = record.bucketId,
              let keys = record.bucketClipKeys, keys.count > 1,
              !FreeBucket.matchingBucketIDs.contains(bucketId) else {
            return record.bucketRotationIndex
        }
        return ((record.bucketRotationIndex ?? 0) + 1) % keys.count
    }

    /// 날씨 조건 스냅샷을 갱신한다(`WeatherVariantRefreshService` 전용).
    ///
    /// ⚠ **`updatedAtMillis` 를 올리지 않는다.** 사용자가 고친 게 아니라 우리가 예보를
    /// 받아 적은 것이다. 여기서 올리면 받은 알람이 '수신자가 고친 행' 으로 읽혀
    /// (`RemoteAlarmPullSync.locallyEditedByRecipient`) 서버 내용이 영영 안 들어온다.
    func applyWeatherVariant(id: String, index: Int, resolvedAtMillis: Int64) {
        guard let position = alarms.firstIndex(where: { $0.id == id }) else { return }
        alarms[position].contextVariantIndex = index
        alarms[position].contextResolvedAtMillis = resolvedAtMillis
        persist()
    }

    func markStopped(
        alarmKitID: String,
        isHoliday: (Date) -> Bool = { LocalHolidayCalendar.isHoliday($0) }
    ) {
        guard let index = alarms.firstIndex(where: { $0.alarmKitID == alarmKitID }) else { return }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        // ⚠ **여기서 회전을 전진시킨다.** 알람이 어떻게 끝나든(정지 버튼·시스템 alert
        // 사라짐) 이 함수로 모이므로, 다음 회차가 다음 문구로 울린다.
        // 안드로이드 `advancedBucketRotationIndex` 와 같은 규칙이다.
        alarms[index].bucketRotationIndex = Self.advancedBucketRotationIndex(alarms[index])
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
        // ⚠ **꺼진 알람에는 실패를 새기지 않는다**(2026-08-19 실기기 확인).
        // `.failed` 는 행에 빨간 "알람을 다시 예약하지 못했어요" 를 띄우는데, 꺼진 알람은
        // 애초에 울릴 일이 없어 그 말이 거짓이다. 더 나쁜 건 **아무도 치워 주지 않는다**
        // 는 것 — `recoverScheduledAlarms` 는 켜진 알람만 후보로 잡으므로, 한번 이 상태가
        // 되면 사용자가 직접 열어 다시 저장할 때까지 경고가 영원히 붙는다.
        //
        // 실제 경로: 켜기 실패 시 `AlarmsListView` 가 **되돌려 끈 뒤** 이 함수를 부른다
        // (`setEnabled(false)` → `markFailed`). 호출부 한 곳만 고치면 같은 실수가 또
        // 나므로 여기서 불변식으로 막는다 — **`.failed` 는 켜진 알람에만 의미가 있다.**
        // 사용자에게는 그 자리에서 `actionMessage` 로 이미 알린다.
        guard alarms[index].enabled else { return }
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

    /// - Parameter keepScheduleHandle: 끄면서도 `alarmKitID` 를 남길지.
    ///   ⚠ **취소가 실패했을 때만 `true`** 다(Codex #699 P1). 그 값은 OS 예약을 취소할
    ///   **유일한 손잡이**라, 취소에 실패했는데 지우면 예약은 남고 취소할 방법만 사라진다
    ///   (고아 예약). 평소에는 `false` — 남겨 두면 다음에 켤 때 옛 핸들과 어긋난다.
    func setEnabled(
        id: String,
        enabled: Bool,
        keepScheduleHandle: Bool = false,
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
            if !keepScheduleHandle {
                alarms[index].alarmKitID = nil
            }
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
