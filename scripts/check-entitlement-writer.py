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

# 문을 부르는 줄. 트레일링 람다/클로저 때문에 호출은 여러 줄에 걸치므로 **시작 줄**만 본다.
#
# ⚠ **수신자 이름으로 찾지 않는다**(2026-09-02 리뷰). 처음에는 `entitlementWriter\.` 리터럴만
# 봤는데, 같은 저장소 안에 `entitlement.write(...)`(워커 둘)·`writer.write(...)`
# (SubscriptionManager)·`EntitlementWriter().writeNow(...)` 가 이미 있어서 **넷을 통째로
# 놓쳤다.** 이름은 호출부마다 다르고 앞으로도 달라진다.
#
# 대신 **호출 모양**으로 가른다 — 문의 시그니처는 `(표, "이유")` 와 `("이유")` 뿐이라,
# 두 번째(또는 첫) 인자가 **문자열 리터럴**인 것으로 다른 write 와 구별된다.
# (`writer.write(alarms, seq: seq)` 같은 알람 저장소 호출은 이 모양이 아니라 안 걸린다.)
GATE_CALL = re.compile(
    r"""(
        \.\s*write\s*\(\s*[A-Za-z_][\w.]*\s*,\s*"   |   # .write(ticket, "이유"
        \.\s*writeNow\s*\(\s*"                            # .writeNow("이유"
    )""",
    re.X,
)
# 결과를 실제로 쓰는 모양들. `_ =` 는 "일부러 버린다"는 명시적 표시라 허용한다.
RESULT_USED = re.compile(
    r"""(
        \b(val|var|let)\s+\w+\s*(:[^=]+)?=\s*$|   # val x =  (Kotlin/Swift)
        \b(val|var|let)\s+\w+\s*(:[^=]+)?=\s*\S|
        ^\s*(guard|if|while)\b|                     # guard/if 안에서 바로 판정
        ^\s*return\b|                               # 결과를 그대로 돌려준다
        _\s*=|                                       # 일부러 버린다는 명시
        ^\s*\)                                       # 여러 줄 호출의 이어지는 줄
    )""",
    re.X,
)


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
        lines = text.splitlines()
        for lineno, line in enumerate(lines, 1):
            stripped = line.strip()
            # 주석은 규칙을 설명하려고 이름을 인용할 수 있다.
            if stripped.startswith(("//", "*", "/*", "#")):
                continue
            rel = path.relative_to(ROOT)
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
            # ⚠ **앞 줄도 본다.** Kotlin 의 식 본문(`): EntitlementWrite =` 다음 줄에 호출)
            #   처럼 결과를 쓰는 표시가 앞 줄에 있는 형태가 실제로 있다 — 한 줄만 보면
            #   그걸 "결과를 버린다" 로 오판한다(2026-09-02 에 실제로 오탐이 났다).
            prev = lines[lineno - 2].rstrip() if lineno >= 2 else ""
            carried = prev.endswith("=") or prev.endswith("return")
            if GATE_CALL.search(line) and not RESULT_USED.search(line) and not carried:
                problems.append(
                    f"{rel}:{lineno}: `write` 의 결과를 버린다 — 문이 거절해도 화면·메모리가 "
                    f"옛 등급을 그대로 쓴다.\n"
                    f"    결과를 받아 `Applied` 일 때만 상태를 갱신하라"
                    f"(Swift 는 정말 버릴 때 `_ =`, Kotlin 은 `_ =` 가 없으니 "
                    f"결과를 변수로 받아 로그·분기에 쓴다).\n    {stripped}"
                )
    return problems


def main() -> int:
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
