#!/usr/bin/env python3
"""백그라운드 워커의 실패 마무리는 **한 곳을 지난다** — 우회를 CI 에서 막는다.

## 왜 있는가

`sync/` 의 `CoroutineWorker` 들은 `runCatching { ... }.getOrElse { Result.retry() }` 로
실패를 처리했다. 그 모양은 **401 을 재시도로 센다.** 폐기된 토큰으로 같은 요청을 영원히
다시 보내고(서버는 매번 같은 401 을 돌려준다), 회차마다 Sentry 이슈가 한 건씩 쌓인다
(2026-09-14 ANDROID-M). 취소(`CancellationException`)도 같이 삼켜 "Job was cancelled" 가
실사용자 이슈로 올라갔다.

판정을 `syncWorkerOutcome`(`sync/SyncWorkerFailure.kt`) 하나로 모았는데, **모으는 것만으로는
다음 워커가 빠지는 걸 못 막는다** — 실제로 1차 수정이 워커 **6개 중 3개**에만 닿았고
(`PlanChangeSyncWorker`·`VoiceAccessSyncWorker`·`StockClipPrefetchWorker` 가 옛 모양 그대로였다),
빠진 줄 아무도 몰랐다. 그래서 이 검사가 CI 에 있다.

## 무엇을 막는가

`sync/` 아래 `CoroutineWorker` 의 **실패 처리 블록**(`.getOrElse { }` / `catch ( ) { }`)이
`Result.retry()` 를 돌려주면서 `syncWorkerOutcome(...)` 을 거치지 않는 것.

일부러 좁게 잡았다:
 - `runCatching` **본문 안**의 `return@runCatching Result.retry()` 는 실패 분류가 아니라
   정상 흐름의 판단이라 보지 않는다(예: 매니페스트 공개 실패).
 - 바깥 처리 블록이 이미 `syncWorkerOutcome` 을 지나면 그 **안쪽** 블록은 통과시킨다.
   판정은 한 번만 하면 된다.
 - 네트워크를 안 타는 워커(`AlarmScheduleIntegrityWorker`)도 예외가 아니다 — 401 은 올 수
   없지만 **취소 되던지기**는 똑같이 필요하다(`RETHROW` 갈래).

고치는 법은 `SyncWorkerFailure.kt` 의 KDoc 에 있다.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SYNC_DIR = ROOT / "apps/android-native/app/src/main/java/com/alarmtalk/app/sync"

WORKER_DECL = re.compile(r":\s*CoroutineWorker\s*\(")
RETRY_CALL = re.compile(r"\bResult\s*\.\s*retry\s*\(")
OUTCOME_CALL = re.compile(r"\bsyncWorkerOutcome\s*\(")

GET_OR_ELSE = re.compile(r"\.\s*getOrElse\s*(\{)")
CATCH = re.compile(r"\bcatch\s*\(")


def strip_noise(text: str) -> str:
    """주석과 문자열 리터럴을 공백으로 지운다(오프셋·줄바꿈은 그대로).

    두 가지를 동시에 얻는다:
      - 규칙을 **설명하는** 주석(`Result.retry()` 를 인용한 KDoc)이 위반으로 잡히지 않는다.
      - 문자열 안의 중괄호·`${...}` 가 블록 균형을 망치지 않는다.
    """
    out = list(text)
    n = len(text)

    def blank(start: int, end: int) -> None:
        for k in range(start, end):
            if out[k] != "\n":
                out[k] = " "

    def scan_quoted(start: int, quote: str) -> int:
        j = start + 1
        while j < n:
            if text[j] == "\\":
                j += 2
                continue
            if text[j] == quote:
                return j + 1
            if text[j] == "\n":
                return j
            j += 1
        return n

    i = 0
    while i < n:
        if text.startswith("//", i):
            j = text.find("\n", i)
            j = n if j < 0 else j
            blank(i, j)
            i = j
        elif text.startswith("/*", i):
            j = text.find("*/", i + 2)
            j = n if j < 0 else j + 2
            blank(i, j)
            i = j
        elif text.startswith('"""', i):
            j = text.find('"""', i + 3)
            j = n if j < 0 else j + 3
            blank(i, j)
            i = j
        elif text[i] in ('"', "'"):
            j = scan_quoted(i, text[i])
            blank(i, j)
            i = j
        else:
            i += 1
    return "".join(out)


