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
            let target = clips
                .filter {
                    $0.voiceProfileId == record.voiceProfileId
                        && $0.category == bucket
                        && ($0.language ?? "ko") == language
                }
            // 그 언어에 이 테마의 클립이 없으면 **그대로 둔다.** 지우면 소리가 사라진다 —
            // 옛 언어로라도 울리는 편이 낫다.
            guard let first = target.first else { continue }

            var keys: [String] = []
            for clip in target {
                let key = AudioCacheStore.stockCacheKey(messageId: clip.messageId)
                if cache.cachedURL(for: key) == nil {
                    guard await download(messageID: clip.messageId, key: key, token: token) else { continue }
                }
                keys.append(key)
            }
            guard !keys.isEmpty else { continue }

            var updated = record
            updated.bucketClipKeys = keys
            updated.audioCacheKey = keys.first
            updated.localAudioUri = cache.cachedURL(for: keys[0])?.path
            updated.voiceLanguage = language
            updated.voiceText = first.text
            updated.ttsMessageId = first.messageId
            _ = store.upsertPreservingServerSyncFields(updated)
            rebound += 1
        }
        return rebound
    }

    private func download(messageID: String, key: String, token: String) async -> Bool {
        guard let response = try? await api.getTTSMessageAudio(id: messageID, token: token) else {
            return false
        }
        let cached = try? await AudioCacheStore.cacheStockClipOffMain(
            audio: response,
            messageId: messageID,
            cacheKey: key
        )
        return cached != nil
    }
}
