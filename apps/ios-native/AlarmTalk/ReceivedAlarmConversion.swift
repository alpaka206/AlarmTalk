import Foundation

// MARK: - 받은 알람을 내 알람으로
//
// 커플·가족 이용권과 함께 **받은 알람**이 사라졌다(`docs/spec/plan-gates.md` 「커플·가족 이용권 — 폐지」).
// 기기에 남은 받은 알람은 지우지 않고 **내 알람으로 바꾼다** — 사용자가 기대고 자는 시각은 남기고, 회수할 길이
// 없어진 보낸 사람의 목소리·이름은 걷어낸다. 목소리는 **내 목소리가 있으면 그것, 없으면 기본 목소리(미나)** 다
// (`docs/spec/billing-lifecycle.md` 「목소리를 못 쓰게 되면」).
//
// 두 단계로 나눈다:
//  1. **즉시 변환**(`ReceivedAlarmConversion`) — 저장소가 디스크를 읽은 직후 한 번(`LocalAlarmStore`). 네트워크가
//     필요 없다. 미나의 오디오 없는 기본 목소리 알람이 되어, 울릴 때 그 목소리의 내장 인사말이 나간다
//     (`AlarmSoundResolver.plan` 의 1b 갈래).
//  2. **내 목소리로 승격**(`ReceivedAlarmPromotion`) — 목소리 목록을 서버에서 새로 받은 뒤(접근권 정리와 같은
//     자리), 아직 1단계 모양 그대로인 행만 내 클론 + 기본 인사말로 바꾼다.
//
// 안드로이드는 Room 27→28 마이그레이션이 1단계를, `data/FormerReceivedAlarms.kt` 가 2단계를 같은 규칙으로 한다 —
// 한쪽만 고치지 말 것.

enum ReceivedAlarmConversion {
    /// 옛 받은 알람의 `origin` 저장값. 열거형(`AlarmOrigin`)에서는 지웠다 — 이 변환만 문자열로 본다.
    static let legacyReceivedOrigin = "received_remote"

    /// 보낸 사람 오디오의 캐시 키 접두 — 옛 동기화가 `remote-message-<messageId>` 로 받아 두었다.
    static let senderAudioKeyPrefix = "remote-message-"

    /// 바꾼 행의 예약을 **다시 걸게 하는** 지문. 실제 지문(`AlarmSoundPlan.fingerprint` — `voice:`·`sound:`·
    /// `default`)과 겹치지 않는다.
    ///
    /// ⚠ 지문만 믿으면 안 된다: 변환 전 예약은 보낸 사람 목소리와 **이름이 든 제목**을 쥐고 있는데, 재생 방식이
    /// '알람' 인 행은 바꾼 뒤에도 소리 지문이 같아 리컨사일러가 다시 걸지 않는다 — 잠금 화면에 보낸 사람 이름이
    /// 남는다. 리컨사일러는 **새로 건 뒤 옛것을 푼다**(무예약 창이 없다).
    static let staleScheduleFingerprint = "!received-alarm-converted"

    struct Outcome {
        /// 바꾼 뒤의 전체 목록.
        var alarms: [LocalAlarmRecord]
        /// 바꾼 행(바뀐 뒤 모양).
        var converted: [LocalAlarmRecord]
        /// 바꾼 뒤 **아무 행도 가리키지 않는** 보낸 사람 오디오 키 — 다른 알람이 같은 파일을 쓰면 남긴다.
        var releasedSenderAudioKeys: Set<String>
    }

    static func isLegacyReceived(_ record: LocalAlarmRecord) -> Bool {
        record.origin == legacyReceivedOrigin
    }

