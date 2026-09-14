#!/usr/bin/env python3
"""iOS 유닛 테스트가 **기기의 진짜 사용자 상태**를 잡지 못하게 막는다.

유닛 테스트는 호스트 앱 프로세스 안에서 돈다. 그래서 저장 위치를 손으로 조립하면 그
경로는 **사용자가 실제로 쓰는 그 파일**이다. 2026-08-19 에 실기기에서 그 대가를 치렀다 —
기기에서 테스트를 한 번 돌릴 때마다

  * 로그인이 풀리고(`AuthViewModelTests` → `signOut()` → 진짜 키체인 항목 삭제),
  * 받아 둔 기본 목소리 클립이 사라지고(그래서 다음 로그인이 전부 다시 받았다),
  * `AlarmAppContextTests` 의 `setUp` 이 사용자의 알람 JSON 을 `removeItem` 으로 지웠다.

앱 데이터 컨테이너 자체는 멀쩡했다(며칠 전 파일이 그대로 있었다) — **재설치가 아니라
테스트가 지운 것**이다.

이제 저장 위치는 `TestIsolation` 이 한 곳에서 가른다. 이 검사는 그 갈림을 **우회하는**
코드를 막는다. 우회는 테스트가 실패하는 형태로 드러나지 않는다(테스트는 초록으로 통과하고
개발자 기기만 조용히 지워진다) — 그래서 문법으로 잡아야 한다.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEST_DIRS = [
    ROOT / "apps/ios-native/AlarmTalkTests",
    ROOT / "apps/ios-native/AlarmTalkUITests",
]

# 손으로 조립하면 사용자 데이터를 잡게 되는 것들. 값을 여기 베끼지 말고 저장소에게 물을 것.
FORBIDDEN = [
    (
        re.compile(r"\.documentDirectory|\.applicationSupportDirectory"),
        "사용자 데이터 디렉터리를 직접 잡았다. `LocalAlarmStore.defaultStorageURL()` 처럼 "
        "저장소가 주는 경로를 쓸 것 (TestIsolation 이 테스트용으로 갈라 준다)",
    ),
    (
        re.compile(r"AppGroup\.containerURL"),
        "App Group 컨테이너를 직접 잡았다. `AudioCacheStore.audioDirectory()` 를 쓸 것",
    ),
    (
        re.compile(r'"voice-alarm-ios-alarms|"audio-cache|"com\.alarmtalk\.app\.auth'),
        "저장 위치 이름을 문자열로 베꼈다. 이름이 갈려도 이 사본은 안 갈려 "
        "사용자 파일을 그대로 잡는다",
    ),
]

ALLOW_MARKER = "test-isolation-ok:"


def main() -> int:
    failures: list[str] = []

    for directory in TEST_DIRS:
        if not directory.is_dir():
            continue
        for path in sorted(directory.rglob("*.swift")):
            for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                if ALLOW_MARKER in line:
                    continue
                for pattern, reason in FORBIDDEN:
                    if pattern.search(line):
                        rel = path.relative_to(ROOT)
                        failures.append(f"{rel}:{lineno}: {reason}\n    {line.strip()}")

    if failures:
        print("테스트가 기기의 실제 사용자 상태를 잡는다:\n")
        for failure in failures:
            print(f"  {failure}\n")
        print(
            "저장 위치는 `TestIsolation` 이 한 곳에서 가른다. 그 갈림을 우회하면 기기에서\n"
            "테스트를 돌릴 때마다 로그인·알람·목소리가 지워진다(2026-08-19 실제 발생).\n"
            f"정말 실제 경로가 필요하면 그 줄에 `{ALLOW_MARKER} <이유>` 주석을 단다."
        )
        return 1

    print("iOS 테스트 격리 검사 통과")
    return 0


if __name__ == "__main__":
    sys.exit(main())
