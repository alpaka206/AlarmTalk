import Foundation

// MARK: - 기본 목소리 대체
//
// 유료 목소리를 못 쓰게 된 알람(기간 한정 개인 플랜 종료 · 무료 전환 · 권한 없음)은 **기본(시스템)
// 목소리로 운다** — 알람음이 아니다. 규칙의 유일 출처는 `docs/spec/billing-lifecycle.md`
// 「목소리를 못 쓰게 되면 — 기본 목소리로 울고, 절대 조용하지 않다」다.
//
// 안드로이드 `data/DefaultVoiceFallback.kt` 미러다(`pickDefaultSystemVoiceId` ·
// `defaultVoiceBucketFor` · `lockedToDefaultVoice` · `restoredFromLock` · `finalizedLock`).
// 한쪽만 고치지 말 것.
//
// iOS 는 울릴 때 앱 코드가 돌지 않으므로(AlarmKit 이 예약 때 받은 소리를 그대로 튼다) 같은 대체를
// **예약할 때** 한다 — `AlarmKitViewModel.effectiveRecordForScheduling`. AlarmKit 은 넘긴 소리가
// 없으면 시스템 기본음을 울리므로 iOS 에는 무음 갈래가 애초에 없다.

/// 잠그기 전의 **유료 목소리 필드** — 무료 잠금 보관본(`LocalAlarmRecord.preLockVoice`)의 모양.
/// 안드로이드 `LockedPaidVoice` 미러. 재생 방식은 여기 없다 — 예전처럼 `preLockPlayMode` 에 둔다.
struct LockedPaidVoice: Codable, Equatable, Hashable {
    var voiceSource: String?
    var voiceProfileId: String?
    var voiceListenerTitle: String?
    var voiceText: String?
    var voiceCategory: String?
    var voiceLanguage: String?
    var voiceRandomPrompt: Bool?
    var voiceRandomContext: String?
    var localAudioUri: String?
    var audioCacheKey: String?
    var rawAudioUri: String?
    var ttsMessageId: String?
    var bucketId: String?
    var bucketClipKeys: [String]?
    var bucketRotationIndex: Int?
    var contextVariantIndex: Int?
    var contextResolvedAtMillis: Int64?
    var dynamicVoicePreparedForFireAtMillis: Int64?

    init(of record: LocalAlarmRecord) {
        voiceSource = record.voiceSource
        voiceProfileId = record.voiceProfileId
        voiceListenerTitle = record.voiceListenerTitle
        voiceText = record.voiceText
        voiceCategory = record.voiceCategory
        voiceLanguage = record.voiceLanguage
        voiceRandomPrompt = record.voiceRandomPrompt
        voiceRandomContext = record.voiceRandomContext
        localAudioUri = record.localAudioUri
        audioCacheKey = record.audioCacheKey
        rawAudioUri = record.rawAudioUri
        ttsMessageId = record.ttsMessageId
        bucketId = record.bucketId
        bucketClipKeys = record.bucketClipKeys
        bucketRotationIndex = record.bucketRotationIndex
        contextVariantIndex = record.contextVariantIndex
        contextResolvedAtMillis = record.contextResolvedAtMillis
        dynamicVoicePreparedForFireAtMillis = record.dynamicVoicePreparedForFireAtMillis
    }

    /// 이 보관본이 붙들고 있는 캐시 키 — 캐시 정리가 지우지 않게 참조로 센다.
    var referencedCacheKeys: [String] {
        [audioCacheKey?.nilIfBlank].compactMap { $0 } + (bucketClipKeys ?? [])
    }
}

extension LocalAlarmRecord {
    /// 새 모양(기본 목소리로 고쳐 쓰고 원래 목소리를 보관)으로 잠긴 행인가.
    var hasLockedPaidVoice: Bool { preLockVoice != nil }
}

enum DefaultVoiceSubstitute {

    /// 잠금·대체가 행에 묶을 클립 한 벌 — (목소리 · 테마 · 언어)의 클립이 **전부** 캐시에 있을 때만.
    struct Binding: Equatable {
        let bucket: String
        let language: String
        let keys: [String]
        let messageIDs: [String]
        let texts: [String]
        let firstRawAudioURL: String?
        let firstLocalFileName: String?
    }

