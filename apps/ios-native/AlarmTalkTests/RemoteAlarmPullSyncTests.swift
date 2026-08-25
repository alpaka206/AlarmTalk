import XCTest
@testable import AlarmTalk

/// `RemoteAlarmPullSync` 의 충돌 정책 / 머지 / cascade 정책을 단위 검증.
///
/// 네트워크 layer 는 `AlarmTalkAPI` final class 의 직접 mock 이 까다로워
/// 본 테스트는 store 기반 정책 메서드에 집중한다. 통합 흐름은 simulator 의
/// end-to-end 빌드로 별도 검증한다.
@MainActor
final class RemoteAlarmPullSyncTests: XCTestCase {

    func test_deliveryCompletesOnlyAfterEnabledAlarmIsScheduledAndVersioned() {
        XCTAssertFalse(RemoteAlarmPullSync.receivedAlarmDeliveryComplete(
            audioSecured: true,
            enabled: true,
            scheduleSucceeded: false,
            conflictsCleared: true,
            deliveryVersion: "version-1"
        ))
        XCTAssertFalse(RemoteAlarmPullSync.receivedAlarmDeliveryComplete(
            audioSecured: true,
            enabled: true,
            scheduleSucceeded: true,
            conflictsCleared: true,
            deliveryVersion: nil
        ))
        XCTAssertTrue(RemoteAlarmPullSync.receivedAlarmDeliveryComplete(
            audioSecured: true,
            enabled: true,
            scheduleSucceeded: true,
            conflictsCleared: true,
            deliveryVersion: "version-1"
        ))
        XCTAssertTrue(RemoteAlarmPullSync.receivedAlarmDeliveryComplete(
            audioSecured: true,
            enabled: false,
            scheduleSucceeded: false,
            conflictsCleared: true,
            deliveryVersion: "version-1"
        ))
    }

    /// ⚠ **같은 시각 충돌 정리에 실패하면 ACK 하지 않는다**(Codex #703 P1).
    /// 행만 꺼지고 OS 예약이 살아 있는데 서버 행을 지우면 다시 시도할 근거가 사라진다 —
    /// 백그라운드로 받은 알람은 전경 복귀 전에 울릴 수 있고, 그러면 둘이 같이 운다.
    func test_deliveryIncompleteWhenSameTimeConflictCancellationFails() {
        XCTAssertFalse(RemoteAlarmPullSync.receivedAlarmDeliveryComplete(
            audioSecured: true,
            enabled: true,
            scheduleSucceeded: true,
            conflictsCleared: false,
            deliveryVersion: "version-1"
        ))
        // ⚠ **꺼진 알람도 정리는 요구한다**(Codex #703 P1). 서버가 받은 알람을 끄면 새로
        // 걸 것은 없지만 **옛 예약은 지워야 한다** — 그 취소가 실패했는데 ACK 하면 꺼진 행
        // 뒤에 살아 있는 예약이 남고, 서버 행이 없어 다시 시도할 근거도 사라진다.
        XCTAssertFalse(RemoteAlarmPullSync.receivedAlarmDeliveryComplete(
            audioSecured: true,
            enabled: false,
            scheduleSucceeded: false,
            conflictsCleared: false,
            deliveryVersion: "version-1"
        ))
        // 정리가 끝났으면 꺼진 알람은 예약 성공을 요구하지 않는다.
        XCTAssertTrue(RemoteAlarmPullSync.receivedAlarmDeliveryComplete(
            audioSecured: true,
            enabled: false,
            scheduleSucceeded: false,
            conflictsCleared: true,
            deliveryVersion: "version-1"
        ))
    }

    func test_editedReceivedAlarmRetriesAckOnlyForAppliedDeliveryVersion() {
        var existing = makeReceivedRemote(remoteID: "remote-1")
        existing.remoteDeliveryVersion = "version-1"

        XCTAssertTrue(RemoteAlarmPullSync.receivedDeliveryVersionAlreadyApplied(
            existing: existing,
            deliveryVersion: "version-1"
        ))
        XCTAssertFalse(RemoteAlarmPullSync.receivedDeliveryVersionAlreadyApplied(
            existing: existing,
            deliveryVersion: "version-2"
        ))
        XCTAssertFalse(RemoteAlarmPullSync.receivedDeliveryVersionAlreadyApplied(
            existing: existing,
            deliveryVersion: nil
        ))

        existing.remoteDeliveryVersion = nil
        XCTAssertFalse(RemoteAlarmPullSync.receivedDeliveryVersionAlreadyApplied(
            existing: existing,
            deliveryVersion: "0123456789abcdef0123456789abcdef"
        ))
        XCTAssertFalse(RemoteAlarmPullSync.receivedDeliveryVersionAlreadyApplied(
            existing: existing,
            deliveryVersion: "11111111-1111-4111-8111-111111111111"
        ))
        // ⚠ **세대 형식으로 가르지 않는다**(Codex #703 P2). 적용 세대를 모르는 편집본은
        // 구형 backfill(32자리 hex)이든 지금 세대(UUID)든 **같은 복구**를 거친다 —
        // 형식으로 가르면 일반 세대가 영영 ACK 되지 못하고 서버 행과 음원이 남는다.
        XCTAssertTrue(RemoteAlarmPullSync.deliveryVersionUnknownLocally(existing))
        var applied = existing
        applied.remoteDeliveryVersion = "11111111-1111-4111-8111-111111111111"
        XCTAssertFalse(
            RemoteAlarmPullSync.deliveryVersionUnknownLocally(applied),
            "적용 세대를 아는 행은 이 복구 대상이 아니다"
        )
    }

