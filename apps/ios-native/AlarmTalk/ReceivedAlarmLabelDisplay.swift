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

/// 받은 알람의 녹음 문구 표시 — 안드로이드 `data/ReceivedAlarmLabels.kt` 의
/// `localizedReceivedVoiceText` 와 짝이다.
enum ReceivedVoiceTextDisplay {
    /// 가족 알람으로 보낸 녹음의 기본 라벨 — **저장·전송 계약값**이라 번역하지 않는다
    /// (`docs/spec/localization.md` §2). 서버 `routes/family-alarm.ts` 의 `DEFAULT_VOICE_LABEL`,
    /// 안드로이드 `FAMILY_VOICE_DEFAULT_LABEL` 과 같은 글자여야 한다.
    static let familyVoiceDefault = "가족이 보낸 음성"

    /// 계약값 대신 번역문을 보내던 안드로이드 빌드가 남긴 값. 계약값과 같은 뜻으로 읽는다.
    private static let legacyFamilyVoiceLabels: Set<String> = ["Voice from family", "家族からの音声"]

    /// 기본 라벨(계약값)만 현재 언어의 문구로 바꾸고, 보낸 사람이 직접 친 라벨은 그대로 둔다.
    /// 보낸 사람은 가족일 수도 커플 상대일 수도 있어 '가족' 이라고 단정하지 않는다(§3).
    static func text(_ stored: String, bundle: Bundle = .main) -> String {
        let value = stored.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value == familyVoiceDefault || legacyFamilyVoiceLabels.contains(value) else { return stored }
        return String(localized: "상대가 보낸 음성", bundle: bundle)
    }
}

extension LocalAlarmRecord {
    var localizedDisplayLabel: String {
        originEnum == .receivedRemote ? ReceivedAlarmLabelDisplay.label(label) : label
    }

    /// 울림 화면(Live Activity)에 실을 녹음 문구. 받은 알람의 기본 라벨만 이 기기 언어로 바꾼다.
    /// ⚠ **표시에서만 바꾼다** — 저장값(`voiceText`)을 번역문으로 덮지 않는다.
    var localizedVoiceText: String? {
        guard let voiceText, originEnum == .receivedRemote else { return voiceText }
        return ReceivedVoiceTextDisplay.text(voiceText)
    }
}