    /// 대체할 **기본 목소리**. 안드로이드 `pickDefaultSystemVoiceId` 와 같은 순서다:
    /// 알람이 이미 기본 목소리면 그 목소리 → 마지막에 쓴 목소리가 기본 목소리면 그것 → 목록 첫 값.
    static func pickVoiceID(alarmVoiceID: String?, lastUsedVoiceID: String?) -> String {
        if let alarmVoiceID, isSystemVoiceId(alarmVoiceID) { return alarmVoiceID }
        if let lastUsedVoiceID, isSystemVoiceId(lastUsedVoiceID) { return lastUsedVoiceID }
        return bundledSystemVoiceProfiles()[0].id
    }

    /// 기본 목소리로 틀 **무료 테마**. 안드로이드 `defaultVoiceBucketFor` 미러 — 테마가 붙어 있으면
    /// 그 테마(옛 이름 `love` → `cheer`), 없으면 문구 종류를 테마로 옮긴다. 기본 목소리에 그 종류의
    /// 클립이 없으면(기본 인사말 · 직접 입력) nil — 그때는 내장 인사말로 운다.
    static func bucket(bucketId: String?, voiceRandomContext: String?) -> String? {
        let fromBucket = bucketId?.nilIfBlank.map { $0 == "love" ? "cheer" : $0 }
        let candidate = fromBucket ?? RandomPromptContext.normalized(voiceRandomContext).bucketCategory
        return FreeBucket.order.contains { $0.rawValue == candidate } ? candidate : nil
    }

    /// (목소리 · 테마 · 언어)의 클립을 **variant 순으로 정렬·중복 제거**한다 — 편집기
    /// `AlarmEditorSheet.bucketClipKeys(forCategory:)` 와 같은 정렬.
    static func orderedClips(
        _ clips: [StockClip],
        voiceID: String,
        bucket: String,
        language: String
    ) -> [StockClip] {
        var seen = Set<Int>()
        return clips
            .filter { $0.voiceProfileId == voiceID && $0.category == bucket && ($0.language ?? "ko") == language }
            .enumerated()
            .sorted { ($0.element.variant ?? Int.max, $0.offset) < ($1.element.variant ?? Int.max, $1.offset) }
            .filter { seen.insert($0.element.variant ?? -($0.offset + 1)).inserted }
            .map(\.element)
    }

    /// (목소리 · 테마 · 언어)의 클립 — **세트가 완전할 때만**(variant 0..N-1 이 빠짐없이). 아니면 nil.
    /// 안드로이드 `completeDefaultVoiceClips` 미러.
    ///
    /// ⚠ **매니페스트에 온 것을 그대로 완전한 세트로 읽지 말 것**(Codex #820). 날씨·운세는 자리
    /// 번호가 곧 조건이라, 가운데 variant 하나가 빠진 목록을 순서대로 묶으면 뒤 자리가 밀려 **다른
    /// 조건의 문구**를 튼다. 편집기(`hasCompleteBucket`)·재바인더(`replacementIsComplete`)와 같이 서버의
    /// `expectedVariants` 로 N 을 정한다. 모르면(옛 서버) 받은 개수를 N 으로 보되 0 부터 빈틈없어야 한다.
    static func completeClips(
        _ clips: [StockClip],
        voiceID: String,
        bucket: String,
        language: String,
        expectedVariants: ExpectedVariantCounts?
    ) -> [StockClip]? {
        let ordered = orderedClips(clips, voiceID: voiceID, bucket: bucket, language: language)
        guard !ordered.isEmpty else { return nil }
        let expected = expectedVariants
            .flatMap { $0.count(category: bucket, isSystemVoice: isSystemVoiceId(voiceID)) }
            .flatMap { $0 > 0 ? $0 : nil }
            ?? ordered.count
        return ordered.map(\.variant) == Array(0..<expected).map(Optional.some) ? ordered : nil
    }

    /// 잠금·대체가 묶을 클립. ⚠ **세트가 모자라거나 하나라도 캐시에 없으면 nil 이다** — 날씨·운세는
    /// 자리 번호가 곧 조건이라, 빠진 클립을 건너뛰어 묶으면 뒤 자리가 밀려 **맑은 날에 우산 얘기**를
    /// 한다(`completeClips`). 네트워크는 부르지 않는다.
    static func binding(
        for record: LocalAlarmRecord,
        voiceID: String,
        manifest: [StockClip]?,
        expectedVariants: ExpectedVariantCounts?,
        languages: [String],
        cachedURL: (String) -> URL?
    ) -> Binding? {
        guard let bucket = bucket(bucketId: record.bucketId, voiceRandomContext: record.voiceRandomContext),
              let manifest else { return nil }
        for language in languages {
            guard let clips = completeClips(
                manifest, voiceID: voiceID, bucket: bucket, language: language, expectedVariants: expectedVariants
            ) else { continue }
            let keys = clips.map { AudioCacheStore.stockCacheKey(messageId: $0.messageId) }
            let urls = keys.map(cachedURL)
            guard urls.allSatisfy({ $0 != nil }) else { continue }
            return Binding(
                bucket: bucket,
                language: language,
                keys: keys,
                messageIDs: clips.map(\.messageId),
                texts: clips.map(\.text),
                firstRawAudioURL: clips[0].audioUrl,
                firstLocalFileName: urls[0]?.lastPathComponent
            )
        }
        return nil
    }

