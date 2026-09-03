import Foundation

/// **기기 언어를 바꾸면 이미 저장한 테마 알람도 그 언어로 말하게 한다.**
///
/// 테마(무료 버킷) 알람은 저장하는 순간 그때 언어의 클립 키 목록으로 **고정된다**
/// (`LocalAlarmRecord.bucketClipKeys`). 그래야 울릴 때 네트워크 없이도 순서대로 돌 수
/// 있다. 그런데 그 고정 때문에 시스템 언어를 한국어→영어로 바꿔도 **어제 만든 알람은
/// 계속 한국어로 울린다** — 앱 화면은 전부 영어인데 알람만 한국어라 어긋난다.
///
/// 그래서 앱이 뜰 때 한 번, 언어가 어긋난 테마 알람을 지금 언어의 같은 테마 클립으로
/// 다시 묶는다.
///
/// ⚠ **회전 자리(`bucketRotationIndex`)는 건드리지 않는다.** 같은 테마의 같은 순번을
/// 언어만 바꿔 이어가는 것이라, 초기화하면 매번 첫 문구로 되돌아간다.
///
/// ⚠ **직접 녹음·직접 입력·유료 클론 알람은 대상이 아니다.** 테마 알람(`bucketId` 가
/// 있는 것)만 고친다 — 사용자가 직접 친 문구를 언어가 바뀌었다고 갈아치우면 안 된다.
///
/// 안드로이드 짝은 `sync/StockClipLanguageRebinder.kt` 다 — **한쪽만 고치지 말 것.**
@MainActor
struct StockClipLanguageRebinder {

    let store: LocalAlarmStore
    let api: AlarmTalkAPI
    let cache: AudioCacheStore

    init(
        store: LocalAlarmStore,
        api: AlarmTalkAPI = .shared,
        cache: AudioCacheStore = .shared
    ) {
        self.store = store
        self.api = api
        self.cache = cache
    }

    /// 다시 묶은 알람 수.
    @discardableResult
    // ⚠ **이름보다 하는 일이 넓다**(2026-09-03). 언어가 바뀐 알람뿐 아니라,
    //   같은 언어인데 **묶인 클립이 서버에서 사라진** 알람도 다시 묶는다.
    //   이름은 호출부 호환으로 남겨 두었다 — 조건을 언어 하나로 되돌리지 말 것.
    func rebindIfLanguageChanged(
        session: AuthSession?,
        clips: [StockClip],
        language: String = VoiceStudioViewModel.appVoiceLanguage(),
        expectedVariants: ExpectedVariantCounts? = nil
    ) async -> Int {
        guard let token = session?.token, !clips.isEmpty else { return 0 }

        // 지금 매니페스트에 살아 있는 클립 키. 알람이 들고 있는 키가 여기 없으면 그
        // 클립은 **서버에서 사라진 것**이다(문구·목소리를 갈면 message id 가 새로 난다).
        let liveKeys = Set(clips.map { AudioCacheStore.stockCacheKey(messageId: $0.messageId) })

        let stale: [LocalAlarmRecord] = store.alarms.filter { (record: LocalAlarmRecord) -> Bool in
            Self.shouldRebind(
                record: record, language: language, liveKeys: liveKeys,
                clips: clips, expectedVariants: expectedVariants,
            )
        }
        guard !stale.isEmpty else { return 0 }

        var rebound = 0
        for record in stale {
            // ⚠ **묶을 때도 접은 이름을 쓴다**(2026-09-03 리뷰 5차). 지난 회차에
            //   `normalizedBucketId` 를 **완전성 검사에만** 넣었더니, 검사는 통과하는데
            //   `bindBucket` 이 여전히 옛 이름(`love`)으로 매니페스트를 뒤져 아무것도
            //   못 찾고 그 알람이 **영원히 건너뛰어졌다.** 이름을 접는 자리는 '판정' 이
            //   아니라 **'저장된 값을 읽는 모든 곳'** 이다.
            guard let bucket = Self.normalizedBucketId(record.bucketId) else { continue }
            guard let clipFields = await bindBucket(
                record: record, bucket: bucket, clips: clips, language: language, token: token
            ) else { continue }
            guard var bound = applyClipFields(snapshot: record, bound: clipFields) else { continue }
            // 접은 이름을 **행에도 적는다.** 안 적으면 다음 회차도, 편집기도, 서버 동기도
            // 계속 옛 이름을 읽는다 — 접기를 매번 다시 해야 하는 상태로 남는다.
            bound.bucketId = bucket
            _ = store.upsertPreservingServerSyncFields(bound)
            rebound += 1
        }
        return rebound
    }

