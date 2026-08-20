import CryptoKit
import Foundation

// MARK: - CachedVoiceAudio (legacy compat)

struct CachedVoiceAudio: Equatable, Sendable {
    var url: URL
    var fileName: String
    var format: String
    var cacheKey: String
}

// MARK: - AudioCacheMetadata
// Android 의 `.meta` Properties 파일을 JSON sidecar 로 대체.
struct AudioCacheMetadata: Codable, Equatable {
    let cacheKey: String
    let source: String          // "tts" / "clone_audio" / "raw_audio"
    let mimeType: String
    let durationMs: Int64?
    let createdAtMillis: Int64
    let messageId: String?
    let rawAudioUri: String?

    /// **입력 별칭**: 이 사이드카가 오디오가 아니라 '입력 → 서버 캐시키' 를 가리킬 때 채워진다.
    /// 안드로이드 `.meta` 의 `alias_of` / `alias_text` 대응.
    var aliasOf: String?
    var aliasText: String?
}

/// 같은 입력으로 이미 만들어 둔 음성이 있다는 표시. 안드로이드 `TtsInputAlias`.
struct TtsInputAlias: Equatable {
    /// 서버가 준 캐시키(실제 오디오 파일이 여기 있다).
    let cacheKey: String
    /// **서버 표시 문구.** 알람에 저장되는 건 입력 원문이 아니라 이 값이다
    /// (번역이 켜진 기기에서는 둘이 갈라진다). 이게 없는 별칭은 없는 것으로 친다 —
    /// 그 값 없이 재사용하면 번역된 오디오에 원문을 붙이게 된다.
    let displayText: String
}

enum AudioCacheError: LocalizedError {
    case invalidBase64
    case durationExceedsLimit(Int64)
    case appGroupContainerUnavailable
    case writeFailed(Error)

    var errorDescription: String? {
        switch self {
        case .invalidBase64:
            return "음성 오디오를 해석하지 못했어요."
        case .durationExceedsLimit(let limit):
            return "음성은 최대 \(limit / 1000)초까지 사용할 수 있어요."
        case .appGroupContainerUnavailable:
            return "오디오 저장 공간을 사용할 수 없어요."
        case .writeFailed(let error):
            return "오디오 파일을 저장하지 못했어요."
        }
    }
}

// MARK: - AudioCacheStore
/// SHA-256 cacheKey 기반 음원 캐시.
/// Android `AlarmAudioStore.kt` 의 동작을 이식하되, iOS 는 AVAsset 으로 길이를 측정한다.
///
/// 저장 위치 우선순위:
///   1. App Group container (위젯이 같은 캐시 읽을 수 있도록)
///   2. Application Support / AlarmTalkAudio (폴백)
///
/// 파일 명명:
///   - `<safeCacheKey>.<ext>`  (실제 음원)
///   - `<safeCacheKey>.meta.json` (메타 사이드카)
@MainActor
final class AudioCacheStore {
    /// `nonisolated` — 이 타입의 실제 멤버는 사실상 전부 `nonisolated` 다(FileManager /
    /// AVAsset 만 건드린다). 클래스의 `@MainActor` 는 SwiftUI 호출처 편의를 위한 것이고,
    /// 캐싱 경로는 `Task.detached` 등 백그라운드에서 `Self.shared` 를 await 없이 잡아야 한다
    /// (아래 `cache(tts:)` / `cacheStockClip(...)`). 기본값인 MainActor 격리로 두면
    /// 그 경로들이 컴파일되지 않는다.
    ///
    /// 안전한 이유: `@MainActor` 타입은 암묵적으로 `Sendable` 이고, 이 프로퍼티는 `let` 이라
    /// 재할당이 없다. 가리키는 인스턴스는 상태를 메모리에 들고 있지 않으며(디스크가 진실),
    /// 동시 접근이 닿는 메서드는 전부 `nonisolated` 로 표시돼 있다.
    nonisolated static let shared = AudioCacheStore()

    /// `nonisolated` — 빈 바디라 상태를 건드리지 않으며, `shared` 와 단위 테스트의
    /// `AudioCacheStore()` 가 어떤 격리에서도 인스턴스를 만들 수 있게 한다(change 5:
    /// nonisolated 캐싱 경로가 `Self.shared` 를 await 없이 접근).
    nonisolated init() {}

    // MARK: Legacy API (기존 호출처 호환)

    /// 기존 `AudioCacheStore.cache(tts:)` 와 동일 시그니처.
    /// 새 cacheKey 규칙을 사용하지만, 파일명에는 messageId 도 살려 두기 위해 audio 파일은
    /// 기존 위치(`AlarmTalkAudio/<messageId>.<ext>`)에도 사본을 유지한다.
    nonisolated static func cache(tts: TtsGenerateResponse) throws -> CachedVoiceAudio {
        return try cache(tts: tts, cacheKey: nil)
    }