    /// 알람에 적힌 언어가 먼저, 그다음 기기 언어(선다운로드가 받는 언어).
    static func languages(for record: LocalAlarmRecord, deviceLanguage: String) -> [String] {
        var result: [String] = []
        if let language = record.voiceLanguage?.nilIfBlank {
            result.append(["en", "ja"].contains(language) ? language : "ko")
        }
        if !result.contains(deviceLanguage) { result.append(deviceLanguage) }
        return result
    }

    /// 유료 목소리 알람을 **기본 목소리 알람으로 잠근다**(순수 — 행을 쓰는 것은 호출부).
    /// 안드로이드 `lockedToDefaultVoice` 미러:
    /// - 재생 방식은 원래 값 그대로다(옛 모양이면 `preLockPlayMode` 의 값) — '그냥 기본 알람' 이 되지 않는다.
    /// - `binding` 이 있으면 편집기가 테마를 붙일 때와 같은 모양으로 묶고, 없으면 오디오 없는 기본
    ///   목소리 알람으로 둔다(예약 때 `AlarmSoundResolver` 가 그 목소리의 클립·내장 인사말을 싣는다).
    /// - ⚠ **오디오 없이 두어도 테마는 남긴다**(Codex #820, 안드로이드 `lockedToDefaultVoice` 와 같다).
    ///   비우면 편집기가 그 알람의 종류를 잃고(`applyPendingFreeBucketIfNeeded` 가 첫 테마를 붙인다)
    ///   시각만 고쳐 저장해도 문구가 바뀐다. 테마가 남아 있으면 저장할 때 그 테마의 클립을 받아 묶는다.
    ///   기본 인사말·직접 입력은 기본 목소리 테마가 없으니 비운다.
    /// - 원래 목소리 필드는 보관본에 담는다. 이미 있으면 **덮지 않는다**(다시 잠그면 원래 값을 잃는다).
    /// - 동기 상태는 건드리지 않는다 — 잠금은 로컬만 고친다.
    static func locked(
        _ record: LocalAlarmRecord,
        voiceID: String,
        binding: Binding?,
        nowMillis: Int64
    ) -> LocalAlarmRecord {
        var next = record
        let originalMode = record.preLockPlayMode?.nilIfBlank ?? record.playMode
        next.playMode = AlarmPlayMode.decode(originalMode).rawValue
        next.preLockPlayMode = originalMode
        next.preLockVoice = record.preLockVoice ?? LockedPaidVoice(of: record)
        next.voiceSource = VoiceSource.ttsProfile.rawValue
        next.voiceProfileId = voiceID
        // 호칭은 클론 문구에 녹아 있던 것이라 기본 목소리 클립과 무관하다.
        next.voiceListenerTitle = nil
        next.voiceRandomPrompt = false
        // 문구 종류는 그대로 둔다 — 편집기 요약이 고른 종류를 말한다.
        next.voiceRandomContext = record.voiceRandomContext
            ?? RandomPromptContext.forBucket(binding?.bucket ?? record.bucketId)?.rawValue
        next.updatedAtMillis = nowMillis
        guard let binding, !binding.keys.isEmpty else {
            // 직접 입력은 친 문구를 남긴다. 그 밖에는 클론이 읽던 문장이라 남기지 않는다.
            next.voiceText = record.usesCustomMessageVoice ? record.voiceText : nil
            next.localAudioUri = nil
            next.audioCacheKey = nil
            next.rawAudioUri = nil
            next.ttsMessageId = nil
            let theme = bucket(bucketId: record.bucketId, voiceRandomContext: record.voiceRandomContext)
            next.bucketId = theme
            next.bucketClipKeys = nil
            next.bucketRotationIndex = theme != nil && theme == record.bucketId ? record.bucketRotationIndex : nil
            return next
        }
        next.voiceText = binding.texts.first
        next.voiceLanguage = binding.language
        next.localAudioUri = binding.firstLocalFileName
        next.audioCacheKey = binding.keys[0]
        next.rawAudioUri = binding.firstRawAudioURL
        next.ttsMessageId = binding.messageIDs.first
        next.bucketId = binding.bucket
        next.bucketClipKeys = binding.keys
        // 같은 테마면 회전 자리를 이어 간다(날씨 조건 인덱스는 variant 축이 같아 그대로 쓴다).
        next.bucketRotationIndex = binding.bucket == record.bucketId ? record.bucketRotationIndex : 0
        return next
    }

