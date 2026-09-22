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

검사하는 것 두 가지:
  1. `BGTaskScheduler...register(` 의 런치 핸들러 클로저에 `@Sendable` 이 있는가
  2. `expirationHandler = {` 에 `@Sendable` 이 있는가 (시스템이 어느 큐에서든 부른다)

격리를 건너는 일은 클로저 **안에서** `Task { @MainActor in ... }` 로 명시적으로 한다.

테스트 디렉터리는 보지 않는다 — 더블에 꽂는 핸들러는 시스템 큐에서 불리지 않는다.

실행: python3 scripts/check-bgtask-handler-isolation.py   (문제가 있으면 exit 1)
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
COMMENT_START = ("//", "///", "*", "/*")

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


def main() -> int:
    problems: list[str] = []
    for directory in SOURCE_DIRS:
        if not directory.is_dir():
            continue
        for path in sorted(directory.rglob("*.swift")):
            check_file(path, problems)

    if problems:
        print("BGTask 콜백이 메인 액터 격리를 물려받는다:\n")
        for problem in problems:
            print(f"  {problem}\n")
        print(
            "표기가 없는 클로저는 감싸는 `@MainActor` 타입의 격리를 물려받는데, 시스템은\n"
            "그 콜백을 **기본 백그라운드 큐**에서 부른다 — 배달되는 즉시 트랩한다\n"
            "(2026-09-21 Sentry ALARMTALK-IOS-4/-7/-8).\n"
            "클로저를 `{ @Sendable ... in` 으로 열고, 메인 액터로 건너뛰는 일은 그 안에서\n"
            "`Task { @MainActor in ... }` 로 명시적으로 할 것 — `BackgroundSyncTask.handleLaunch` 가 그 꼴이다."
        )
        return 1

    print("BGTask 콜백 격리 검사 통과")
    return 0


if __name__ == "__main__":
    sys.exit(main())
