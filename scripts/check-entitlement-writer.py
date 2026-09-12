#!/usr/bin/env python3
"""권한 스냅샷은 **문 하나로만** 쓴다 — 우회를 CI 에서 막는다.

## 왜 있는가

권한 상태(구독·그룹·users.plan·스토어 신호)를 쓰는 곳이 안드로이드 9곳·iOS 8곳이었고,
각자 계정·세대·에폭 가드를 **손으로** 들고 있었다. PR #709 에서 그 가드를 82줄 붙였는데
국소 가드끼리 어긋나면서 리뷰가 37회·119건까지 갔다. 2026-09-02 에 쓰기 문을 하나로 모았다
(`EntitlementWriter` / `EntitlementWriter.swift`).

문을 만드는 것만으로는 다음 사람이 우회하는 걸 못 막는다 — 새 경로가 저장소를 직접 부르면
같은 사고가 다시 난다. 그래서 이 검사가 CI 에 있다.

## 무엇을 막는가

1. 원시 쓰기(`patchWithoutOwnershipCheck` / `patchWithoutOwnershipCheck(_:_:)`)를
   문 밖에서 부르는 것.
2. 권한 스냅샷 필드를 문을 거치지 않고 직접 저장하는 것.
3. **`write` 의 결과를 버리는 것.**

3번은 2026-09-02 Codex 리뷰가 실제로 잡아낸 것이다. 규칙은 처음부터 이 파일 끝의 안내에
「결과가 Applied 일 때만 화면 상태를 갱신한다」로 적혀 있었지만 **강제되지 않아서**,
`MainViewModelBillingActions` 가 결과를 무시하고 스토어 등급을 먼저 발행하고 있었다.
호출부의 계정 가드는 **id 만** 보는데 문은 **세대(epoch)** 까지 본다 — 같은 사람이
로그아웃하고 다시 들어오면 id 는 같고 세대만 바뀌므로, 문은 정확히 거절하는데 화면·메모리
상태는 옛 등급을 그대로 쓴다. `storeEntitlementChecked` 가 그렇게 서면 **되돌릴 수 없는
무료 강등**까지 이어진다. 문을 만들어도 결과를 안 보면 문이 없는 것과 같다.

허용된 파일은 아래 OWNERS 뿐이다.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

ANDROID = ROOT / "apps/android-native/app/src/main/java"
IOS = ROOT / "apps/ios-native/AlarmTalk"

# 원시 쓰기를 불러도 되는 파일 — 문 그 자체와 저장소 구현.
OWNERS = {
    "EntitlementWriter.kt",
    "AccessSnapshotStore.kt",
    "EntitlementWriter.swift",
    "AccessSnapshotStore.swift",
}

RAW_WRITE = re.compile(r"\bpatchWithoutOwnershipCheck\b")

# 옛 API 가 되살아나는 것도 막는다(문을 우회하는 가장 쉬운 길이었다).
REVIVED_API = re.compile(r"\b(updateStorePlanKey|updateUserPlan|updateSubscription|updateFamilyGroup)\s*\(")

# 문을 부르는 자리를 찾는다.
#
# ⚠ **인자 모양을 정규식으로 흉내내지 않는다**(2026-09-02 리뷰 2차 정정). 처음에는
# 수신자 이름(`entitlementWriter.`)만 봐서 넷을 놓쳤고, 고친 뒤에도
# `write(<맨이름>, "<리터럴>")` 한 줄짜리만 알아봐서 **생성자를 인자로 쓰거나 줄을
# 나눈 형태**를 또 놓쳤다(`RemoteAlarmSyncWorker` 의
# `.write(AccessTicket(...), "background session renewal")`, `renewSession(...)`).
# 정규식으로 인자를 흉내내는 한 이 술래잡기는 끝나지 않는다.
#
# 그래서 **괄호 균형으로 실제 호출을 파싱**한다. 아래 SELF_TEST 가 이 파서를 검증한다.
GATE_METHODS = ("write", "writeNow", "renewSession")
CALL_START = re.compile(r"\.\s*(write|writeNow|renewSession)\s*\(")

# 결과를 실제로 쓰는 모양. `_ =` 는 "일부러 버린다"는 명시적 표시라 허용한다(Swift 전용 —
# Kotlin 에는 그 문법이 없어 변수로 받아 로그·분기에 쓴다).
RESULT_USED = re.compile(
    r"""(
        \b(val|var|let)\s+\w+[^=]*=      |   # val x = / let x: T =
        ^\s*(guard|if|while|return)\b     |   # 바로 판정하거나 돌려준다
        _\s*=                              |   # 일부러 버린다는 명시(Swift)
        =\s*$                              |   # 식 본문·여러 줄 대입 — 값이 어딘가로 간다
        ->\s*$
    )""",
    re.X,
)


def _call_args(text: str, open_paren: int) -> str:
    """여는 괄호부터 짝이 맞는 닫는 괄호까지의 인자 텍스트(여러 줄 가능)."""
    depth = 0
    for i in range(open_paren, len(text)):
        ch = text[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return text[open_paren + 1 : i]
    return text[open_paren + 1 :]


def _is_gate_call(method: str, args: str, before: str) -> bool:
    """이 `.write(`/`.writeNow(`/`.renewSession(` 가 **권한 문**인가.

    같은 이름의 다른 write 가 많다(`data.write(to:)`, `output.write(buf, 0, n)`,
    `MarketingConsentCache(...).write(userId, agreed)`, 알람 저장소의 `write(alarms, seq:)`).
    문만 갖는 표식 셋 중 하나면 문으로 본다:
      - `writeNow`/`renewSession` 은 문에만 있는 이름이다.
      - 인자에 **이유 문자열**이 있다(문의 시그니처가 `(표, "이유")` 다).
      - 수신자 쪽에 `Entitlement` 가 보인다(생성자를 바로 부르는 형태).
    """
    if method in ("writeNow", "renewSession"):
        return True
    if '"' in args:
        return True
    return "ntitlement" in before[-120:]


# 앞 줄이 이렇게 끝나면 이 줄은 그 문장의 **이어지는 줄**이다.
#
# ⚠ `,` 와 `(` 는 **넣지 않는다.** 넣으면 여러 줄 파라미터 목록을 타고 함수 선언까지
#   거슬러 올라가, 식 본문(`): EntitlementWrite =`)을 지나쳐 머리를 잘못 잡는다.
#   찾는 것은 "이 값이 어디로 가는가" 이고, 그건 `=`·`->`·`return` 에서 끝난다.
CONTINUES = ("=", "->", "return", "?:", "&&", "||")


def _statement_head(lines: list[str], index: int) -> str:
    """이 호출이 속한 문장의 **머리 줄**.

    두 가지 이어짐을 따라 올라간다. 둘 다 실제로 있는 형태다:
      - `Foo(ctx)` 다음 줄에 `.write(...)`  (체이닝)
      - `): EntitlementWrite =` 다음 줄에 `entitlementWriter.write(...)`  (식 본문)

    ⚠ 두 번째를 빠뜨리면 **결과를 그대로 돌려주는 함수**를 "버린다" 로 오판한다
    (2026-09-02 에 `saveFamilyGroupSnapshot` 에서 실제로 그랬다).
    """
    i = index
    while i > 0:
        if lines[i].strip().startswith("."):
            i -= 1
            continue
        if i == 0:
            break
        prev = lines[i - 1].strip()
        if prev.endswith(CONTINUES):
            i -= 1
            continue
        break
    return lines[i]


def find_unused_results(text: str) -> list[tuple[int, str]]:
    """결과를 쓰지 않는 문 호출의 (줄번호, 줄) 목록."""
    lines = text.splitlines()
    # 각 문자 오프셋이 몇 번째 줄인지
    offsets: list[int] = []
    pos = 0
    for line in lines:
        offsets.append(pos)
        pos += len(line) + 1

    def line_of(offset: int) -> int:
        lo, hi = 0, len(offsets) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if offsets[mid] <= offset:
                lo = mid
            else:
                hi = mid - 1
        return lo

    problems: list[tuple[int, str]] = []
    for match in CALL_START.finditer(text):
        index = line_of(match.start())
        line = lines[index]
        if line.strip().startswith(("//", "*", "/*", "#")):
            continue
        open_paren = text.index("(", match.start())
        if not _is_gate_call(match.group(1), _call_args(text, open_paren), text[: match.start()]):
            continue
        if not RESULT_USED.search(_statement_head(lines, index)):
            problems.append((index + 1, line.strip()))
    return problems


# 검사 자신을 검증한다 — 이 파서는 두 번 뚫렸다(수신자 이름만 보던 판, 한 줄 리터럴만
# 보던 판). 실제로 있었던 형태를 그대로 표본으로 둔다.
SELF_TEST: list[tuple[str, bool]] = [
    # (표본, 잡혀야 하는가)
    ('entitlementWriter.write(ticket, "play entitlement") {', True),
    ('val x = entitlementWriter.write(ticket, "play entitlement") {', False),
    ('_ = writer.write(accessTicket, "storekit revalidate") {', False),
    ('if (entitlement.write(ticket, "prefetch plan") { it }', False),
    ('guard planWrite == .applied else { return }', False),
    # 결과를 그대로 돌려주는 식 본문 — 잡히면 안 된다(오탐이 실제로 났던 형태)
    ('): EntitlementWrite =\n    entitlementWriter.write(ticket, "family group snapshot") { it }', False),
    # 놓쳤던 형태들
    ('EntitlementWriter(applicationContext)\n    .write(AccessTicket(u, g), "renewal") {', True),
    ('EntitlementWriter().renewSession(\n    AccessTicket(userID: a, token: b),\n    plan: p\n)', True),
    ('EntitlementWriter().writeNow("storekit tier") {', True),
    # 문이 아닌 write 들 — 잡히면 안 된다
    ('try data.write(to: url, options: [.atomic])', False),
    ('output.write(buffer.array(), 0, sampleSize)', False),
    ('MarketingConsentCache(app).write(userId, agreed)', False),
    ('return writer.write(alarms, seq: saveSeq)', False),
]


def run_self_test() -> list[str]:
    failures: list[str] = []
    for sample, should_flag in SELF_TEST:
        flagged = bool(find_unused_results(sample))
        if flagged != should_flag:
            failures.append(
                f"검사 자신이 틀렸다: {'잡아야 하는데 못 잡았다' if should_flag else '잡으면 안 되는데 잡았다'}\n"
                f"      {sample}"
            )
    return failures


def scan(root: Path, suffix: str) -> list[str]:
    problems: list[str] = []
    if not root.exists():
        return problems
    for path in sorted(root.rglob(f"*{suffix}")):
        if "/build/" in str(path) or path.name in OWNERS:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        rel = path.relative_to(ROOT)
        for lineno, line in enumerate(text.splitlines(), 1):
            stripped = line.strip()
            # 주석은 규칙을 설명하려고 이름을 인용할 수 있다.
            if stripped.startswith(("//", "*", "/*", "#")):
                continue
            if RAW_WRITE.search(line):
                problems.append(
                    f"{rel}:{lineno}: 원시 쓰기를 문 밖에서 부른다 — "
                    f"`EntitlementWriter.write(ticket, …)` 를 쓸 것\n    {stripped}"
                )
            if REVIVED_API.search(line):
                problems.append(
                    f"{rel}:{lineno}: 문을 우회하는 옛 API 가 되살아났다 — "
                    f"`EntitlementWriter.write(ticket, …)` 로 바꿀 것\n    {stripped}"
                )
        for lineno, stripped in find_unused_results(text):
            problems.append(
                f"{rel}:{lineno}: 문의 결과를 버린다 — 문이 거절해도 화면·메모리가 "
                f"옛 등급을 그대로 쓴다.\n"
                f"    결과를 받아 `Applied` 일 때만 상태를 갱신하라"
                f"(Swift 는 정말 버릴 때 `_ =`, Kotlin 은 그 문법이 없으니 변수로 받아 "
                f"로그·분기에 쓴다).\n    {stripped}"
            )
    return problems


def main() -> int:
    # 검사 자신부터 검증한다 — 이 파서는 두 번 뚫렸다.
    self_test_failures = run_self_test()
    if self_test_failures:
        print("이 검사가 고장났다:\n", file=sys.stderr)
        for f in self_test_failures:
            print(f"  - {f}", file=sys.stderr)
        return 1
    problems = scan(ANDROID, ".kt") + scan(IOS, ".swift")
    if problems:
        print("권한 스냅샷을 문 밖에서 쓰는 곳이 있다:\n", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        print(
            "\n권한 스냅샷은 `EntitlementWriter` 하나로만 쓴다.\n"
            "  1) 네트워크·SDK 호출 **전에** 표를 뜬다: `val ticket = accessTicket() ?: return`\n"
            "  2) 응답 뒤 그 표로 쓴다: `writer.write(ticket, \"이유\") { it.copy(...) }`\n"
            "  3) 결과가 Applied 일 때만 화면 상태를 갱신한다.\n"
            "이유는 `EntitlementWriter` 의 KDoc 과 docs/spec/billing-lifecycle.md 참조.",
            file=sys.stderr,
        )
        return 1
    print("권한 스냅샷 쓰기가 전부 문을 지난다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