    /// base64 decode + 디스크 쓰기 + 길이 측정은 모두 FileManager/AVAsset 만 건드리므로
    /// `nonisolated` — `Task.detached` 등 백그라운드 컨텍스트에서 호출하면 메인 액터를
    /// 막지 않는다(change 5, Android 의 Dispatchers.IO 캐싱과 동일 의도).
    nonisolated static func cache(tts: TtsGenerateResponse, cacheKey overrideCacheKey: String?) throws -> CachedVoiceAudio {
        // ⚠ **`!data.isEmpty` 를 빼지 말 것.** `Data(base64Encoded: "")` 는 nil 이 아니라
        // **0바이트 Data** 다(실측). 서버가 빈 audio_base64 를 주면 0바이트 파일이
        // 캐시에 앉고, 재다운로드도 캐시 히트로 막혀 영영 안 덮인다 — 그 파일을 문
        // 알람은 무음으로 운다.
        guard let data = Data(base64Encoded: tts.audioBase64), !data.isEmpty else {
            throw AudioCacheError.invalidBase64
        }
        let format = Self.normalizedFormat(tts.audioFormat)
        let fileName = "\(tts.messageId).\(format)"
        let url = try Self.legacyAudioDirectory().appendingPathComponent(fileName)
        try data.write(to: url, options: Self.audioWriteOptions)

        // 새 cacheKey 캐시에도 동시 저장 (위젯 공유 캐시 + cascade cleanup 대상).
        let cacheKey = nonBlank(overrideCacheKey) ?? nonBlank(tts.cacheKey) ?? Self.computeCacheKey(data)
        _ = try? Self.shared.cacheBytes(
            data,
            cacheKey: cacheKey,
            mimeType: Self.mimeType(forFormat: format),
            source: "tts",
            messageId: tts.messageId,
            rawAudioUri: tts.remoteAudioURI,
            durationOverrideMs: nil,
            enforceMaxDuration: false  // tts 길이는 서버가 보장. 한도는 메타에만.
        )

        return CachedVoiceAudio(url: url, fileName: fileName, format: format, cacheKey: cacheKey)
    }

    /// 스톡 클립 음원(`GET /tts/messages/:id/audio` 응답)을 캐싱한다.
    /// `cache(tts:cacheKey:)` 와 동일하게 (1) legacy 디렉터리에 `<messageId>.<ext>`
    /// 파일을 쓰고 (저장 경로가 `prepared.localAudioFileName` 을 legacy URL 로
    /// 해석하므로 필수) (2) cacheKey 기반 위치에도 저장한다.
    /// - cacheKey: 선택은 `stock_<messageId>`, 미리듣기는 `stock_preview_<messageId>`.
    ///   Android `AlarmEditorScreen.kt` 의 두 캐시 키와 동일.
    /// 길이 한도는 메타에만 기록한다(enforceMaxDuration:false) — 생성 TTS 와 동일하게
    /// 30초 초과 시 AlarmSoundResolver 가 in-app 재생으로 폴백한다.
    @discardableResult
    nonisolated static func cacheStockClip(
        audio response: TtsMessageAudioResponse,
        messageId: String,
        cacheKey: String
    ) throws -> CachedVoiceAudio {
        // 0바이트 방어는 위 `cache(tts:)` 주석 참조.
        guard let data = Data(base64Encoded: response.audioBase64), !data.isEmpty else {
            throw AudioCacheError.invalidBase64
        }
        let format = Self.normalizedFormat(response.audioFormat)
        let fileName = "\(messageId).\(format)"
        let url = try Self.legacyAudioDirectory().appendingPathComponent(fileName)
        try data.write(to: url, options: Self.audioWriteOptions)

        _ = try? Self.shared.cacheBytes(
            data,
            cacheKey: cacheKey,
            mimeType: Self.mimeType(forFormat: format),
            source: "tts",
            messageId: messageId,
            rawAudioUri: response.audioUrl,
            durationOverrideMs: nil,
            enforceMaxDuration: false
        )

        return CachedVoiceAudio(url: url, fileName: fileName, format: format, cacheKey: cacheKey)
    }

    /// 스톡 클립 선택용 cacheKey (`stock_<messageId>`). Android 와 동일 규칙.
    nonisolated static func stockCacheKey(messageId: String) -> String { "\(stockCacheKeyPrefix)\(messageId)" }

    /// 스톡 클립 캐시 키 접두. 안드로이드 `AlarmAudioStore.STOCK_CACHE_KEY_PREFIX` 와 같다.
    nonisolated static let stockCacheKeyPrefix = "stock_"

    /// 스톡 클립 미리듣기용 cacheKey (`stock_preview_<messageId>`). Android 와 동일.
    nonisolated static func stockPreviewCacheKey(messageId: String) -> String { "stock_preview_\(messageId)" }

    // MARK: Off-main caching (change 5)

    /// `cacheStockClip` 의 off-main 래퍼. base64 디코드/디스크 쓰기/길이 측정을
    /// `Task.detached` 로 돌려 메인 액터를 막지 않는다(Android Dispatchers.IO 대응).
    /// 캐시 후 30초 초과면 자동 트림(change 6)을 시도한다.
    static func cacheStockClipOffMain(
        audio response: TtsMessageAudioResponse,
        messageId: String,
        cacheKey: String
    ) async throws -> CachedVoiceAudio {
        let cached = try await Task.detached(priority: .userInitiated) {
            try cacheStockClip(audio: response, messageId: messageId, cacheKey: cacheKey)
        }.value
        await Self.shared.trimCachedAudioIfNeeded(cacheKey: cacheKey)
        return cached
    }