    /// **다시 묶어야 하고, 갈아탈 세트도 완전한가.**
    ///
    /// ⚠ **두 술어를 호출부에서 손으로 조립하지 말 것**(2026-09-03 리뷰 5차). 예전에는
    ///   안드로이드가 `needsRebind(...) && replacementIsComplete(...)` 로 조립하고 iOS 는
    ///   필터 안에서 인라인으로 썼는데, iOS 쪽이 **언어 불일치에서 먼저 return 해**
    ///   완전성 검사를 건너뛰었다. 시딩이 도는 중에 언어를 바꾸면 부분 세트가 박히고,
    ///   그 키는 살아 있으니 **다시는 stale 로 안 잡힌다.**
    ///
    /// 안드로이드 짝은 `sync/StockClipLanguageRebinder.kt` 의 같은 이름이다.
    static func shouldRebind(
        record: LocalAlarmRecord,
        language: String,
        liveKeys: Set<String>,
        clips: [StockClip],
        expectedVariants: ExpectedVariantCounts?
    ) -> Bool {
        needsRebind(record: record, language: language, liveKeys: liveKeys)
            && replacementIsComplete(
                record: record, clips: clips, language: language, expectedVariants: expectedVariants,
            )
    }

    /// **이 알람을 다시 묶어야 하는가** — 안드로이드 `needsRebind` 미러.
    ///
    /// 판정이 둘이고 어느 쪽이든 하나면 true 다:
    ///  1. **앱 언어가 바뀌었다** — 원래 이 함수의 목적.
    ///  2. **묶인 클립이 서버에서 사라졌다.** 발사는 저장된 키와 로컬 파일만 보고 서버를
    ///     묻지 않으므로(비행기모드 재생), 문구·목소리를 통째로 갈면 그 알람은 **지워진
    ///     대사를 옛 목소리로 영원히 재생한다** — 언어가 안 바뀌어 1번에도 안 걸린다.
    ///
    /// ⚠ **2번을 「하나라도 죽었으면」으로 넓히지 말 것.** 부분 세트는 정상 상태다 —
    ///   시딩 중이거나 클립이 늘어난 직후에는 일부만 매니페스트에 있다.
    static func needsRebind(
        record: LocalAlarmRecord,
        language: String,
        liveKeys: Set<String>
    ) -> Bool {
        guard (record.bucketId).nilIfBlank != nil else { return false }
        guard record.playModeEnum != .alarmOnly else { return false }
        // 녹음 알람에는 문구 개념이 없다.
        guard record.voiceSourceEnum != .localAudio else { return false }
        let current: String = record.voiceLanguage ?? "ko"
        if current != language { return true }
        let bound = record.bucketClipKeys ?? []
        // ③ **테마는 아는데 클립 목록이 없는 알람**(2026-09-03 리뷰 11차). 받은 가족 알람이
        //    그렇다 — 동기가 `bucketId` 와 대표 클립 하나만 적고 목록은 비운다. 게다가
        //    `voiceLanguage` 가 nil 이라 한국어 기기에서는 ①에도 안 걸리고, 목록이 비어
        //    ②에도 안 걸린다 — 어디에도 안 걸려 옛 대사를 영원히 재생한다.
        if bound.isEmpty {
            guard let messageId = (record.ttsMessageId).nilIfBlank else { return false }
            return !liveKeys.contains(AudioCacheStore.stockCacheKey(messageId: messageId))
        }
        return bound.allSatisfy { !liveKeys.contains($0) }
    }