    func test_legacyBackfillLinksRecoveredAudioWithoutChangingRecipientSchedule() {
        var existing = makeReceivedRemote(remoteID: "remote-1")
        existing.hour = 9
        existing.minute = 17
        existing.playMode = AlarmPlayMode.alarmOnly.rawValue
        existing.localAudioUri = nil
        existing.audioCacheKey = nil
        existing.ttsMessageId = nil
        existing.voiceProfileId = nil
        existing.voiceText = nil
        existing.voiceCategory = nil

        var prepared = existing
        prepared.playMode = AlarmPlayMode.voiceOnly.rawValue
        prepared.localAudioUri = "remote-message-message-1.mp3"
        prepared.audioCacheKey = "remote-message-message-1"
        prepared.rawAudioUri = "r2://voice.mp3"
        prepared.voiceSource = VoiceSource.serverTts.rawValue
        prepared.voiceProfileId = "voice-1"
        prepared.voiceText = "일어나세요"
        prepared.voiceCategory = "custom"
        prepared.ttsMessageId = "message-1"

        let recovered = RemoteAlarmPullSync.linkRecoveredLegacyRemoteAudio(
            existing: existing,
            prepared: prepared
        )

        XCTAssertEqual(recovered.hour, 9)
        XCTAssertEqual(recovered.minute, 17)
        XCTAssertEqual(recovered.playModeEnum, .voiceOnly)
        XCTAssertEqual(recovered.localAudioUri, prepared.localAudioUri)
        XCTAssertEqual(recovered.audioCacheKey, prepared.audioCacheKey)
        XCTAssertEqual(recovered.ttsMessageId, "message-1")
        XCTAssertEqual(recovered.voiceProfileId, "voice-1")

        var recipientVoice = existing
        recipientVoice.playMode = AlarmPlayMode.voiceOnly.rawValue
        recipientVoice.localAudioUri = "my-recording.m4a"
        recipientVoice.voiceSource = VoiceSource.localAudio.rawValue
        let preserved = RemoteAlarmPullSync.linkRecoveredLegacyRemoteAudio(
            existing: recipientVoice,
            prepared: prepared
        )
        XCTAssertEqual(preserved.localAudioUri, "my-recording.m4a")
        XCTAssertEqual(preserved.voiceSourceEnum, .localAudio)
    }

    // MARK: - shouldApplyRemote

    func test_shouldApplyRemote_localDirty_returnsFalse() {
        var existing = makeLocalOwned(remoteID: "r1")
        existing.syncState = AlarmSyncState.dirty.rawValue
        existing.lastSyncedAtMillis = 100

        var mapped = existing
        mapped.lastSyncedAtMillis = 200  // 서버가 더 최신이라도

        XCTAssertFalse(RemoteAlarmPullSync.shouldApplyRemote(existing: existing, mapped: mapped))
    }

    func test_shouldApplyRemote_serverFresher_returnsTrue() {
        var existing = makeLocalOwned(remoteID: "r1")
        existing.syncState = AlarmSyncState.synced.rawValue
        existing.lastSyncedAtMillis = 100

        var mapped = existing
        mapped.lastSyncedAtMillis = 200

        XCTAssertTrue(RemoteAlarmPullSync.shouldApplyRemote(existing: existing, mapped: mapped))
    }

    func test_shouldApplyRemote_localFresher_returnsFalse() {
        var existing = makeLocalOwned(remoteID: "r1")
        existing.syncState = AlarmSyncState.synced.rawValue
        existing.lastSyncedAtMillis = 500

        var mapped = existing
        mapped.lastSyncedAtMillis = 100

        XCTAssertFalse(RemoteAlarmPullSync.shouldApplyRemote(existing: existing, mapped: mapped))
    }

    // MARK: - 받은 뒤에는 받은 사람이 관리한다 (docs/spec/family-alarm.md 1절)

    func test_shouldApplyRemote_recipientEditedReceivedAlarm_returnsFalse() {
        // 수신자가 저장하면 upsertPreservingServerSyncFields 가 lastSyncedAtMillis 를
        // 보존한 채 updatedAtMillis 만 올린다. 그 뒤로는 서버본을 다시 입히지 않는다.
        var existing = makeReceivedRemote(remoteID: "r1")
        existing.lastSyncedAtMillis = 100
        existing.updatedAtMillis = 200

        var mapped = existing
        mapped.lastSyncedAtMillis = 300  // 서버가 아무리 최신이어도

        XCTAssertTrue(RemoteAlarmPullSync.locallyEditedByRecipient(existing))
        XCTAssertFalse(RemoteAlarmPullSync.shouldApplyRemote(existing: existing, mapped: mapped))
    }