    /// 목록의 옛 받은 알람을 모두 내 알람으로 바꾼다(순수). 받은 알람이 없으면 목록을 그대로 돌려준다.
    static func convert(_ alarms: [LocalAlarmRecord], nowMillis: Int64) -> Outcome {
        var converted: [LocalAlarmRecord] = []
        var released = Set<String>()
        let next = alarms.map { record -> LocalAlarmRecord in
            guard isLegacyReceived(record) else { return record }
            released.formUnion(referencedCacheKeys(of: record).filter { $0.hasPrefix(senderAudioKeyPrefix) })
            let own = asOwnAlarm(record, nowMillis: nowMillis)
            converted.append(own)
            return own
        }
        let stillReferenced = Set(next.flatMap(referencedCacheKeys(of:)))
        return Outcome(
            alarms: next,
            converted: converted,
            releasedSenderAudioKeys: released.subtracting(stillReferenced)
        )
    }

    /// 받은 알람 한 행을 **내 알람**으로 바꾼다(순수).
    ///
    /// 남기는 것은 받은 사람이 기대는 값이다 — 시각·요일·공휴일 끄기·켜짐·다시 울림·진동·알람음·음량·목소리 반복·
    /// 소유자. 재생 방식은 둔 값 그대로다(옛 버그의 잠금 표시면 그 원래 값) — '알람' 모드로 둔 행은 목소리만 바뀌고
    /// 계속 알람음으로 운다.
    static func asOwnAlarm(_ record: LocalAlarmRecord, nowMillis: Int64) -> LocalAlarmRecord {
        var next = record
        next.playMode = AlarmPlayMode.decode(record.preLockPlayMode?.nilIfBlank ?? record.playMode).rawValue
        next.preLockPlayMode = nil
        next.preLockVoice = nil
        // 목소리는 미나 — 보낸 사람이 고른 문구·테마·클립은 받은 쪽이 다시 묶을 근거가 없어 모두 비운다.
        // 언제나 같은 모양이어야 2단계가 '사용자가 고치지 않은 행' 을 가린다(`ReceivedAlarmPromotion.isStillConverted`).
        next.voiceSource = VoiceSource.ttsProfile.rawValue
        next.voiceProfileId = substituteSystemVoiceID
        next.voiceListenerTitle = nil
        next.voiceText = nil
        next.voiceCategory = nil
        next.voiceLanguage = nil
        next.voiceRandomPrompt = false
        next.voiceRandomContext = nil
        next.voiceWeatherCountry = nil
        next.voiceWeatherCity = nil
        next.voiceFortuneGender = nil
        next.voiceFortuneBirthDate = nil
        next.voiceFortuneBirthTime = nil
        next.dynamicVoicePreparedForFireAtMillis = nil
        next.localAudioUri = nil
        next.audioCacheKey = nil
        next.rawAudioUri = nil
        next.ttsMessageId = nil
        next.bucketId = nil
        next.bucketClipKeys = nil
        next.bucketRotationIndex = nil
        next.contextVariantIndex = nil
        next.contextResolvedAtMillis = nil
        // 보낸 사람 이름이 든 라벨도 걷어낸다.
        next.label = LocalAlarmRecord.storedDefaultLabel
        // 서버의 받은 알람 행과는 끊는다 — 아직 서버에 없는 새 내 알람이라 다음 동기화가 올린다.
        next.remoteAlarmId = nil
        next.lastSyncedAtMillis = nil
        next.origin = AlarmOrigin.localOwned.rawValue
        next.syncState = AlarmSyncState.localOnly.rawValue
        next.updatedAtMillis = nowMillis
        if next.alarmKitID != nil { next.scheduledSoundFingerprint = staleScheduleFingerprint }
        return next
    }