    /// **라이브 랜덤 생성으로 저장된 옛 알람을 테마 클립에 다시 묶는다.**
    ///
    /// 그 알람들은 울릴 때마다 서버가 새 문장을 지어 주는 전제로 저장됐다
    /// (`voiceRandomPrompt = true`, `bucketId` 없음). 라이브 생성을 걷어내면 그 전제가
    /// 사라져 **마지막에 만들어진 한 문장만 매일 반복**되고, 시각만 바꾸려 열어도 편집기가
    /// 되돌릴 방법이 없다 — 사용자 눈에는 "알람이 고장났다" 로 보인다.
    ///
    /// 고른 **문구 종류**(`voiceRandomContext`)를 같은 뜻의 테마로 옮긴다. 매핑은
    /// `RandomPromptContext.bucketCategory` 를 **그대로 재사용**한다(안드로이드는
    /// `clonePrerenderBucketCategoryFor`). 여기에 다시 적으면 두 벌이 된다.
    ///
    /// ⚠ **묶을 클립이 없으면 그대로 둔다.** 지우거나 `voiceRandomPrompt` 만 내리면 소리가
    /// 사라진다 — 옛 문장이라도 울리는 편이 낫다. 다음 실행에 다시 시도한다(멱등).
    ///
    /// 안드로이드 짝은 `sync/StockClipLanguageRebinder.kt` 의 `rebindLiveGenerationRows` 다 —
    /// **한쪽만 고치지 말 것.**
    ///
    /// - Returns: 다시 묶은 알람 수.
    /// **교체가 끝났으면 옛 스톡 클립 파일을 지운다.**
    ///
    /// 순서가 안전장치다: **다 받고 → 다 묶고 → 그 다음에 지운다.** 아직 갈아탈 알람이
    /// 남아 있으면(시딩이 도는 중이라 세트가 모자란 경우) **아무것도 지우지 않고** 다음
    /// 실행으로 미룬다 — 중간에 멈추면 지운 것이 없으므로 잃는 것도 없다(멱등).
    ///
    /// ⚠ **판정은 `needsRebind` 하나로 한다.** "죽은 키를 물고 있는 알람이 하나라도 있으면
    ///   미룬다" 로 하면 **영영 안 지운다** — 버킷 없이 클립 하나만 물린 옛 행은 재바인더가
    ///   손댈 수 없어 죽은 키를 계속 들고 있다. `needsRebind` 는 그 행을 false 로 돌려주므로
    ///   막지 않고, 그 행이 물고 있는 키는 참조 집합에 들어가 **파일도 지워지지 않는다.**
    ///
    /// 안드로이드 짝은 `StockClipLanguageRebinder.pruneReplacedStockAudio` 다.
    ///
    /// - Returns: 지운 파일 수. 아직 때가 아니면 0.
    @discardableResult
    func pruneReplacedStockAudio(
        clips: [StockClip],
        language: String = VoiceStudioViewModel.appVoiceLanguage(),
        expectedVariants: ExpectedVariantCounts? = nil
    ) -> Int {
        guard !clips.isEmpty else { return 0 }
        // ⚠⚠ **알람이 디스크에서 다 올라오기 전에는 절대 지우지 않는다**(2026-09-03 리뷰 10차).
        //   `LocalAlarmStore` 는 콜드 스타트에 `alarms = []` 로 시작해 **비동기로** 채운다.
        //   그 창에서 이 함수가 돌면 참조 집합이 비어 **받아 둔 클립 전부가 '아무도 안 쓰는
        //   것'** 으로 보이고, 특히 재바인딩이 불가능한 **버킷 없는 옛 행**은 하나뿐인
        //   로컬 클립을 잃어 다시 받을 방법도 없다(그 행은 어떤 테마인지 알 수 없다).
        //   호출부에서도 막지만(`rebindStockClipsIfNeeded`), **지우는 자리에도 둔다** —
        //   이 함수를 다른 데서 부르는 순간 그 방어가 사라진다.
        //   (안드로이드는 Room 을 동기로 읽으므로 이 창이 없다.)
        guard store.hasLoadedFromDisk else { return 0 }
        let liveKeys = Set(clips.map { AudioCacheStore.stockCacheKey(messageId: $0.messageId) })
        let alarms = store.alarms

        // ① 아직 갈아탈 것이 남았으면 미룬다. ② 세트가 모자라 못 갈아탄 것이 있어도 미룬다.
        let pending = alarms.contains {
            Self.shouldRebind(
                record: $0, language: language, liveKeys: liveKeys,
                clips: clips, expectedVariants: expectedVariants,
            )
        }
        guard !pending else { return 0 }
        let waitingForSeed = alarms.contains {
            Self.needsRebind(record: $0, language: language, liveKeys: liveKeys)
        }
        guard !waitingForSeed else { return 0 }

        // ③ 지금 알람들이 물고 있는 키는 전부 남긴다(여러 알람이 같은 클립을 공유한다).
        var referenced = Set<String>()
        var referencedFileNames = Set<String>()
        for alarm in alarms {
            referenced.formUnion(alarm.bucketClipKeys ?? [])
            if let key = alarm.audioCacheKey, !key.isEmpty { referenced.insert(key) }
            // 옛 별칭 디렉터리는 파일 **이름**으로 참조된다(`<messageId>.<ext>`).
            if let uri = alarm.localAudioUri, !uri.isEmpty {
                referencedFileNames.insert((uri as NSString).lastPathComponent)
            }
        }
        return cache.pruneReplacedStockAudio(
            referencedKeys: referenced,
            liveKeys: liveKeys,
            referencedFileNames: referencedFileNames
        )
    }

