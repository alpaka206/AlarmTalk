import CryptoKit
import Foundation

// MARK: - CachedVoiceAudio (legacy compat)

struct CachedVoiceAudio: Equatable {
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
    static let shared = AudioCacheStore()

    init() {}

    // MARK: Legacy API (기존 호출처 호환)

    /// 기존 `AudioCacheStore.cache(tts:)` 와 동일 시그니처.
    /// 새 cacheKey 규칙을 사용하지만, 파일명에는 messageId 도 살려 두기 위해 audio 파일은
    /// 기존 위치(`AlarmTalkAudio/<messageId>.<ext>`)에도 사본을 유지한다.
    static func cache(tts: TtsGenerateResponse) throws -> CachedVoiceAudio {
        return try cache(tts: tts, cacheKey: nil)
    }

    static func cache(tts: TtsGenerateResponse, cacheKey overrideCacheKey: String?) throws -> CachedVoiceAudio {
        guard let data = Data(base64Encoded: tts.audioBase64) else {
            throw AudioCacheError.invalidBase64
        }
        let format = Self.normalizedFormat(tts.audioFormat)
        let fileName = "\(tts.messageId).\(format)"
        let url = try Self.legacyAudioDirectory().appendingPathComponent(fileName)
        try data.write(to: url, options: [.atomic])

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

    /// Legacy URL 조회. messageId 기반 파일명용.
    static func url(for fileName: String) throws -> URL {
        try Self.legacyAudioDirectory().appendingPathComponent(fileName)
    }

    static func exists(fileName: String) -> Bool {
        guard let url = try? Self.url(for: fileName) else { return false }
        return FileManager.default.fileExists(atPath: url.path)
    }

    // MARK: cacheKey-based API

    /// SHA-256 hex 해시 계산 (64 char).
    static func computeCacheKey(_ data: Data) -> String {
        let digest = SHA256.hash(data: Data(data))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    /// SHA-256 over UTF-8 input (텍스트 기반 cacheKey 도 동일 규칙).
    static func computeCacheKey(text: String) -> String {
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
        return computeCacheKey(text: ["tts-v2", profileId, normalizedText, category, language].joined(separator: "|"))
    }

    /// bytes 를 cacheKey 기반 위치에 기록하고 메타 사이드카를 생성한다.
    /// - enforceMaxDuration: true 면 durationMs > AlarmAudioLimits.maxDurationMillis 일 때 throw.
    @discardableResult
    func cacheBytes(
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
                try data.write(to: target, options: [.atomic])
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
    func cachedURL(for cacheKey: String) -> URL? {
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
    func readMetadata(cacheKey: String) -> AudioCacheMetadata? {
        guard let url = metadataURL(cacheKey: cacheKey),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(AudioCacheMetadata.self, from: data)
    }

    func writeMetadata(_ metadata: AudioCacheMetadata) throws {
        guard let url = metadataURL(cacheKey: metadata.cacheKey) else {
            throw AudioCacheError.appGroupContainerUnavailable
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(metadata)
        try data.write(to: url, options: [.atomic])
    }

    /// 단일 cacheKey 의 파일 + 사이드카 삭제.
    /// Android `AlarmAudioStore.deleteCachedAudio` 와 동일 의미.
    func deleteCachedAudio(cacheKey: String) throws {
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

    // MARK: Helpers

    /// 메인 캐시 디렉토리. App Group 컨테이너가 있으면 위젯과 공유.
    static func audioDirectory() throws -> URL {
        let base: URL
        if let container = AppGroup.containerURL {
            base = container
        } else {
            let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            base = support
        }
        let directory = base.appendingPathComponent("audio-cache", isDirectory: true)
        if !FileManager.default.fileExists(atPath: directory.path) {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        return directory
    }

    /// Legacy 위치 (messageId 기반 파일명을 그대로 유지하는 디렉토리).
    /// 기존 `voiceStudio.preparedAlarm.localAudioFileName` 흐름이 여기에 의존.
    static func legacyAudioDirectory() throws -> URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let directory = support.appendingPathComponent("AlarmTalkAudio", isDirectory: true)
        if !FileManager.default.fileExists(atPath: directory.path) {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        return directory
    }

    private func metadataURL(cacheKey: String) -> URL? {
        guard let directory = try? Self.audioDirectory() else { return nil }
        let safeKey = Self.safeCacheKey(cacheKey)
        return directory.appendingPathComponent("\(safeKey).meta.json")
    }

    /// Android `safeCacheKey` 와 동일 규칙: 소문자 + [^a-z0-9_-] → "_", 최대 96 자.
    static func safeCacheKey(_ cacheKey: String) -> String {
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

    private static func nonBlank(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    /// "abc.meta.json" → ("abc", "meta.json"), "abc.mp3" → ("abc", "mp3").
    static func splitName(_ name: String) -> (base: String, ext: String) {
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

    static func fileExtension(forMimeType mimeType: String) -> String {
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
    static func readDurationMillis(url: URL) -> Int64? {
        #if canImport(AVFoundation)
        return AVAssetDurationReader.readMillis(url: url)
        #else
        return nil
        #endif
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
