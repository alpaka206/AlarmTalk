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

숫자 전용 입력(`filter(Char::isDigit)`, `isNumber`)은 대상이 아니다 — 위험 문자가
애초에 못 들어간다.
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
              "takeWithoutSplittingPairs")
IOS_OK = ("InputSanitizer.",)

# 숫자 전용이라 면제
ANDROID_NUMERIC = ("isDigit", "isNumber", "filter(Char::isDigit)")
IOS_NUMERIC = ("isNumber", "isWholeNumber", "filter(\\.isNumber)")


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


def main() -> int:
    findings = scan_android() + scan_ios()
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
        )
        return 1
    print("모든 입력창이 새니타이저를 거친다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
