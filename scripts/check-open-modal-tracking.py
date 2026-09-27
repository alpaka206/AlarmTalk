#!/usr/bin/env python3
"""창을 여는 모달은 **스스로 이름을 적는다** — 빠뜨리는 것을 CI 에서 막는다.

## 왜 있는가

개인 플랜 종료 안내는 **앱에 들어올 때마다** 뜬다. '들어옴' 은 프로세스 ON_START 라 문서
선택기·시스템 설정·브라우저에서 돌아오는 것도 진입이고, 그때 목소리 등록 창 같은 모달이 아직
열려 있을 수 있다. 안내는 다른 창 위에 뜨면 안 된다(`docs/spec/gates-and-overlays.md`
「개인 플랜 종료 안내」 — 모달이 둘이면 둘 다 못 읽는다).

모달은 화면 곳곳에서 로컬 상태로 열리므로, 뷰모델 플래그로 끌어올리는 대신 **창을 여는 자리**가
`TrackOpenModal()` 을 불러 `OpenModalRegistry` 에 적는다(`ui/components/OpenModalRegistry.kt`).
껍데기(`IosAlertDialog`·`WakerSelectionSheet`·`WakerFormSheet`)는 이미 부른다. 문제는 **껍데기를
거치지 않는 새 `Dialog(`·`ModalBottomSheet(`** 다 — 그 규칙이 KDoc 한 줄에만 있어서 다음 사람이
빠뜨려도 아무도 모른다. 빠뜨리면 그 모달 위로 진입 안내가 조용히 겹쳐 뜬다(리뷰 지적).

## 무엇을 막는가

`apps/android-native` 아래 `.kt` 파일에서 **날것의** `Dialog(` · `ModalBottomSheet(` 호출
(`androidx.compose.ui.window.Dialog(` 처럼 패키지를 붙인 것 포함) 개수보다 `TrackOpenModal()`
호출이 적은 것.

- 호출이 있는데 `TrackOpenModal()` 이 **하나도 없는** 파일은 당연히 걸린다.
- **개수로 본다** — 이미 모달 하나를 적는 큰 파일(`VoiceProfileManagementPanel.kt` 등)에 두 번째
  `Dialog(` 를 더하면 파일 단위 검사는 통과해 버린다. 한 `TrackOpenModal()` 이 if/else 로 갈린 두
  `Dialog(` 를 함께 덮는 모양이라면 갈래마다 부르면 된다(비용이 없다).
- `AlertDialog(`·`IosAlertDialog(`·`DatePickerDialog(` 처럼 이름 **안에** `Dialog` 가 든 것은
  대상이 아니다 — 앞의 둘은 껍데기이거나 이 저장소가 쓰지 않는 것이고, 셋째는 창을 여는 자리가 다르다.
- 선언(`fun Dialog(`)·import·주석·문자열 안의 인용은 세지 않는다.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

ANDROID_DIR = ROOT / "apps/android-native"

# 이름 앞이 식별자 글자가 아닐 때만(= `AlertDialog(` 는 제외, `.Dialog(` 는 포함).
RAW_MODAL_CALL = re.compile(r"(?<![A-Za-z0-9_])(Dialog|ModalBottomSheet)\s*\(")
TRACK_CALL = re.compile(r"(?<![A-Za-z0-9_])TrackOpenModal\s*\(\s*\)")
# 같은 줄에서 이름 바로 앞이 `fun ` / `fun Receiver.` 이면 호출이 아니라 선언이다.
DECLARATION_BEFORE = re.compile(r"\bfun\s+(?:[A-Za-z0-9_.<>, ?]+\.)?$")


def strip_noise(text: str) -> str:
    """주석과 문자열 리터럴을 공백으로 지운다(오프셋·줄바꿈은 그대로).

    규칙을 **설명하는** KDoc(`Dialog(` 를 인용한 문장)이 위반으로 잡히지 않게 한다.
    """
    out = list(text)
    n = len(text)

    def blank(start: int, end: int) -> None:
        for k in range(start, end):
            if out[k] != "\n":
                out[k] = " "

    def scan_quoted(start: int, quote: str) -> int:
        j = start + 1
        while j < n:
            if text[j] == "\\":
                j += 2
                continue
            if text[j] == quote:
                return j + 1
            if text[j] == "\n":
                return j
            j += 1
        return n

    i = 0
    while i < n:
        if text.startswith("//", i):
            j = text.find("\n", i)
            j = n if j < 0 else j
            blank(i, j)
            i = j
        elif text.startswith("/*", i):
            j = text.find("*/", i + 2)
            j = n if j < 0 else j + 2
            blank(i, j)
            i = j
        elif text.startswith('"""', i):
            j = text.find('"""', i + 3)
            j = n if j < 0 else j + 3
            blank(i, j)
            i = j
        elif text[i] in ('"', "'"):
            j = scan_quoted(i, text[i])
            blank(i, j)
            i = j
        else:
            i += 1
    return "".join(out)


def calls_of(pattern: re.Pattern[str], clean: str) -> list[int]:
    """[pattern] 호출의 오프셋들 — import·선언(`fun Dialog(`·`fun Foo.Dialog(`)은 뺀다."""
    offsets: list[int] = []
    for match in pattern.finditer(clean):
        line_start = clean.rfind("\n", 0, match.start()) + 1
        before = clean[line_start:match.start()]
        if before.lstrip().startswith("import "):
            continue
        if DECLARATION_BEFORE.search(before):
            continue
        offsets.append(match.start())
    return offsets


