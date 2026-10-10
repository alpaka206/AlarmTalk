#!/usr/bin/env python3
"""목소리 등록의 **제시 대본**이 서버가 아는 글과 같은지 본다.

## 왜 있는가

서버는 등록 녹음 전사가 제시 대본을 읽은 것인지 글자로 가려, 읽은 녹음이면 말투 분석의 어체를 버린다
(`docs/spec/voice-and-message.md` §4-2 — 대본은 존댓말이라 읽은 사람은 누구든 정중체로 분석됐다). 서버가 대조하는
원본은 `packages/shared/src/voice-enrollment-script.json` 이고, 두 앱은 TypeScript 를 못 쓰니 같은 글을 손으로 둔다.
앱의 대본만 고치면 서버가 새 대본을 못 알아봐 **아무 경보 없이** 다시 대본의 존댓말이 화자의 어체로 저장된다.

## 무엇을 비교하는가

| 원본(shared) | Android | iOS |
| --- | --- | --- |
| `ko`·`en`·`ja` | `voices2_record_script`(`res/values{,-en,-ja}/strings.xml`) | `VoiceCloneUploadFlow.recordingScript`(`default`·`"en"`·`"ja"`) |

서버 판정처럼 **글자·숫자만** 비교한다(NFKC·소문자) — 문장부호·띄어쓰기·줄바꿈 차이는 같은 글이다(iOS 영어는 줄표를 쓴다).
"""
from __future__ import annotations

import html
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SHARED = ROOT / "packages/shared/src/voice-enrollment-script.json"
ANDROID_RES = ROOT / "apps/android-native/app/src/main/res"
ANDROID = {"ko": "values", "en": "values-en", "ja": "values-ja"}
IOS = ROOT / "apps/ios-native/AlarmTalk/Views/Voices/VoiceCloneUploadFlow.swift"
IOS_CASES = {"en": r'case "en":', "ja": r'case "ja":', "ko": r"default:"}


def letters(text: str) -> str:
    """서버 `enrollment-script.ts` 의 `lettersOnly` 와 같다 — 글자·숫자만(NFKC·소문자)."""
    normalized = unicodedata.normalize("NFKC", text).lower()
    return "".join(ch for ch in normalized if unicodedata.category(ch)[0] in ("L", "N"))


def android_script(lang: str) -> str | None:
    path = ANDROID_RES / ANDROID[lang] / "strings.xml"
    if not path.exists():
        return None
    m = re.search(r'<string name="voices2_record_script">(.*?)</string>', path.read_text(encoding="utf-8"), re.S)
    if not m:
        return None
    # 안드로이드 문자열 이스케이프(\n · \' · \")를 풀고 XML 엔티티를 푼다. 풀지 않으면 '\n' 의 'n' 이 글자로 남는다.
    text = re.sub(r"\\(.)", lambda e: "\n" if e.group(1) == "n" else e.group(1), m.group(1))
    return html.unescape(text)


def ios_script(lang: str) -> str | None:
    if not IOS.exists():
        return None
    source = IOS.read_text(encoding="utf-8")
    body = re.search(r"var recordingScript: String \{(.*?)\n    \}\n", source, re.S)
    if not body:
        return None
    m = re.search(IOS_CASES[lang] + r'\s*return """\n(.*?)\n\s*"""', body.group(1), re.S)
    return m.group(1) if m else None


def main() -> int:
    shared = json.loads(SHARED.read_text(encoding="utf-8"))
    problems: list[str] = []
    for lang in ("ko", "en", "ja"):
        expected = shared.get(lang)
        if not expected:
            problems.append(f"shared `{lang}`: 대본이 없다")
            continue
        for label, actual in (
            (f"Android {ANDROID[lang]}/voices2_record_script", android_script(lang)),
            (f"iOS recordingScript({lang})", ios_script(lang)),
        ):
            if actual is None:
                problems.append(f"{label}: 대본을 찾지 못했다 — 이름·자리를 바꿨으면 이 검사도 고친다")
            elif letters(actual) != letters(expected):
                problems.append(f"{label}: shared 와 글이 다르다")

    if problems:
        print("제시 대본이 갈라졌다:\n", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        print(
            "\n원본은 `packages/shared/src/voice-enrollment-script.json` 이다. 대본을 바꾸려면 거기와 두 앱을\n"
            "같은 글로 고친다 — 서버가 그 글로 대본 읽기를 가려 말투 분석의 어체를 버린다(스펙 §4-2).",
            file=sys.stderr,
        )
        return 1

    print("제시 대본이 shared·Android·iOS 에서 일치한다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