    /// 변환 뒤 정리 — 보낸 사람 오디오의 **캐시 원본**을 지우고, 2단계가 볼 행을 계정별로 적는다. 행을 디스크에 앉힌
    /// **뒤에** 부른다(`LocalAlarmStore`).
    ///
    /// `Library/Sounds` 의 **예약 사본**은 여기서 바로 지우지 않는다 — 바꾼 알람이 새 소리로 다시 걸리기 전에는 옛
    /// AlarmKit 예약이 그 파일을 가리킨다(`releaseStagedSenderAudioIfRearmed`).
    static func finish(
        _ outcome: Outcome,
        promotions: ReceivedAlarmPromotionStore = ReceivedAlarmPromotionStore(),
        stagedCleanup: StagedSenderAudioStore = StagedSenderAudioStore(),
        audioCache: AudioCacheStore = .shared,
        clearStaged: (String) -> Void = { AlarmSoundStaging.clearStagedSoundFiles(forKey: $0) }
    ) {
        for key in outcome.releasedSenderAudioKeys {
            try? audioCache.deleteCachedAudio(cacheKey: key)
        }
        stagedCleanup.add(outcome.releasedSenderAudioKeys)
        releaseStagedSenderAudioIfRearmed(alarms: outcome.alarms, pending: stagedCleanup, clearStaged: clearStaged)
        let byOwner = Dictionary(grouping: outcome.converted, by: { $0.ownerUserId?.nilIfBlank })
        for (owner, rows) in byOwner {
            promotions.add(Set(rows.map(\.id)), ownerUserID: owner)
        }
    }

    /// 보낸 사람 오디오의 **예약 사본**을 지운다 — 바꾼 알람이 **옛 예약을 더 쥐고 있지 않을 때만**
    /// (`staleScheduleFingerprint` 를 든 예약이 하나도 없을 때).
    ///
    /// 바꾼 알람은 시작 과정의 리컨사일(동기화·날씨 뒤)에서야 새 소리로 다시 걸린다. 변환하자마자 사본을 지우면 그
    /// 사이에 옛 예약이 울리거나 앱이 끝났을 때 그 예약이 없는 파일을 가리킨다(Codex #931). 리컨사일러는 새로 건 **뒤에**
    /// 옛 핸들을 풀므로, 표식을 든 예약이 사라졌다는 것은 다시 걸렸거나(또는 끄거나 지워) 그 파일을 쓰는 예약이 없다는
    /// 뜻이다. 리컨사일러가 회차를 마칠 때마다 부른다(`AlarmScheduleReconciler.reconcile`).
    static func releaseStagedSenderAudioIfRearmed(
        alarms: [LocalAlarmRecord],
        pending: StagedSenderAudioStore = StagedSenderAudioStore(),
        clearStaged: (String) -> Void = { AlarmSoundStaging.clearStagedSoundFiles(forKey: $0) }
    ) {
        let keys = pending.keys
        guard !keys.isEmpty else { return }
        guard !alarms.contains(where: { $0.alarmKitID != nil && $0.scheduledSoundFingerprint == staleScheduleFingerprint })
        else { return }
        for key in keys.sorted() { clearStaged(key) }
        pending.clear()
    }

    /// 이 행이 붙든 오디오 키 — 대표 클립, 클립 세트, 무료 잠금 보관본.
    private static func referencedCacheKeys(of record: LocalAlarmRecord) -> [String] {
        ([record.audioCacheKey?.nilIfBlank].compactMap { $0 })
            + (record.bucketClipKeys ?? []).compactMap(\.nilIfBlank)
            + (record.preLockVoice?.referencedCacheKeys ?? []).compactMap(\.nilIfBlank)
    }
}

// MARK: - 예약 사본 정리 대기

/// 1단계가 놓은 보낸 사람 오디오 키 — 그 **예약 사본**(`Library/Sounds`)을 지울 차례를 기다린다
/// (`ReceivedAlarmConversion.releaseStagedSenderAudioIfRearmed`). 앱이 그 사이 끝나도 다음 실행의 리컨사일이 이어서
/// 지우도록 `UserDefaults` 에 둔다.
struct StagedSenderAudioStore {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    private static let key = "received_alarm_staged_sender_audio\(TestIsolation.storageSuffix)"

    var keys: Set<String> {
        Set(defaults.stringArray(forKey: Self.key) ?? [])
    }

    func add(_ keys: Set<String>) {
        guard !keys.isEmpty else { return }
        defaults.set(self.keys.union(keys).sorted(), forKey: Self.key)
    }

