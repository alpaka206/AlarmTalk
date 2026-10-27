#!/usr/bin/env python3
"""BGTask 콜백이 **메인 액터 격리를 물려받는 것**을 막는다.

2026-09-21 에 실제로 난 사고(Sentry ALARMTALK-IOS-4/-7/-8): `BGTaskScheduler.register` 의
런치 핸들러는 SDK 에서 `void (^)(BGTask *)` 로 들어온다 — **Sendable 표기가 없는** 클로저라,
표기 없이 `@MainActor` 타입 안에서 쓰면 그 격리를 그대로 물려받는다. 그런데 `using: nil` 은
헤더 문서대로 **기본 백그라운드 큐**다. Swift 6 이 클로저 진입부에 심은 동적 격리 검사가
거기서 즉시 실패하고(`dispatch_assert_queue(main)`) 프로세스가 죽는다.

왜 문법으로 잡나: 이 실패는 **기기에서 시스템이 task 를 배달할 때만** 드러난다. 컴파일도
통과하고, 시뮬레이터에서는 BGTask 가 아예 배달되지 않으며, 메인 액터에서 부르는 유닛
테스트도 초록이다. 그래서 `BackgroundSyncTask.runAndSchedule` 이 **한 번도 실행되지 않은 채**
여러 릴리스를 나갔다 — 토큰 롤링 갱신·못 끊은 예약 회수·목소리 접근권 재확인·push/pull·
날씨 variant·리컨사일러가 전부 죽은 코드였는데 크래시 말고는 아무 신호가 없었다.

검사하는 것 세 가지:
  1. `BGTaskScheduler...register(` 의 런치 핸들러 클로저에 `@Sendable` 이 있는가
  2. `expirationHandler = {` 에 `@Sendable` 이 있는가 (시스템이 어느 큐에서든 부른다)
  3. `TimelineView(...) {`·`Canvas {` 의 클로저에 `@Sendable` 이 있는가 — 같은 사고의 SwiftUI 판이다.
     iOS 27 의 SwiftUI 는 애니메이션 타임라인을 **그리기 전용 스레드**(`ViewGraphDisplayLink.asyncThread`)에서
     갱신하기도 해서, `body` 안에서 메인 액터를 물려받은 클로저가 그 자리에서 트랩했다(2026-10-14 1.2.13,
     같은 이슈 ALARMTALK-IOS-4 — `Views/Auth/AuthBackdrop.swift` 의 `SunriseScene`).

  4. `URLSession…Delegate` 를 따르는 타입이 `@MainActor` 가 아니고, 그 채택이 `@preconcurrency` 가 아닌가 — 같은 사고의
     델리게이트 판이다. background `URLSession` 은 델리게이트를 **세션의 delegate 큐**에서 부르고, iOS 가 다운로드를
     배달하려고 앱을 다시 띄운 실행에도 그렇다(`BackgroundClipDownloader`, 2026-10-27). 메인 액터 타입이 이 프로토콜을
     따르면 Swift 6 은 `nonisolated` 를 요구하거나(`@preconcurrency` 로 막으면) 진입부에 격리 검사를 심어 그 큐에서 트랩한다.
     한계: 타입 선언에서만 본다 — 다른 파일의 `@MainActor` 타입을 `extension` 으로 채택하면 놓친다(그 꼴은 이 저장소에 없다).

격리를 건너는 일은 클로저 **안에서** `Task { @MainActor in ... }` 로 명시적으로 한다.

테스트 디렉터리는 보지 않는다 — 더블에 꽂는 핸들러는 시스템 큐에서 불리지 않는다.

실행: python3 scripts/check-bgtask-handler-isolation.py   (문제가 있으면 exit 1)
      python3 scripts/check-bgtask-handler-isolation.py --self-test   # 검사기 자체만
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIRS = [
    ROOT / "apps/ios-native/AlarmTalk",
    ROOT / "apps/ios-native/AlarmTalkWidget",
    ROOT / "apps/ios-native/Shared",
]

REGISTER_CALL = re.compile(r"\.register\s*\(")
# 런치 핸들러가 열리는 자리: 인자 목록을 닫고 붙는 트레일링 클로저이거나 레이블 인자.
HANDLER_OPEN = re.compile(r"(?:\)\s*|launchHandler:\s*)\{")
EXPIRATION_ASSIGN = re.compile(r"expirationHandler\s*=\s*\{")
# SwiftUI 가 메인 밖에서 부를 수 있는 클로저를 받는 초기화. 이름 뒤에 `(` 나 `{` 가 오는 자리만 본다
# (`-> Canvas<EmptyView>` 같은 타입 표기는 건너뛴다). 클로저는 여러 줄에 걸쳐 열릴 수 있어 [render_closure_opens] 가
# 괄호를 따라 읽는다(코덱스 #901 — 한 줄 정규식은 `Canvas(` 다음 줄에서 여는 클로저를 놓쳤다).
RENDER_INIT = re.compile(r"\b(?:TimelineView|Canvas)\s*[({]")
# 괄호 안에서 이름표로 넘기는 클로저(`Canvas(renderer: { ... })`, `TimelineView(.x, content: { ... })`).
LABELED_CLOSURE = re.compile(r"\b(?:renderer|content)\s*:\s*\{")
# 초기화 하나를 따라 읽는 최대 줄 수.
RENDER_LOOKAHEAD = 20
COMMENT_START = ("//", "///", "*", "/*")
# `URLSession…Delegate` 를 채택하는 타입 선언(같은 줄의 상속 절).
URLSESSION_DELEGATE_DECL = re.compile(
    r"\b(?:class|actor|struct|extension)\s+\w+[^{]*:[^{]*\bURLSession\w*Delegate\b"
)
PRECONCURRENCY_URLSESSION = re.compile(r"@preconcurrency\s+URLSession\w*Delegate\b")
# 선언 앞 몇 줄의 특성(`@MainActor` 가 줄을 따로 쓴다).
ATTRIBUTE_LOOKBACK = 3

# register 호출이 줄바꿈으로 갈린 경우(`BGTaskScheduler.shared` 다음 줄에 `.register(`)까지 본다.
LOOKBACK = 3
# `register(` 에서 트레일링 클로저가 열릴 때까지 허용하는 줄 수.
LOOKAHEAD = 12


def is_comment(line: str) -> bool:
    return line.lstrip().startswith(COMMENT_START)


def has_sendable(lines: list[str], index: int, brace_end: int) -> bool:
    """`{` 바로 뒤에 `@Sendable` 이 오는가. 줄이 `{` 로 끝나면 다음 줄까지 본다."""
    tail = lines[index][brace_end:].strip()
    if not tail and index + 1 < len(lines):
        tail = lines[index + 1].strip()
    return tail.startswith("@Sendable")


def sendable_after(text: str, pos: int) -> bool:
    """[pos] 의 `{` 뒤(공백·줄바꿈을 건너뛰고)가 `@Sendable` 로 시작하는가."""
    return text[pos + 1:].lstrip().startswith("@Sendable")


def render_closure_opens(lines: list[str], index: int, start: int) -> list[int]:
    """`TimelineView`·`Canvas` 초기화 하나에서 `@Sendable` 없이 열린 클로저들의 줄 번호(0 기반).

    여러 줄을 이어 붙여 괄호를 따라간다 — 인자 목록 안의 이름표 클로저(`renderer:`·`content:`)와 인자 목록을 닫은
    뒤의 트레일링 클로저를 본다. 문자열·주석 안의 괄호는 이 저장소의 쓰임새에 없어 따로 다루지 않는다.
    """
    window = "\n".join(lines[index:index + RENDER_LOOKAHEAD])
    offsets = [0]
    for row in lines[index:index + RENDER_LOOKAHEAD]:
        offsets.append(offsets[-1] + len(row) + 1)

    def row_of(pos: int) -> int:
        for k in range(len(offsets) - 1):
            if pos < offsets[k + 1]:
                return index + k
        return index

    bad: list[int] = []
    cursor = start + RENDER_INIT.match(window, start).end() - start - 1
    if window[cursor] == "(":
        depth = 0
        close = None
        for pos in range(cursor, len(window)):
            ch = window[pos]
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    close = pos
                    break
        if close is None:
            return bad  # 창 안에서 닫히지 않는다 — 판단하지 않는다.
        for labeled in LABELED_CLOSURE.finditer(window, cursor, close):
            if not sendable_after(window, labeled.end() - 1):
                bad.append(row_of(labeled.start()))
        rest = window[close + 1:]
        stripped = rest.lstrip()
        if not stripped.startswith("{"):
            return bad  # 트레일링 클로저가 없다(이름표 클로저만 썼다).
        cursor = close + 1 + (len(rest) - len(stripped))
    if not sendable_after(window, cursor):
        bad.append(row_of(cursor))
    return bad


def check_file(path: Path, problems: list[str]) -> None:
    lines = path.read_text(encoding="utf-8").splitlines()
    rel = path.relative_to(ROOT)

    for index, line in enumerate(lines):
        if is_comment(line):
            continue

        if EXPIRATION_ASSIGN.search(line):
            match = EXPIRATION_ASSIGN.search(line)
            assert match is not None
            if not has_sendable(lines, index, match.end()):
                problems.append(
                    f"{rel}:{index + 1}: expirationHandler 클로저에 `@Sendable` 이 없다\n"
                    f"    {line.strip()}"
                )

        delegate_decl = URLSESSION_DELEGATE_DECL.search(line)
        if delegate_decl:
            # 선언 키워드 앞(같은 줄의 특성)과, 바로 위에 줄을 따로 쓴 특성들.
            attributes = [line[:delegate_decl.start()]]
            for back in range(1, ATTRIBUTE_LOOKBACK + 1):
                prior = lines[index - back].strip() if index - back >= 0 else ""
                if not prior.startswith("@"):
                    break
                attributes.append(prior)
            if any("@MainActor" in text for text in attributes) or PRECONCURRENCY_URLSESSION.search(line):
                problems.append(
                    f"{rel}:{index + 1}: URLSession 델리게이트 타입이 메인 액터 격리를 가진다\n"
                    f"    {line.strip()}"
                )

        for opened in RENDER_INIT.finditer(line):
            for row in render_closure_opens(lines, index, opened.start()):
                problems.append(
                    f"{rel}:{row + 1}: TimelineView·Canvas 클로저에 `@Sendable` 이 없다\n"
                    f"    {lines[index].strip()}"
                )

        if not REGISTER_CALL.search(line):
            continue
        window = "\n".join(lines[max(0, index - LOOKBACK):index + 1])
        if "BGTaskScheduler" not in window:
            continue
        for offset in range(0, LOOKAHEAD):
            cursor = index + offset
            if cursor >= len(lines) or is_comment(lines[cursor]):
                continue
            opened = HANDLER_OPEN.search(lines[cursor])
            if not opened:
                continue
            if not has_sendable(lines, cursor, opened.end()):
                problems.append(
                    f"{rel}:{cursor + 1}: 런치 핸들러 클로저에 `@Sendable` 이 없다\n"
                    f"    {lines[cursor].strip()}"
                )
            break


SELF_TEST_CASES: list[tuple[str, int]] = [
    # (스위프트 조각, 걸려야 하는 클로저 수)
    ("Canvas { context, size in }", 1),
    ("Canvas { @Sendable context, size in }", 0),
    ("Canvas(\n    opaque: false\n) { context, size in }", 1),  # 여러 줄 — 코덱스 #901
    ("Canvas(\n    opaque: false\n) { @Sendable context, size in }", 0),
    ("Canvas(renderer: { context, size in })", 1),
    ("Canvas(renderer: { @Sendable context, size in })", 0),
    ("TimelineView(.animation(minimumInterval: 1)) {\n    timeline in Text(\"x\")\n}", 1),  # 다음 줄의 `in`
    ("TimelineView(.animation) { @Sendable timeline in Text(\"x\") }", 0),
    ("func f() -> Canvas<EmptyView> { fatalError() }", 0),  # 타입 표기
    ("BGTaskScheduler.shared.register(forTaskWithIdentifier: id, using: nil) { task in }", 1),
    ("BGTaskScheduler.shared.register(forTaskWithIdentifier: id, using: nil) { @Sendable task in }", 0),
    ("task.expirationHandler = { work.cancel() }", 1),
    ("final class D: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {}", 0),
    ("@MainActor\nfinal class D: NSObject, URLSessionDownloadDelegate {}", 1),
    ("@MainActor final class D: NSObject, URLSessionDelegate {}", 1),
    ("final class D: NSObject, @preconcurrency URLSessionTaskDelegate {}", 1),
    ("@MainActor\nfinal class V: ObservableObject {}", 0),
]


def self_test() -> int:
    """검사기 자체를 시험한다 — 걸러야 할 것은 걸리고, 고친 꼴은 통과하는가."""
    import tempfile

    failures = 0
    for snippet, expected in SELF_TEST_CASES:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Probe.swift"
            path.write_text(snippet + "\n", encoding="utf-8")
            problems: list[str] = []
            global ROOT
            saved, ROOT = ROOT, Path(tmp)
            try:
                check_file(path, problems)
            finally:
                ROOT = saved
        if len(problems) != expected:
            failures += 1
            print(f"자체 시험 실패: 기대 {expected} 건, 실제 {len(problems)} 건\n    {snippet!r}")
    if failures:
        return 1
    print(f"check-bgtask-handler-isolation 자체 시험 통과({len(SELF_TEST_CASES)}건).")
    return 0


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return self_test()
    problems: list[str] = []
    for directory in SOURCE_DIRS:
        if not directory.is_dir():
            continue
        for path in sorted(directory.rglob("*.swift")):
            check_file(path, problems)

    if problems:
        print("시스템·SwiftUI 가 메인 밖에서 부르는 콜백이 메인 액터 격리를 물려받는다:\n")
        for problem in problems:
            print(f"  {problem}\n")
        print(
            "표기가 없는 클로저는 감싸는 `@MainActor` 타입의 격리를 물려받는데, 시스템은\n"
            "그 콜백을 **기본 백그라운드 큐**에서 부른다 — 배달되는 즉시 트랩한다\n"
            "(2026-09-21 Sentry ALARMTALK-IOS-4/-7/-8). TimelineView·Canvas 는 SwiftUI 가 그리기 스레드에서\n"
            "부른다(2026-10-14 같은 이슈) — 그리는 코드는 `View` 밖의 타입에 둔다(`SunriseSceneRenderer`).\n"
            "클로저를 `{ @Sendable ... in` 으로 열고, 메인 액터로 건너뛰는 일은 그 안에서\n"
            "`Task { @MainActor in ... }` 로 명시적으로 할 것 — `BackgroundSyncTask.handleLaunch` 가 그 꼴이다.\n"
            "URLSession 델리게이트는 메인 액터가 아닌 타입에 두고(`BackgroundClipDownloader`), 메인 일은 안에서 넘긴다."
        )
        return 1

    print("BGTask·SwiftUI 렌더·URLSession 델리게이트 격리 검사 통과")
    return 0


if __name__ == "__main__":
    sys.exit(main())
