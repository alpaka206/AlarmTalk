#!/usr/bin/env python3
"""입력창이 **새니타이저를 거치는지** 검사한다.

CLAUDE.md 「입력 규칙은 한 곳에서만」 규약의 기계 검사다. 규약 자체는 이미 문서에
있고 새니타이저 함수의 단위 테스트도 있지만, **실제로 깨진 방식은 늘 우회였다** —
새 입력창이 `onValueChange = { it.take(50) }` 처럼 생 리터럴로 자르고 새니타이저를
아예 안 부르는 것. 함수 테스트로는 그걸 못 잡는다(함수는 멀쩡하다).

무엇이 잘못되나:
  1. **제어문자·제로폭·양방향 제어문자가 그대로 들어간다.** 로그·CSV 를 깨고,
     눈에 같아 보이는 다른 값이라 사칭에 쓰이며, 문구 필드면 TTS 낭독을 망친다.
  2. **서러게이트 쌍이 반으로 갈린다.** 코틀린 `take(n)` 은 UTF-16 코드 유닛 단위라
     상한 경계에 이모지가 오면 깨진 반쪽이 DB·JWT 에 실린다.
  3. **상한 리터럴이 공유 상수와 어긋난다.** 앱이 더 느슨하면 서버가 거절하고,
     더 빡빡하면 서버가 허용하는 이름을 못 쓴다.
  4. iOS 는 한 가지가 더 있다 — `String.prefix(n)` 은 **grapheme 단위**인데 서버는
     UTF-16 으로 센다. 이모지 20개는 Swift 20(통과)/서버 40(거절)이라 앱은 통과시키고
     서버만 거절하는 이름이 생긴다. `InputSanitizer.clamp(_:max:)` 가 그걸 맞춘다.

숫자 전용 입력(`filter(Char::isDigit)`, `isNumber`)은 1~4 의 대상이 아니다 — 위험 문자가
애초에 못 들어간다. ⚠ 그렇다고 **안전한 것은 아니다.** `isDigit`·`isNumber` 는 ASCII 가 아닌
숫자(아라비아-인도·페르시아·전각·데바나가리…)를 그대로 넘긴다. 서버로 가는 **인증 코드**는 형식
검사가 ASCII 여섯 자만 받고 서버가 바꿔 주는 것은 세 숫자 블록뿐이라(`docs/spec/session-and-auth.md`
「코드는 ASCII 숫자 여섯 자다」), 그 밖의 숫자로 친 코드는 영영 통과하지 못한다 — 숫자를 ASCII 로
바꾸는 것은 앱 1차(인증 코드 새니타이저)의 몫이다. 그래서 하나를 더 본다:

  5. **인증 코드 칸은 인증 코드 새니타이저를 거친다.** 안드로이드 `ui/auth/` 의
     `onValueChange = { … }` 가 숫자로 거르거나(`filter(Char::isDigit)`) 6자에서 자르면(`take(6)`)
     `sanitizeVerificationCode` 를 불러야 하고, iOS `Views/Auth/` 의 `.onChange(of:)`·`set:`
     클로저가 `filter(\\.isNumber)` 로 거르거나 `prefix(6)` 으로 자르면
     `InputSanitizer.sanitizeVerificationCode` 를 불러야 한다. 핸들러를 **블록째** 읽는다 — 예전
     가입 화면처럼 `onValueChange = {` 와 필터가 다른 줄에 있어도 잡는다. 주석·문자열 속 글자는
     세지 않는다. 인증 화면 폴더가 없거나 그 새니타이저를 부르는 칸을 하나도 못 찾으면 실패한다 —
     화면이 옮겨 갔는데 이 검사만 남아 조용히 통과하지 않게.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

ANDROID = ROOT / "apps/android-native/app/src/main/java"
IOS = ROOT / "apps/ios-native/AlarmTalk"

# 새니타이저를 거쳤다고 인정하는 흔적
ANDROID_OK = ("sanitizeUserText", "sanitizeDisplayName", "sanitizeRedeemCode",
              "sanitizeVerificationCode", "takeWithoutSplittingPairs")
IOS_OK = ("InputSanitizer.",)

# 숫자 전용이라 1~4 에서 면제 — 인증 코드 칸은 5번이 따로 본다
ANDROID_NUMERIC = ("isDigit", "isNumber", "filter(Char::isDigit)")
IOS_NUMERIC = ("isNumber", "isWholeNumber", "filter(\\.isNumber)")

# 5번 — 인증 코드 칸. (화면 폴더, 핸들러 시작, 옛 칸의 모양, 반드시 부를 새니타이저, 코틀린인가)
# 옛 칸의 모양은 **숫자로 거르기**(`filter`·`all` 류)와 **6자 자르기**다. `any { it.isDigit() }` 같은
# 비밀번호 규칙 확인은 거르기가 아니라 걸리지 않는다. 코드 칸은 거의 언제나 6자에서 자르므로, 낯선
# 거르기 모양은 자르기가 잡는다.
AUTH_CODE_FIELDS = (
    (
        ANDROID / "com/alarmtalk/app/ui/auth", ".kt",
        re.compile(r"\bonValueChange\s*=\s*\{"),
        re.compile(r"\b(?:filter|filterNot|all)\s*(?:\(\s*Char::isDigit\s*\)|\{[^{}]*\bisDigit\b)"
                   r"|\.take\(\s*(?:6|VerificationCodeLength)\s*\)"),
        "sanitizeVerificationCode", True,
    ),
    (
        IOS / "Views/Auth", ".swift",
        re.compile(r"\.onChange\s*\(|\bset:\s*\{"),
        re.compile(r"\b(?:filter|allSatisfy)\s*(?:\(\s*\\\.(?:isNumber|isWholeNumber)\s*\)"
                   r"|\{[^{}]*\b(?:isNumber|isWholeNumber|decimalDigits)\b)"
                   r"|\.prefix\(\s*(?:6|(?:InputSanitizer\.)?verificationCodeLength)\s*\)"),
        "InputSanitizer.sanitizeVerificationCode", False,
    ),
)


def scan_android() -> list[str]:
    bad: list[str] = []
    for path in sorted(ANDROID.rglob("*.kt")):
        for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if "onValueChange" not in line:
                continue
            if not re.search(r"\.take\(\s*\d+\s*\)", line):
                continue
            if any(tok in line for tok in ANDROID_OK):
                continue
            if any(tok in line for tok in ANDROID_NUMERIC):
                continue
            bad.append(f"{path.relative_to(ROOT)}:{i}  {line.strip()[:100]}")
    return bad


def scan_ios() -> list[str]:
    bad: list[str] = []
    for path in sorted(IOS.rglob("*.swift")):
        text = path.read_text(encoding="utf-8")
        lines = text.splitlines()
        for i, line in enumerate(lines, 1):
            m = re.search(r"\.prefix\(\s*\d+\s*\)", line)
            if not m:
                continue
            # 입력 핸들러 문맥인지 — 위 6줄 안에 onChange/set:/binding 이 있는가
            context = "\n".join(lines[max(0, i - 7):i])
            if not re.search(r"onChange\(of:|set:\s*\{|wrappedValue", context + line):
                continue
            if any(tok in line for tok in IOS_OK):
                continue
            # 숫자 전용은 면제 — 거를 위험 문자가 애초에 없다. 필터가 **앞줄**에 있는
            # 경우(`let digits = newValue.filter(\.isNumber)`)가 흔해서 문맥까지 본다.
            if any(tok in (context + line) for tok in IOS_NUMERIC):
                continue
            bad.append(f"{path.relative_to(ROOT)}:{i}  {line.strip()[:100]}")
    return bad


def blank_comments_and_strings(text: str, kotlin: bool) -> str:
    """주석·문자열 리터럴의 글자를 공백으로 지운다 — 줄바꿈과 글자 자리는 그대로라 줄 번호가 맞는다.

    지우지 않으면 주석에 남은 옛 이름("`isDigit` 필터는 …")이 걸리고, 문자열 속 중괄호가 블록의
    끝을 흐린다. 한 줄 문자열은 줄 끝에서 끊는다 — 보간 속 따옴표를 잘못 읽어도 그 줄에서 멈춘다.
    """
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
        elif text.startswith("/*", i):
            depth, end = 1, i + 2
            while end < n and depth:
                if text.startswith("/*", end):
                    depth, end = depth + 1, end + 2
                elif text.startswith("*/", end):
                    depth, end = depth - 1, end + 2
                else:
                    end += 1
        elif text.startswith('"""', i):
            end = text.find('"""', i + 3)
            end = n if end == -1 else end + 3
        elif text[i] == '"' or (kotlin and text[i] == "'"):
            quote, end = text[i], i + 1
            while end < n and text[end] not in (quote, "\n"):
                end += 2 if text[end] == "\\" else 1
            end = min(end + 1, n)
        else:
            i += 1
            continue
        blank(i, end)
        i = end
    return "".join(out)