    /// 저장된 버킷 id 를 **현재 이름**으로 접는다. 접기의 단일 출처는
    /// `RandomPromptContext.forBucket` ↔ `bucketCategory` 한 쌍이다.
    static func normalizedBucketId(_ bucketId: String?) -> String? {
        guard let raw = (bucketId).nilIfBlank else { return nil }
        return RandomPromptContext.forBucket(raw)?.bucketCategory ?? raw
    }

    /// 갈아탈 세트가 완전한가 — 안드로이드 `replacementIsComplete` 미러.
    /// `expectedVariants` 가 없으면(옛 서버) 막지 않는다.
    static func replacementIsComplete(
        record: LocalAlarmRecord,
        clips: [StockClip],
        language: String,
        expectedVariants: ExpectedVariantCounts?
    ) -> Bool {
        // ⚠ **저장된 옛 이름을 접고 나서 맞춘다**(2026-09-03 리뷰 4차). 기기에 `love` 로
        //   저장된 알람은 새 매니페스트(`cheer`)와 이름이 달라 variant 가 0개로 잡히고,
        //   그러면 이 함수가 영원히 false 라 재바인딩이 통째로 막힌다.
        guard let bucket = normalizedBucketId(record.bucketId) else { return false }
        let variants = Set(
            clips
                .filter {
                    $0.voiceProfileId == record.voiceProfileId
                        && $0.category == bucket
                        && ($0.language ?? "ko") == language
                }
                .compactMap(\.variant)
        )
        guard !variants.isEmpty else { return false }
        guard let expected = expectedVariants?.count(
            category: bucket,
            isSystemVoice: isSystemVoiceId(record.voiceProfileId)
        ), expected > 0 else { return true }
        return variants == Set(0..<expected)
    }

    @discardableResult
    func rebindLiveGenerationRows(
        session: AuthSession?,
        clips: [StockClip],
        language: String = VoiceStudioViewModel.appVoiceLanguage(),
        expectedVariants: ExpectedVariantCounts? = nil
    ) async -> Int {
        guard let token = session?.token, !clips.isEmpty else { return 0 }

        let legacy: [LocalAlarmRecord] = store.alarms.filter { (record: LocalAlarmRecord) -> Bool in
            // ⚠ `bucketId` 가 **비어 있는** 것이 '옛 라이브 행' 의 표식이다. 테마 알람은
            // 저장할 때 `randomPrompt` 를 내리고 `bucketId` 를 적으므로 여기 안 걸린다.
            guard record.voiceRandomPrompt else { return false }
            guard (record.bucketId).nilIfBlank == nil else { return false }
            guard record.playModeEnum != .alarmOnly else { return false }
            guard record.voiceSourceEnum != .localAudio else { return false }
            return true
        }
        guard !legacy.isEmpty else { return 0 }

        var rebound = 0
        for record in legacy {
            // ⚠ **저장된 값은 `normalized` 로 읽는다**(2026-09-03 리뷰). 생성자를 직접
            //   쓰면 이름이 바뀐 옛 값(`love`)에 nil 이 나와 그 행이 **통째로 건너뛰어진다** —
            //   옛 표현에 남아 매번 같은 문구를 되풀이한다. `normalized` 가 `cheer` 로 접는다.
            guard let raw = record.voiceRandomContext, !raw.isEmpty else { continue }
            let context = RandomPromptContext.normalized(raw)
            // ⚠ **여기도 완전한 세트일 때만 옮긴다**(2026-09-03 리뷰 4차). 이 경로는 옛
            //   라이브 행을 테마로 바꾸면서 `voiceRandomPrompt` 를 내린다 — 한 번 옮겨지면
            //   위 술어에 다시 안 걸려 **영원히 그 부분 세트로 남는다.**
            var probe = record
            probe.bucketId = context.bucketCategory
            guard Self.replacementIsComplete(
                record: probe, clips: clips, language: language, expectedVariants: expectedVariants,
            ) else { continue }
            guard let clipFields = await bindBucket(
                record: record, bucket: context.bucketCategory,
                clips: clips, language: language, token: token
            ) else { continue }
            guard var bound = applyClipFields(snapshot: record, bound: clipFields) else { continue }
            bound.bucketId = context.bucketCategory
            // ⚠ **랜덤을 내린다.** 안 내리면 다음 실행이 이 행을 또 옛 행으로 보고 매번 다시
            // 묶으며, 편집기도 계속 '생성형' 으로 읽는다. 문구 **종류**
            // (`voiceRandomContext`)는 그대로 둔다 — 편집기가 열 때 무엇을 골랐었는지
            // 되짚는 값이다(CLAUDE.md 「일곱 자리」).
            bound.voiceRandomPrompt = false
            _ = store.upsertPreservingServerSyncFields(bound)
            rebound += 1
        }
        return rebound
    }

