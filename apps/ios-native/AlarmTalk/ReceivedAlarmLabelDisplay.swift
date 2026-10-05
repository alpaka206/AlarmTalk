import Foundation

enum ReceivedAlarmLabelDisplay {
    static func label(_ stored: String, bundle: Bundle = .main) -> String {
        let value = stored.trimmingCharacters(in: .whitespacesAndNewlines)
        // 옛 영어 빌드의 이름 없는 상대 표기.
        if value == "Alarm from your friend" { return receivedAlarmDisplayLabel(sender: nil, bundle: bundle) }
        for language in ["ko", "en", "ja"] {
            guard let path = Bundle.main.path(forResource: language, ofType: "lproj"),
                  let source = Bundle(path: path) else { continue }
            if value == source.localizedString(forKey: "상대가 보낸 알람", value: nil, table: nil) {
                return receivedAlarmDisplayLabel(sender: nil, bundle: bundle)
            }
            let format = source.localizedString(forKey: "%@이 보낸 알람", value: nil, table: nil)
            let pieces = format.components(separatedBy: "%@")
            guard pieces.count == 2, value.hasPrefix(pieces[0]), value.hasSuffix(pieces[1]),
                  value.count > pieces[0].count + pieces[1].count else { continue }
            var sender = String(value.dropFirst(pieces[0].count).dropLast(pieces[1].count))
            // 이름과 존칭이 한 칸에 저장된 옛 값. 일본어의 이중 さん도 한 번으로 복원한다.
            if language == "ko", sender.hasSuffix("님") { sender = String(sender.dropLast()) }
            if language == "ja", sender.hasSuffix("さん") {
                sender = String(sender.dropLast(2))
                if sender.hasSuffix("さん") { sender = String(sender.dropLast(2)) }
            }
            return receivedAlarmDisplayLabel(sender: sender, bundle: bundle)
        }
        return stored
    }
}

extension LocalAlarmRecord {
    var localizedDisplayLabel: String {
        originEnum == .receivedRemote ? ReceivedAlarmLabelDisplay.label(label) : label
    }
}