def handler_body(code: str, match: re.Match) -> tuple[int, int] | None:
    """핸들러가 여는 블록 본문의 (시작, 끝) 자리. `.onChange(…)` 는 괄호를 건너 뒤따르는 클로저를 본다."""
    start = match.end() - 1
    if code[start] == "(":
        depth = 0
        for k in range(start, len(code)):
            depth += {"(": 1, ")": -1}.get(code[k], 0)
            if depth == 0:
                break
        else:
            return None
        start = k + 1
        while start < len(code) and code[start].isspace():
            start += 1
        if start >= len(code) or code[start] != "{":
            return None  # `perform:` 처럼 클로저가 아닌 인자
    depth = 0
    for k in range(start, len(code)):
        depth += {"{": 1, "}": -1}.get(code[k], 0)
        if depth == 0:
            return start + 1, k
    return None


def scan_auth_code_fields() -> list[str]:
    """5번 — 인증 화면에서 숫자를 거르거나 6자로 자르는 핸들러는 인증 코드 새니타이저를 부른다."""
    bad: list[str] = []
    for directory, suffix, handler, old_shape, sanitizer, kotlin in AUTH_CODE_FIELDS:
        where = directory.relative_to(ROOT)
        if not directory.is_dir():
            bad.append(f"{where}  인증 화면 폴더가 없다 — 화면을 옮겼으면 이 검사의 경로도 옮길 것")
            continue
        sanitized_fields = 0
        for path in sorted(directory.rglob(f"*{suffix}")):
            raw = path.read_text(encoding="utf-8")
            code = blank_comments_and_strings(raw, kotlin)
            for match in handler.finditer(code):
                span = handler_body(code, match)
                if span is None:
                    continue
                body = code[span[0]:span[1]]
                if sanitizer in body:
                    sanitized_fields += 1
                    continue
                hit = old_shape.search(body)
                if not hit:
                    continue
                lineno = code.count("\n", 0, span[0] + hit.start()) + 1
                line = raw.splitlines()[lineno - 1].strip()
                bad.append(f"{path.relative_to(ROOT)}:{lineno}  {line[:100]}")
        if sanitized_fields == 0:
            bad.append(
                f"{where}  `{sanitizer}` 를 부르는 인증 코드 칸을 하나도 못 찾았다 — "
                "칸을 옮겼으면 이 검사의 경로·핸들러 모양도 옮길 것"
            )
    return bad


