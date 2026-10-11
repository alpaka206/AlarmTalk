#!/usr/bin/env python3
"""사용자가 친 값의 **예상된 거절** 목록이 shared·안드로이드·iOS 에서 같은지 본다.

## 왜 있는가

두 앱은 이 목록에 있는 코드의 4xx 를 Sentry 이벤트로 올리지 않고 브레드크럼(category `refusal`)으로 남긴다
(`docs/spec/error-codes.md` §3 「앱도 같다」). 틀린 인증 코드·이미 가입된 이메일·잘못 친 이용권 코드처럼 이유가
사용자가 친 값이고, 화면이 그 이유를 이미 말한다. 원본은 `packages/shared/src/schemas/error-codes.ts` 의
`CLIENT_EXPECTED_REFUSAL_CODES` 이고, 두 앱은 TypeScript 를 가져다 쓸 수 없어 **같은 값을 손으로** 둔다. 한쪽만
고치면 같은 거절이 한 앱에서는 이슈, 다른 앱에서는 브레드크럼이 된다 — 각 앱의 테스트는 자기 목록만 보므로 아무도
모른다.

## 무엇을 비교하는가

| 원본(shared) | Android | iOS |
| --- | --- | --- |
| `CLIENT_EXPECTED_REFUSAL_CODES`(배열) | `EXPECTED_REFUSAL_CODES`(`setOf(...)`) | `expectedRefusalCodes`(`Set<String>`) |

앱 쪽은 **이름으로** 찾는다 — 안드로이드는 `apps/android-native/app/src/main` 의 `.kt`, iOS 는
`apps/ios-native/AlarmTalk` 의 `.swift` 를 전부 훑는다(파일을 옮겨도 검사가 따라간다). 걸리는 것:

- 선언이 없다 / 두 곳 이상에 있다(어느 쪽이 쓰이는지 알 수 없다).
- 모양이 다르다 — 안드로이드는 `setOf(` 여야 하고, iOS 는 `Set<String>` 이어야 한다(`[...]` 만 쓰면 배열이다).
- 문자열 리터럴이 아닌 항목이 섞였다(상수 이름 등 — 그 값은 이 검사가 볼 수 없다).
- 같은 값이 두 번 있다(Swift 의 `Set` 리터럴은 중복이 있으면 실행 중에 멈춘다).
- 값이 shared 와 다르다.

주석과 문자열 안의 인용(KDoc 이 이름을 대는 것 등)은 선언으로 세지 않는다. 이 맥의 시스템 python3(3.9)로 돈다.

    python3 scripts/check-expected-refusal-codes.py --self-test   # 검사기 자체만
    python3 scripts/check-expected-refusal-codes.py               # 세 목록 대조
"""
from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]

SHARED = ROOT / "packages/shared/src/schemas/error-codes.ts"
ANDROID_DIR = ROOT / "apps/android-native/app/src/main"
IOS_DIR = ROOT / "apps/ios-native/AlarmTalk"


@dataclass(frozen=True)
class Spec:
    label: str
    name: str
    # 이름의 **선언**(`val NAME` 꼴) — 사용처(`code in NAME`)는 걸리지 않는다.
    declaration: "re.Pattern[str]"
    # 선언 바로 뒤 — 타입·`=`·여는 괄호까지. 마지막 글자가 여는 괄호다.
    shape: "re.Pattern[str]"
    opener: str
    closer: str
    shape_hint: str
    # Kotlin·Swift 의 블록 주석은 겹칠 수 있다(`/* /* */ */`). TypeScript 는 아니다.
    nested_comments: bool


SHARED_SPEC = Spec(
    label="shared CLIENT_EXPECTED_REFUSAL_CODES",
    name="CLIENT_EXPECTED_REFUSAL_CODES",
    declaration=re.compile(r"\b(?:const|let|var)\s+CLIENT_EXPECTED_REFUSAL_CODES\b"),
    shape=re.compile(r"\s*(?::[^=;]*)?=\s*\["),
    opener="[",
    closer="]",
    shape_hint="export const CLIENT_EXPECTED_REFUSAL_CODES: readonly ErrorCode[] = ['…', …]",
    nested_comments=False,
)
ANDROID_SPEC = Spec(
    label="Android EXPECTED_REFUSAL_CODES",
    name="EXPECTED_REFUSAL_CODES",
    declaration=re.compile(r"\b(?:val|var)\s+EXPECTED_REFUSAL_CODES\b"),
    shape=re.compile(r"\s*(?::\s*Set\s*<\s*String\s*>\s*)?=\s*setOf\s*(?:<\s*String\s*>\s*)?\("),
    opener="(",
    closer=")",
    shape_hint='val EXPECTED_REFUSAL_CODES: Set<String> = setOf("…", …)',
    nested_comments=True,
)
IOS_SPEC = Spec(
    label="iOS expectedRefusalCodes",
    name="expectedRefusalCodes",
    declaration=re.compile(r"\b(?:let|var)\s+expectedRefusalCodes\b"),
    # `: Set<String> = [...]` · `: Set<String> = Set([...])` · `= Set<String>([...])` — 타입이 Set 임이 드러나야 한다.
    shape=re.compile(
        r"\s*(?:"
        r":\s*Set\s*<\s*String\s*>\s*=\s*(?:Set\s*(?:<\s*String\s*>\s*)?\(\s*)?"
        r"|=\s*Set\s*(?:<\s*String\s*>\s*)?\(\s*"
        r")\["
    ),
    opener="[",
    closer="]",
    shape_hint='static let expectedRefusalCodes: Set<String> = ["…", …]',
    nested_comments=True,
)