    /// **이 저장이 무료 잠금을 이어받는가** — iOS 규칙: 목소리를 그대로 둔 저장(시각·이름만 고침)은
    /// 잠금을 잇고, 목소리·오디오·재생 방식을 바꾼 저장은 비운다(`docs/spec/billing-lifecycle.md`
    /// 「목소리를 못 쓰게 되면」). 편집기의 두 자리(`AlarmEditDraft.carryOverNonEditableFields` ·
    /// `AlarmEditorSheet` 저장 직전)가 이것 하나를 본다.
    ///
    /// ⚠ **오디오 없이 잠긴 행에 같은 테마의 클립을 채운 것은 편집이 아니다**(Codex #820). 테마를 남긴
    /// 잠금 행은 저장할 때 편집기가 그 테마의 기본 목소리 클립을 받아 묶으므로 `audioCacheKey` 가
    /// nil → 클립 키로 바뀐다. 그걸 '오디오를 바꿨다' 로 읽으면 시각만 고친 저장이 보관본을 버려
    /// 재결제해도 원래 목소리로 돌아가지 않는다. 테마가 바뀌었으면 사용자가 고친 것이다.
    static func saveKeepsLock(saved: LocalAlarmRecord, editing: LocalAlarmRecord) -> Bool {
        guard saved.voiceProfileId == editing.voiceProfileId, saved.playMode == editing.playMode else {
            return false
        }
        if saved.audioCacheKey == editing.audioCacheKey { return true }
        guard editing.audioCacheKey?.nilIfBlank == nil, let theme = editing.bucketId?.nilIfBlank else {
            return false
        }
        return saved.bucketId == theme
    }

    /// 잠금을 풀어 **원래 유료 목소리로 되돌린다**(순수). 보관본이 없는 옛 모양은 재생 방식만
    /// 되돌린다. 동기 상태는 호출부가 정한다(보관본을 되돌렸으면 올려야 한다 — 잠긴 동안의
    /// 켜기·끄기가 기본 목소리를 서버에 올렸을 수 있다). 안드로이드 `restoredFromLock` 미러.
    static func restored(_ record: LocalAlarmRecord, nowMillis: Int64) -> LocalAlarmRecord {
        var next = record
        next.playMode = record.preLockPlayMode?.nilIfBlank ?? record.playMode
        next.preLockPlayMode = nil
        next.preLockVoice = nil
        next.updatedAtMillis = nowMillis
        guard let snapshot = record.preLockVoice else { return next }
        next.voiceSource = snapshot.voiceSource ?? record.voiceSource
        next.voiceProfileId = snapshot.voiceProfileId
        next.voiceListenerTitle = snapshot.voiceListenerTitle
        next.voiceText = snapshot.voiceText
        next.voiceCategory = snapshot.voiceCategory
        next.voiceLanguage = snapshot.voiceLanguage
        next.voiceRandomPrompt = snapshot.voiceRandomPrompt ?? false
        next.voiceRandomContext = snapshot.voiceRandomContext
        next.localAudioUri = snapshot.localAudioUri
        next.audioCacheKey = snapshot.audioCacheKey
        next.rawAudioUri = snapshot.rawAudioUri
        next.ttsMessageId = snapshot.ttsMessageId
        next.bucketId = snapshot.bucketId
        next.bucketClipKeys = snapshot.bucketClipKeys
        next.bucketRotationIndex = snapshot.bucketRotationIndex
        next.contextVariantIndex = snapshot.contextVariantIndex
        next.contextResolvedAtMillis = snapshot.contextResolvedAtMillis
        next.dynamicVoicePreparedForFireAtMillis = snapshot.dynamicVoicePreparedForFireAtMillis
        return next
    }