def main() -> int:
    findings = scan_android() + scan_ios() + scan_auth_code_fields()
    if findings:
        print("입력창이 새니타이저를 거치지 않는다 (CLAUDE.md 「입력 규칙은 한 곳에서만」):\n")
        for f in findings:
            print(f"  {f}")
        print(
            "\n고치는 법:"
            "\n  Android — sanitizeDisplayName(it, maxLength = DisplayNameMaxLength|VoiceNameMaxLength)"
            "\n            문구처럼 줄바꿈을 허용하는 필드는"
            "\n            sanitizeUserText(it, allowNewlines = true).takeWithoutSplittingPairs(n)"
            "\n  iOS     — InputSanitizer.clampDisplayName(_) / .clampVoiceName(_)"
            "\n            (길이는 UTF-16 으로 세야 서버와 같다 — prefix(n) 은 grapheme 단위라 어긋난다)"
            "\n  인증 코드 칸 — Android sanitizeVerificationCode(it) / iOS InputSanitizer.sanitizeVerificationCode(_)"
            "\n            (isDigit·isNumber 는 ASCII 가 아닌 숫자를 그대로 넘긴다 — 서버가 바꿔 주는 것은 세 숫자 블록뿐이다)"
        )
        return 1
    print("모든 입력창이 새니타이저를 거친다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