    /// **다운로드 도중 사용자가 고친 것을 덮지 않는다**(2026-09-03 리뷰 8차).
    ///
    /// 이 경로는 알람을 스냅샷으로 읽고 나서 **여러 번 await 하며**(클립 N개 다운로드)
    /// 돌아온다. 그 사이 사용자가 시각을 바꾸거나 알람을 끄면, 스냅샷을 통째로 쓰는 순간
    /// 그 편집이 사라진다 — `upsertPreservingServerSyncFields` 는 **서버 발급 필드만**
    /// 보존하므로 시각·요일·on/off 는 지켜 주지 않는다. iOS 는 그 뒤 곧바로 AlarmKit 예약을
    /// 재조정하므로, 덮어쓴 옛 시각이 **그 자리에서 OS 예약에까지 반영된다.**
    ///
    /// 그래서 쓰기 직전에 **행을 다시 읽고, 클립에 관한 값만** 얹는다.
    ///
    /// ⚠ 다시 읽은 행이 더 이상 이 테마/목소리가 아니면 포기한다 — 그 사이 사용자가 바꾼
    ///   것이라, 받아 둔 클립은 이미 남의 것이다. 다음 실행이 다시 판단한다(멱등).
    ///
    /// ⚠ **문구 갈래(`voiceRandomPrompt`·`voiceRandomContext`)도 함께 본다**(2026-09-03
    ///   리뷰 9차). 목소리·테마·소스만 보면 **옛 라이브 행 → 직접 입력** 전환을 못 잡는다 —
    ///   그 편집은 같은 목소리·같은 소스에 `bucketId` 도 여전히 nil 이라 가드를 통과하고,
    ///   사용자가 방금 친 문구를 덮어쓴 뒤 테마 알람으로 되돌린다.
    ///
    /// 안드로이드 짝은 `StockClipLanguageRebinder.applyClipFields` 다 — **한쪽만 고치지 말 것.**
    /// **받아 둔 클립을 이 행에 얹어도 되는가** — 안드로이드 `canApplyClipFields` 미러.
    ///
    /// ⚠ 판정 축은 「이 알람이 어떤 종류의 문구를 쓰는가」 전부다. 목소리·테마·소스만 보면
    ///   **옛 라이브 행 → 직접 입력** 전환을 못 잡는다(같은 목소리·같은 소스에 `bucketId`
    ///   도 여전히 nil 이라 통과한다) — 사용자가 방금 친 문구를 덮어쓰게 된다.
    static func canApplyClipFields(snapshot: LocalAlarmRecord, fresh: LocalAlarmRecord) -> Bool {
        fresh.voiceProfileId == snapshot.voiceProfileId
            && fresh.bucketId == snapshot.bucketId
            && fresh.voiceSource == snapshot.voiceSource
            && fresh.voiceRandomPrompt == snapshot.voiceRandomPrompt
            && fresh.voiceRandomContext == snapshot.voiceRandomContext
    }