    func clear() {
        defaults.removeObject(forKey: Self.key)
    }
}

// MARK: - 2단계 기록

/// 1단계에서 바꾼 알람 id 를 **계정별로** 남긴다. 2단계가 끝을 내면(승격·미나 확정) 지운다. 사용자가 그 알람을
/// 고치거나 지우면(`LocalAlarmStore`), 명시적 로그아웃·탈퇴면(`AuthViewModel.clearAccountPreferences`) 함께 지운다.
///
/// 알람 행에 필드를 더하지 않으려고 `UserDefaults` 에 둔다(안드로이드는 SharedPreferences).
struct ReceivedAlarmPromotionStore {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    private static let keyPrefix = "received_alarm_promotion\(TestIsolation.storageSuffix)_"
    /// 소유자가 안 적힌 옛 행 — 지금 계정 것으로 본다(저장소의 다른 경로와 같은 관용).
    private static let unownedSlot = "unowned"

    func add(_ ids: Set<String>, ownerUserID: String?) {
        guard !ids.isEmpty else { return }
        let key = Self.key(ownerUserID)
        write(Set(defaults.stringArray(forKey: key) ?? []).union(ids), key: key)
    }

    /// 이 계정이 2단계로 볼 알람 — 자기 것과 소유자 미기록 행.
    func pendingIDs(for userID: String) -> Set<String> {
        Set(defaults.stringArray(forKey: Self.key(userID)) ?? [])
            .union(defaults.stringArray(forKey: Self.key(nil)) ?? [])
    }

    /// 끝낸 알람을 지운다 — 그 계정 칸과 소유자 미기록 칸 모두에서.
    func remove(_ ids: Set<String>, ownerUserID: String?) {
        guard !ids.isEmpty else { return }
        for key in Set([Self.key(ownerUserID), Self.key(nil)]) {
            let current = Set(defaults.stringArray(forKey: key) ?? [])
            guard !current.isDisjoint(with: ids) else { continue }
            write(current.subtracting(ids), key: key)
        }
    }

    /// 계정을 떠날 때. 소유자 미기록 행은 그 계정 것으로 새겨지므로(`claimUnownedAlarms`) 함께 지운다.
    func clear(userID: String?) {
        defaults.removeObject(forKey: Self.key(userID))
        defaults.removeObject(forKey: Self.key(nil))
    }

    private func write(_ ids: Set<String>, key: String) {
        if ids.isEmpty {
            defaults.removeObject(forKey: key)
        } else {
            defaults.set(ids.sorted(), forKey: key)
        }
    }

    private static func key(_ userID: String?) -> String {
        keyPrefix + (userID?.nilIfBlank ?? unownedSlot)
    }
}

// MARK: - 2단계: 내 목소리로 승격

enum ReceivedAlarmPromotion {
    /// 승격에 묶을 내 클론의 기본 인사말 클립 한 벌 — 세트가 완전하고 **전부 캐시에 있을 때만** 만든다.
    struct CloneGreeting: Equatable {
        let voiceID: String
        let language: String
        let keys: [String]
        let messageIDs: [String]
        let texts: [String]
        let firstRawAudioURL: String?
        let firstLocalFileName: String?
    }

    enum Decision: Equatable {
        /// 내 클론 + 기본 인사말로 바꾸고 기록을 지운다.
        case promote(CloneGreeting)
        /// 아직 정할 수 없다(이용권 미확정·클립 미완·정리 중) — 미나 그대로 두고 기록을 남겨 다음 새로고침에 다시 본다.
        case hold
        /// 쓸 수 있는 내 클론이 없거나 '알람' 모드다 — 미나로 확정하고 기록을 지운다.
        case keepMina
        /// 행이 없어졌거나 사용자가 고쳤다 — 손대지 않고 기록을 지운다.
        case untouched
    }

    /// 기본 인사말의 테마 id — 클론의 '기본 인사말' 은 이 테마의 클립이다.
    static var greetingBucket: String { RandomPromptContext.preset.bucketCategory }

