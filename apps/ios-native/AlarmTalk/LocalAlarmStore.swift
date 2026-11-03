import Foundation

// MARK: - Store
@MainActor
final class LocalAlarmStore: ObservableObject {
    @Published private(set) var alarms: [LocalAlarmRecord] = []
    @Published private(set) var hasLoadedFromDisk = false

    private let persistence: LocalAlarmPersistence
    /// 비동기·동기 저장이 **함께** 쓰는 파일 기록기. 순번으로 순서를 지킨다.
    private let writer: LocalAlarmFileWriter
    /// 스냅샷을 뜰 때마다 올라가는 순번. 늦게 도착한 옛 스냅샷을 가려내는 기준이다.
    private var saveSeq: UInt64 = 0
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

    init(
        storageURL: URL? = nil, loadFromDisk: Bool = true,
        loadRecords: (@Sendable () async -> [LocalAlarmRecord])? = nil
    ) {
        let resolvedStorageURL = storageURL ?? Self.defaultStorageURL()
        let writer = LocalAlarmFileWriter(url: resolvedStorageURL)
        self.writer = writer
        self.persistence = LocalAlarmPersistence(storageURL: resolvedStorageURL, writer: writer)
        guard loadFromDisk else {
            self.hasLoadedFromDisk = true
            return
        }
        Task { [persistence] in
            let loaded: [LocalAlarmRecord]
            if let loadRecords { loaded = await loadRecords() }
            else { loaded = await persistence.load() }
            await MainActor.run {
                self.adoptLoadedAlarms(loaded)
                self.hasLoadedFromDisk = true
            }
        }
    }