def string_end(text: str, i: int) -> int:
    """`text[i]` 에서 시작하는 문자열 리터럴이 끝난 다음 위치. 세 겹 따옴표(여러 줄 문자열)도 다룬다."""
    n = len(text)
    if text.startswith('"""', i):
        end = text.find('"""', i + 3)
        return n if end == -1 else end + 3
    quote = text[i]
    j = i + 1
    while j < n:
        if text[j] == "\\":
            j += 2
            continue
        if text[j] == quote:
            return j + 1
        if text[j] == "\n" and quote != "`":
            return j  # 닫히지 않은 한 줄 문자열 — 줄 끝에서 멈춘다
        j += 1
    return n


def blank_comments(text: str, nested: bool) -> str:
    """주석을 공백으로 지운다(줄바꿈·길이는 그대로). 문자열 안의 `//`·`/*` 는 주석이 아니다."""
    out = list(text)
    n = len(text)

    def blank(start: int, end: int) -> None:
        for k in range(start, end):
            if out[k] != "\n":
                out[k] = " "

    i = 0
    while i < n:
        if text.startswith("//", i):
            end = text.find("\n", i)
            end = n if end == -1 else end
            blank(i, end)
            i = end
        elif text.startswith("/*", i):
            depth, j = 1, i + 2
            while j < n and depth > 0:
                if nested and text.startswith("/*", j):
                    depth += 1
                    j += 2
                elif text.startswith("*/", j):
                    depth -= 1
                    j += 2
                else:
                    j += 1
            blank(i, j)
            i = j
        elif text[i] in "\"'`":
            i = string_end(text, i)
        else:
            i += 1
    return "".join(out)


def blank_strings(text: str) -> str:
    """문자열 리터럴의 **안쪽**을 공백으로 지운다(따옴표·길이는 그대로) — 그 안의 이름·괄호를 세지 않게."""
    out = list(text)
    n = len(text)
    i = 0
    while i < n:
        if text[i] in "\"'`":
            end = string_end(text, i)
            inner = 3 if text.startswith('"""', i) else 1
            for k in range(i + inner, max(i + inner, end - inner)):
                if out[k] != "\n":
                    out[k] = " "
            i = end
        else:
            i += 1
    return "".join(out)


def closing_index(code: str, open_index: int, opener: str, closer: str) -> Optional[int]:
    """`code[open_index]` 의 여는 괄호와 짝이 맞는 닫는 괄호의 위치(문자열은 이미 비워져 있다)."""
    depth = 0
    for i in range(open_index, len(code)):
        if code[i] == opener:
            depth += 1
        elif code[i] == closer:
            depth -= 1
            if depth == 0:
                return i
    return None


def literal_items(body: str) -> Tuple[List[str], List[str]]:
    """목록 안쪽(주석은 지운 것)을 문자열 리터럴 값과 리터럴이 아닌 항목으로 가른다."""
    values: List[str] = []
    others: List[str] = []
    i, n = 0, len(body)
    while i < n:
        ch = body[i]
        if ch.isspace() or ch == ",":
            i += 1
            continue
        if ch in "\"'":
            end = string_end(body, i)
            values.append(body[i + 1 : end - 1])
            i = end
            continue
        end = body.find(",", i)
        end = n if end == -1 else end
        others.append(body[i:end].strip())
        i = end
    return values, others


@dataclass
class Found:
    where: str
    values: Optional[List[str]]  # None — 선언은 있는데 모양이 다르다
    others: List[str]


def find_declarations(spec: Spec, files: Iterable[Tuple[str, str]]) -> List[Found]:
    found: List[Found] = []
    for path, text in files:
        no_comments = blank_comments(text, spec.nested_comments)
        code = blank_strings(no_comments)
        for match in spec.declaration.finditer(code):
            where = f"{path}:{code.count(chr(10), 0, match.start()) + 1}"
            shape = spec.shape.match(code, match.end())
            close = closing_index(code, shape.end() - 1, spec.opener, spec.closer) if shape else None
            if shape is None or close is None:
                found.append(Found(where, None, []))
                continue
            values, others = literal_items(no_comments[shape.end() : close])
            found.append(Found(where, values, others))
    return found


