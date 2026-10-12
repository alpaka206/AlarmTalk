#!/usr/bin/env python3
"""안드로이드 진동 패턴 목록과 서버가 받는 목록이 같은지 본다.

## 왜 있는가

안드로이드는 고른 진동 값을 그대로 동기화한다(`network/RemoteAlarmMapper.kt`). 서버가 그 값을 모르면
`POST·PATCH /alarm` 이 400 `INVALID_VIBRATION_PATTERN` 으로 막히는데, 알람은 폰에서 그대로 울려 아무도
모른다 — 서버 사본만 조용히 갱신되지 않는다. 2026-10-12 까지 서버는 안드로이드 18종 중 셋만 받았다
(ALARMTALK-ANDROID-14). 두 목록은 언어가 달라 **같은 값을 손으로** 둔다.

## 무엇을 비교하는가

| 안드로이드 | 서버 |
| --- | --- |
| `data/AlarmConstants.kt` 의 `object VibrationPatterns` 안 `val all = listOf(...)` (상수 이름 → `const val` 값) | `packages/backend/src/routes/alarm-helpers.ts` 의 `VIBRATION_PATTERNS = [...] as const` |

걸리는 것: 선언을 못 찾는다 / 문자열·상수가 아닌 항목이 섞였다 / 같은 값이 두 번 있다 / 두 집합이 다르다
(순서는 보지 않는다). iOS 는 진동 목록이 없고 값을 문자열 그대로 왕복하므로 비교하지 않는다.
이 맥의 시스템 python3(3.9)로 돈다.

    python3 scripts/check-vibration-patterns.py --self-test   # 검사기 자체만
    python3 scripts/check-vibration-patterns.py               # 저장소 검사
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ANDROID = ROOT / "apps/android-native/app/src/main/java/com/alarmtalk/app/data/AlarmConstants.kt"
SERVER = ROOT / "packages/backend/src/routes/alarm-helpers.ts"


class CheckError(Exception):
    pass


def _strip_line_comments(text):
    return re.sub(r"//[^\n]*", "", text)


def _block_after(text, header):
    """`header` 뒤의 첫 `{` 부터 짝이 맞는 `}` 까지를 돌려준다."""
    start = text.find(header)
    if start < 0:
        raise CheckError("선언을 찾지 못했다: " + header)
    open_at = text.find("{", start)
    if open_at < 0:
        raise CheckError("여는 중괄호가 없다: " + header)
    depth = 0
    for i in range(open_at, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[open_at + 1:i]
    raise CheckError("닫는 중괄호가 없다: " + header)


def android_patterns(source):
    body = _strip_line_comments(_block_after(source, "object VibrationPatterns"))
    consts = dict(re.findall(r'const\s+val\s+(\w+)\s*=\s*"([^"]*)"', body))
    m = re.search(r"val\s+all\s*=\s*listOf\((.*?)\)", body, re.S)
    if not m:
        raise CheckError("VibrationPatterns.all = listOf(...) 를 찾지 못했다")
    values = []
    for item in [x.strip() for x in m.group(1).split(",") if x.strip()]:
        if item in consts:
            values.append(consts[item])
        elif re.fullmatch(r'"[^"]*"', item):
            values.append(item[1:-1])
        else:
            raise CheckError("안드로이드 목록에 읽을 수 없는 항목이 있다: " + item)
    return values


def server_patterns(source):
    m = re.search(r"export\s+const\s+VIBRATION_PATTERNS\s*=\s*\[(.*?)\]\s*as\s+const", source, re.S)
    if not m:
        raise CheckError("서버의 VIBRATION_PATTERNS = [...] as const 를 찾지 못했다")
    body = _strip_line_comments(m.group(1))
    values = []
    for item in [x.strip() for x in body.split(",") if x.strip()]:
        if not re.fullmatch(r"'[^']*'|\"[^\"]*\"", item):
            raise CheckError("서버 목록에 문자열이 아닌 항목이 있다: " + item)
        values.append(item[1:-1])
    return values


def compare(android, server):
    problems = []
    for name, values in (("안드로이드", android), ("서버", server)):
        dupes = sorted({v for v in values if values.count(v) > 1})
        if dupes:
            problems.append(name + " 목록에 같은 값이 두 번 있다: " + ", ".join(dupes))
    missing = sorted(set(android) - set(server))
    extra = sorted(set(server) - set(android))
    if missing:
        problems.append("서버가 받지 않는 안드로이드 패턴(동기화가 400 으로 막힌다): " + ", ".join(missing))
    if extra:
        problems.append("안드로이드에 없는 서버 패턴: " + ", ".join(extra))
    return problems


def self_test():
    kt = '''
object VibrationPatterns {
    const val DEFAULT = "default"
    const val SOS = "sos" // 주석
    const val NONE = "none"

    val all = listOf(
        DEFAULT,
        SOS,
        NONE,
    )
}
'''
    ts = """export const VIBRATION_PATTERNS = [
  'default', // 주석
  'sos',
  'none',
] as const;"""
    assert android_patterns(kt) == ["default", "sos", "none"], android_patterns(kt)
    assert server_patterns(ts) == ["default", "sos", "none"], server_patterns(ts)
    assert compare(android_patterns(kt), server_patterns(ts)) == []
    narrow = "export const VIBRATION_PATTERNS = ['default', 'none'] as const;"
    found = compare(android_patterns(kt), server_patterns(narrow))
    assert len(found) == 1 and "sos" in found[0], found
    assert compare(["a", "a"], ["a"])[0].startswith("안드로이드 목록에 같은 값")
    try:
        server_patterns("export const VIBRATION_PATTERNS = ['default', OTHER] as const;")
        raise AssertionError("상수 항목을 놓쳤다")
    except CheckError:
        pass
    try:
        android_patterns("object Other { }")
        raise AssertionError("선언 없음을 놓쳤다")
    except CheckError:
        pass
    print("self-test ok")


def main():
    if "--self-test" in sys.argv[1:]:
        self_test()
        return 0
    try:
        android = android_patterns(ANDROID.read_text(encoding="utf-8"))
        server = server_patterns(SERVER.read_text(encoding="utf-8"))
    except CheckError as e:
        print("check-vibration-patterns: " + str(e))
        return 1
    problems = compare(android, server)
    if problems:
        for p in problems:
            print("check-vibration-patterns: " + p)
        return 1
    print("check-vibration-patterns: ok (%d종)" % len(android))
    return 0


if __name__ == "__main__":
    sys.exit(main())
