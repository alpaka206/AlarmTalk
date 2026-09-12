#!/usr/bin/env python3
"""iOS 주석이 대는 **안드로이드·백엔드 근거가 실재하는지** 검사한다.

왜 필요한가: iOS 는 안드로이드를 원본으로 삼는다(CLAUDE.md). 그래서 주석 대부분이
"안드로이드 `Foo.kt:123` 미러" 꼴인데, 안드로이드가 그 화면을 지우거나 파일이 짧아져도
주석은 그대로 남는다. 2026-08-06 전수 대조에서 **존재하지 않는 심볼·파일·줄번호를 근거로
댄 주석이 여럿** 나왔고, 그걸 믿고 고친 코드가 다시 틀렸다.

검사하는 것 두 가지:
  1. `Foo.kt:123` / `Foo.ts:12-34` — 그 파일이 있고 그 줄이 실재하는가
  2. 백틱 심볼(`SomeComposable`) — 안드로이드/백엔드 어디에도 없는 이름인가

⚠ **줄번호는 어차피 썩는다.** 새 주석에는 줄번호를 쓰지 말고 `ui/editor/Foo.kt` 처럼
경로와 심볼 이름만 적을 것. 이 검사는 이미 있는 것들을 잡아내기 위한 그물이다.

실행: python3 scripts/check-cross-platform-refs.py   (문제가 있으면 exit 1)
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
IOS = ROOT / "apps/ios-native/AlarmTalk"
SOURCE_ROOTS = [
    ROOT / "apps/android-native/app/src/main",
    ROOT / "packages/backend/src",
    ROOT / "packages/shared/src",
]

# 안드로이드 API·라이브러리 이름은 우리 소스에 없는 게 정상이다.
SYMBOL_ALLOWLIST = {
    "EncryptedFile",          # androidx.security
    "MediaPlayer",
    "SharedPreferences",
    "LocalAlarmRecord",       # iOS 자기 타입(다른 파일에 정의)
    "ControlsAndPermissions", # 파일명(내용에는 안 나온다)
}

LINE_REF = re.compile(r"([A-Za-z0-9_+\-]+\.(?:kt|ts|xml)):(\d+)(?:-(\d+))?")
SYMBOL = re.compile(r"`([A-Z][A-Za-z0-9]{4,})`")
COMMENT_START = ("//", "///", "*", "/*")


def main() -> int:
    by_name: dict[str, list[pathlib.Path]] = {}
    sources: list[pathlib.Path] = []
    for root in SOURCE_ROOTS:
        for path in root.rglob("*"):
            if path.is_file() and path.suffix in {".kt", ".ts", ".xml"}:
                by_name.setdefault(path.name, []).append(path)
                sources.append(path)

    line_counts = {p: len(p.read_text(errors="ignore").splitlines()) for p in sources}
    blob = "\n".join(p.read_text(errors="ignore") for p in sources)

    problems: list[str] = []
    for swift in sorted(IOS.rglob("*.swift")):
        text = swift.read_text()
        defined_here = set(re.findall(r"\b(?:struct|class|enum|protocol|extension|func)\s+(\w+)", text))
        rel = swift.relative_to(ROOT)
        for number, line in enumerate(text.splitlines(), 1):
            if not line.lstrip().startswith(COMMENT_START):
                continue

            for match in LINE_REF.finditer(line):
                name = match.group(1)
                last = int(match.group(3) or match.group(2))
                targets = by_name.get(name)
                if not targets:
                    problems.append(f"{rel}:{number}  {match.group(0)}  → 그런 파일이 없다")
                elif not any(last <= line_counts[t] for t in targets):
                    longest = max(line_counts[t] for t in targets)
                    problems.append(f"{rel}:{number}  {match.group(0)}  → 파일은 {longest}줄뿐이다")

            if "안드로이드" not in line and "Android" not in line:
                continue
            # "…라는 이름은 없다" 처럼 **부재를 적어 둔 주석**은 잡지 않는다 —
            # 그건 이미 사실을 바로잡은 문장이고, 다시 지우면 같은 오해가 되돌아온다.
            if "없다" in line or "틀렸다" in line:
                continue
            for match in SYMBOL.finditer(line):
                symbol = match.group(1)
                if symbol in defined_here or symbol in SYMBOL_ALLOWLIST:
                    continue
                if symbol not in blob:
                    problems.append(f"{rel}:{number}  `{symbol}`  → 안드로이드·백엔드 어디에도 없다")

    if problems:
        print(f"근거가 썩은 주석 {len(problems)}건:\n")
        for problem in problems:
            print(f"  {problem}")
        print("\n주석을 사실대로 고치거나, 줄번호를 빼고 경로·심볼만 남길 것.")
        return 1

    print("iOS 주석의 안드로이드·백엔드 근거가 모두 실재한다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
