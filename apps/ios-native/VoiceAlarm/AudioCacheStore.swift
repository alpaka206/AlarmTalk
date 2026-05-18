import Foundation

struct CachedVoiceAudio: Equatable {
    var url: URL
    var fileName: String
    var format: String
}

enum AudioCacheStore {
    static func cache(tts: TtsGenerateResponse) throws -> CachedVoiceAudio {
        guard let data = Data(base64Encoded: tts.audioBase64) else {
            throw AudioCacheError.invalidBase64
        }
        let format = normalizedFormat(tts.audioFormat)
        let fileName = "\(tts.messageId).\(format)"
        let url = try audioDirectory().appendingPathComponent(fileName)
        try data.write(to: url, options: [.atomic])
        return CachedVoiceAudio(url: url, fileName: fileName, format: format)
    }

    static func url(for fileName: String) throws -> URL {
        try audioDirectory().appendingPathComponent(fileName)
    }

    static func exists(fileName: String) -> Bool {
        guard let url = try? url(for: fileName) else { return false }
        return FileManager.default.fileExists(atPath: url.path)
    }

    private static func audioDirectory() throws -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let directory = base.appendingPathComponent("VoiceAlarmAudio", isDirectory: true)
        if !FileManager.default.fileExists(atPath: directory.path) {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        return directory
    }

    private static func normalizedFormat(_ value: String) -> String {
        let lowered = value.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        return lowered.isEmpty ? "mp3" : lowered
    }
}

enum AudioCacheError: LocalizedError {
    case invalidBase64

    var errorDescription: String? {
        switch self {
        case .invalidBase64:
            return "Generated audio was not valid base64."
        }
    }
}
