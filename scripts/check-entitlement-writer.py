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
        for lineno, line in enumerate(text.splitlines(), 1):
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