    private func applyClipFields(
        snapshot: LocalAlarmRecord,
        bound: LocalAlarmRecord
    ) -> LocalAlarmRecord? {
        guard var fresh = store.alarms.first(where: { $0.id == snapshot.id }) else { return nil }
        guard Self.canApplyClipFields(snapshot: snapshot, fresh: fresh) else { return nil }
        // ⚠ **`bindBucket` 이 세우는 값과 정확히 같은 목록이어야 한다** — 하나 빠지면
        //   그 필드만 옛 값으로 남아 클립과 어긋난다.
        fresh.bucketClipKeys = bound.bucketClipKeys
        fresh.audioCacheKey = bound.audioCacheKey
        fresh.localAudioUri = bound.localAudioUri
        fresh.voiceLanguage = bound.voiceLanguage
        fresh.voiceText = bound.voiceText
        fresh.ttsMessageId = bound.ttsMessageId
        return fresh
    }

    /// (알람·테마·언어)로 클립 세트를 받아 행에 묶을 값을 만든다. 묶을 수 없으면 nil.
    ///
    /// ⚠ **두 재바인더가 이걸 공유한다.** 베껴 두면 한쪽만 고치는 사고가 난다.
    /// `bucketId`·`voiceRandomPrompt` 처럼 **갈래마다 다른 값은 호출자가** 얹는다.
    private func bindBucket(
        record: LocalAlarmRecord,
        bucket: String,
        clips: [StockClip],
        language: String,
        token: String
    ) async -> LocalAlarmRecord? {
        let target = clips
            .filter {
                $0.voiceProfileId == record.voiceProfileId
                    && $0.category == bucket
                    && ($0.language ?? "ko") == language
            }
            // ⚠ **variant 순으로 정렬하고 중복을 없앤다**(2026-08-18 추가. 그전에는 없었다).
            // 날씨·운세는 서버가 조건을 **절대 인덱스**로 고르므로 순서가 곧 뜻이다 —
            // 매니페스트가 주는 순서에 기대면 비 오는 날에 맑음 문구가 나갈 수 있다.
            // 안드로이드 재바인더와 편집기 `bindStockBucketClips` 는 처음부터 그렇게 한다.
            .sorted { ($0.variant ?? 0) < ($1.variant ?? 0) }
            .reduce(into: [StockClip]()) { acc, clip in
                if !acc.contains(where: { $0.variant == clip.variant }) { acc.append(clip) }
            }
        // 그 언어에 이 테마의 클립이 없으면 **그대로 둔다.** 지우면 소리가 사라진다 —
        // 옛 언어로라도 울리는 편이 낫다.
        guard let first = target.first else { return nil }

        var keys: [String] = []
        for clip in target {
            let key = AudioCacheStore.stockCacheKey(messageId: clip.messageId)
            if cache.cachedURL(for: key) == nil {
                // ⚠ **하나라도 못 받으면 통째로 포기한다**(2026-09-03 리뷰 4차, 안드로이드와
                //   같은 규칙). 실패한 것만 건너뛰고 저장하면 그 키들이 `liveKeys` 에
                //   들어가 다음 회차부터 stale 로 안 잡힌다 — 일시적인 네트워크 실패
                //   하나가 그 알람을 **영구히 부분 세트**로 만든다.
                guard await download(messageID: clip.messageId, key: key, token: token) else {
                    return nil
                }
            }
            keys.append(key)
        }
        guard !keys.isEmpty else { return nil }

        var updated = record
        updated.bucketClipKeys = keys
        updated.audioCacheKey = keys.first
        updated.localAudioUri = cache.cachedURL(for: keys[0])?.path
        updated.voiceLanguage = language
        updated.voiceText = first.text
        updated.ttsMessageId = first.messageId
        return updated
    }

    private func download(messageID: String, key: String, token: String) async -> Bool {
        guard let response = try? await api.getTTSMessageAudio(id: messageID, token: token) else {
            return false
        }
        do {
            _ = try await AudioCacheStore.cacheStockClipOffMain(
                audio: response,
                messageId: messageID,
                cacheKey: key
            )
            return true
        } catch AudioCacheError.legacyAliasFailed {
            // 이 경로가 읽는 것은 **정본(cacheKey)** 뿐이다(아래 `cachedURL(for:)`).
            // 옛 별칭 실패로 클립을 버리면 키 배열에서 한 자리가 빠지고, 자리 인덱스로 고르는
            // 조건 클립(날씨 등)이 통째로 밀려 엉뚱한 문구가 울린다.
            return true
        } catch {
            return false
        }
    }
}
