import XCTest
@testable import AlarmTalk

/// 동의 화면이 읽는 **번들 법무 문서**.
///
/// ⚠ 이게 깨지면 동의 화면이 랜딩 웹으로 떨어지고, 그러면 출시 뒤 문서가 개정될 때
/// **보여 준 것과 기록한 버전이 달라진다**(코덱스 #730 2차). 렌더 규칙은 안드로이드
/// `renderLegalMarkdown` 과 같아야 한다(`LegalMarkdownRenderTest.kt` 와 같은 범위).
final class BundledLegalDocumentTests: XCTestCase {

    func test_두_문서가_번들에_실려_있다() throws {
        for doc in BundledLegalDocument.allCases {
            // 기본값(`Bundle.main`)을 그대로 쓴다 — 호스트 앱 번들이라 프로덕션과 같은 경로다.
            let markdown = try XCTUnwrap(
                doc.markdown(),
                "\(doc.title) 이 번들에 없다 — project.yml 의 docs/legal 리소스를 확인할 것"
            )
            XCTAssertFalse(markdown.isEmpty)
        }
    }

    func test_번들_문서의_정책_버전이_앱이_제출하는_버전과_같다() throws {
        // ⚠ 이 둘이 갈라지면 서버가 409(POLICY_VERSION_MISMATCH)로 동의를 전부 거절한다.
        let markdown = try XCTUnwrap(BundledLegalDocument.privacy.markdown())
        let line = markdown
            .components(separatedBy: .newlines)
            .first { $0.hasPrefix("정책 버전:") }
        let version = try XCTUnwrap(line)
            .replacingOccurrences(of: "정책 버전:", with: "")
            .trimmingCharacters(in: .whitespaces)
        XCTAssertEqual(version, LegalPolicy.bundledVersion,
                       "번들 문서의 정책 버전과 앱이 제출하는 버전이 다르다")
    }

    func test_표_구분선은_본문에_남지_않는다() {
        let rendered = renderLegalMarkdown("| 항목 | 값 |\n|---|---|\n| 수탁사 | ElevenLabs |")
        let text = String(rendered.characters)
        XCTAssertFalse(text.contains("---"), "표 구분선이 본문에 남았다")
        XCTAssertTrue(text.contains("항목: 수탁사"), "헤더를 라벨로 풀지 않았다")
        XCTAssertTrue(text.contains("값: ElevenLabs"))
    }

    func test_정렬_지정_구분선도_인식한다() {
        let rendered = renderLegalMarkdown("| 항목 | 값 |\n|:---|---:|\n| 가 | 나 |")
        XCTAssertFalse(String(rendered.characters).contains("---"))
    }

    func test_굵게와_불릿은_텍스트로_살아남는다() {
        let rendered = renderLegalMarkdown("- **필수**: 알람 시간")
        let text = String(rendered.characters)
        XCTAssertTrue(text.contains("• "), "불릿이 사라졌다")
        XCTAssertTrue(text.contains("필수"), "굵게 안의 글자가 사라졌다")
        XCTAssertFalse(text.contains("**"), "굵게 기호가 그대로 남았다")
    }

    func test_제목의_샵은_제거된다() {
        let rendered = renderLegalMarkdown("### 1.2 알람 설정 및 사용 기록")
        let text = String(rendered.characters)
        XCTAssertFalse(text.contains("#"))
        XCTAssertTrue(text.contains("1.2 알람 설정 및 사용 기록"))
    }

    func test_내부_문서는_번들에_실리지_않는다() {
        // ⚠ docs/legal 에는 사용자에게 보이면 안 되는 내부 문서가 함께 있다.
        // 폴더째 리소스로 넣으면 IPA 를 푼 누구나 읽는다 — 목록을 두 개로 묶어 둔다.
        for internalDoc in ["compliance-notes.ko", "README", "store-disclosures.ko"] {
            XCTAssertNil(
                Bundle.main.url(forResource: internalDoc, withExtension: "md"),
                "내부 문서 \(internalDoc).md 가 앱 번들에 실렸다 — project.yml 을 확인할 것"
            )
        }
    }
}
