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
    func rebindIfLanguageChanged(
        session: AuthSession?,
        clips: [StockClip],
        language: String = VoiceStudioViewModel.appVoiceLanguage()
    ) async -> Int {
        guard let token = session?.token, !clips.isEmpty else { return 0 }

        let stale: [LocalAlarmRecord] = store.alarms.filter { (record: LocalAlarmRecord) -> Bool in
            guard (record.bucketId).nilIfBlank != nil else { return false }
            guard record.playModeEnum != .alarmOnly else { return false }
            // 녹음 알람에는 문구 개념이 없다.
            guard record.voiceSourceEnum != .localAudio else { return false }
            let current: String = record.voiceLanguage ?? "ko"
            return current != language
        }
        guard !stale.isEmpty else { return 0 }

        var rebound = 0
        for record in stale {
            guard let bucket = (record.bucketId).nilIfBlank else { continue }
            guard let bound = await bindBucket(
                record: record, bucket: bucket, clips: clips, language: language, token: token
            ) else { continue }
            _ = store.upsertPreservingServerSyncFields(bound)
            rebound += 1
        }
        return rebound
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
    @discardableResult
    func rebindLiveGenerationRows(
        session: AuthSession?,
        clips: [StockClip],
        language: String = VoiceStudioViewModel.appVoiceLanguage()
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
            guard let context = RandomPromptContext(rawValue: record.voiceRandomContext ?? "") else { continue }
            guard var bound = await bindBucket(
                record: record, bucket: context.bucketCategory,
                clips: clips, language: language, token: token
            ) else { continue }
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
                guard await download(messageID: clip.messageId, key: key, token: token) else { continue }
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
