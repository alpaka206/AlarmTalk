#!/usr/bin/env python3
"""응원·기상 인사 문구 원본(`packages/shared/src/stock-content.json`)에서 **검수표**를 만든다.

## 왜 있는가

문구는 한 벌이어야 한다(`docs/spec/voice-and-message.md` §5-4). 서버 시드·게시 스크립트는 `@alarmtalk/shared` 로 JSON 을
그대로 읽는다(`stock-content.ts` → `lib/stock-clips.ts` 의 `STOCK_CLIP_PRESETS`). 사람이 세 언어를 나란히 읽고 청취 검수 때
대조할 표는 이 스크립트가 만든다 — **만든 파일을 손으로 고치지 말 것.** 다음 생성이 덮고, `--check` 가 CI 에서 어긋남을 잡는다.

| 대상 | 파일 |
| --- | --- |
| 검수표 | `docs/product/stock-content-review.md` |

글자 수는 **코드 포인트**로 센다(합성 요청에 실리는 글자 그대로, 앞뒤 공백 제외). 목소리 × 언어 × 문구의 합성량은
`npm run cost:stock`(백엔드)이 같은 셈으로 낸다.

실행:
  python3 scripts/gen-stock-content.py          # 파일을 새로 쓴다
  python3 scripts/gen-stock-content.py --check  # 디스크의 파일이 JSON 과 맞는지만 본다(CI)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "packages/shared/src/stock-content.json"
REVIEW_MD = ROOT / "docs/product/stock-content-review.md"
LOCALES = ("ko", "en", "ja")
LOCALE_LABEL = {"ko": "한국어", "en": "English", "ja": "日本語"}


def chars(text: str) -> int:
    return len(text.strip())


def cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def render(doc: dict) -> str:
    out: list[str] = []
    out.append("# 응원·기상 인사 문구 검수표")
    out.append("")
    out.append("> **생성 파일이다 — 손으로 고치지 말 것.** 원본은 `packages/shared/src/stock-content.json`, 다시 만들기는")
    out.append("> `python3 scripts/gen-stock-content.py`. 규칙은 [`docs/spec/voice-and-message.md`](../spec/voice-and-message.md) §5-4.")
    out.append("")
    out.append("검수 순서: 세 언어 문장 검수 → `npm run cost:stock`(비용 dry-run) → `npm run preview:stock -- --category <카테고리>`")
    out.append("→ 청취 검수 → `npm run publish:stock -- --env dev --category <카테고리>` → `--release <묶음>` → prod.")
    out.append("")
    out.append("| 묶음 | 테마 | 카테고리 | 상태 | 항목 수 |")
    out.append("| --- | --- | --- | --- | --- |")
    for s in doc["sets"]:
        if s["baseline"]:
            state = "게시됨(옛 알람 참조용)" if s["legacy"] else "게시됨"
        else:
            state = "공개 표식 필요"
        out.append(f"| `{s['id']}` | `{s['theme']}` | `{s['category']}` | {state} | {len(s['items'])} |")
    out.append("")
    for s in doc["sets"]:
        out.append(f"## `{s['id']}`")
        out.append("")
        out.append(cell(s["note"]))
        out.append("")
        has_seed = any("clone_seed" in item for item in s["items"])
        header = "| ID | 자리 | " + " | ".join(f"{LOCALE_LABEL[loc]} (글자)" for loc in LOCALES)
        sep = "| --- | --- | " + " | ".join("---" for _ in LOCALES)
        if has_seed:
            header += " | 클론 시드"
            sep += " | ---"
        out.append(header + " |")
        out.append(sep + " |")
        totals = {loc: 0 for loc in LOCALES}
        for index, item in enumerate(s["items"]):
            row = f"| `{item['id']}` | {index} | "
            parts = []
            for loc in LOCALES:
                text = item["texts"][loc]
                totals[loc] += chars(text)
                parts.append(f"{cell(text)} ({chars(text)})")
            row += " | ".join(parts)
            if has_seed:
                row += " | " + cell(item.get("clone_seed", ""))
            out.append(row + " |")
        out.append("")
        out.append("글자 합계: " + " · ".join(f"{LOCALE_LABEL[loc]} {totals[loc]}" for loc in LOCALES))
        out.append("")
    return "\n".join(out).rstrip() + "\n"


def main() -> int:
    check = "--check" in sys.argv[1:]
    doc = json.loads(SOURCE.read_text(encoding="utf-8"))
    rendered = render(doc)
    if check:
        current = REVIEW_MD.read_text(encoding="utf-8") if REVIEW_MD.exists() else ""
        if current != rendered:
            print(f"{REVIEW_MD.relative_to(ROOT)} 가 원본과 다르다 — python3 scripts/gen-stock-content.py 로 다시 만들 것.")
            return 1
        print("검수표가 원본과 같다.")
        return 0
    REVIEW_MD.parent.mkdir(parents=True, exist_ok=True)
    REVIEW_MD.write_text(rendered, encoding="utf-8")
    print(f"썼다: {REVIEW_MD.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
