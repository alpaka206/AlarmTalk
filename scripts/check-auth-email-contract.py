import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def extract(relative_path: str, expression: str, raw: bool = False) -> str:
    content = (ROOT / relative_path).read_text(encoding="utf-8")
    match = re.search(expression, content)
    if match is None:
        raise ValueError(f"{relative_path}: 이메일 판정 상수를 찾지 못했습니다")
    return match.group(1) if raw else json.loads('"' + match.group(1) + '"')


def main() -> int:
    shared = extract("packages/shared/src/schemas/auth.ts", r'export const EMAIL_PATTERN\s*=\s*"([^"\n]+)"')
    android = extract("apps/android-native/app/src/main/java/com/alarmtalk/app/ui/auth/AuthEmail.kt",
                      r'const val AuthEmailPattern\s*=\s*"([^"\n]+)"')
    ios = extract("apps/ios-native/AlarmTalk/AuthEmailFormat.swift",
                  r'static let pattern\s*=\s*#"([^"\n]+)"#', raw=True)
    if android != shared or ios != shared:
        print("이메일 정규식이 shared 계약과 다릅니다", file=sys.stderr)
        return 1
    print("이메일 형식 계약: backend / Android / iOS 일치")
    return 0


if __name__ == "__main__":
    sys.exit(main())