    /// 디스크에서 읽은 목록을 들인다 — 옛 받은 알람은 **로드가 끝났다고 알리기 전에** 내 알람으로 바꾼다
    /// (`ReceivedAlarmConversion`). 그래서 어느 경로도 받은 알람을 보지 않는다.
    ///
    /// ⚠ 행 하나를 못 읽었다고 던지게 만들지 말 것 — `LocalAlarmPersistence.load` 는 디코드가 던지면 알람
    /// **전부**를 버린다. 변환은 디코드가 끝난 뒤 여기서 한다.
    private func adoptLoadedAlarms(_ loaded: [LocalAlarmRecord]) {
        let outcome = ReceivedAlarmConversion.convert(loaded, nowMillis: Int64(Date().timeIntervalSince1970 * 1000))
        alarms = outcome.alarms
        guard !outcome.converted.isEmpty else { return }
        // 곧바로 디스크에 앉힌다 — 다음 실행이 받은 알람을 다시 읽지 않게. 못 앉혔으면 비동기로 한 번 더 건다
        // (다음 실행이 다시 바꿔도 결과는 같다). 예약은 리컨사일러가 다시 건다(`staleScheduleFingerprint`).
        if !saveNow() { persist() }
        ReceivedAlarmConversion.finish(outcome)
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
            // 로드 지연/취소 회귀는 주입한 loadRecords를 대기시켜 실제 미완료 상태로 쓴다.
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

    /// 무료 전환 시 정리 대상이 되는 유료 목소리 알람.
    func paidAlarmTalks() -> [LocalAlarmRecord] {
        Self.paidAlarmTalks(in: alarms)
    }

    /// `paidAlarmTalks()` 의 순수판 — 무료 잠금 선별(`FreePlanLockSelection`)이 같은 술어를 쓴다.
    nonisolated static func paidAlarmTalks(in alarms: [LocalAlarmRecord]) -> [LocalAlarmRecord] {
        alarms.filter(\.isPaidVoiceForDowngrade)
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

    /// 이 캐시 키를 쓰는 알람 수 — 지워도 되는지 볼 때 쓴다.
    ///
    /// ⚠ **무료 잠금 보관본이 붙든 키도 센다**(Codex #820, 안드로이드 `AlarmDao.countByAudioCacheKey`
    /// 의 `preLockVoiceJson` 조건과 짝). 잠금은 원래 오디오를 `audioCacheKey` 에서 보관본으로 옮기므로,
    /// 그걸 안 세면 같은 클립을 쓰던 다른 알람을 지우거나 바꿀 때 파일이 지워지고, 재결제로 복원한
    /// 알람은 들을 소리가 없다.
    func countByAudioCacheKey(_ key: String) -> Int {
        alarms.reduce(0) { acc, record in
            let referenced = record.audioCacheKey == key
                || (record.preLockVoice?.referencedCacheKeys.contains(key) ?? false)
            return referenced ? acc + 1 : acc
        }
    }

    /// `AlarmRepository.requireUniqueTime` 와 동일 의미 — hour+minute 가 같으면 중복이다
    /// (요일은 보지 않는다. Android 원본 의도와 동일). 판정은 `conflictingAlarms` 하나다.
    ///
    /// ⚠ **소유자를 반드시 넘긴다 — 목록만 거르면 뚫린다**(Codex #699 P1).
    /// 목록에서 남의 알람을 감춰도 이 판정이 저장소 전체를 보면, B 가 A 의 **숨은** 알람과
    /// 같은 시각을 고르는 순간 "중복" 으로 막힌다. 보이지도 않는 알람 때문에 막히니
    /// 사용자는 이유를 알 길이 없다.
    func requireUniqueTime(
        hour: Int,
        minute: Int,
        excludingID: String? = nil,
        ownerUserId: String?
    ) throws {
        if !conflictingAlarms(hour: hour, minute: minute, excludingID: excludingID, ownerUserId: ownerUserId).isEmpty {
            throw LocalAlarmValidationError.duplicateTime
        }
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
        // 날짜 알람은 실제 있는 날짜여야 하고 요일 반복·공휴일 끄기와 함께 있을 수 없다
        // (스펙 alarm-lifecycle.md §4-1). 지난 시각은 여기서 보지 않는다 — 편집기가 누르는 순간 막는다.
        if let targetDate = record.targetDate.nilIfBlank {
            guard DatedAlarmTime.isValidTargetDate(targetDate),
                  record.repeatDaysMask == 0,
                  !record.holidayOff else {
                throw LocalAlarmValidationError.invalidTargetDate
            }
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
        // 사용자가 고친 옛 받은 알람은 승격하지 않는다 — 고른 목소리를 덮지 않는다(`ReceivedAlarmPromotion`).
        ReceivedAlarmPromotionStore().remove([updated.id], ownerUserID: updated.ownerUserId)
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
    func delete(_ alarm: LocalAlarmRecord) -> String? {
        guard let index = alarms.firstIndex(where: { $0.id == alarm.id }) else {
            return nil
        }
        let releasedAudioCacheKey = alarms[index].audioCacheKey.nilIfBlank
        alarms.remove(at: index)
        persist()
        // 지운 알람의 표시 언어 기록도 지운다 — 남겨 두면 알람을 지울 때마다 키가 쌓인다.
        AlarmPresentationLanguage.forget(alarm.id)
        ReceivedAlarmPromotionStore().remove([alarm.id], ownerUserID: alarm.ownerUserId)
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

    // MARK: State transitions
    // Android `AlarmRepository` 의 markRinging / dismiss / snooze / setEnabled 흐름 이식.

    /// OS 예약 핸들을 기록한다.
    ///
    /// ⚠ **`updatedAtMillis` 를 올리지 않는다.** 이건 사용자가 고친 게 아니라 우리가 OS 에
    /// 건 예약을 적어 두는 것이다. 같은 이유로 `applyWeatherVariant` 도 올리지 않는다.
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
    /// 문구가 나온다 — 안드로이드 `MatchingBucketIds` 와 같은 이유다.
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
    /// 받아 적은 것이다.
    func applyWeatherVariant(id: String, index: Int, resolvedAtMillis: Int64) {
        guard let position = alarms.firstIndex(where: { $0.id == id }) else { return }
        alarms[position].contextVariantIndex = index
        alarms[position].contextResolvedAtMillis = resolvedAtMillis
        persist()
    }

    /// **발사 날짜가 바뀌면 받아 둔 날씨 조건을 버린다** — 울린 뒤·다시 켤 때·놓친 회차를
    /// 넘길 때(스펙 `docs/spec/voice-and-message.md` 5-1 「발사 날짜가 바뀌면 받아 둔 인덱스를 버린다」).
    ///
    /// 조건 인덱스는 **그 날짜의** 날씨다. 반복 날씨 알람이 울리고 다음 날로 넘어갈 때 옛 값을
    /// 남겨 두면 `weatherVariantNeedsRefresh` 가 "이미 받았다" 로 읽고(받은 시각이 24시간 창
    /// 안이다), 그 사이 갱신을 못 하면 **어제 날씨 클립**이 울린다. 2026-09-30 까지 iOS 는 울린
    /// 뒤에 지우지 않았다. 안드로이드는 `AlarmRepository.dismiss`·`setEnabled` 가
    /// `shouldResetWeatherVariant` 로 같은 판정을 한다 — 판정식은 편집 저장과 같은
    /// `BucketVariantResolver.shouldResetWeatherVariant` 하나다.
    ///
    /// 지운 뒤에는 '못 봤어요' 안내 클립 자리가 되고(`BucketVariantResolver.variantIndex`),
    /// 준비창 갱신(`WeatherVariantRefreshService.refreshDue`)이 새 날짜로 다시 받아 재예약한다.
    /// ⚠ 여기서 **다시 예약하지는 않는다** — 소리 지문이 바뀌므로 정지 뒤 리컨사일러
    /// (`AlarmAppContext.reconcileAfterStop`)·복구 경로가 새 소리로 건다.
    /// **응원 — 다음 회차의 문구를 준비한다**(스펙 voice-and-message §5-4). 관측된 해제(`markStopped`)와 지나간 회차를 넘기는
    /// 복구(`prepareForScheduleRecovery`)가 부른다. 디스크(매니페스트·캐시)만 읽는다. 다시 예약하지는 않는다 — 소리 지문이
    /// 바뀌므로 그 뒤의 재조정이 새 소리로 건다. 안드로이드는 `AlarmRepository.dismiss` 가 같은 일을 한다.
    static func prepareCheerForNextOccurrence(_ record: inout LocalAlarmRecord, nextFireAtMillis: Int64) {
        guard record.bucketId == CheerVariety.bucketID else { return }
        record = CheerVariety.prepared(
            record,
            occurrence: nextFireAtMillis,
            candidates: CheerVariety.candidates(for: record, audioCache: .shared),
            explicitChange: false
        )
    }

    /// **앱 복귀 때 응원을 준비한다**(스펙 voice-and-message §5-4). 켜진 응원 알람 중 이번 회차(`fireAtMillis`)의 선택이
    /// 아직 없는 것 — 그 사이 새 응원이 받아졌거나(공개·보충) 앞 회차가 해제 관측 없이 지나간 경우, 또는 목소리가 바뀌어
    /// (무료 강등) 고른 것이 옛 목소리의 것인 경우 — 을 골라 둔다.
    /// 울리는 중·스누즈 중이면 건너뛴다(같은 회차다). 바뀐 알람 id 를 돌려준다 — 호출자가 재조정으로 다시 예약한다.
    @discardableResult
    func prepareCheerSelections(nowMillis: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) -> [String] {
        var changed: [String] = []
        for index in alarms.indices {
            let record = alarms[index]
            guard record.enabled, record.bucketId == CheerVariety.bucketID, record.fireAtMillis > nowMillis,
                  record.runtimeStateEnum != .ringing, record.runtimeStateEnum != .snoozed,
                  CheerVariety.needsPreparation(record) else { continue }
            let next = CheerVariety.prepared(
                record,
                occurrence: record.fireAtMillis,
                candidates: CheerVariety.candidates(for: record, audioCache: .shared),
                explicitChange: false
            )
            if next.cheerSelection != record.cheerSelection {
                alarms[index] = next
                changed.append(record.id)
            }
        }
        if !changed.isEmpty { persist() }
        return changed
    }

    static func invalidateWeatherVariantIfFireDateChanges(
        _ record: inout LocalAlarmRecord,
        nextFireAtMillis: Int64,
        calendar: Calendar = .current
    ) {
        guard record.bucketId == "weather",
              BucketVariantResolver.shouldResetWeatherVariant(
                  previous: record,
                  nextBucketId: record.bucketId,
                  nextCountry: record.voiceWeatherCountry,
                  nextCity: record.voiceWeatherCity,
                  nextFireAtMillis: nextFireAtMillis,
                  calendar: calendar
              ) else { return }
        record.contextVariantIndex = nil
        record.contextResolvedAtMillis = nil
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
        // ⚠ **날짜 알람은 반복이 아니다**(`isRecurring`) — 정지하면 일회성처럼 꺼진 채 남는다. 다음 날·
        // 다음 주로 넘기지 않는다(스펙 alarm-lifecycle.md §4-4).
        if alarms[index].isRecurring,
           let nextFireAt = try? alarms[index].nextFireAtMillis(nowMillis: now, isHoliday: isHoliday) {
            // 다음 날로 넘어가면 오늘 받아 둔 날씨 조건은 버린다 — 옛 `fireAtMillis` 로 판정하므로
            // **덮기 전에** 부른다(`invalidateWeatherVariantIfFireDateChanges` 주석).
            Self.invalidateWeatherVariantIfFireDateChanges(&alarms[index], nextFireAtMillis: nextFireAt)
            alarms[index].fireAtMillis = nextFireAt
            Self.prepareCheerForNextOccurrence(&alarms[index], nextFireAtMillis: nextFireAt)
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

        // 날짜 알람은 **그 날짜·시간대로 다시 계산한다** — 벽시계로 다시 계산하지 않는다(스펙 alarm-lifecycle.md
        // §4-4). 스누즈 중이면 `fireAtMillis` 가 스누즈 마감이라 건드리지 않는다. 계산이 안 되는 날짜는 지난 것으로
        // 보고 아래 '만료된 1회성' 갈래로 보낸다.
        if alarms[index].isDated, alarms[index].runtimeStateEnum != .snoozed {
            alarms[index].fireAtMillis = alarms[index].datedFireAtMillis ?? 0
        }
        if alarms[index].fireAtMillis <= nowMillis {
            if alarms[index].isRecurring,
               let nextFireAt = try? alarms[index].nextFireAtMillis(nowMillis: nowMillis, isHoliday: isHoliday) {
                // 정지 기록 없이 지나간 회차를 넘길 때도 같다 — 날짜가 바뀌면 조건을 버린다.
                Self.invalidateWeatherVariantIfFireDateChanges(&alarms[index], nextFireAtMillis: nextFireAt)
                alarms[index].fireAtMillis = nextFireAt
                // iOS 는 AlarmKit 이 우리 코드 없이 울리므로 지나간 회차는 울렸을 수 있다 — 응원은 다음 회차를 준비한다(스펙 §5-4).
                Self.prepareCheerForNextOccurrence(&alarms[index], nextFireAtMillis: nextFireAt)
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

    /// **달력(공휴일 국가·시간대)이 바뀌었다** — '공휴일에는 끄기' 반복 알람의 다음 발생만 새 달력으로 다시
    /// 계산한다. 다시 걸어야 하면 바뀐 행을, 그럴 필요가 없으면 nil 을 돌려준다(`AlarmKitViewModel.recoverScheduledAlarms`
    /// 의 `forceHolidayOffRecompute` 갈래 — 공휴일 국가는 `HolidayOffRescheduler`, 시간대는 `AlarmTalkApp`).
    ///
    /// 안드로이드 `AlarmRepository.refreshHolidayOffAlarms`(`reschedulePendingAlarmsLocked` 의 `recomputeHolidayOff`)와
    /// 같은 규칙이다(스펙 alarm-lifecycle.md 「공휴일 국가는 지역의 나라다」):
    ///  - **멱등이다.** 다음 발생이 그대로이고 이미 걸려 있으면 nil — 같은 달력으로 몇 번 불러도 예약을 흔들지 않는다.
    ///  - **스누즈 중·울리는 중이면 건드리지 않는다**(nil). 예전에는 `setEnabled` 로 다시 켜서 스누즈 횟수를
    ///    지우고 옛 예약을 취소했다 — 그 사이 울리던 알람·스누즈가 사라진다.
    ///  - ⚠ **수정 시각(`updatedAtMillis`)·동기화 상태를 건드리지 않는다** — 사용자의 편집이 아니다. 올리면
    ///    바뀐 것도 없이 dirty 가 되어 서버로 다시 간다.
    func recomputeHolidayOffFireTime(
        id: String,
        nowMillis: Int64,
        isHoliday: (Date) -> Bool = { LocalHolidayCalendar.isHoliday($0) }
    ) -> LocalAlarmRecord? {
        guard let index = alarms.firstIndex(where: { $0.id == id }),
              alarms[index].enabled,
              alarms[index].isHolidayOffRecurring else { return nil }
        let state = alarms[index].runtimeStateEnum
        guard state != .snoozed, state != .ringing,
              let nextFireAt = try? alarms[index].nextFireAtMillis(nowMillis: nowMillis, isHoliday: isHoliday)
        else { return nil }
        let needsArm = alarms[index].alarmKitID == nil || state == .failed
        guard needsArm || nextFireAt != alarms[index].fireAtMillis else { return nil }
        // 발사 날짜가 바뀌면 받아 둔 날씨 조건을 버린다 — 옛 `fireAtMillis` 로 판정하므로 덮기 전에.
        Self.invalidateWeatherVariantIfFireDateChanges(&alarms[index], nextFireAtMillis: nextFireAt)
        alarms[index].fireAtMillis = nextFireAt
        alarms[index].state = AlarmRuntimeState.armed.rawValue
        persist()
        return alarms[index]
    }

    /// - Parameter keepScheduleHandle: 끄면서도 `alarmKitID` 를 남길지.
    ///   ⚠ **취소가 실패했을 때만 `true`** 다(Codex #699 P1). 그 값은 OS 예약을 취소할
    ///   **유일한 손잡이**라, 취소에 실패했는데 지우면 예약은 남고 취소할 방법만 사라진다
    ///   (고아 예약). 평소에는 `false` — 남겨 두면 다음에 켤 때 옛 핸들과 어긋난다.
    /// - Returns: 바꿨는가. ⚠ **날짜가 지난 날짜 알람은 켜지 않고 false**(스펙 alarm-lifecycle.md §4-4) — 켜면
    ///   다음 날로 넘길 회차가 없다. 부르는 쪽(`AlarmsListView`)이 그 전에 알럿으로 막고, 여기는 그물이다.
    @discardableResult
    func setEnabled(
        id: String,
        enabled: Bool,
        keepScheduleHandle: Bool = false,
        nowMillis: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
        isHoliday: (Date) -> Bool = { LocalHolidayCalendar.isHoliday($0) }
    ) -> Bool {
        guard let index = alarms.firstIndex(where: { $0.id == id }) else { return false }
        if enabled, alarms[index].datedTimeHasPassed(nowMillis: nowMillis) { return false }
        if enabled {
            let nextFireAt = (try? alarms[index].nextFireAtMillis(nowMillis: nowMillis, isHoliday: isHoliday))
                ?? LocalAlarmRecord.fallbackFireAtMillis(
                hour: alarms[index].hour,
                minute: alarms[index].minute,
                referenceMillis: nowMillis
            )
            // 다시 켜서 발사 날짜가 바뀌면 옛 날씨 조건을 버린다(안드로이드 `setEnabled` 와 같다).
            Self.invalidateWeatherVariantIfFireDateChanges(&alarms[index], nextFireAtMillis: nextFireAt)
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
        return true
    }

    // MARK: Sync transitions

    /// Android `AlarmRepository.nextLocalSyncState` 동일.
    /// - remoteAlarmId 없으면 local_only
    /// - 그 외엔 dirty
    /// ⚠ **2026-10-29 부터 이 값을 읽는 곳이 없다** — 서버 알람 사본을 지웠고 올리는 코드도 지웠다. 칸은 디스크 형식을
    ///   그대로 두려고 남긴다(안드로이드 `AlarmSyncStates` 짝).
    func nextLocalSyncState(for record: LocalAlarmRecord) -> AlarmSyncState {
        if record.remoteAlarmId == nil { return .localOnly }
        return .dirty
    }

    // MARK: Persistence

    private func persist() {
        let snapshot = alarms
        saveSeq += 1
        let seq = saveSeq
        Task { [persistence] in
            await persistence.save(snapshot, seq: seq)
        }
    }

    /**
     * 지금 상태를 **동기로** 쓰고 성공 여부를 돌려준다.
     *
     * ⚠ "디스크에 실제로 남았는가" 가 정확성에 걸린 자리에서만 쓴다 — 교체 표식은 강등이
     * 디스크에 남은 뒤에야 '반영함' 으로 적을 수 있다. 평소 경로는 `persist()`(비동기)로
     * 충분하다. 백그라운드 푸시로 깨어난 실행은 비동기 쓰기 전에 종료될 수 있고, 그러면
     * 다음 실행이 옛 목소리 알람을 다시 읽어 오는데 표식만 앞서 나가 **영영 다시 내리지
     * 않는다.**
     */
    @discardableResult
    func saveNow() -> Bool {
        saveSeq += 1
        return writer.write(alarms, seq: saveSeq)
    }
}