    /// 아직 **1단계 모양 그대로인가**(사용자가 고치지 않았는가) — `ReceivedAlarmConversion.asOwnAlarm` 이 만든
    /// 목소리 칸과 같은지 본다. 미나의 오디오 없는 알람이고 문구·테마·클립·잠금 표시가 하나도 없다. 편집기로 저장한
    /// 행은 이 모양이 깨진다(목소리 모드는 문구를 골라야 저장되고, '알람' 모드는 테마를 남긴다). 시각·켜짐처럼
    /// 목소리와 무관한 칸은 보지 않는다.
    static func isStillConverted(_ record: LocalAlarmRecord) -> Bool {
        let blankFields: [String?] = [
            record.localAudioUri, record.audioCacheKey, record.rawAudioUri, record.ttsMessageId,
            record.voiceText, record.voiceCategory, record.voiceListenerTitle, record.voiceRandomContext,
            record.bucketId, record.preLockPlayMode,
        ]
        return record.voiceSource == VoiceSource.ttsProfile.rawValue
            && record.voiceProfileId == substituteSystemVoiceID
            && !record.voiceRandomPrompt
            && blankFields.allSatisfy { $0?.nilIfBlank == nil }
            && (record.bucketClipKeys ?? []).isEmpty
            && record.preLockVoice == nil
    }

    /// 쓸 수 있는 내 클론 — 등록을 마쳤고(초안 아님) 준비가 끝난 것. 기본 목소리는 빠진다.
    static func readyClones(_ profiles: [VoiceProfile]) -> [VoiceProfile] {
        profiles.filter { !isSystemVoice($0) && $0.isDraft != true && ($0.status == nil || $0.status == "ready") }
    }

    /// 클론이 여럿이면 **마지막에 쓴 목소리**가 그중 하나일 때 그것, 아니면 **가장 최근에 만든** 것.
    static func pickClone(_ clones: [VoiceProfile], lastUsedVoiceID: String?) -> VoiceProfile? {
        if let last = lastUsedVoiceID?.nilIfBlank, let match = clones.first(where: { $0.id == last }) {
            return match
        }
        func createdOrder(_ profile: VoiceProfile) -> (Date, String, String) {
            let raw = profile.createdAt ?? ""
            return (PaidVoiceGate.parseTimestamp(raw) ?? .distantPast, raw, profile.id)
        }
        return clones.max { createdOrder($0) < createdOrder($1) }
    }

    /// 그 클론의 기본 인사말 클립 한 벌. 언어는 편집기와 같다(`AlarmEditorSheet.bucketClipLanguage`) — 기기
    /// 언어가 있으면 그것, 없으면 있는 것 중 하나. 세트가 모자라거나 하나라도 캐시에 없으면 nil 이다 — 바꾸는
    /// 순간 다 묶을 수 없으면 바꾸지 않는다(절대 조용히 울리지 않는다).
    /// 서버가 세트 크기(`expectedVariants`)를 안 알려 주면 완전한지 단정할 수 없어 nil 이다 — 편집기 관문
    /// (`AlarmEditorSheet.hasCompleteBucket`)과 같다.
    static func greeting(
        cloneID: String,
        manifest: [StockClip],
        expectedVariants: ExpectedVariantCounts?,
        deviceLanguage: String,
        cachedURL: (String) -> URL?
    ) -> CloneGreeting? {
        guard expectedVariants != nil else { return nil }
        let languages = Set(
            manifest
                .filter { $0.voiceProfileId == cloneID && $0.category == greetingBucket }
                .map { $0.language ?? "ko" }
        )
        guard let language = languages.contains(deviceLanguage) ? deviceLanguage : languages.sorted().first,
              let clips = DefaultVoiceSubstitute.completeClips(
                  manifest, voiceID: cloneID, bucket: greetingBucket, language: language,
                  expectedVariants: expectedVariants
              ) else { return nil }
        let keys = clips.map { AudioCacheStore.stockCacheKey(messageId: $0.messageId) }
        let urls = keys.map(cachedURL)
        guard urls.allSatisfy({ $0 != nil }) else { return nil }
        return CloneGreeting(
            voiceID: cloneID,
            language: language,
            keys: keys,
            messageIDs: clips.map(\.messageId),
            texts: clips.map(\.text),
            firstRawAudioURL: clips[0].audioUrl,
            firstLocalFileName: urls[0]?.lastPathComponent
        )
    }