def find_problem(text: str) -> tuple[int, int, int] | None:
    """(모달 호출 수, TrackOpenModal 호출 수, 첫 모달 호출 줄) — 모자라면. 괜찮으면 None."""
    clean = strip_noise(text)
    calls = calls_of(RAW_MODAL_CALL, clean)
    if not calls:
        return None
    tracks = len(calls_of(TRACK_CALL, clean))
    if tracks >= len(calls):
        return None
    first_line = clean.count("\n", 0, calls[0]) + 1
    return len(calls), tracks, first_line


# 검사 자신을 검증한다 — 형제 검사들처럼 표본을 코드에 박아 둔다.
SELF_TEST: list[tuple[str, bool, str]] = [
    # (표본, 잡혀야 하는가, 설명)
    (
        """
        if (open) {
            Dialog(onDismissRequest = { open = false }) { Text("x") }
        }
        """,
        True,
        "추적 없이 창을 연다",
    ),
    (
        """
        if (open) {
            TrackOpenModal()
            Dialog(onDismissRequest = { open = false }) { Text("x") }
        }
        """,
        False,
        "고친 모양",
    ),
    (
        """
        if (open) {
            TrackOpenModal()
            androidx.compose.ui.window.Dialog(onDismissRequest = {}) { }
        }
        if (other) {
            androidx.compose.ui.window.Dialog(onDismissRequest = {}) { }
        }
        """,
        True,
        "패키지를 붙인 두 번째 창이 추적 없이 열린다(파일 단위로는 통과해 버린다)",
    ),
    (
        """
        TrackOpenModal()
        ModalBottomSheet(onDismissRequest = onDismiss, sheetState = state) { }
        """,
        False,
        "바텀시트도 같은 규칙",
    ),
    (
        """
        ModalBottomSheet(onDismissRequest = onDismiss) { }
        """,
        True,
        "추적 없는 바텀시트",
    ),
    (
        """
        IosAlertDialog(title = "t", onDismiss = {}) { }
        AlertDialog(onDismissRequest = {}, confirmButton = {})
        DatePickerDialog(onDismissRequest = {}, confirmButton = {}) { }
        """,
        False,
        "이름 안에 Dialog 가 든 것은 대상이 아니다",
    ),
    (
        """
        // 새 `Dialog(` 를 만들면 TrackOpenModal 을 부를 것.
        /** `ModalBottomSheet(` 도 마찬가지다. */
        val hint = "Dialog(onDismissRequest)"
        """,
        False,
        "주석·문자열 안의 인용은 세지 않는다",
    ),
    (
        """
        import androidx.compose.ui.window.Dialog
        @Composable
        internal fun Dialog(content: @Composable () -> Unit) { }
        """,
        False,
        "import·선언은 호출이 아니다",
    ),
    (
        """
        @Composable
        internal fun TrackOpenModal() { }
        Dialog(onDismissRequest = {}) { }
        """,
        True,
        "추적 함수의 선언은 추적 호출로 세지 않는다",
    ),
    (
        """
        com.alarmtalk.app.TrackOpenModal()
        Dialog(onDismissRequest = {}) { }
        """,
        False,
        "패키지를 붙인 추적 호출도 센다",
    ),
]


def run_self_test() -> list[str]:
    failures: list[str] = []
    for sample, should_flag, why in SELF_TEST:
        flagged = find_problem(sample) is not None
        if flagged != should_flag:
            verb = "잡아야 하는데 못 잡았다" if should_flag else "잡으면 안 되는데 잡았다"
            failures.append(f"{verb} ({why})")
    return failures


def scan() -> list[str]:
    if not ANDROID_DIR.exists():
        return [f"{ANDROID_DIR.relative_to(ROOT)} 가 없다 — 경로가 바뀌었으면 이 검사도 옮길 것"]
    problems: list[str] = []
    for path in sorted(ANDROID_DIR.rglob("*.kt")):
        if "build" in path.relative_to(ANDROID_DIR).parts:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        found = find_problem(text)
        if found is None:
            continue
        calls, tracks, line = found
        rel = path.relative_to(ROOT)
        problems.append(
            f"{rel}:{line}: 창을 여는 호출 {calls}개(`Dialog(`·`ModalBottomSheet(`)에 "
            f"`TrackOpenModal()` 이 {tracks}개뿐이다.\n"
            f"    빠진 모달이 떠 있는 동안 앱에 다시 들어오면(문서 선택기·설정에서 복귀)\n"
            f"    개인 플랜 종료 안내가 그 위에 겹쳐 뜬다."
        )
    return problems


def main() -> int:
    self_test_failures = run_self_test()
    if self_test_failures:
        print("이 검사가 고장났다:\n", file=sys.stderr)
        for failure in self_test_failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1
    problems = scan()
    if problems:
        print("추적하지 않는 모달이 있다:\n", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        print(
            "\n창을 여는 호출 바로 앞, **같은 조건 블록 안에서** 부른다:\n"
            "    if (open) {\n"
            "        TrackOpenModal()\n"
            "        Dialog(onDismissRequest = { ... }) { ... }\n"
            "    }\n"
            "알럿·선택 시트·폼 시트는 껍데기(`IosAlertDialog`·`WakerSelectionSheet`·\n"
            "`WakerFormSheet`)를 쓰면 이미 들어 있다. 이유는 `ui/components/OpenModalRegistry.kt`\n"
            "의 KDoc 과 `docs/spec/gates-and-overlays.md` 「개인 플랜 종료 안내」 참조.",
            file=sys.stderr,
        )
        return 1
    print("apps/android-native 의 모달이 전부 OpenModalRegistry 에 적힌다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