    /// `cache(tts:cacheKey:)` 의 off-main 래퍼.
    static func cacheOffMain(
        tts: TtsGenerateResponse,
        cacheKey: String?
    ) async throws -> CachedVoiceAudio {
        let cached = try await Task.detached(priority: .userInitiated) {
            try cache(tts: tts, cacheKey: cacheKey)
        }.value
        await Self.shared.trimCachedAudioIfNeeded(cacheKey: cached.cacheKey)
        return cached
    }

    /// `cacheBytes` 의 off-main 래퍼.
    @discardableResult
    func cacheBytesOffMain(
        _ data: Data,
        cacheKey: String,
        mimeType: String,
        source: String = "raw_audio",
        messageId: String? = nil,
        rawAudioUri: String? = nil,
        durationOverrideMs: Int64? = nil,
        enforceMaxDuration: Bool = true
    ) async throws -> URL {
        let url = try await Task.detached(priority: .userInitiated) { [self] in
            try cacheBytes(
                data,
                cacheKey: cacheKey,
                mimeType: mimeType,
                source: source,
                messageId: messageId,
                rawAudioUri: rawAudioUri,
                durationOverrideMs: durationOverrideMs,
                enforceMaxDuration: enforceMaxDuration
            )
        }.value
        if !enforceMaxDuration {
            await trimCachedAudioIfNeeded(cacheKey: cacheKey)
        }
        return url
    }

    /// Legacy URL 조회. messageId 기반 파일명용.
    nonisolated static func url(for fileName: String) throws -> URL {
        try Self.legacyAudioDirectory().appendingPathComponent(fileName)
    }

    // MARK: cacheKey-based API