    func test_shouldApplyRemote_untouchedReceivedAlarm_stillApplies() {
        // 아직 안 고친 행은 그대로 둔다 — 음성 다운로드가 실패했던 행의 재시도 경로다.
        var existing = makeReceivedRemote(remoteID: "r1")
        existing.lastSyncedAtMillis = 100
        existing.updatedAtMillis = 100

        var mapped = existing
        mapped.lastSyncedAtMillis = 300

        XCTAssertFalse(RemoteAlarmPullSync.locallyEditedByRecipient(existing))
        XCTAssertTrue(RemoteAlarmPullSync.shouldApplyRemote(existing: existing, mapped: mapped))
    }

    func test_locallyEditedByRecipient_ignoresOwnAlarms() {
        // 내가 만든 알람은 dirty 플래그가 정상 동작하므로 이 판정 대상이 아니다.
        var owned = makeLocalOwned(remoteID: "r1")
        owned.lastSyncedAtMillis = 100
        owned.updatedAtMillis = 999

        XCTAssertFalse(RemoteAlarmPullSync.locallyEditedByRecipient(owned))
    }

    func test_locallyEditedByRecipient_legacyRowWithoutStamp_isProtected() {
        var legacy = makeReceivedRemote(remoteID: "r1")
        legacy.lastSyncedAtMillis = nil

        XCTAssertTrue(RemoteAlarmPullSync.locallyEditedByRecipient(legacy))
    }

    @MainActor
    func test_upsertSyncedNow_marksRowAsUntouched() {
        // ⚠ 불변식: pull 이 쓴 행은 updatedAtMillis == lastSyncedAtMillis 여야 한다.
        // 그냥 upsert 하면 updatedAtMillis 만 now 로 올라가, 갓 받은 알람이 곧바로
        // '수신자가 고친 행' 으로 읽힌다(=서버 내용이 영영 안 들어온다).
        let store = LocalAlarmStore(loadFromDisk: false)
        var record = makeReceivedRemote(remoteID: "r1")
        record.lastSyncedAtMillis = 1
        record.updatedAtMillis = 1

        let saved = store.upsert(record, syncedNow: true)

        XCTAssertEqual(saved.updatedAtMillis, saved.lastSyncedAtMillis)
        XCTAssertFalse(RemoteAlarmPullSync.locallyEditedByRecipient(saved))

        // 대조군 — 수신자 편집 경로(plain upsert)는 lastSyncedAtMillis 를 건드리지 않아
        // 두 값이 갈라진다.
        var reopened = saved
        reopened.lastSyncedAtMillis = 1  // 오래전에 받은 행
        let edited = store.upsert(reopened)
        XCTAssertEqual(edited.lastSyncedAtMillis, 1)
        XCTAssertGreaterThan(edited.updatedAtMillis, 1)
        XCTAssertTrue(RemoteAlarmPullSync.locallyEditedByRecipient(edited))
    }

    @MainActor
    func test_markScheduled_doesNotMakeAFreshlyReceivedAlarmLookEdited() {
        // ⚠ 받은 알람은 import 직후 곧바로 예약된다(`rescheduleReceivedRemote`).
        // 그때 `updatedAtMillis` 가 올라가면 '수신자가 고친 행' 으로 읽혀 서버 내용이
        // 영영 안 들어온다 — 첫 수신 때 음성을 못 받은 행의 재시도까지 죽는다.
        let store = LocalAlarmStore(loadFromDisk: false)
        var record = makeReceivedRemote(remoteID: "r1")
        record.lastSyncedAtMillis = 1
        record.updatedAtMillis = 1
        let saved = store.upsert(record, syncedNow: true)
        XCTAssertFalse(RemoteAlarmPullSync.locallyEditedByRecipient(saved))

        store.markScheduled(localID: saved.id, alarmKitID: UUID().uuidString)

        let afterScheduling = store.record(id: saved.id)!
        XCTAssertNotNil(afterScheduling.alarmKitID)
        XCTAssertFalse(
            RemoteAlarmPullSync.locallyEditedByRecipient(afterScheduling),
            "예약을 적는 것은 사용자 편집이 아니다 — updatedAtMillis 를 올리면 안 된다."
        )
    }

    // MARK: - received remote filter

    func test_isReceivedRemoteCandidate_targetMeSenderOther_returnsTrue() {
        let remote = makeRemote(targetUserID: "me", senderUserID: "other")

        XCTAssertTrue(RemoteAlarmPullSync.isReceivedRemoteCandidate(remote, currentUserID: "me"))
    }

