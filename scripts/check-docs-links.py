#!/usr/bin/env python3
"""문서의 **상대 링크와 스펙 색인**이 실재하는지 검사한다.

왜 필요한가: 동작 규칙을 `docs/spec/` 한 곳으로 모으면서 `CLAUDE.md` 는 포인터만 남겼다.
그 포인터가 깨지면 **규칙이 있는 줄도 모른 채** 코드만 고치게 된다 — 이 저장소에서
반복된 사고가 정확히 그 모양이었다(주석이 없는 파일을 근거로 대던 것).

검사하는 것:
  1. 마크다운의 상대 링크가 가리키는 파일이 실재하는가
  2. **백틱으로 적은 `docs/...` 경로**가 실재하고 **git 에 추적되는가**
  3. `docs/spec/` 의 모든 문서가 **두 색인**(`docs/spec/README.md`, `CLAUDE.md`)에
     들어 있는가 — 새 스펙을 만들고 색인에 안 넣으면 아무도 못 찾는다

⚠ 2번이 왜 있나: `.gitignore` 에 빗금 없는 `ios/` 가 있어서 **`docs/ios/` 가 통째로
추적되지 않았다.** 로컬에는 파일이 있으니 1번 검사도, 사람 눈도 통과했지만, 클론한
사람에게는 `CLAUDE.md` 가 "상세는 docs/ios/" 라고 가리키는 문서가 **아예 없었다.**
그래서 존재만이 아니라 **추적 여부**까지 본다. 링크가 아니라 백틱 경로로 적혀 있어서
1번에도 안 걸렸다 — 이 저장소의 포인터는 둘 다 쓴다.

실행: python3 scripts/check-docs-links.py   (문제가 있으면 exit 1)
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SPEC_DIR = ROOT / "docs/spec"
INDEXES = [SPEC_DIR / "README.md", ROOT / "CLAUDE.md"]

LINK = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
# 백틱 안의 docs 경로. 뒤에 `:12` / `:12-15` / `:57,59` 같은 줄번호가 붙어도 잡는다.
# `docs/<slug>` 처럼 꺾쇠가 든 것은 **템플릿 자리표시자**라 제외한다.
BACKTICK_DOCS = re.compile(r"`(docs/[^`\s<>]+?)(?::[\d,\-]+)?`")
SKIP_PREFIXES = ("http://", "https://", "mailto:", "#")


def tracked_paths() -> set[str]:
    """git 이 추적하는 경로 집합. git 이 없으면 빈 집합(=이 검사 건너뜀)."""
    try:
        out = subprocess.run(
            ["git", "-C", str(ROOT), "ls-files"],
            capture_output=True, text=True, check=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        return set()
    return set(out.splitlines())


def main() -> int:
    problems: list[str] = []

    # 1) 상대 링크가 실재하는가
    for md in sorted(ROOT.rglob("*.md")):
        if any(part in {"node_modules", "build", ".git", "Pods"} for part in md.parts):
            continue
        for number, line in enumerate(md.read_text(errors="ignore").splitlines(), 1):
            for target in LINK.findall(line):
                if target.startswith(SKIP_PREFIXES):
                    continue
                path = target.split("#", 1)[0].strip()
                if not path:
                    continue
                if not (md.parent / path).resolve().exists():
                    problems.append(f"{md.relative_to(ROOT)}:{number}  깨진 링크 → {path}")

    # 2) 백틱으로 적은 docs 경로가 실재하고 **추적되는가**
    tracked = tracked_paths()
    for md in sorted(ROOT.rglob("*.md")):
        if any(part in {"node_modules", "build", ".git", "Pods"} for part in md.parts):
            continue
        for number, line in enumerate(md.read_text(errors="ignore").splitlines(), 1):
            for target in set(BACKTICK_DOCS.findall(line)):
                path = ROOT / target
                where = f"{md.relative_to(ROOT)}:{number}"
                if not path.exists():
                    problems.append(f"{where}  없는 경로 → {target}")
                elif tracked:
                    # 디렉터리면 그 아래 아무거나 하나라도 추적되면 된다.
                    ok = (
                        target in tracked
                        if path.is_file()
                        else any(t.startswith(target.rstrip("/") + "/") for t in tracked)
                    )
                    if not ok:
                        problems.append(
                            f"{where}  git 에 없는 경로 → {target}"
                            "  (로컬에만 있다 — 클론하면 안 보인다. .gitignore 확인)"
                        )

    # 3) 스펙이 **두 색인 각각에** 들어 있는가
    #
    # ⚠ 두 파일을 합쳐서 검사하면 안 된다. 한쪽에만 있어도 통과해 버려서, 색인 하나가
    #    빠진 걸 못 잡는다(처음에 그렇게 짰다가 일부러 깨뜨린 테스트를 놓쳤다).
    for spec in sorted(SPEC_DIR.glob("*.md")):
        if spec.name == "README.md":
            continue
        for index in INDEXES:
            if not index.exists():
                continue
            if spec.name not in index.read_text(errors="ignore"):
                problems.append(
                    f"docs/spec/{spec.name} 이 {index.relative_to(ROOT)} 색인에 없다"
                )

    if problems:
        print(f"문서 문제 {len(problems)}건:\n")
        for problem in problems:
            print(f"  {problem}")
        return 1

    print("문서 링크와 스펙 색인이 모두 정상이다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
