import Foundation

#if canImport(AlarmKit)
import AlarmKit

struct VoiceAlarmMetadata: AlarmMetadata, Codable, Hashable, Sendable {
    var localAlarmID: String
    var label: String
}
#endif