    func test_isReceivedRemoteCandidate_senderIsMe_returnsFalse() {
        let remote = makeRemote(targetUserID: "me", senderUserID: "me")

        XCTAssertFalse(RemoteAlarmPullSync.isReceivedRemoteCandidate(remote, currentUserID: "me"))
    }

    func test_isReceivedRemoteCandidate_missingTargetOrSender_returnsFalse() {
        XCTAssertFalse(RemoteAlarmPullSync.isReceivedRemoteCandidate(
            makeRemote(targetUserID: nil, senderUserID: "other"),
            currentUserID: "me"
        ))
        XCTAssertFalse(RemoteAlarmPullSync.isReceivedRemoteCandidate(
            makeRemote(targetUserID: "me", senderUserID: nil),
            currentUserID: "me"
        ))
        XCTAssertFalse(RemoteAlarmPullSync.isReceivedRemoteCandidate(
            makeRemote(targetUserID: "someone-else", senderUserID: "other"),
            currentUserID: "me"
        ))
    }

    // MARK: - merge

    func test_merge_preservesLocalIdentityAndCounters() {
        var existing = makeLocalOwned(remoteID: "r1")
        existing.id = "local-id"
        existing.alarmKitID = "kit-id"
        existing.snoozeCount = 3
        existing.snoozeRepeatLimit = SnoozeRepeatLimit.five.rawValue
        existing.voiceVolumePercent = 64
        existing.holidayOff = true
        existing.alarmVolumePercent = 70
        existing.alarmSoundUri = "file:///x.wav"
        existing.alarmSoundLabel = "custom"
        existing.createdAtMillis = 12345

        var mapped = makeLocalOwned(remoteID: "r1")
        mapped.id = "another-id"
        mapped.alarmKitID = nil
        mapped.snoozeCount = 0
        mapped.snoozeRepeatLimit = SnoozeRepeatLimit.three.rawValue
        mapped.voiceVolumePercent = 100
        mapped.holidayOff = false
        mapped.alarmVolumePercent = 100
        mapped.alarmSoundUri = nil
        mapped.alarmSoundLabel = nil
        mapped.createdAtMillis = 99999
        mapped.label = "remote-label"

        let merged = RemoteAlarmPullSync.merge(existing: existing, mapped: mapped)

        XCTAssertEqual(merged.id, "local-id")
        XCTAssertEqual(merged.alarmKitID, "kit-id")
        XCTAssertEqual(merged.snoozeCount, 3)
        XCTAssertEqual(merged.snoozeRepeatLimit, SnoozeRepeatLimit.five.rawValue)
        XCTAssertEqual(merged.voiceVolumePercent, 64)
        XCTAssertTrue(merged.holidayOff)
        XCTAssertEqual(merged.alarmVolumePercent, 70)
        XCTAssertEqual(merged.alarmSoundUri, "file:///x.wav")
        XCTAssertEqual(merged.alarmSoundLabel, "custom")
        XCTAssertEqual(merged.createdAtMillis, 12345)
        // 서버 권위 필드는 mapped 가 이긴다.
        XCTAssertEqual(merged.label, "remote-label")
    }

    func test_merge_receivedRemote_respectsLocalDisabledIntent() {
        var existing = makeReceivedRemote(remoteID: "r1")
        existing.enabled = false  // 사용자가 끔

        var mapped = makeReceivedRemote(remoteID: "r1")
        mapped.enabled = true     // 서버는 active

        let merged = RemoteAlarmPullSync.merge(existing: existing, mapped: mapped)

        XCTAssertFalse(merged.enabled)
        XCTAssertEqual(merged.runtimeStateEnum, .disabled)
    }

    func test_merge_localOwned_doesNotForceDisabled() {
        var existing = makeLocalOwned(remoteID: "r1")
        existing.enabled = false

        var mapped = makeLocalOwned(remoteID: "r1")
        mapped.enabled = true

        let merged = RemoteAlarmPullSync.merge(existing: existing, mapped: mapped)

        // localOwned 는 사용자 disable 의도 보존 규칙이 적용되지 않으므로 서버 응답을 그대로.
        XCTAssertTrue(merged.enabled)
    }

    // MARK: - remote audio fallback