    /// SHA-256 hex 해시 계산 (64 char).
    nonisolated static func computeCacheKey(_ data: Data) -> String {
        let digest = SHA256.hash(data: Data(data))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    /// SHA-256 over UTF-8 input (텍스트 기반 cacheKey 도 동일 규칙).
    nonisolated static func computeCacheKey(text: String) -> String {
        let bytes = Data(text.utf8)
        return computeCacheKey(bytes)
    }

    /// Android `AlarmAudioStore.ttsCacheKey(...)` equivalent.
    static func ttsCacheKey(
        profileId: String,
        text: String,
        category: String,
        language: String,
        serverCacheKey: String? = nil
    ) -> String {
        if let serverKey = nonBlank(serverCacheKey) {
            return serverKey
        }
        let normalizedText = text
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        let normalizedCategory = normalizedTtsCategory(category)
        return computeCacheKey(text: ["tts-v2", profileId, normalizedText, normalizedCategory, language].joined(separator: "|"))
    }

    /// 카테고리는 그대로 쓴다.
    ///
    /// ⚠ 예전에는 레거시 별칭(afternoon→cheer, sleep→night, medicine→medication)을 remap 했는데,
    /// **서버가 그 별칭 표를 통째로 버렸다**(`e4fad460` — '10테마' 분류 제거). 한쪽만 남기면
    /// 같은 문구가 두 키로 캐싱돼 재생성·한도 차감이 한 번 더 일어난다. 되살리지 말 것.
    nonisolated static func normalizedTtsCategory(_ category: String) -> String {
        category
    }

    /// bytes 를 cacheKey 기반 위치에 기록하고 메타 사이드카를 생성한다.
    /// - enforceMaxDuration: true 면 durationMs > AlarmAudioLimits.maxDurationMillis 일 때 throw.
    /// FileManager + AVAsset 만 다루고 actor state 를 건드리지 않으므로 `nonisolated` —
    /// `Task.detached` 로 감싸 호출하면 디코드/쓰기/길이 측정이 메인 액터를 막지 않는다
    /// (change 5).
    @discardableResult
    nonisolated func cacheBytes(
        _ data: Data,
        cacheKey: String,
        mimeType: String,
        source: String = "raw_audio",
        messageId: String? = nil,
        rawAudioUri: String? = nil,
        durationOverrideMs: Int64? = nil,
        enforceMaxDuration: Bool = true
    ) throws -> URL {
        let directory = try Self.audioDirectory()
        let ext = Self.fileExtension(forMimeType: mimeType)
        let safeKey = Self.safeCacheKey(cacheKey)
        let target = directory.appendingPathComponent("\(safeKey).\(ext)")

        // ⚠ **파일이 있다고 무조건 건너뛰지 말 것 — 그러면 캐시가 write-once 가 된다.**
        // 서버가 같은 message_id 의 오디오 실체를 바꿔도(목소리 교체) 기기는 영영 옛
        // 소리를 쓴다. 키에 버전이 없으니 판별은 **`audio_url` 이 달라졌는가**로 한다 —
        // 그 값은 이미 메타에 `rawAudioUri` 로 저장하고 있었는데 **아무도 비교하지
        // 않았다.** 서버가 새 오디오를 새 R2 키에 올리면 이 값이 반드시 달라진다.
        let stale = Self.isStaleCachedFile(at: target, storedFor: cacheKey, incomingAudioUri: rawAudioUri)
        if stale || !FileManager.default.fileExists(atPath: target.path) {
            do {
                try data.write(to: target, options: Self.audioWriteOptions)
            } catch {
                throw AudioCacheError.writeFailed(error)
            }
            if stale {
                // ⚠ **구워 둔 알람 사운드도 함께 버린다.** iOS 는 예약 시점에 캐시 파일을
                // `Library/Sounds/voice-<key>.caf` 로 복사해 그 이름을 AlarmKit 에 박는다.
                // 캐시만 갈아 끼우면 알람은 **여전히 옛 목소리로** 운다.
                Task { @MainActor in AlarmSoundStaging.clearStagedSound(forKey: cacheKey) }
            }
        }

        let durationMs = durationOverrideMs ?? Self.readDurationMillis(url: target)
        if enforceMaxDuration,
           let durationMs,
           durationMs > AlarmAudioLimits.maxDurationMillis + AlarmAudioLimits.durationToleranceMillis {
            try? FileManager.default.removeItem(at: target)
            throw AudioCacheError.durationExceedsLimit(AlarmAudioLimits.maxDurationMillis)
        }

        let metadata = AudioCacheMetadata(
            cacheKey: cacheKey,
            source: source,
            mimeType: mimeType,
            durationMs: durationMs,
            createdAtMillis: Int64(Date().timeIntervalSince1970 * 1000),
            messageId: messageId,
            rawAudioUri: rawAudioUri
        )
        try writeMetadata(metadata)

        return target
    }

    /// 받아 둔 무료 버킷 스톡 클립이 하나라도 있는가.
    ///
    /// '목소리 받기' 게이트를 다시 띄울지 판정하는 데 쓴다 — 다운로드가 성공한 사람에게
    /// 콜드 스타트마다 다시 받으라고 하지 않기 위해서다(안드로이드도 캐시 개수로 본다).
    nonisolated var hasAnyStockClip: Bool {
        guard let directory = try? Self.audioDirectory() else { return false }
        let files = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        return files.contains { name in
            let (base, ext) = Self.splitName(name)
            return base.hasPrefix("stock_") && ext != "meta.json" && ext != "json"
        }
    }

    /// cacheKey 로 파일 URL 조회.
    /// 캐시에 든 파일이 **서버가 지금 주는 오디오와 다른 것**인가.
    ///
    /// 판정은 `audio_url` 비교 하나다. 서버가 새 음원을 새 R2 키에 올리므로 교체가
    /// 일어나면 이 값이 반드시 달라진다.
    ///
    /// ⚠ **모르면 stale 이 아니다.** 옛 버전이 저장한 메타에는 `rawAudioUri` 가 없고,
    /// 서버가 주지 않는 경로도 있다. 그때 stale 로 보면 **매번 다시 받는다** —
    /// 알람마다 네트워크를 타고 오프라인에서는 아예 못 쓴다.
    nonisolated static func isStaleCachedFile(
        at url: URL,
        storedFor cacheKey: String,
        incomingAudioUri: String?
    ) -> Bool {
        guard FileManager.default.fileExists(atPath: url.path) else { return false }
        guard let incoming = incomingAudioUri, !incoming.isEmpty else { return false }
        guard let stored = AudioCacheStore.shared.readMetadata(cacheKey: cacheKey)?.rawAudioUri,
              !stored.isEmpty else { return false }
        return stored != incoming
    }

    /// 서버가 준 `audio_url` 기준으로 이 키의 캐시가 낡았는지. 프리페치·선다운로드가
    /// "이미 있으니 건너뛴다" 를 판단할 때 이걸 함께 본다.
    nonisolated func isStale(cacheKey: String, remoteAudioUri: String?) -> Bool {
        guard let url = cachedURL(for: cacheKey) else { return false }
        return Self.isStaleCachedFile(at: url, storedFor: cacheKey, incomingAudioUri: remoteAudioUri)
    }

    nonisolated func cachedURL(for cacheKey: String) -> URL? {
        guard let directory = try? Self.audioDirectory() else { return nil }
        let safeKey = Self.safeCacheKey(cacheKey)
        let files = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        for name in files {
            let url = directory.appendingPathComponent(name)
            let (base, ext) = Self.splitName(name)
            if base == safeKey && ext != "meta.json" && ext != "json" {
                return url
            }
        }
        return nil
    }

    /// 메타 사이드카 조회.
    nonisolated func readMetadata(cacheKey: String) -> AudioCacheMetadata? {
        guard let url = metadataURL(cacheKey: cacheKey),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(AudioCacheMetadata.self, from: data)
    }

    nonisolated func writeMetadata(_ metadata: AudioCacheMetadata) throws {
        guard let url = metadataURL(cacheKey: metadata.cacheKey) else {
            throw AudioCacheError.appGroupContainerUnavailable
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(metadata)
        try data.write(to: url, options: Self.audioWriteOptions)
    }

    // MARK: - 입력 별칭 (같은 문구를 다시 만들지 않는다)

    /// **입력 키** — 같은 사람이 같은 목소리로 같은 문구를 다시 고르면 같은 값이 나온다.
    /// 안드로이드 `AlarmAudioStore.ttsInputKey`.
    ///
    /// 서버 캐시키(`ttsCacheKey`)와 다른 이유: 서버 키는 **응답을 받아야** 계산할 수 있다
    /// (표시 문구가 번역될 수 있어서). 저장 직전에 "이미 만들어 둔 게 있나" 를 묻는 데는
    /// **부르기 전에** 만들 수 있는 키가 필요하다.
    ///
    /// 키에 들어가는 것과 이유:
    ///  - `userId`·`profileId` — 사람과 목소리가 다르면 다른 음성이다
    ///  - `text` — 공백을 하나로 접어 비교한다(줄바꿈만 다른 같은 문구를 갈라놓지 않게)
    ///  - `category` — 같은 문구라도 카테고리가 다르면 서버가 다르게 만든다
    ///  - `language` — 번역 여부가 이 값으로 갈린다
    ///  - `listenerTitle` — 서버가 호칭을 문구 **안에** 병합하고, 공유 목소리는 보는
    ///    사람마다 호칭이 다르다. 빼면 '엄마 목소리로 아빠 호칭' 이 나온다
    nonisolated static func ttsInputKey(
        userId: String,
        profileId: String,
        text: String,
        category: String,
        language: String,
        listenerTitle: String?
    ) -> String {
        let normalizedText = text
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        return computeCacheKey(text: [
            "tts-input-v1",
            userId,
            profileId,
            normalizedText,
            normalizedTtsCategory(category),
            language,
            listenerTitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        ].joined(separator: "|"))
    }

    /// 입력 키 → (서버 캐시키, 서버 표시 문구) 별칭을 남긴다.
    ///
    /// 별칭은 오디오와 **같은 사이드카 형식**을 쓴다(새 파일 형식을 만들지 않는다).
    /// 스윕이 별칭을 지웠거나 오디오가 먼저 사라졌으면 조회가 nil 이 되어 서버 경로로
    /// 폴백한다 — 최악의 경우가 '지금과 똑같음' 이다.
    nonisolated func linkTtsInput(inputKey: String, serverCacheKey: String, displayText: String) {
        guard !inputKey.isEmpty, !serverCacheKey.isEmpty, inputKey != serverCacheKey else { return }
        guard !displayText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let alias = AudioCacheMetadata(
            cacheKey: inputKey,
            source: "tts_input_alias",
            mimeType: "",
            durationMs: nil,
            createdAtMillis: Int64(Date().timeIntervalSince1970 * 1000),
            messageId: nil,
            rawAudioUri: nil,
            aliasOf: serverCacheKey,
            aliasText: displayText
        )
        try? writeMetadata(alias)
    }

    /// `linkTtsInput` 이 남긴 별칭. 없거나 **가리키는 오디오가 사라졌으면** nil 이다.
    ///
    /// ⚠ 오디오 존재까지 확인한다 — 별칭만 보고 재사용하면 파일이 스윕된 뒤에도
    /// '캐시 히트' 라고 판단해 소리 없는 알람을 저장한다.
    nonisolated func resolveTtsInput(inputKey: String) -> TtsInputAlias? {
        guard !inputKey.isEmpty,
              let meta = readMetadata(cacheKey: inputKey),
              let target = meta.aliasOf, !target.isEmpty,
              let text = meta.aliasText, !text.isEmpty,
              cachedURL(for: target) != nil
        else { return nil }
        return TtsInputAlias(cacheKey: target, displayText: text)
    }

    /// 단일 cacheKey 의 파일 + 사이드카 삭제.
    /// Android `AlarmAudioStore.deleteCachedAudio` 와 동일 의미.
    nonisolated func deleteCachedAudio(cacheKey: String) throws {
        guard let directory = try? Self.audioDirectory() else { return }
        let safeKey = Self.safeCacheKey(cacheKey)
        let files = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        for name in files {
            let (base, _) = Self.splitName(name)
            if base == safeKey {
                let url = directory.appendingPathComponent(name)
                try? FileManager.default.removeItem(at: url)
            }
        }
    }

    /// 호출자가 LocalAlarmStore 의 모든 audioCacheKey 를 모아 전달하면
    /// 캐시 디렉터리에서 어디에도 참조되지 않는 파일을 삭제한다.
    func cascadeCleanup(activeCacheKeys: Set<String>) throws {
        let directory = try Self.audioDirectory()
        let active = Set(activeCacheKeys.map { Self.safeCacheKey($0) })
        let files = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        for name in files {
            let (base, _) = Self.splitName(name)
            if !active.contains(base) {
                let url = directory.appendingPathComponent(name)
                try? FileManager.default.removeItem(at: url)
            }
        }
    }

    // MARK: Stale sweep

    /// 미참조 캐시 음원의 보존 기한 (30일).
    nonisolated static let staleCacheMaxAgeMillis: Int64 = 30 * 24 * 60 * 60 * 1000

    /// 앱 시작 시 1회 백그라운드로 호출되는 캐시 청소.
    ///
    /// 정책:
    ///   - `activeCacheKeys` (현재 알람들이 참조 중인 audioCacheKey 집합) 는
    ///     나이와 무관하게 건너뛴다 — 같은 키를 여러 알람이 공유할 수 있으므로
    ///     호출자가 전체 알람의 키를 모아 전달해야 한다.
    ///   - 메타 사이드카의 `createdAtMillis` (없으면 파일 생성/수정 시각) 기준으로
    ///     30일이 지난 음원과 그 사이드카를 함께 삭제한다.
    ///   - 본체 음원이 없는 고아 `.meta.json` 은 나이와 무관하게 즉시 제거한다.
    ///
    /// actor state 를 건드리지 않고 파일 I/O 만 수행하므로 `nonisolated` —
    /// `Task.detached` 등 백그라운드 컨텍스트에서 실행해도 안전하다.
    nonisolated func sweepStaleCache(
        activeCacheKeys: Set<String>,
        nowMillis: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    ) {
        guard let directory = try? Self.audioDirectory() else { return }
        let fileManager = FileManager.default
        let names = (try? fileManager.contentsOfDirectory(atPath: directory.path)) ?? []
        guard !names.isEmpty else { return }

        let active = Set(activeCacheKeys.map { Self.safeCacheKey($0) })

        // base(safeCacheKey) 단위로 음원과 사이드카를 묶어 함께 판정한다.
        var namesByBase: [String: [String]] = [:]
        for name in names {
            namesByBase[Self.splitName(name).base, default: []].append(name)
        }

        for (base, grouped) in namesByBase {
            if active.contains(base) { continue }
            // ⚠ **스톡 클립은 나이로 지우지 않는다.** 이건 사용자가 만든 게 아니라 앱이
            // 받아 둔 기본 자산이고, 알람이 지금 참조하지 않아도 **다음에 고를 때 필요**하다.
            // 게다가 iOS 에는 받는 길이 최초 설치 화면 하나뿐이라, 한 번 지워지면
            // **다시 받을 방법이 없었다**(2026-08-11 확인). 안드로이드
            // `AlarmAudioStore.sweepStaleCache` 도 같은 예외를 갖고 있다 — iOS 만 빠져 있었다.
            if base.hasPrefix(Self.stockCacheKeyPrefix) { continue }

            let audioNames = grouped.filter { Self.splitName($0).ext != "meta.json" }

            // 고아 사이드카: 본체 음원이 사라졌으면 즉시 제거.
            if audioNames.isEmpty {
                for name in grouped {
                    try? fileManager.removeItem(at: directory.appendingPathComponent(name))
                }
                continue
            }

            // 생성 시각을 알 수 없으면 보수적으로 보존한다.
            guard let createdAtMillis = Self.entryCreatedAtMillis(
                base: base,
                audioNames: audioNames,
                directory: directory
            ) else { continue }

            if nowMillis - createdAtMillis >= Self.staleCacheMaxAgeMillis {
                for name in grouped {
                    try? fileManager.removeItem(at: directory.appendingPathComponent(name))
                }
            }
        }
    }

    /// 메타 사이드카의 `createdAtMillis` 우선, 없으면 음원 파일의 생성/수정 시각.
    private nonisolated static func entryCreatedAtMillis(
        base: String,
        audioNames: [String],
        directory: URL
    ) -> Int64? {
        let metaURL = directory.appendingPathComponent("\(base).meta.json")
        if let data = try? Data(contentsOf: metaURL),
           let metadata = try? JSONDecoder().decode(AudioCacheMetadata.self, from: data) {
            return metadata.createdAtMillis
        }
        guard let audioName = audioNames.first else { return nil }
        let audioURL = directory.appendingPathComponent(audioName)
        let attributes = try? FileManager.default.attributesOfItem(atPath: audioURL.path)
        let date = (attributes?[.creationDate] as? Date) ?? (attributes?[.modificationDate] as? Date)
        guard let date else { return nil }
        return Int64(date.timeIntervalSince1970 * 1000)
    }

    // MARK: Helpers

    /// 캐시 음원/메타 쓰기 시 적용하는 파일 보호 옵션.
    ///
    /// 알람음은 기기가 **잠긴 상태에서도** 재생돼야 하므로 가장 강한 `.complete`
    /// (잠금 중 복호화 불가) 는 쓸 수 없다. `.completeUntilFirstUserAuthentication`
    /// 은 부팅 후 사용자가 처음 잠금을 해제한 뒤부터 (이후 다시 잠겨도) 접근 가능
    /// 하므로, 잠금 화면 알람 재생을 보장하면서도 콜드 부트 직후 평문 노출을 막는다.
    /// (Android `EncryptedFile` 대비 iOS 의 동등 수준 보호.)
    nonisolated static let audioWriteOptions: Data.WritingOptions =
        [.atomic, .completeFileProtectionUntilFirstUserAuthentication]

    /// 메인 캐시 디렉토리. App Group 컨테이너가 있으면 위젯과 공유.
    /// 파일 시스템만 다루므로 `nonisolated` — 백그라운드 sweep 에서도 호출 가능.
    nonisolated static func audioDirectory() throws -> URL {
        let base: URL
        if let container = AppGroup.containerURL {
            base = container
        } else {
            let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            base = support
        }
        // ⚠ 테스트는 별도 디렉터리를 쓴다 — 안 그러면 기기에서 테스트를 돌릴 때마다
        // 받아 둔 스톡 클립이 함께 지워져 다음 로그인이 전부 다시 받는다(`TestIsolation`).
        let directory = base.appendingPathComponent(
            "audio-cache\(TestIsolation.storageSuffix)",
            isDirectory: true
        )
        if !FileManager.default.fileExists(atPath: directory.path) {
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
                // 잠금 화면 알람 재생 호환 — 첫 잠금 해제 이후 접근 가능한 보호 등급을
                // 디렉터리에 걸어 신규 캐시 파일이 상속하게 한다.
                attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
            )
        }
        return directory
    }

    /// Legacy 위치 (messageId 기반 파일명을 그대로 유지하는 디렉토리).
    /// 기존 `voiceStudio.preparedAlarm.localAudioFileName` 흐름이 여기에 의존.
    /// 파일 시스템만 다루므로 `nonisolated` — 백그라운드 캐싱에서도 호출 가능.
    nonisolated static func legacyAudioDirectory() throws -> URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        // ⚠ 여기도 테스트를 갈라야 한다(Codex #699 P2). `cache(tts:)` 가 이 옛 경로로
        // 파일을 쓰므로, 안 가르면 기기 테스트가 **사용자의 실제 음원 디렉터리**에 쓰고
        // id 가 겹치면 진짜 파일을 덮어쓴다 — `audio-cache` 만 가른 것으로는 부족했다.
        let directory = support.appendingPathComponent(
            "AlarmTalkAudio\(TestIsolation.storageSuffix)",
            isDirectory: true
        )
        if !FileManager.default.fileExists(atPath: directory.path) {
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
            )
        }
        return directory
    }

    private nonisolated func metadataURL(cacheKey: String) -> URL? {
        guard let directory = try? Self.audioDirectory() else { return nil }
        let safeKey = Self.safeCacheKey(cacheKey)
        return directory.appendingPathComponent("\(safeKey).meta.json")
    }

    /// Android `safeCacheKey` 와 동일 규칙: 소문자 + [^a-z0-9_-] → "_", 최대 96 자.
    nonisolated static func safeCacheKey(_ cacheKey: String) -> String {
        let lowered = cacheKey.lowercased()
        let sanitized = lowered.map { ch -> Character in
            if ("a"..."z").contains(ch) || ("0"..."9").contains(ch) || ch == "_" || ch == "-" {
                return ch
            }
            return "_"
        }
        let s = String(sanitized)
        if s.count <= 96 { return s }
        return String(s.prefix(96))
    }

    private nonisolated static func nonBlank(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    /// "abc.meta.json" → ("abc", "meta.json"), "abc.mp3" → ("abc", "mp3").
    nonisolated static func splitName(_ name: String) -> (base: String, ext: String) {
        if name.hasSuffix(".meta.json") {
            let base = String(name.dropLast(".meta.json".count))
            return (base, "meta.json")
        }
        if let dot = name.lastIndex(of: ".") {
            let base = String(name[..<dot])
            let ext = String(name[name.index(after: dot)...])
            return (base, ext)
        }
        return (name, "")
    }

    nonisolated static func normalizedFormat(_ value: String) -> String {
        let lowered = value
            .lowercased()
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let semicolon = lowered.firstIndex(of: ";") {
            return String(lowered[..<semicolon])
        }
        return lowered.isEmpty ? "mp3" : lowered
    }

    nonisolated static func mimeType(forFormat format: String) -> String {
        switch format.lowercased() {
        case "mp3": return "audio/mpeg"
        case "m4a", "aac": return "audio/aac"
        case "wav": return "audio/wav"
        case "ogg": return "audio/ogg"
        default: return "audio/\(format)"
        }
    }

    nonisolated static func fileExtension(forMimeType mimeType: String) -> String {
        switch mimeType.lowercased() {
        case "audio/mpeg", "audio/mp3": return "mp3"
        case "audio/aac", "audio/mp4": return "m4a"
        case "audio/wav", "audio/x-wav": return "wav"
        case "audio/ogg": return "ogg"
        default:
            if let slash = mimeType.firstIndex(of: "/") {
                return String(mimeType[mimeType.index(after: slash)...])
            }
            return "bin"
        }
    }

    /// AVFoundation 으로 음원 길이 측정. 측정 실패 시 nil.
    /// (AVURLAsset 의 duration 은 동기 접근이 deprecated 이므로 단위 테스트 등에선
    /// CMTime 직접 추출. 본 phase 에서는 best-effort.)
    nonisolated static func readDurationMillis(url: URL) -> Int64? {
        #if canImport(AVFoundation)
        return AVAssetDurationReader.readMillis(url: url)
        #else
        return nil
        #endif
    }

    /// 비동기 길이 측정. `AVAsset.load(.duration)` 를 사용해 메인 액터를 막지 않는다
    /// (AlarmEditorSheet.readAudioDurationMs 와 동일 패턴). 측정 실패 시 nil.
    nonisolated static func loadDurationMillis(url: URL) async -> Int64? {
        #if canImport(AVFoundation)
        let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
        guard let cmTime = try? await asset.load(.duration),
              cmTime.isValid, !cmTime.isIndefinite else { return nil }
        let seconds = CMTimeGetSeconds(cmTime)
        guard seconds.isFinite, seconds >= 0 else { return nil }
        return Int64((seconds * 1000).rounded())
        #else
        return nil
        #endif
    }

    // MARK: - Auto-trim (change 6)

    /// 캐시된 음원이 30초(+tolerance)를 넘으면 첫 30초로 잘라 다시 저장하고 메타의
    /// durationMs 를 <=30s 로 갱신한다. 이렇게 해두면 `AlarmSoundResolver` 의
    /// withinLimit 검사가 통과돼 staging → `AlertSound.named` 경로를 타고,
    /// 기기가 잠긴 상태에서도 알람음이 울린다(제품 결정: reject 대신 auto-trim).
    ///
    /// 트림은 `AudioCropper.crop(start:0, end:30000)` (AVAssetExportSession m4a) 로
    /// 수행하며, 실패하면 원본을 그대로 두고 조용히 넘어간다 — 그 경우 resolver 가
    /// `.cachedAudio` in-app 폴백을 쓴다. 로컬 오디오는 저장 전에 사용자의 크롭
    /// 윈도우가 이미 적용돼 보통 <=30s 이므로 이 트림은 스톡/TTS·미크롭 경로에서만 발화한다.
    ///
    /// FileManager + AVAsset 만 다루므로 `nonisolated`. base64/I/O off-main 래퍼에서 호출된다.
    nonisolated func trimCachedAudioIfNeeded(cacheKey: String) async {
        #if canImport(AVFoundation)
        guard let url = cachedURL(for: cacheKey) else { return }
        let limit = AlarmAudioLimits.maxDurationMillis + AlarmAudioLimits.durationToleranceMillis
        guard let durationMs = await Self.loadDurationMillis(url: url), durationMs > limit else {
            return
        }
        let cap = Int(AlarmAudioLimits.maxDurationMillis)
        guard let trimmed = try? await AudioCropper.crop(source: url, startMs: 0, endMs: cap) else {
            // 트림 실패 — 원본 유지(메타 durationMs 도 그대로). resolver 가 in-app 폴백.
            return
        }
        defer { try? FileManager.default.removeItem(at: trimmed) }
        guard let data = try? Data(contentsOf: trimmed) else { return }

        // 트림 결과를 같은 cacheKey 자리에 덮어쓴다. 확장자가 바뀔 수 있으므로(.m4a)
        // 기존 음원 파일을 먼저 지우고, audio/aac(m4a) 로 다시 캐싱한다. 메타의
        // durationMs 는 실제 트림 길이(<=30s)로 다시 기록된다.
        let trimmedDuration = await Self.loadDurationMillis(url: trimmed) ?? AlarmAudioLimits.maxDurationMillis
        removeAudioFile(forCacheKey: cacheKey)
        _ = try? cacheBytes(
            data,
            cacheKey: cacheKey,
            mimeType: "audio/aac",
            source: "raw_audio",
            durationOverrideMs: min(trimmedDuration, AlarmAudioLimits.maxDurationMillis),
            enforceMaxDuration: false
        )
        // 트림 전 staged 파일이 남아 있으면 무효화해 다음 resolve 가 새 파일로 staging 한다.
        // AlarmSoundStaging 은 @MainActor 이므로 메인에서 정리한다.
        await MainActor.run { AlarmSoundStaging.clearStagedSound(forKey: cacheKey) }
        #endif
    }

    /// cacheKey 에 해당하는 음원 본체(메타 사이드카 제외)만 삭제한다. 트림 시 확장자가
    /// 달라질 수 있어 메타를 보존한 채 본체만 갈아끼우기 위해 사용한다.
    private nonisolated func removeAudioFile(forCacheKey cacheKey: String) {
        guard let directory = try? Self.audioDirectory() else { return }
        let safeKey = Self.safeCacheKey(cacheKey)
        let files = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        for name in files {
            let (base, ext) = Self.splitName(name)
            if base == safeKey, ext != "meta.json", ext != "json" {
                try? FileManager.default.removeItem(at: directory.appendingPathComponent(name))
            }
        }
    }
}

// MARK: - AVAsset Duration Reader (lazy import)
#if canImport(AVFoundation)
import AVFoundation

enum AVAssetDurationReader {
    static func readMillis(url: URL) -> Int64? {
        let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
        let cmTime = asset.duration
        if cmTime.isIndefinite || !cmTime.isValid { return nil }
        let seconds = CMTimeGetSeconds(cmTime)
        if !seconds.isFinite || seconds < 0 { return nil }
        return Int64((seconds * 1000).rounded())
    }
}
#endif
