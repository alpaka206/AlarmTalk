import Foundation

/// 메인 앱과 위젯이 공유하는 알람 스냅샷의 JSON 표현.
///
/// Phase 2-B1 에서 `LocalAlarmRecord` 의 33필드 모델과 정합시키며 필드를 확장한다.
/// 위젯/Live Activity 는 풀 모델을 알 필요가 없고, 진행 중인 알람 화면을 그리는 데
/// 필요한 최소 필드만 갖는다.
public struct SharedAlarmSnapshot: Codable, Hashable, Sendable {
    public var alarmID: String
    public var label: String
    public var firesAt: Date
    public var voiceClipFilename: String?
    public var voiceCacheKey: String?
    public var voiceLanguage: String?
    public var playMode: String?
    public var vibrationPattern: String?

    public init(
        alarmID: String,
        label: String,
        firesAt: Date,
        voiceClipFilename: String? = nil,
        voiceCacheKey: String? = nil,
        voiceLanguage: String? = nil,
        playMode: String? = nil,
        vibrationPattern: String? = nil
    ) {
        self.alarmID = alarmID
        self.label = label
        self.firesAt = firesAt
        self.voiceClipFilename = voiceClipFilename
        self.voiceCacheKey = voiceCacheKey
        self.voiceLanguage = voiceLanguage
        self.playMode = playMode
        self.vibrationPattern = vibrationPattern
    }

    /// Decodable 호환: 구버전 JSON 에 신규 필드가 없어도 디코딩 가능.
    public enum CodingKeys: String, CodingKey {
        case alarmID
        case label
        case firesAt
        case voiceClipFilename
        case voiceCacheKey
        case voiceLanguage
        case playMode
        case vibrationPattern
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.alarmID = try c.decode(String.self, forKey: .alarmID)
        self.label = try c.decode(String.self, forKey: .label)
        self.firesAt = try c.decode(Date.self, forKey: .firesAt)
        self.voiceClipFilename = try c.decodeIfPresent(String.self, forKey: .voiceClipFilename)
        self.voiceCacheKey = try c.decodeIfPresent(String.self, forKey: .voiceCacheKey)
        self.voiceLanguage = try c.decodeIfPresent(String.self, forKey: .voiceLanguage)
        self.playMode = try c.decodeIfPresent(String.self, forKey: .playMode)
        self.vibrationPattern = try c.decodeIfPresent(String.self, forKey: .vibrationPattern)
    }
}

/// 공유 컨테이너에 알람 스냅샷을 저장/조회하는 헬퍼.
///
/// App Group 컨테이너가 비활성화된 빌드(예: 시뮬레이터 초기 부팅 직후)에서는
/// 메인 앱의 documentDirectory 폴백을 사용해 graceful degradation 한다.
/// 위젯은 폴백 경로를 읽을 수 없으니 빈 배열을 반환하는 케이스를 호출부가 처리해야 한다.
public enum SharedAlarmCache {
    public static let filename = "shared-alarms.json"

    public enum CacheError: Error {
        case appGroupUnavailable
        case encodingFailed(Error)
        case decodingFailed(Error)
        case writeFailed(Error)
    }

    /// 캐시 파일의 절대 경로. App Group 우선, 미설정 시 documentDirectory.
    public static var fileURL: URL? {
        if let container = AppGroup.containerURL {
            return container.appendingPathComponent(filename, isDirectory: false)
        }
        // 폴백: documentDirectory (메인 앱 전용. 위젯은 nil 반환과 동등하게 처리할 것).
        if let doc = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
            return doc.appendingPathComponent(filename, isDirectory: false)
        }
        return nil
    }

    /// App Group 컨테이너 사용 가능 여부.
    public static var hasAppGroupContainer: Bool {
        AppGroup.containerURL != nil
    }

    /// 디스크에서 알람 스냅샷 배열을 읽어온다. 파일이 없으면 빈 배열.
    public static func load() throws -> [SharedAlarmSnapshot] {
        guard let url = fileURL else {
            // App Group 도 폴백도 불가한 비정상 케이스.
            throw CacheError.appGroupUnavailable
        }
        guard FileManager.default.fileExists(atPath: url.path) else {
            return []
        }
        do {
            let data = try Data(contentsOf: url)
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            return try decoder.decode([SharedAlarmSnapshot].self, from: data)
        } catch {
            throw CacheError.decodingFailed(error)
        }
    }

    /// 알람 스냅샷 배열을 원자적으로 기록한다.
    public static func save(_ snapshots: [SharedAlarmSnapshot]) throws {
        guard let url = fileURL else {
            throw CacheError.appGroupUnavailable
        }
        do {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            encoder.outputFormatting = [.sortedKeys]
            let data = try encoder.encode(snapshots)
            try data.write(to: url, options: [.atomic])
        } catch let error as EncodingError {
            throw CacheError.encodingFailed(error)
        } catch {
            throw CacheError.writeFailed(error)
        }
    }
}