def item_problems(label: str, found: Found) -> List[str]:
    problems: List[str] = []
    if found.others:
        problems.append(
            f"{found.where}: {label} 에 문자열 리터럴이 아닌 항목이 있다: {found.others} — 값을 그대로 적는다"
        )
    values = found.values or []
    repeated = sorted({value for value in values if values.count(value) > 1})
    if repeated:
        problems.append(f"{found.where}: {label} 에 같은 값이 두 번 있다: {repeated}")
    return problems


def check(
    shared_files: List[Tuple[str, str]],
    android_files: List[Tuple[str, str]],
    ios_files: List[Tuple[str, str]],
) -> List[str]:
    shared = find_declarations(SHARED_SPEC, shared_files)
    if len(shared) != 1 or shared[0].values is None:
        where = ", ".join(found.where for found in shared) or "없음"
        return [
            f"{SHARED_SPEC.label} 를 읽지 못했다(선언 {len(shared)}곳: {where}) — 모양은 {SHARED_SPEC.shape_hint}"
        ]
    problems = item_problems(SHARED_SPEC.label, shared[0])
    expected = set(shared[0].values or [])

    for spec, files in ((ANDROID_SPEC, android_files), (IOS_SPEC, ios_files)):
        found = find_declarations(spec, files)
        if not found:
            problems.append(f"{spec.label}: 선언을 찾지 못했다 — 이름을 바꿨거나 즉석 목록으로 되돌렸다. 모양은 {spec.shape_hint}")
            continue
        if len(found) > 1:
            problems.append(
                f"{spec.label}: 선언이 {len(found)}곳에 있다 — 하나만 둔다: " + ", ".join(f.where for f in found)
            )
            continue
        only = found[0]
        if only.values is None:
            problems.append(f"{only.where}: {spec.label} 의 모양이 다르다 — {spec.shape_hint}")
            continue
        problems.extend(item_problems(spec.label, only))
        actual = set(only.values)
        if actual != expected:
            problems.append(
                f"{only.where}: {spec.label} 이 shared 와 다르다\n"
                f"      빠진 값: {sorted(expected - actual)}\n"
                f"      남는 값: {sorted(actual - expected)}"
            )
    return problems


def source_files(directory: Path, suffix: str, name: str) -> List[Tuple[str, str]]:
    """이름이 글자로라도 나오는 파일만 — 선언이 있을 수 있는 파일은 그것뿐이다."""
    files: List[Tuple[str, str]] = []
    if not directory.exists():
        return files
    for path in sorted(directory.rglob(f"*{suffix}")):
        if "build" in path.relative_to(directory).parts:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        if name in text:
            files.append((str(path.relative_to(ROOT)), text))
    return files


# ── 자체 시험 ──────────────────────────────────────────────────────────────────────────────────
_SHARED_SAMPLE = """
export const ALERTING_ERROR_CODES: readonly ErrorCode[] = ['X_ALERT'];
/** CLIENT_EXPECTED_REFUSAL_CODES 를 고치면 — `export const CLIENT_EXPECTED_REFUSAL_CODES = ['FAKE']` */
export const CLIENT_EXPECTED_REFUSAL_CODES: readonly ErrorCode[] = [
  // 'COMMENTED_OUT' 은 주석이다 — [괄호] 와 따옴표가 섞여도
  'A_CODE',
  /* 'B_FAKE' */ "B_CODE",
];
"""
_ANDROID_SAMPLE = """
/** [EXPECTED_REFUSAL_CODES] 에 있으면 낮춘다. 예: val EXPECTED_REFUSAL_CODES = setOf("FAKE") */
internal val EXPECTED_REFUSAL_CODES: Set<String> = setOf(
    "A_CODE", // "C_FAKE"
    "B_CODE",
)
fun demote(code: String) = code in EXPECTED_REFUSAL_CODES
val note = "val EXPECTED_REFUSAL_CODES = setOf(\\"Q\\")"
"""
_IOS_SAMPLE = """
/* 바깥 /* 안쪽 */ 아직 주석 let expectedRefusalCodes: Set<String> = ["FAKE"] */
enum AlarmTalkLog {
    static let expectedRefusalCodes: Set<String> = [
        "B_CODE", "A_CODE",
    ]
    static func isRefusal(_ code: String) -> Bool { expectedRefusalCodes.contains(code) }
}
"""


