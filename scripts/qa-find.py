#!/usr/bin/env python3
"""uiautomator 덤프에서 라벨로 요소를 찾아 **탭할 좌표**를 돌려준다.

좌표를 손으로 추측하면 시스템 내비바를 눌러 홈으로 나가는 사고가 난다(2026-08-20 실제로
그랬다). 화면을 덤프해서 라벨의 실제 bounds 를 읽고 그 한가운데를 누른다.

    scripts/qa.sh taplbl s23 더보기      # 이 파일을 그렇게 쓴다
    python3 scripts/qa-find.py 더보기 < ui.xml
"""

import re
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("사용법: qa-find.py <라벨> [--all]", file=sys.stderr)
        return 2
    label = sys.argv[1]
    list_all = "--all" in sys.argv
    xml = sys.stdin.read()

    hits = []
    for match in re.finditer(r"<node[^>]*>", xml):
        tag = match.group(0)
        text = re.search(r'text="([^"]*)"', tag)
        desc = re.search(r'content-desc="([^"]*)"', tag)
        values = [v.group(1) for v in (text, desc) if v and v.group(1)]
        if not values:
            continue
        # 정확히 같은 것을 먼저 보고, 없으면 포함으로 넓힌다.
        exact = any(v == label for v in values)
        loose = any(label in v for v in values)
        if not (exact or loose):
            continue
        bounds = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', tag)
        if not bounds:
            continue
        x1, y1, x2, y2 = map(int, bounds.groups())
        area = (x2 - x1) * (y2 - y1)
        # ⚠ **넓이 0 은 건너뛴다.** 접히거나 화면 밖인 노드가 그렇게 나오는데,
        # '가장 작은 것' 규칙이 그걸 최우선으로 골라 (0,0) 을 누르게 된다.
        if area <= 0:
            continue
        # ⚠ 같은 라벨이 여럿이면 **가장 작은** 것을 고른다 — 큰 것은 대개 그 글자를
        # 감싸는 컨테이너라, 누르면 엉뚱한 자리가 눌린다.
        hits.append((0 if exact else 1, area, (x1 + x2) // 2, (y1 + y2) // 2, values[0]))

    if not hits:
        return 1
    hits.sort()
    if list_all:
        for _, area, cx, cy, value in hits[:12]:
            print(f"{cx} {cy}  ({area}px) {value}")
        return 0
    _, _, cx, cy, _ = hits[0]
    print(f"{cx} {cy}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