    /// 2단계 판정(순수). 순서가 규칙이다(안드로이드 `data/FormerReceivedAlarms.kt` 와 같은 순서).
    /// - Parameter entitlementConfirmed: 이용권 판정이 이번 실행에 서버로 확인됐는가. 저장된 무료 판정만으로는
    ///   **되돌릴 수 없는 미나 확정**을 하지 않는다 — 그 사이 결제했을 수 있다.
    static func decide(
        record: LocalAlarmRecord?,
        access: PaidVoiceAccess,
        entitlementConfirmed: Bool,
        profiles: [VoiceProfile],
        settlingProfileIDs: Set<String>,
        lastUsedVoiceID: String?,
        manifest: [StockClip]?,
        expectedVariants: ExpectedVariantCounts?,
        deviceLanguage: String,
        cachedURL: (String) -> URL?
    ) -> Decision {
        guard let record, isStillConverted(record) else { return .untouched }
        // '알람' 모드는 목소리를 쓰지 않는다 — 편집기도 이 모드에서는 목소리 문구를 저장하지 않는다.
        if record.playModeEnum == .alarmOnly { return .keepMina }
        // 클론이 없으면 이용권과 상관없이 미나다 — 판정을 기다릴 것이 없다.
        guard let clone = pickClone(readyClones(profiles), lastUsedVoiceID: lastUsedVoiceID) else {
            return .keepMina
        }
        switch access {
        case .unknown:
            return .hold
        case .notEntitled:
            return entitlementConfirmed ? .keepMina : .hold
        case .entitled:
            break
        }
        // 제자리 교체를 정리하는 중인 목소리는 아직 고를 수 없다(`VoiceStudioViewModel.isReplacementSettling`).
        guard !settlingProfileIDs.contains(clone.id), let manifest,
              let greeting = greeting(
                  cloneID: clone.id, manifest: manifest, expectedVariants: expectedVariants,
                  deviceLanguage: deviceLanguage, cachedURL: cachedURL
              ) else { return .hold }
        return .promote(greeting)
    }

    /// 승격한 행(순수) — 편집기에서 그 클론과 '기본 인사말' 을 골라 저장한 것과 같은 모양이다
    /// (`AlarmEditorSheet.saveFlow` 의 테마 클립 갈래). 동기 상태는 호출부가 정한다.
    static func promoted(_ record: LocalAlarmRecord, greeting: CloneGreeting, nowMillis: Int64) -> LocalAlarmRecord {
        var next = record
        next.voiceSource = VoiceSource.ttsProfile.rawValue
        next.voiceProfileId = greeting.voiceID
        next.voiceListenerTitle = nil
        next.voiceText = greeting.texts.first
        next.voiceCategory = "custom"
        next.voiceLanguage = greeting.language
        next.voiceRandomPrompt = false
        next.voiceRandomContext = RandomPromptContext.preset.rawValue
        next.dynamicVoicePreparedForFireAtMillis = nil
        next.localAudioUri = greeting.firstLocalFileName
        next.audioCacheKey = greeting.keys.first
        next.rawAudioUri = greeting.firstRawAudioURL
        next.ttsMessageId = greeting.messageIDs.first
        next.bucketId = greetingBucket
        next.bucketClipKeys = greeting.keys
        next.bucketRotationIndex = 0
        next.contextVariantIndex = nil
        next.contextResolvedAtMillis = nil
        next.voiceRepeat = true
        next.updatedAtMillis = nowMillis
        return next
    }
}

