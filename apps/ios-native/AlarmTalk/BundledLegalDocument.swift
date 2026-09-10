import Foundation
import SwiftUI

/**
 앱에 실린 법무 문서 전문.

 ⚠ **동의 화면은 반드시 이걸 읽는다 — 웹 문서를 띄우지 말 것**(코덱스 #730 2차).
 `submitConsents` 는 빌드 시점의 `LegalPolicy.bundledVersion` 을 보내는데, 화면이 랜딩의
 실시간 문서를 띄우면 IPA 출시 뒤 랜딩이 개정될 때 **보여 준 것과 기록한 버전이 달라진다.**
 번들본은 그 버전 상수와 **같은 빌드에서 나온 파일**이라 어긋날 수가 없고, 오프라인에서도
 보인다(동의는 가입 흐름이라 문서를 못 보면 진행이 막힌다).

 안드로이드도 같은 갈래다 — 동의 흐름은 번들 자산(`ui/auth/LegalDocument.kt`), 설정의
 뷰어는 랜딩 웹(`ui/settings/LegalDocumentScreen.kt`). 단일 출처는 양쪽 다 `docs/legal` 이다.
 */
enum BundledLegalDocument: String, CaseIterable {
    case privacy = "privacy-policy.ko"
    case terms = "terms-of-service.ko"

    var title: String {
        switch self {
        case .privacy: return "개인정보 처리방침"
        case .terms: return "서비스 이용약관"
        }
    }

    /// 번들에 실린 원문. 못 읽으면 nil — 호출부가 웹 뷰어로 떨어진다.
    ///
    /// 파일은 **번들 루트**에 있다(`project.yml` 이 `docs/legal` 의 두 파일을 개별
    /// 리소스로 넣는다 — 폴더째 넣으면 내부 문서까지 실린다). 라이선스 전문과 같은 자리다.
    func markdown(bundle: Bundle = .main) -> String? {
        guard let url = bundle.url(forResource: rawValue, withExtension: "md") else { return nil }
        return try? String(contentsOf: url, encoding: .utf8)
    }
}

/**
 법무 문서 마크다운을 폰에서 읽히는 텍스트로 만든다.

 ⚠ **안드로이드 `renderLegalMarkdown` 과 같은 규칙이어야 한다.** 렌더러 의존성을 새로
 들이지 않고 이 문서들이 실제로 쓰는 문법만 다룬다 — 제목, 굵게, 불릿, 표, 구분선.

 **표는 표로 그리지 않는다.** 처리방침의 위탁·국외이전 표는 5열이라 폰 폭에 절대 안 맞는다.
 헤더를 라벨로 삼아 행마다 `항목: 값` 블록으로 푸는 편이 가로 스크롤보다 훨씬 잘 읽힌다.
 */
func renderLegalMarkdown(_ markdown: String) -> AttributedString {
    var out = AttributedString()
    var tableHeader: [String]?
    var firstBlock = true

    func breakBlock() {
        if !firstBlock { out += AttributedString("\n\n") }
        firstBlock = false
    }

    func bold(_ text: String) -> AttributedString {
        var piece = AttributedString(text)
        piece.inlinePresentationIntent = .stronglyEmphasized
        return piece
    }

    /// `**굵게**` 와 `` `코드` `` 만 처리한다. 나머지 기호는 원문 그대로 둔다.
    func appendInline(_ text: String) {
        var rest = Substring(text.replacingOccurrences(of: "`", with: ""))
        while let open = rest.range(of: "**") {
            let after = rest[open.upperBound...]
            guard let close = after.range(of: "**") else { break }
            out += AttributedString(String(rest[rest.startIndex..<open.lowerBound]))
            out += bold(String(after[after.startIndex..<close.lowerBound]))
            rest = after[close.upperBound...]
        }
        out += AttributedString(String(rest))
    }

    func tableCells(_ line: String) -> [String] {
        line.trimmingCharacters(in: .whitespaces)
            .trimmingCharacters(in: CharacterSet(charactersIn: "|"))
            .split(separator: "|", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
    }

    for raw in markdown.components(separatedBy: .newlines) {
        let line = raw.replacingOccurrences(of: "\\s+$", with: "", options: .regularExpression)

        if line.trimmingCharacters(in: .whitespaces).isEmpty {
            tableHeader = nil
        } else if line.hasPrefix("#") {
            tableHeader = nil
            breakBlock()
            out += bold(line.drop(while: { $0 == "#" }).trimmingCharacters(in: .whitespaces))
        } else if line.hasPrefix("|"),
                  line.trimmingCharacters(in: CharacterSet(charactersIn: "|-: ")).isEmpty {
            // 표 구분선(|---|---|)은 그리지 않는다.
            continue
        } else if line.hasPrefix("|") {
            let cells = tableCells(line)
            if tableHeader == nil {
                tableHeader = cells
            } else {
                breakBlock()
                var wrote = false
                for (index, cell) in cells.enumerated() where !cell.isEmpty {
                    if wrote { out += AttributedString("\n") }
                    wrote = true
                    if let label = tableHeader?[safe: index], !label.isEmpty {
                        out += bold("\(label): ")
                    }
                    appendInline(cell)
                }
            }
        } else if line.hasPrefix("- ") || line.hasPrefix("* ") {
            tableHeader = nil
            breakBlock()
            out += AttributedString("• ")
            appendInline(String(line.dropFirst(2)))
        } else if line.hasPrefix("---") {
            tableHeader = nil
        } else {
            tableHeader = nil
            breakBlock()
            appendInline(line)
        }
    }
    return out
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
