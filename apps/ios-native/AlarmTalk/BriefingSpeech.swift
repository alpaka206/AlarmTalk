import Foundation

/// 아침 소식 항목 → 목소리로 만들 **한 문단**(200자 이하). 서버 `lib/briefing/speech.ts` 의 `composeBriefingSpeech` 와 **같은
/// 문장**이다(`docs/spec/morning-briefing.md` §6·§8). 안드로이드 짝은 `ui/briefing/BriefingSpeech.kt`.
///
/// ⚠ 원천이 준 사실만 말한다. "최신"·"새로운"·전망·평가·매수/매도를 넣지 않는다. 시각은 말하지 않는다.
/// ⚠ 문장은 언제나 한국어다 — 낭독 입력(`language: ko`)이고 원천 글이 한국어라 화면 언어로 옮기지 않는다.
enum BriefingSpeech {
    /// 직접 입력 상한과 같다. UTF-16 길이로 센다(서버 JS 길이와 같은 단위).
    static let maxLength = 200

    private static let closing = "자세한 내용은 원문에서 확인해주세요."

    private static let kst = TimeZone(identifier: "Asia/Seoul")!

    /// ISO 시각 → 한국 날짜(`YYYY-MM-DD`). 읽지 못하면 nil.
    static func kstDate(_ iso: String?) -> String? {
        guard let iso, let date = parseInstant(iso) else { return nil }
        return ymd(date)
    }

    static func todayKst(_ now: Date = Date()) -> String { ymd(now) }

    static func disclosure(_ item: BriefingDisclosure, checkedDate: String) -> String {
        let corp = truncate(speakable(item.corpName), 40)
        let withdrawn = item.flags.withdrawn ? " 이 공시는 철회되었습니다." : ""
        return fit(
            head: "\(monthDay(checkedDate)) 확인한 \(corp)의 공시입니다.\(withdrawn) 보고서명은 ",
            slot: speakable(item.reportName),
            tail: "입니다. \(closing)"
        )
    }

    static func policyNews(_ item: BriefingPolicyNews, checkedDate: String) -> String {
        fit(
            head: "\(monthDay(checkedDate)) 확인한 정책브리핑 정책뉴스입니다. 제목은 ",
            slot: speakable(item.title),
            tail: "입니다. \(closing)"
        )
    }

    /// 항목의 `fetchedAt`(이 내용으로 처음 받아 둔 날)이 '확인한 날' 이다 — 다시 확인만 해서는 문장이 바뀌지 않는다.
    static func disclosure(_ item: BriefingDisclosure) -> String {
        disclosure(item, checkedDate: kstDate(item.fetchedAt) ?? todayKst())
    }

    static func policyNews(_ item: BriefingPolicyNews) -> String {
        policyNews(item, checkedDate: kstDate(item.fetchedAt) ?? todayKst())
    }

    /// `[기재정정]사업보고서` → `기재정정 사업보고서`.
    static func speakable(_ text: String) -> String {
        cleanText(text.replacingOccurrences(of: #"\[([^\]]*)\]"#, with: " $1 ", options: .regularExpression))
    }

    /// 서버 `cleanText` 와 같다 — 줄바꿈·탭은 공백, 제어·제로폭·양방향 제어문자는 지우고, 공백을 하나로.
    static func cleanText(_ text: String) -> String {
        var scalars = String.UnicodeScalarView()
        for scalar in text.unicodeScalars {
            switch scalar.value {
            case 0x09, 0x0A, 0x0B, 0x0C, 0x0D: scalars.append(" ")
            case 0x00...0x1F, 0x7F...0x9F: continue
            case 0x200B...0x200F, 0x2028...0x202E, 0x2060...0x2069, 0xFEFF: continue
            default: scalars.append(scalar)
            }
        }
        return String(scalars)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    /// 서버 `truncateText` 와 같다 — 넘치면 `max - 1` 단위 안에서 **유니코드 스칼라 단위로** 자르고 '…' 를 붙인다(서러게이트
    /// 쌍을 가르지 않는다). 길이는 UTF-16 단위다.
    static func truncate(_ text: String, _ max: Int) -> String {
        guard text.utf16.count > max else { return text }
        var out = String.UnicodeScalarView()
        var length = 0
        for scalar in text.unicodeScalars {
            let size = scalar.utf16.count
            if length + size > max - 1 { break }
            out.append(scalar)
            length += size
        }
        var trimmed = String(out)
        while let last = trimmed.unicodeScalars.last, CharacterSet.whitespaces.contains(last) {
            trimmed.unicodeScalars.removeLast()
        }
        return trimmed + "…"
    }

    private static func fit(head: String, slot: String, tail: String) -> String {
        let room = maxLength - head.utf16.count - tail.utf16.count
        return head + truncate(slot, Swift.max(room, 1)) + tail
    }

    private static func monthDay(_ ymd: String) -> String {
        let parts = ymd.split(separator: "-")
        guard parts.count == 3, let month = Int(parts[1]), let day = Int(parts[2]) else { return ymd }
        return "\(String(month))월 \(String(day))일"
    }

    private static func ymd(_ date: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = kst
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    static func parseInstant(_ iso: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: iso) { return date }
        return ISO8601DateFormatter().date(from: iso)
    }
}