extension VoiceStudioViewModel {
    /// **1단계에서 미나로 바꾼 옛 받은 알람을 내 클론 + 기본 인사말로 승격한다**(한 번, 재시도 가능).
    ///
    /// 목소리 목록을 서버에서 새로 받은 직후(`onAuthoritativeRefresh`) 접근권 정리와 같은 조건에서 부른다 —
    /// 실패한 조회의 목록으로는 판단하지 않는다(`accessibleVoicesAreAuthoritative`).
    /// - Parameter entitlementConfirmed: 이용권 판정이 이번 실행에 서버로 확인됐는가
    ///   (`SocialFeatureViewModel.entitlementSnapshotComplete`).
    /// - Returns: 승격한 알람 수 — 0 보다 크면 호출부가 예약을 맞춘다(AlarmKit 은 예약할 때 소리를 고정한다).
    @discardableResult
    func promoteConvertedReceivedAlarms(
        alarmStore: LocalAlarmStore,
        ownerUserId: String?,
        entitlementConfirmed: Bool,
        promotions: ReceivedAlarmPromotionStore = ReceivedAlarmPromotionStore(),
        audioCache: AudioCacheStore = .shared
    ) -> Int {
        guard accessibleVoicesAreAuthoritative, alarmStore.hasLoadedFromDisk,
              let owner = ownerUserId?.nilIfBlank else { return 0 }
        let pending = promotions.pendingIDs(for: owner)
        guard !pending.isEmpty else { return 0 }
        let access = PaidVoiceGate.resolve(snapshot: AccessSnapshotStore().read(userID: owner))
        let manifest = StockClipManifestStore.load(ownerUserID: owner)
        let lastUsed = DefaultVoicePreferenceStore().lastUsedVoiceId(userID: owner)
        let deviceLanguage = Self.appVoiceLanguage()
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var settled: Set<String> = []
        var promotedIDs: Set<String> = []
        var promoted = 0
        for id in pending.sorted() {
            let record = alarmStore.record(id: id)
            // 다른 계정이 새긴 행은 그 계정의 회차가 본다.
            if let rowOwner = record?.ownerUserId?.nilIfBlank, rowOwner != owner { continue }
            let decision = ReceivedAlarmPromotion.decide(
                record: record,
                access: access,
                entitlementConfirmed: entitlementConfirmed,
                profiles: authoritativeProfiles,
                settlingProfileIDs: replacementSuppressedProfileIDs,
                lastUsedVoiceID: lastUsed,
                manifest: manifest?.clips,
                expectedVariants: manifest?.expectedVariants,
                deviceLanguage: deviceLanguage,
                cachedURL: { audioCache.cachedURL(for: $0) }
            )
            switch decision {
            case .promote(let greeting):
                guard let record else { continue }
                var next = ReceivedAlarmPromotion.promoted(record, greeting: greeting, nowMillis: now)
                next.syncState = alarmStore.nextLocalSyncState(for: next).rawValue
                _ = alarmStore.upsert(next)
                promoted += 1
                promotedIDs.insert(id)
                settled.insert(id)
            case .keepMina, .untouched:
                settled.insert(id)
            case .hold:
                continue
            }
        }
        // ⚠ **올린 행이 디스크에 남은 뒤에야 기록을 지운다**(Codex #932). `upsert` 의 저장은 비동기라, 백그라운드
        // 실행이 그 전에 끝나면 다음 실행은 미나 행을 다시 읽는데 기록만 사라져 다시 올릴 길이 없다. 못 앉혔으면
        // 기록을 남긴다 — 다음 회차는 메모리의 올린 행을 '고친 행' 으로 읽어 그때 지운다.
        if !promotedIDs.isEmpty, !alarmStore.saveNow() {
            settled.subtract(promotedIDs)
        }
        promotions.remove(settled, ownerUserID: owner)
        if promoted > 0 { needsScheduleReconcile = true }
        return promoted
    }
}