    func test_withoutUnavailableRemoteAudio_downgradesToAlarmOnly() {
        var record = makeReceivedRemote(remoteID: "r1")
        record.playMode = AlarmPlayMode.voiceOnly.rawValue
        record.localAudioUri = "remote-message-m1.m4a"
        record.audioCacheKey = "remote-message-m1"
        record.rawAudioUri = "r2://tts/m1.m4a"
        record.voiceSource = VoiceSource.serverTts.rawValue
        record.voiceProfileId = "voice-1"
        record.voiceText = "wake up"
        record.voiceCategory = "custom"
        record.voiceLanguage = "ko"
        record.voiceRandomPrompt = true
        record.voiceRandomContext = "weather"
        record.voiceWeatherCountry = "KR"
        record.voiceWeatherCity = "Seoul"
        record.voiceFortuneGender = "female"
        record.voiceFortuneBirthDate = "2000-01-01"
        record.voiceFortuneBirthTime = "07:30"
        record.ttsMessageId = "m1"

        let sanitized = RemoteAlarmPullSync.withoutUnavailableRemoteAudio(record)

        XCTAssertEqual(sanitized.playModeEnum, .alarmOnly)
        XCTAssertNil(sanitized.localAudioUri)
        XCTAssertNil(sanitized.audioCacheKey)
        XCTAssertNil(sanitized.rawAudioUri)
        XCTAssertEqual(sanitized.voiceSourceEnum, .localAudio)
        XCTAssertNil(sanitized.voiceProfileId)
        XCTAssertNil(sanitized.voiceText)
        XCTAssertNil(sanitized.voiceCategory)
        XCTAssertNil(sanitized.voiceLanguage)
        XCTAssertFalse(sanitized.voiceRandomPrompt)
        XCTAssertNil(sanitized.voiceRandomContext)
        XCTAssertNil(sanitized.voiceWeatherCountry)
        XCTAssertNil(sanitized.voiceWeatherCity)
        XCTAssertNil(sanitized.voiceFortuneGender)
        XCTAssertNil(sanitized.voiceFortuneBirthDate)
        XCTAssertNil(sanitized.voiceFortuneBirthTime)
        XCTAssertNil(sanitized.ttsMessageId)
    }

    // MARK: - Helpers

    // MARK: - 편집 커밋이 sync 필드를 되돌리지 않는다

    /// 편집기는 화면 진입 시점의 스냅샷으로 전체 행을 덮는다. 그 사이에 push 가
    /// `remoteAlarmId` 를 새겼다면 편집 커밋이 그걸 **nil 로 되돌리면 안 된다** —
    /// 되돌리면 다음 push 가 같은 알람을 또 create 해 서버에 두 행이 생긴다.
    @MainActor
    func test_upsertPreservingServerSyncFields_keepsRemoteIdSetDuringEdit() {
        let url = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("upsert-preserve-\(UUID().uuidString).json")
        let store = LocalAlarmStore(storageURL: url, loadFromDisk: false)
        defer { try? FileManager.default.removeItem(at: url) }
        var record = makeLocalOwned(remoteID: nil)
        record.syncState = AlarmSyncState.localOnly.rawValue
        store.upsert(record)

        // 편집 중 push 가 끼어들어 remoteAlarmId 를 새긴다.
        store.markRemote(
            localID: record.id,
            remoteID: "remote-new",
            lastSyncedAtMillis: 777,
            syncState: .synced
        )
        store.markRemoteDeliveryVersion(remoteID: "remote-new", deliveryVersion: "version-1")

        // 편집기가 들고 있던 **옛 스냅샷**으로 커밋한다.
        var stale = record
        stale.label = "사용자가 고친 라벨"
        let committed = store.upsertPreservingServerSyncFields(stale)

        XCTAssertEqual(committed.label, "사용자가 고친 라벨", "사용자 편집은 반영된다")
        XCTAssertEqual(committed.remoteAlarmId, "remote-new", "push 가 새긴 값이 살아남아야 한다")
        XCTAssertEqual(committed.lastSyncedAtMillis, 777)
        XCTAssertEqual(committed.remoteDeliveryVersion, "version-1")
        // remoteAlarmId 가 있으므로 편집분은 dirty 여야 다음 push 가 update 로 간다.
        XCTAssertEqual(committed.syncState, AlarmSyncState.dirty.rawValue)
    }

    // MARK: - 받은 알람 소유권 (받은 뒤부터는 받는 사람 것)

    /// **수신자가 고친 값은 다음 pull 이 되돌리면 안 된다.**
    ///
    /// 예전 구현은 '무엇을 보존할지 세는' 방식이라 시각·요일·스누즈 간격·스누즈 토글·
    /// 발화시각을 빠뜨렸다. 수신자가 07:00 → 06:30 으로 고쳐도 다음 pull 에 되돌아갔다 —
    /// 고쳐 뒀다고 믿고 그 시각에 못 일어난다. 안드로이드도 같은 버그를 네 번 겪고
    /// 세는 방식을 폐기했다.
    ///
    /// ⚠ 이 테스트에 필드를 계속 더해라. 편집 가능한 필드가 늘 때 같이 늘어야 한다.
    func test_merge_receivedRemote_recipientOwnsSchedule() {
        var existing = makeReceivedRemote(remoteID: "r1")
        existing.hour = 6
        existing.minute = 30
        existing.repeatDaysMask = 0b0000_0010
        existing.fireAtMillis = 111_111
        existing.snoozeEnabled = false
        existing.snoozeMinutes = 12
        existing.holidayOff = true

        var mapped = makeReceivedRemote(remoteID: "r1")
        mapped.hour = 7          // 서버가 보낸 원래 시각
        mapped.minute = 0
        mapped.repeatDaysMask = 0b0111_1110
        mapped.fireAtMillis = 999_999
        mapped.snoozeEnabled = true
        mapped.snoozeMinutes = 5
        mapped.holidayOff = false

        let merged = RemoteAlarmPullSync.merge(existing: existing, mapped: mapped)

        XCTAssertEqual(merged.hour, 6, "수신자가 고친 시각이 이긴다")
        XCTAssertEqual(merged.minute, 30)
        XCTAssertEqual(merged.repeatDaysMask, 0b0000_0010)
        XCTAssertEqual(merged.fireAtMillis, 111_111)
        XCTAssertFalse(merged.snoozeEnabled, "스누즈 토글도 수신자 것이다")
        XCTAssertEqual(merged.snoozeMinutes, 12)
        XCTAssertTrue(merged.holidayOff, "놓치면 공휴일에 울린다")
    }

