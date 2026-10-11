import Foundation
import XCTest

/// **앱 소스를 글자로 읽는다** — 뷰의 `private` 함수·`@State` 배선처럼 유닛 테스트가 부를 수 없는 규칙을 볼 때만
/// 쓴다(안드로이드 배선 테스트처럼 소스를 읽어 본다). 부를 수 있는 규칙은 순수 셈으로 떼어 내 직접 부른다.
enum AppSourceText {
    /// 앱 소스 한 파일(`AlarmTalk/` 아래 경로). 소스 트리가 없는 곳(실기기)에서는 건너뛴다. 소스 트리가 있는데 그
    /// 파일이 없으면 **실패한다** — 파일을 옮기고 그 테스트를 잊었을 때 조용히 건너뛰지 않게.
    static func read(_ relativePath: String, testFile: StaticString = #filePath) throws -> String {
        let testURL = URL(fileURLWithPath: "\(testFile)")
        guard FileManager.default.fileExists(atPath: testURL.path) else {
            throw XCTSkip("소스 트리가 없는 기기다 — 소스 배선은 시뮬레이터에서 본다")
        }
        let appURL = testURL.deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("AlarmTalk", isDirectory: true)
            .appendingPathComponent(relativePath)
        return try String(contentsOf: appURL, encoding: .utf8)
    }

    /// `start` 부터 그 뒤 처음 나오는 `end` 앞까지. 못 찾으면 실패한다 — 소스 구조가 바뀌면 그 테스트도 함께 고친다.
    static func region(of text: String, from start: String, to end: String) throws -> Substring {
        let head = try XCTUnwrap(text.range(of: start), "소스에서 못 찾았다: \(start)")
        let tail = try XCTUnwrap(text.range(of: end, range: head.upperBound..<text.endIndex), "소스에서 못 찾았다: \(end)")
        return text[head.lowerBound..<tail.lowerBound]
    }
}