def _block_end(text: str, open_brace: int) -> int:
    """여는 중괄호의 짝이 맞는 닫는 중괄호 **다음** 오프셋."""
    depth = 0
    for i in range(open_brace, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return i + 1
    return len(text)


def _brace_after(text: str, start: int) -> int:
    """`catch ( ... )` 뒤에 오는 본문 중괄호의 오프셋(없으면 -1)."""
    depth = 0
    i = start
    while i < len(text):
        ch = text[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                j = i + 1
                while j < len(text) and text[j] in " \t\r\n":
                    j += 1
                return j if j < len(text) and text[j] == "{" else -1
        i += 1
    return -1


def handler_blocks(clean: str) -> list[tuple[int, int]]:
    """실패 처리 블록들의 (여는 중괄호, 끝) 목록."""
    blocks: list[tuple[int, int]] = []
    for match in GET_OR_ELSE.finditer(clean):
        brace = match.start(1)
        blocks.append((brace, _block_end(clean, brace)))
    for match in CATCH.finditer(clean):
        brace = _brace_after(clean, match.end() - 1)
        if brace >= 0:
            blocks.append((brace, _block_end(clean, brace)))
    return blocks


def find_problems(text: str) -> list[tuple[int, str]]:
    """판정을 거치지 않고 재시도하는 처리 블록의 (줄번호, 줄)."""
    clean = strip_noise(text)
    blocks = handler_blocks(clean)
    lines = text.splitlines()

    def line_of(offset: int) -> int:
        return clean.count("\n", 0, offset) + 1

    problems: list[tuple[int, str]] = []
    for start, end in blocks:
        body = clean[start:end]
        if not RETRY_CALL.search(body):
            continue
        # 자신 또는 자신을 감싸는 처리 블록 중 하나가 판정을 지나면 된다.
        covered = any(
            outer_start <= start and outer_end >= end and OUTCOME_CALL.search(clean[outer_start:outer_end])
            for outer_start, outer_end in blocks
        )
        if covered:
            continue
        lineno = line_of(start)
        raw = lines[lineno - 1].strip() if 0 < lineno <= len(lines) else ""
        problems.append((lineno, raw))
    return problems


# 검사 자신을 검증한다 — 형제 검사(`check-entitlement-writer.py`)가 두 번 뚫린 뒤로
# 표본을 코드에 박아 둔다. 실제로 있었던 모양 그대로다.
SELF_TEST: list[tuple[str, bool, str]] = [
    # (표본, 잡혀야 하는가, 설명)
    (
        """
        }.getOrElse { error ->
            AlarmTalkLog.reportError("plan_changed conversion worker failed", error)
            Result.retry()
        }
        """,
        True,
        "옛 모양 — 401 에도 영원히 재시도한다",
    ),
    (
        """
        }.getOrElse { error ->
            when (syncWorkerOutcome(error)) {
                SyncWorkerOutcome.RETHROW -> throw error
                SyncWorkerOutcome.SESSION_EXPIRED -> Result.success()
                SyncWorkerOutcome.CONSENT_PENDING -> Result.success()
                SyncWorkerOutcome.RETRY -> {
                    AlarmTalkLog.reportError("worker failed", error)
                    Result.retry()
                }
            }
        }
        """,
        False,
        "고친 모양 — 판정을 지난다",
    ),
    (
        """
        }.getOrElse { error ->
            when (syncWorkerOutcome(error)) {
                SyncWorkerOutcome.RETHROW -> throw error
                else -> Result.retry()
            }
        }
        """,
        False,
        "네트워크를 안 타는 워커 — 두 갈래만 맞춰도 통과",
    ),
    (
        """
        val manifest = try {
            api.getStockClips(auth)
        } catch (error: Throwable) {
            report(userId = id, pending = false)
            throw error
        }
        """,
        False,
        "재시도를 돌려주지 않는 catch 는 분류 지점이 아니다",
    ),
    (
        """
        return runCatching {
            when (save(manifest)) {
                PublishResult.FAILED -> return@runCatching Result.retry()
                else -> Unit
            }
            Result.success()
        }.getOrElse { error ->
            when (syncWorkerOutcome(error)) {
                SyncWorkerOutcome.RETHROW -> throw error
                else -> Result.retry()
            }
        }
        """,
        False,
        "runCatching 본문의 retry 는 정상 흐름의 판단이다",
    ),
    (
        """
        }.getOrElse { error ->
            // 옛 모양 설명: 여기서 `Result.retry()` 를 돌려주면 안 된다.
            when (syncWorkerOutcome(error)) {
                SyncWorkerOutcome.RETHROW -> throw error
                else -> Result.retry()
            }
        }
        """,
        False,
        "주석 안의 인용은 위반이 아니다",
    ),
    (
        """
        }.getOrElse { error ->
            Log.w(TAG, "retry: ${Result.retry()}")
            Result.retry()
        }
        """,
        True,
        "문자열 안이어도 블록 자체가 판정을 안 지나면 잡힌다",
    ),
    (
        """
        }.getOrElse { error ->
            when (syncWorkerOutcome(error)) {
                SyncWorkerOutcome.RETHROW -> throw error
                else -> runCatching { prune() }.getOrElse { Result.retry() }
            }
        }
        """,
        False,
        "바깥이 판정을 지나면 안쪽 블록은 통과시킨다",
    ),
]


def run_self_test() -> list[str]:
    failures: list[str] = []
    for sample, should_flag, why in SELF_TEST:
        flagged = bool(find_problems(sample))
        if flagged != should_flag:
            verb = "잡아야 하는데 못 잡았다" if should_flag else "잡으면 안 되는데 잡았다"
            failures.append(f"{verb} ({why})")
    return failures


def scan() -> list[str]:
    problems: list[str] = []
    if not SYNC_DIR.exists():
        return [f"{SYNC_DIR.relative_to(ROOT)} 가 없다 — 경로가 바뀌었으면 이 검사도 옮길 것"]
    for path in sorted(SYNC_DIR.rglob("*.kt")):
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        if not WORKER_DECL.search(strip_noise(text)):
            continue
        rel = path.relative_to(ROOT)
        for lineno, raw in find_problems(text):
            problems.append(
                f"{rel}:{lineno}: 실패 처리가 `syncWorkerOutcome` 을 지나지 않고 재시도한다.\n"
                f"    401 이면 폐기된 토큰으로 영원히 재시도하고(회차마다 이슈), 취소는\n"
                f"    되던지지 못해 \"Job was cancelled\" 가 사용자 이슈로 올라간다.\n    {raw}"
            )
    return problems


def main() -> int:
    self_test_failures = run_self_test()
    if self_test_failures:
        print("이 검사가 고장났다:\n", file=sys.stderr)
        for failure in self_test_failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1
    problems = scan()
    if problems:
        print("실패 마무리가 판정을 건너뛰는 워커가 있다:\n", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        print(
            "\n`sync/` 의 워커는 실패를 `syncWorkerOutcome` 하나로 가른다:\n"
            "    }.getOrElse { error ->\n"
            "        when (syncWorkerOutcome(error)) {\n"
            "            SyncWorkerOutcome.RETHROW -> throw error\n"
            "            SyncWorkerOutcome.SESSION_EXPIRED -> {\n"
            "                endSessionAfterWorkerUnauthorized(...)\n"
            "                Result.success()\n"
            "            }\n"
            "            SyncWorkerOutcome.CONSENT_PENDING -> Result.success()\n"
            "            SyncWorkerOutcome.RETRY -> { reportError(...); Result.retry() }\n"
            "        }\n"
            "    }\n"
            "네트워크를 안 타는 워커는 RETHROW/else 두 갈래만 맞춰도 된다.\n"
            "이유는 `sync/SyncWorkerFailure.kt` 의 KDoc 참조.",
            file=sys.stderr,
        )
        return 1
    print("sync/ 의 워커가 전부 실패 판정을 지난다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