    /// 스누즈 회차는 **한 묶음으로** 지킨다. 상태만 지키고 마감을 갈아 끼우면
    /// '5분 뒤 다시 울림' 이 사라져 다음 정규 회차로 밀린다.
    func test_merge_keepsSnoozeEpisodeIntact() {
        var existing = makeReceivedRemote(remoteID: "r1")
        existing.state = AlarmRuntimeState.snoozed.rawValue
        existing.fireAtMillis = 555_555
        existing.snoozeCount = 2
        existing.enabled = true

        var mapped = makeReceivedRemote(remoteID: "r1")
        mapped.fireAtMillis = 999_999
        mapped.snoozeCount = 0
        mapped.enabled = true

        let merged = RemoteAlarmPullSync.merge(existing: existing, mapped: mapped)

        XCTAssertEqual(merged.state, AlarmRuntimeState.snoozed.rawValue)
        XCTAssertEqual(merged.fireAtMillis, 555_555, "스누즈 마감이 유지돼야 한다")
        XCTAssertEqual(merged.snoozeCount, 2)
    }

    /// 지금 울리는(또는 스누즈 중인) 행은 pull 이 아예 건드리지 않는다.
    /// 건드리면 `rescheduleReceivedRemote` 가 **울리는 중인 AlarmKit 알람을 취소**해
    /// 알람이 울리다 말고 조용해진다.
    func test_isInFlight_coversRingingAndSnoozed() {
        var ringing = makeReceivedRemote(remoteID: "r1")
        ringing.state = AlarmRuntimeState.ringing.rawValue
        XCTAssertTrue(RemoteAlarmPullSync.isInFlight(ringing))

        var snoozed = makeReceivedRemote(remoteID: "r2")
        snoozed.state = AlarmRuntimeState.snoozed.rawValue
        XCTAssertTrue(RemoteAlarmPullSync.isInFlight(snoozed))

        var armed = makeReceivedRemote(remoteID: "r3")
        armed.state = AlarmRuntimeState.armed.rawValue
        XCTAssertFalse(RemoteAlarmPullSync.isInFlight(armed))
    }

    // MARK: - 목소리 철회 (발신자 탈퇴)

    /// 대상은 '목소리가 있는 행' 이 아니라 **'발신자 음성을 든 행'** 이다.
    /// 서버는 철회 기록을 영구히 들고 있어서, 넓게 잡으면 수신자가 나중에 넣은 자기
    /// 목소리까지 매번 걷어낸다.
    func test_hasSenderVoice_onlyRemoteMessageCacheKey() {
        var senderVoice = makeReceivedRemote(remoteID: "r1")
        senderVoice.audioCacheKey = "remote-message-msg-1"
        XCTAssertTrue(RemoteAlarmPullSync.hasSenderVoice(senderVoice))

        // 수신자가 나중에 넣은 자기 목소리 — 키가 다르다. 걷어내면 안 된다.
        var ownVoice = makeReceivedRemote(remoteID: "r2")
        ownVoice.audioCacheKey = "a1b2c3d4e5"
        XCTAssertFalse(RemoteAlarmPullSync.hasSenderVoice(ownVoice))

        // 목소리가 아예 없는 행.
        var noVoice = makeReceivedRemote(remoteID: "r3")
        noVoice.audioCacheKey = nil
        noVoice.localAudioUri = nil
        XCTAssertFalse(RemoteAlarmPullSync.hasSenderVoice(noVoice))
    }

    /// 키 없이 파일 경로만 든 옛 행도 포함한다 — 지금 코드로는 안 만들어지지만,
    /// 그렇다고 단정하고 생체정보를 남겨 둘 수는 없다.
    func test_hasSenderVoice_legacyRowWithoutCacheKey() {
        var legacy = makeReceivedRemote(remoteID: "r4")
        legacy.audioCacheKey = nil
        legacy.localAudioUri = "file:///tmp/voice.m4a"
        XCTAssertTrue(RemoteAlarmPullSync.hasSenderVoice(legacy))
    }