def run_self_test() -> List[str]:
    failures: List[str] = []
    shared = [("error-codes.ts", _SHARED_SAMPLE)]
    android = [("Log.kt", _ANDROID_SAMPLE)]
    ios = [("Log.swift", _IOS_SAMPLE)]

    def expect(condition: bool, why: str) -> None:
        if not condition:
            failures.append(why)

    def flags(problems: List[str], needle: str) -> bool:
        return any(needle in problem for problem in problems)

    expect(check(shared, android, ios) == [], "주석·문자열·사용처를 선언으로 셌거나, 같은 목록을 다르다고 했다")
    expect(
        flags(check(shared, android, [("A.swift", 'static let expectedRefusalCodes: Set<String> = ["A_CODE"]')]), "B_CODE"),
        "빠진 값을 못 잡았다",
    )
    expect(
        flags(check(shared, [("A.kt", 'val EXPECTED_REFUSAL_CODES = setOf("A_CODE", "B_CODE", "Z_CODE")')], ios), "Z_CODE"),
        "남는 값을 못 잡았다",
    )
    expect(flags(check(shared, [], ios), "찾지 못했다"), "선언이 없는 것을 못 잡았다")
    expect(
        flags(check(shared, android + [("B.kt", 'val EXPECTED_REFUSAL_CODES = setOf("A_CODE", "B_CODE")')], ios), "곳에 있다"),
        "두 곳의 선언을 못 잡았다",
    )
    expect(
        flags(check(shared, android, [("A.swift", 'let expectedRefusalCodes = ["A_CODE", "B_CODE"]')]), "모양"),
        "Swift 배열을 Set 으로 봤다",
    )
    expect(
        flags(check(shared, [("A.kt", 'val EXPECTED_REFUSAL_CODES = listOf("A_CODE", "B_CODE")')], ios), "모양"),
        "listOf 를 setOf 로 봤다",
    )
    expect(
        flags(check(shared, [("A.kt", 'val EXPECTED_REFUSAL_CODES = setOf("A_CODE", Codes.B_CODE)')], ios), "리터럴이 아닌"),
        "리터럴이 아닌 항목을 못 잡았다",
    )
    expect(
        flags(
            check(shared, android, [("A.swift", 'let expectedRefusalCodes: Set<String> = ["A_CODE", "B_CODE", "A_CODE"]')]),
            "두 번",
        ),
        "중복 값을 못 잡았다",
    )
    expect(
        check(shared, android, [("A.swift", 'let expectedRefusalCodes = Set<String>(["A_CODE", "B_CODE"])')]) == [],
        "Set<String>([...]) 꼴을 못 읽었다",
    )
    tricky = find_declarations(ANDROID_SPEC, [("A.kt", 'val EXPECTED_REFUSAL_CODES = setOf("A//B", "C/*D", "E)")')])
    expect(
        len(tricky) == 1 and tricky[0].values == ["A//B", "C/*D", "E)"],
        "문자열 안의 // · /* · 괄호를 주석·끝으로 읽었다",
    )
    expect(
        flags(check([("error-codes.ts", "export const ALERTING_ERROR_CODES = ['X'];")], android, ios), "읽지 못했다"),
        "shared 목록이 없는 것을 못 잡았다",
    )
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description="예상된 거절 목록이 shared·Android·iOS 에서 같은지 본다.")
    parser.add_argument("--self-test", action="store_true", help="검사기 자체만 시험한다")
    args = parser.parse_args()

    failures = run_self_test()
    if failures:
        print("이 검사가 고장났다:\n", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1
    if args.self_test:
        print("check-expected-refusal-codes 자체 시험 통과.")
        return 0

    if not SHARED.exists():
        print(f"원본이 없다: {SHARED.relative_to(ROOT)}", file=sys.stderr)
        return 1
    problems: List[str] = []
    for directory in (ANDROID_DIR, IOS_DIR):
        if not directory.exists():
            problems.append(f"{directory.relative_to(ROOT)} 가 없다 — 경로가 바뀌었으면 이 검사도 옮길 것")
    problems.extend(
        check(
            [(str(SHARED.relative_to(ROOT)), SHARED.read_text(encoding="utf-8"))],
            source_files(ANDROID_DIR, ".kt", ANDROID_SPEC.name),
            source_files(IOS_DIR, ".swift", IOS_SPEC.name),
        )
    )
    if problems:
        print("예상된 거절 목록이 갈라졌다:\n", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        print(
            "\n원본은 `packages/shared/src/schemas/error-codes.ts` 의 `CLIENT_EXPECTED_REFUSAL_CODES` 다. 값을 바꾸려면\n"
            "거기부터 고치고 두 앱의 상수(안드로이드 `EXPECTED_REFUSAL_CODES`, iOS `expectedRefusalCodes`)를 같은 값으로\n"
            "맞춘다. 규칙은 `docs/spec/error-codes.md` §3 「앱도 같다」.",
            file=sys.stderr,
        )
        return 1
    print("예상된 거절 목록이 shared·Android·iOS 에서 일치한다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