    /// 잠금을 **확정**한다 — 원래 목소리가 지워졌다. 보관본과 표시를 버리고 기본 목소리 알람으로 남긴다.
    static func finalized(_ record: LocalAlarmRecord, nowMillis: Int64) -> LocalAlarmRecord {
        var next = record
        next.preLockPlayMode = nil
        next.preLockVoice = nil
        next.updatedAtMillis = nowMillis
        return next
    }

    /// **예약에 실을** 대체 행 — 저장하지 않는다. 목소리만 기본 목소리로 바꾸고 보관본·표시·시각은
    /// 원래 행 그대로 둔다(예약 지문이 원래 행과 같은 입력에서 계산되게).
    static func substitutedForScheduling(
        _ record: LocalAlarmRecord,
        voiceID: String,
        binding: Binding?
    ) -> LocalAlarmRecord {
        var next = locked(record, voiceID: voiceID, binding: binding, nowMillis: record.updatedAtMillis)
        next.preLockPlayMode = record.preLockPlayMode
        next.preLockVoice = record.preLockVoice
        return next
    }

    /// **오디오가 없는 기본 목소리 알람**이 울릴 소리 — 안드로이드 `DefaultVoiceClipSource.ringUri` 미러.
    ///
    ///  1. 알람의 테마로 그 목소리의 받아 둔 클립 — 알람에 적힌 자리(`BucketVariantResolver.variantIndex`).
    ///     날씨·운세는 세트가 완전할 때 그 자리만 쓴다(다른 자리는 다른 조건이다 — `completeClips`).
    ///     회전 테마는 받아 둔 아무 클립이나.
    ///  2. 그 목소리의 **내장 인사말** — 네트워크 없이 언제나 있다.
    ///
    /// 잠금이 테마 없이 묶은 행(기본 인사말·직접 입력 종류, 클립을 못 받아 둔 경우)이 이 갈래를 탄다.
    static func fallbackClip(
        for record: LocalAlarmRecord,
        manifest: [StockClip]?,
        expectedVariants: ExpectedVariantCounts?,
        deviceLanguage: String,
        cachedURL: (String) -> URL?,
        bundle: Bundle = .main
    ) -> (key: String, url: URL)? {
        let voiceID = record.voiceProfileId
        let languages = languages(for: record, deviceLanguage: deviceLanguage)
        if let voiceID, let manifest,
           let bucket = bucket(bucketId: record.bucketId, voiceRandomContext: record.voiceRandomContext) {
            let matching = FreeBucket.matchingBucketIDs.contains(bucket)
            for language in languages {
                // 날씨·운세는 자리가 곧 조건이라 **세트가 완전할 때만** 자리를 믿는다(`completeClips`) —
                // 모자라면 내장 인사말로 간다. 회전 테마는 어느 클립이든 같은 종류의 말이다.
                let clips = matching
                    ? (completeClips(manifest, voiceID: voiceID, bucket: bucket, language: language,
                                     expectedVariants: expectedVariants) ?? [])
                    : orderedClips(manifest, voiceID: voiceID, bucket: bucket, language: language)
                guard !clips.isEmpty else { continue }
                let keys = clips.map { AudioCacheStore.stockCacheKey(messageId: $0.messageId) }
                var probe = record
                probe.bucketId = bucket
                probe.bucketClipKeys = keys
                let preferred = BucketVariantResolver.variantIndex(for: probe)
                let order: [Int]
                if matching {
                    order = preferred.map { [$0] } ?? []
                } else if let preferred {
                    order = [preferred] + keys.indices.filter { $0 != preferred }
                } else {
                    order = Array(keys.indices)
                }
                for index in order {
                    if let url = cachedURL(keys[index]) { return (keys[index], url) }
                }
            }
        }
        guard let url = greetingURL(voiceID: voiceID, language: languages[0], bundle: bundle) else { return nil }
        return ("greeting-\(url.deletingPathExtension().lastPathComponent)", url)
    }

    /// 앱 번들에 실린 그 목소리의 **내장 인사말**(안드로이드 `res/raw/voice_greeting_*` 를 그대로
    /// 싣는다 — `project.yml`). 새 기본 목소리라 내장본이 없으면 목록 첫 목소리의 인사말.
    static func greetingURL(voiceID: String?, language: String, bundle: Bundle = .main) -> URL? {
        let candidates = [voiceID, bundledSystemVoiceProfiles()[0].id]
        for candidate in candidates {
            if let resource = bundledSystemGreetingResource(voiceProfileId: candidate, appLanguage: language),
               let url = bundle.url(forResource: resource, withExtension: "mp3") {
                return url
            }
        }
        return nil
    }
}