    /// **목소리만 걷어내고 알람은 남긴다.** 복제 목소리는 발신자의 생체정보라 파기
    /// 대상이지만, 시각·요일은 수신자가 기대고 자는 자기 정보다 — 통째로 지우면
    /// 그날 못 일어난다.
    /// ⚠ **재예약이 실패해도 리컨사일러가 집을 수 있는 상태로 남아야 한다.**
    ///
    /// 철회는 로컬 행을 먼저 고치고(같은 캐시를 쓰는 다른 행까지 세어 파일을 지우려면 그
    /// 순서여야 한다) 그다음 예약을 다시 건다. 그 재예약이 실패하면 pull 은 다시 집지
    /// 않는다(`hasSenderVoice` 가 이제 false 다) — 그래서 **예약 수리는 리컨사일러 몫**이고,
    /// 그러려면 판정 입력 둘(`alarmKitID`·`scheduledSoundFingerprint`)이 남아 있어야 한다.
    /// 여기서 지우면 `needsReschedule` 이 첫 guard 에서 false 가 되어 회수된 목소리 예약이
    /// 영영 남는다.
    func test_withVoiceRevoked_keepsReconcilerInputs() {
        var record = makeReceivedRemote(remoteID: "r6")
        record.enabled = true
        record.playMode = AlarmPlayMode.voiceOnly.rawValue
        record.audioCacheKey = "remote-message-msg-6"
        record.ttsMessageId = "msg-6"
        record.alarmKitID = "alarmkit-handle-6"
        record.scheduledSoundFingerprint = "voice:remote-message-msg-6:r-r2://old:v100"

        let revoked = RemoteAlarmPullSync.withVoiceRevoked(record)

        XCTAssertEqual(revoked.alarmKitID, "alarmkit-handle-6", "예약 핸들이 없으면 리컨사일러가 건너뛴다")
        XCTAssertEqual(
            revoked.scheduledSoundFingerprint,
            "voice:remote-message-msg-6:r-r2://old:v100",
            "구워 둔 지문이 남아 있어야 '지금 계획과 다르다' 를 알아챈다"
        )
    }

    func test_withVoiceRevoked_stripsVoiceButKeepsSchedule() {
        var record = makeReceivedRemote(remoteID: "r5")
        record.label = "엄마가 보낸 알람"
        record.hour = 6
        record.minute = 40
        record.repeatDaysMask = 0b0111_1110
        record.enabled = true
        record.playMode = AlarmPlayMode.voiceOnly.rawValue
        record.audioCacheKey = "remote-message-msg-9"
        record.localAudioUri = "file:///tmp/a.m4a"
        record.rawAudioUri = "https://example.com/a.mp3"
        record.voiceProfileId = "vp-mom"
        record.voiceListenerTitle = "우리 딸"
        record.voiceText = "일어나"
        record.voiceCategory = "morning"
        record.ttsMessageId = "msg-9"

        let revoked = RemoteAlarmPullSync.withVoiceRevoked(record)

        // 시각·요일·켜짐은 그대로 — 그날 못 일어나면 안 된다.
        XCTAssertEqual(revoked.hour, 6)
        XCTAssertEqual(revoked.minute, 40)
        XCTAssertEqual(revoked.repeatDaysMask, 0b0111_1110)
        XCTAssertTrue(revoked.enabled)
        XCTAssertEqual(revoked.id, record.id)
        XCTAssertEqual(revoked.remoteAlarmId, record.remoteAlarmId)

        // 목소리와 발신자 흔적은 전부 사라진다.
        XCTAssertEqual(revoked.playMode, AlarmPlayMode.alarmOnly.rawValue)
        XCTAssertNil(revoked.audioCacheKey)
        XCTAssertNil(revoked.localAudioUri)
        XCTAssertNil(revoked.rawAudioUri)
        XCTAssertNil(revoked.voiceProfileId)
        XCTAssertNil(revoked.ttsMessageId)
        XCTAssertNil(revoked.voiceText)
        XCTAssertNil(revoked.voiceCategory)
        // 보낸 사람 이름이 든 라벨·호칭도 파기 대상이다.
        XCTAssertNil(revoked.voiceListenerTitle)
        XCTAssertEqual(revoked.label, "알람")
        XCTAssertEqual(revoked.voiceSource, VoiceSource.localAudio.rawValue)
    }

    // MARK: - 서버가 표현하지 못하는 값은 merge 가 지킨다

