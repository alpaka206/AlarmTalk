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
        guard let data = Data(base64Encoded: tts.audioBase64) else {
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
        guard let data = Data(base64Encoded: response.audioBase64) else {
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
    nonisolated static func stockCacheKey(messageId: String) -> String { "stock_\(messageId)" }

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

    nonisolated static func exists(fileName: String) -> Bool {
        guard let url = try? Self.url(for: fileName) else { return false }
        return FileManager.default.fileExists(atPath: url.path)
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

        if !FileManager.default.fileExists(atPath: target.path) {
            do {
                try data.write(to: target, options: Self.audioWriteOptions)
            } catch {
                throw AudioCacheError.writeFailed(error)
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

    /// cacheKey 로 파일 URL 조회.
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
        let directory = base.appendingPathComponent("audio-cache", isDirectory: true)
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
        let directory = support.appendingPathComponent("AlarmTalkAudio", isDirectory: true)
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
