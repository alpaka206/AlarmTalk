#!/usr/bin/env python3
"""플랜 상수가 네 벌로 갈라지지 않게 한다.

## 왜 있는가

유료 플랜 목록이 백엔드·안드로이드(2벌)·iOS 에 **네 벌**로 흩어져 있었다. 정작 이 저장소가
「백엔드·클라 공용 계약」이라고 규정한 `@alarmtalk/shared` 에는 플랜 상수가 하나도 없어서,
계약을 둘 자리가 비어 있던 것이 원인이었다.

실제로 갈라져 있었다 — 안드로이드의 `planType` 목록에만 `individual`·`plus`·`couple` 이
있었는데 DB CHECK 상 `plan_type` 은 `free|personal|family` 뿐이라 **도달할 수 없는 가지**였다.
지금은 과허용 방향이라 사고가 안 났을 뿐, 반대로 한 칸 어긋나면 돈 낸 사용자가 잠긴다.

2026-09-02 에 원본을 `packages/shared/src/schemas/plan.ts` 로 올렸다. 네이티브 두 앱은
TypeScript 를 가져다 쓸 수 없어 **같은 값을 손으로** 두는데, 그게 어긋나는 것을 여기서 막는다.

## 무엇을 비교하는가

| 원본(shared) | Android | iOS |
| --- | --- | --- |
| `PAID_USER_PLANS` | `PaidUserPlans` | `PaidPlans.userPlans` |
| `PAID_PLAN_TYPES` | `PaidPlanTypes` | `PaidPlans.planTypes` |

DB CHECK(`plans.plan_type`)와도 대조한다 — 도달 불가능한 값이 다시 들어오는 것을 막는다.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SHARED = ROOT / "packages/shared/src/schemas/plan.ts"
ANDROID = ROOT / "apps/android-native/app/src/main/java/com/alarmtalk/app/ui/util/PlatformAndLabelUtils.kt"
IOS = ROOT / "apps/ios-native/AlarmTalk/PaidVoiceGate.swift"
MIGRATIONS = ROOT / "packages/backend/src/lib/migrations.ts"


def quoted(text: str) -> list[str]:
    return re.findall(r"'([^']+)'|\"([^\"]+)\"", text)


def values(text: str) -> set[str]:
    return {a or b for a, b in quoted(text)}


def extract(path: Path, pattern: str) -> set[str] | None:
    if not path.exists():
        return None
    m = re.search(pattern, path.read_text(encoding="utf-8"), re.S)
    return values(m.group(1)) if m else None


def main() -> int:
    problems: list[str] = []

    shared_user = extract(SHARED, r"PAID_USER_PLANS\s*=\s*\[([^\]]*)\]")
    shared_type = extract(SHARED, r"PAID_PLAN_TYPES\s*=\s*\[([^\]]*)\]")
    if not shared_user or not shared_type:
        print(f"원본을 읽지 못했다: {SHARED.relative_to(ROOT)}", file=sys.stderr)
        return 1

    checks = [
        ("Android PaidUserPlans", extract(ANDROID, r"PaidUserPlans\s*=\s*setOf\(([^)]*)\)"), shared_user),
        ("Android PaidPlanTypes", extract(ANDROID, r"PaidPlanTypes\s*=\s*setOf\(([^)]*)\)"), shared_type),
        ("iOS PaidPlans.userPlans", extract(IOS, r"userPlans:\s*Set<String>\s*=\s*\[([^\]]*)\]"), shared_user),
        ("iOS PaidPlans.planTypes", extract(IOS, r"planTypes:\s*Set<String>\s*=\s*\[([^\]]*)\]"), shared_type),
    ]

    for label, actual, expected in checks:
        if actual is None:
            problems.append(f"{label}: 상수를 찾지 못했다 — 이름을 바꿨거나 즉석 목록으로 되돌렸다")
        elif actual != expected:
            problems.append(
                f"{label}: shared 와 다르다\n"
                f"      shared: {sorted(expected)}\n"
                f"      실제  : {sorted(actual)}"
            )

    # DB CHECK 와도 대조 — 도달 불가능한 plan_type 이 다시 들어오는 것을 막는다.
    db_types = extract(MIGRATIONS, r"plan_type TEXT NOT NULL CHECK\(plan_type IN \(([^)]*)\)\)")
    if db_types:
        unreachable = shared_type - db_types
        if unreachable:
            problems.append(
                f"shared PAID_PLAN_TYPES 에 DB 가 허용하지 않는 값이 있다: {sorted(unreachable)}\n"
                f"      DB CHECK: {sorted(db_types)}"
            )

    if problems:
        print("플랜 상수가 갈라졌다:\n", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        print(
            "\n원본은 `packages/shared/src/schemas/plan.ts` 다. 값을 바꾸려면 거기부터 고치고\n"
            "두 앱의 상수를 같은 값으로 맞춘다. 호출부에서 즉석 목록을 만들지 말 것.",
            file=sys.stderr,
        )
        return 1

    print("플랜 상수가 shared·Android·iOS·DB 에서 일치한다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