    /// ⚠ **회귀 방지의 핵심.** `RemoteAlarm` 에 없는 필드는 매퍼가 기본값으로 만들어 내므로,
    /// merge 가 지키지 않으면 **pull 이 돌 때마다 조용히 초기화된다.**
    /// 실제로 날씨/운세 알람이 pull 한 번에 고정 문구 알람이 됐다
    /// (`voiceRandomPrompt` 가 false 로 덮여 `isRepeatingDynamicAlarmTalk` 에서 빠짐).
    func test_merge_preservesDynamicPromptConfigForLocalOwned() {
        var existing = makeLocalOwned(remoteID: "remote")
        existing.voiceRandomPrompt = true
        existing.voiceRandomContext = "wakeWeather"
        existing.voiceWeatherCountry = "KR"
        existing.voiceWeatherCity = "서울"
        existing.voiceFortuneGender = "female"
        existing.voiceFortuneBirthDate = "1990-01-01"
        existing.voiceFortuneBirthTime = "07:00"
        existing.voiceLanguage = "ko"
        existing.voiceListenerTitle = "우리 딸"
        existing.dynamicVoicePreparedForFireAtMillis = existing.fireAtMillis
        existing.snoozeEnabled = false

        // 매퍼가 만들어 낸 것처럼 기본값만 든 mapped.
        var mapped = makeLocalOwned(remoteID: "remote")
        mapped.voiceRandomPrompt = false
        mapped.snoozeEnabled = true

        let merged = RemoteAlarmPullSync.merge(existing: existing, mapped: mapped)

        XCTAssertTrue(merged.voiceRandomPrompt, "동적 문구 알람이 고정 문구로 바뀌면 안 된다")
        XCTAssertEqual(merged.voiceRandomContext, "wakeWeather")
        XCTAssertEqual(merged.voiceWeatherCountry, "KR")
        XCTAssertEqual(merged.voiceWeatherCity, "서울")
        XCTAssertEqual(merged.voiceFortuneGender, "female")
        XCTAssertEqual(merged.voiceFortuneBirthDate, "1990-01-01")
        XCTAssertEqual(merged.voiceFortuneBirthTime, "07:00")
        XCTAssertEqual(merged.voiceLanguage, "ko")
        XCTAssertEqual(merged.voiceListenerTitle, "우리 딸")
        XCTAssertEqual(
            merged.dynamicVoicePreparedForFireAtMillis, existing.fireAtMillis,
            "표식을 잃으면 다음 주기에 다시 합성해 목소리 생성 한도를 깎는다"
        )
        XCTAssertFalse(merged.snoozeEnabled, "서버는 snoozeEnabled 를 표현하지 못한다")
    }

    /// 로컬 녹음을 쓰는 알람은 `localAudioUri` 가 유일한 음원 경로다. 매퍼는 이걸 nil 로
    /// 만들어 내므로, 이번 회차에 내려받은 것이 없으면 갖고 있던 것을 지켜야 한다.
    func test_merge_keepsLocalAudioWhenRemoteBroughtNone() {
        var existing = makeLocalOwned(remoteID: "remote")
        existing.localAudioUri = "my-recording.m4a"
        let mapped = makeLocalOwned(remoteID: "remote")   // localAudioUri == nil

        XCTAssertEqual(
            RemoteAlarmPullSync.merge(existing: existing, mapped: mapped).localAudioUri,
            "my-recording.m4a"
        )
    }

    /// 반대로 이번 회차에 새로 받은 경로가 있으면 그쪽이 이긴다.
    func test_merge_prefersFreshlyDownloadedAudio() {
        var existing = makeLocalOwned(remoteID: "remote")
        existing.localAudioUri = "old.m4a"
        var mapped = makeLocalOwned(remoteID: "remote")
        mapped.localAudioUri = "new.m4a"

        XCTAssertEqual(
            RemoteAlarmPullSync.merge(existing: existing, mapped: mapped).localAudioUri,
            "new.m4a"
        )
    }

    private func makeLocalOwned(remoteID: String?) -> LocalAlarmRecord {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        return LocalAlarmRecord(
            id: UUID().uuidString,
            label: "owned",
            hour: 7,
            minute: 30,
            fireAtMillis: now + 60_000,
            remoteAlarmId: remoteID,
            lastSyncedAtMillis: now,
            syncState: AlarmSyncState.synced.rawValue,
            origin: AlarmOrigin.localOwned.rawValue,
            createdAtMillis: now,
            updatedAtMillis: now
        )
    }

    private func makeReceivedRemote(remoteID: String) -> LocalAlarmRecord {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        return LocalAlarmRecord(
            id: UUID().uuidString,
            label: "received",
            hour: 7,
            minute: 30,
            fireAtMillis: now + 60_000,
            remoteAlarmId: remoteID,
            lastSyncedAtMillis: now,
            syncState: AlarmSyncState.synced.rawValue,
            origin: AlarmOrigin.receivedRemote.rawValue,
            createdAtMillis: now,
            updatedAtMillis: now
        )
    }

    private func makeRemote(targetUserID: String?, senderUserID: String?) -> RemoteAlarm {
        RemoteAlarm(
            id: "remote",
            time: "07:30",
            repeatDays: [1, 2, 3, 4, 5],
            isActive: true,
            snoozeMinutes: 5,
            mode: "tts",
            vibrationPattern: "default",
            wakeMode: "sound_then_voice",
            voiceProfileId: "vp",
            messageId: "m1",
            messageText: "msg",
            category: nil,
            messageAudioUrl: "https://example.com/audio.m4a",
            targetUserId: targetUserID,
            senderUserId: senderUserID,
            senderName: "Other",
            senderEmail: nil,
            isFamilyAlarm: false,
            isReceivedFamilyAlarm: false
        )
    }
}
