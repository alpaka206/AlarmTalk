#!/usr/bin/env python3
"""Check UI localization without Xcode/Gradle (Python standard library only).

Swift is checked by literal context and a declaration index, not by searching
for Text() alone. Stored Korean values, generated data and TTS inputs require
documented exceptions. The baseline identifies reviewed contexts the index
cannot prove; removed entries fail, so it cannot silently become a dump.
"""
from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
import fnmatch
import hashlib
import json
from pathlib import Path
import re
import sys
import tempfile
import textwrap
import unittest
import xml.etree.ElementTree as ET

from localization_lexers import HANGUL, SwiftLexer, kotlin_literals

ROOT = Path(__file__).resolve().parents[1]
LANGUAGES = ("en", "ja")
SWIFT_ROOTS = ("apps/ios-native/AlarmTalk", "apps/ios-native/AlarmTalkWidget", "apps/ios-native/Shared")
CATALOGS = ("apps/ios-native/AlarmTalk/Localizable.xcstrings", "apps/ios-native/AlarmTalkWidget/Localizable.xcstrings")
CATEGORIES = {"generated", "seed-data", "data-contract", "debug-preview", "log", "endonym", "tts-content", "not-rendered", "language-neutral"}
SWIFT_UI = {"Text", "Button", "Label", "Toggle", "TextField", "SecureField", "Section", "Picker", "Link",
            "navigationTitle", "alert", "confirmationDialog", "accessibilityLabel", "accessibilityHint"}
LOCALIZED_TYPE = r"LocalizedString(?:Key|Resource)"
# English date pickers use bare numbers; Korean/Japanese append year/month/day.
# Only emptiness is exempted. Missing resources or copied Korean still fail.
EMPTY_ANDROID_UNITS = {("en", "editorp_fortune_unit_" + unit) for unit in ("year", "month", "day")}


def fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:16]


def blank_comments(source: str) -> str:
    out = list(source)
    i = 0
    while i < len(source):
        if source.startswith("//", i):
            end = source.find("\n", i)
            end = len(source) if end < 0 else end
        elif source.startswith("/*", i):
            depth, end = 1, i + 2
            while end < len(source) and depth:
                if source.startswith("/*", end):
                    depth += 1
                    end += 2
                elif source.startswith("*/", end):
                    depth -= 1
                    end += 2
                else:
                    end += 1
        else:
            i += 1
            continue
        out[i:end] = ["\n" if c == "\n" else " " for c in source[i:end]]
        i = end
    return "".join(out)


def code_only(source: str, literals: list[dict]) -> str:
    out = list(source)
    for literal in literals:
        a, b = literal["start"], literal["end"]
        out[a:b] = ["\n" if c == "\n" else " " for c in source[a:b]]
    return blank_comments("".join(out))


def delimiter_pairs(code: str) -> dict[int, int]:
    stack, pairs = [], {}
    for i, c in enumerate(code):
        if c in "([{":
            stack.append((i, c))
        elif c in ")]}":
            if stack and stack[-1][1] == {")": "(", "]": "[", "}": "{"}[c]:
                start, _ = stack.pop()
                pairs[start] = i
    return pairs


class Declarations:
    """File-scoped lookup wins for private types with the same name."""
    def __init__(self, sources: dict[str, str]):
        self.parameters: dict[tuple[str, str], set[str]] = {}
        self.returns: dict[str, list[tuple[int, int]]] = {}
        for path, source in sources.items():
            literals = SwiftLexer(source, path).run()
            code = code_only(source, literals)
            pairs = delimiter_pairs(code)
            for match in re.finditer(r"\b(?:struct|class)\s+(\w+)[^\n{]*\{", code):
                start = match.end() - 1
                end = pairs.get(start, start)
                properties = set(re.findall(r"\b(?:let|var)\s+(\w+)\s*:\s*" + LOCALIZED_TYPE, code[start:end]))
                self.parameters[(path, match[1])] = properties
            for match in re.finditer(r"\bfunc\s+(\w+)\s*\(", code):
                start = match.end() - 1
                end = pairs.get(start, start)
                arguments = code[start + 1:end]
                names = re.findall(r"(?:^|,)\s*(\w+)(?:\s+\w+)?\s*:\s*" + LOCALIZED_TYPE, arguments)
                key = (path, match[1])
                names = set(names)
                self.parameters[key] = self.parameters[key] & names if key in self.parameters else names
            spans = []
            pattern = r"(?:\b(?:var|let)\s+\w+\s*:\s*" + LOCALIZED_TYPE + r"\??|->\s*" + LOCALIZED_TYPE + r")\s*"
            for match in re.finditer(pattern, code):
                pos = match.end()
                if pos < len(code) and code[pos] == "{":
                    spans.append((pos, pairs.get(pos, pos)))
                elif pos < len(code) and code[pos] == "=":
                    end = code.find("\n", pos)
                    spans.append((pos, end if end >= 0 else len(code)))
            self.returns[path] = spans

    def accepts(self, path: str, call: str, argument: str) -> bool:
        local = self.parameters.get((path, call))
        if local is not None:
            return argument in local
        candidates = [v for (_, name), v in self.parameters.items() if name == call]
        # Ambiguous declarations must all agree; a String overload cannot certify a call.
        return bool(candidates) and all(argument in v for v in candidates)


def call_at(source: str, opening: int) -> str:
    match = re.search(r"([#\w.]+)\s*$", source[:opening])
    return match[1] if match else ""


def argument_prefix(source: str, literal: dict, opening: int) -> str:
    """The argument fragment immediately before a literal, excluding earlier arguments."""
    fragment = source[opening + 1:literal["start"]]
    nested = SwiftLexer(fragment).run()
    code = code_only(fragment, nested)
    depth, last = 0, 0
    for i, c in enumerate(code):
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        elif c == "," and depth == 0:
            last = i + 1
    return blank_comments(fragment[last:]).strip()


def literal_value(literal: dict) -> str:
    # Keep interpolation expressions for a stable, reviewable allowlist identity.
    value = "".join(value if kind == "lit" else "\\(" + value + ")" for kind, value in literal["parts"])
    if literal["multiline"]:
        value = textwrap.dedent(value.removeprefix("\n")).rstrip(" \t")
        value = value.removesuffix("\n")
    return value


def key_pattern(literal: dict) -> re.Pattern:
    # Swift extraction chooses %@/%lld/%lf by expression type. The audit does not
    # type-check expressions; it requires the actual key shape and checks formats
    # across translations separately. No unbounded Cartesian expansion.
    interpolated = any(kind == "interp" for kind, _ in literal["parts"])
    value = "".join((value.replace("%", "%%") if interpolated else value) if kind == "lit" else "\0" for kind, value in literal["parts"])
    if literal["multiline"]:
        value = textwrap.dedent(value.removeprefix("\n")).rstrip(" \t").removesuffix("\n")
    pattern = re.escape(value).replace("\x00", r"%(?:@|lld|ld|d|lf|f)")
    return re.compile("^" + pattern + "$")


def localized_context(path: str, source: str, literal: dict, declarations: Declarations) -> tuple[bool, str | None]:
    stack = [(kind, pos) for kind, pos in literal["stack"] if kind == "("]
    interpolations = [pos for kind, pos in literal["stack"] if kind == "interp"]
    if interpolations and (not stack or interpolations[-1] > stack[-1][1]):
        # An inner String expression does not inherit the outer Text() overload.
        return False, None
    if stack:
        opening = stack[-1][1]
        call = call_at(source, opening).split(".")[-1]
        prefix = argument_prefix(source, literal, opening)
        if call == "String" and prefix in {"localized:", "defaultValue:"}:
            return True, "default" if prefix == "defaultValue:" else None
        if call == "localizedString" and prefix == "forKey:":
            return True, None
        if call in {"String", "LocalizedStringKey", "LocalizedStringResource"} and prefix == "comment:":
            return False, "comment"
        if call in {"LocalizedStringKey", "LocalizedStringResource"} and prefix in {"", "defaultValue:"}:
            return True, "default" if prefix == "defaultValue:" else None
        # A ternary or ?? at an overloaded SwiftUI call often produces String.
        # Only a lone first argument is certified here.
        if call in SWIFT_UI and prefix == "":
            tail = source[literal["end"]:].lstrip()
            return tail.startswith((",", ")")), None
        argument = re.match(r"(\w+)\s*:", prefix)
        if argument and prefix.endswith((":", "?")) and declarations.accepts(path, call, argument[1]):
            return True, None
    for start, end in declarations.returns.get(path, []):
        if start < literal["start"] < end:
            if stack and stack[-1][1] > start:
                # An inner String helper does not inherit its caller's return type.
                continue
            previous = source[max(start, source.rfind("\n", start, literal["start"]) + 1):literal["start"]].strip()
            if previous in {"{", "=", "return"} or re.search(r"\breturn(?:\s+[^;{}]*)?$", previous) or previous.endswith(":"):
                return True, None
    return False, None


def string_in_key_parameter(path: str, source: str, literal: dict, declarations: Declarations) -> bool:
    """A translated String cannot be passed to a custom key/resource parameter."""
    stack = [pos for kind, pos in literal["stack"] if kind == "("]
    if len(stack) < 2 or call_at(source, stack[-1]) != "String":
        return False
    if argument_prefix(source, literal, stack[-1]) != "localized:":
        return False
    # The outer Text interpolation contains a String expression, not a key arg.
    if any(kind == "interp" and pos > stack[-2] for kind, pos in literal["stack"]):
        return False
    start = re.search(r"\bString\s*$", source[:stack[-1]]).start()
    prefix = argument_prefix(source, {"start": start}, stack[-2])
    argument = re.match(r"(\w+)\s*:", prefix)
    call = call_at(source, stack[-2]).split(".")[-1]
    return bool(argument and declarations.accepts(path, call, argument[1]))


@dataclass
class Issue:
    path: str
    line: int
    value: str
    reason: str

    @property
    def identity(self) -> str:
        return self.path + "\t" + fingerprint(self.value)


def read_allowlist(path: Path) -> list[tuple[str, str, str, str]]:
    rules = []
    if not path.exists():
        return rules
    for line in path.read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        category, pattern, literal, reason = line.split("\t", 3)
        if category not in CATEGORIES or not reason.strip():
            raise ValueError("Invalid allowlist rule: " + line)
        rules.append((category, pattern, json.loads(literal), reason))
    return rules


def allowed(path: str, value: str, rules: list[tuple[str, str, str, str]]) -> bool:
    return any(fnmatch.fnmatchcase(path, pattern) and (literal == "*" or literal == value)
               for _, pattern, literal, _ in rules)


def read_baseline(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    entries = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        file, digest, reason = line.split("\t", 2)
        if not reason.strip() or reason == "REVIEW REQUIRED":
            raise ValueError("Baseline entry needs a reason")
        entries[file + "\t" + digest] = reason
    return entries


def apply_baseline(issues: list[Issue], baseline: dict[str, str]) -> list[Issue]:
    eligible = "literal is not in a proven localization context"
    seen = {issue.identity for issue in issues if issue.reason == eligible}
    result = [issue for issue in issues if issue.reason != eligible or issue.identity not in baseline]
    result += [Issue(key.split("\t")[0], 0, key, "stale baseline entry; remove it") for key in baseline.keys() - seen]
    return result


def string_units(value):
    """Yield translated leaves, including plural and device variations."""
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "stringUnit":
                yield child if isinstance(child, dict) else {}
            else:
                yield from string_units(child)
    elif isinstance(value, list):
        for child in value:
            yield from string_units(child)


def android_text_is_blank(value: str) -> bool:
    # Android decodes escaped whitespace and removes surrounding quotes.
    value = re.sub(r'\\(?:[ntr]|u(?:0020|0009|000[aAdD]))', ' ', value).strip()
    if value.startswith('"') and value.endswith('"'):
        value = value[1:-1]
    return not value.strip()


def catalog_issues(root: Path) -> list[Issue]:
    issues = []
    for relative in (*CATALOGS, "apps/ios-native/AlarmTalk/InfoPlist.xcstrings"):
        data = json.loads((root / relative).read_text())
        for key, entry in data["strings"].items():
            if not entry.get("shouldTranslate", True):
                continue
            # A Korean source-text key can fall back to the key itself. An opaque
            # identifier cannot: require an explicit Korean value as well.
            required_languages = LANGUAGES if HANGUL.search(key) else (*LANGUAGES, "ko")
            for language in required_languages:
                units = entry.get("localizations", {}).get(language, {})
                leaves = list(string_units(units))
                if not leaves or any(leaf.get("state") != "translated"
                                     or not isinstance(leaf.get("value"), str)
                                     or not leaf["value"].strip() for leaf in leaves):
                    issues.append(Issue(relative, 0, key, f"{language} translation missing, unfinished or empty"))
                if language in LANGUAGES and any(HANGUL.search(str(leaf.get("value", ""))) for leaf in leaves):
                    issues.append(Issue(relative, 0, key, f"{language} translation contains Hangul"))
    resources = root / "apps/android-native/app/src/main/res"
    localized = {}
    for language in ("ko", *LANGUAGES):
        entries = {}
        for file in (resources / ("values" if language == "ko" else "values-" + language)).glob("*.xml"):
            for entry in ET.parse(file).getroot():
                if entry.tag in {"string", "string-array", "plurals"}:
                    entries[entry.attrib["name"]] = (entry, str(file.relative_to(root)))
        localized[language] = entries
    for key, (entry, relative) in localized["ko"].items():
        if entry.get("translatable") == "false":
            continue
        for language in LANGUAGES:
            match = localized[language].get(key)
            if match is None:
                issues.append(Issue(relative, 0, key, f"Android {language} resource missing"))
                continue
            other, target = match
            if entry.tag != other.tag or (entry.tag == "string-array" and len(entry) != len(other)):
                issues.append(Issue(target, 0, key, "resource type/array length differs"))
            if HANGUL.search("".join(other.itertext())):
                issues.append(Issue(target, 0, key, f"Android {language} resource contains Hangul"))
            leaves = [other] if other.tag == "string" else list(other)
            if (not leaves or any(android_text_is_blank("".join(leaf.itertext())) for leaf in leaves)) and (language, key) not in EMPTY_ANDROID_UNITS:
                issues.append(Issue(target, 0, key, f"Android {language} resource contains an empty translation"))
    return issues


def kotlin_ui_context(code: str, start: int, pairs: dict[int, int]) -> bool:
    """Recognize literal arguments at text/notification sinks, in any language.

    Code has strings/comments blanked, preserving offsets. A lambda body starts
    a new context: an onClick log is not a title merely because it is inside UI.
    This is a call-site check, not Kotlin data-flow/type analysis.
    """
    def expression_branch(opening):
        before = code[:opening].rstrip()
        if re.search(r"\belse$|->$", before):
            return True
        if before.endswith(")"):
            condition = next((a for a, b in pairs.items() if b == len(before) - 1), None)
            return condition is not None and call_at(code, condition) in {"if", "when"}
        return False

    block = max((opening for opening, end in pairs.items() if code[opening] == "{" and opening < start < end
                 and not expression_branch(opening)), default=-1)
    for opening, end in sorted(pairs.items(), reverse=True):
        if code[opening] != "(" or not block < opening < start < end:
            continue
        call = call_at(code, opening).split(".")[-1]
        if call in {"if", "when", "while"}:
            # A compared contract value does not become UI copy merely because
            # the enclosing expression supplies a title.
            return False
        fragment = code[opening + 1:start]
        depth, last, argument_index = 0, 0, 0
        for i, char in enumerate(fragment):
            if char in "([{":
                depth += 1
            elif char in ")]}":
                depth -= 1
            elif char == "," and depth == 0:
                last, argument_index = i + 1, argument_index + 1
        argument = fragment[last:].strip()
        named = re.match(r"(\w+)\s*=\s*(?!=)", argument)
        parameter = named[1] if named else None
        if call in {"Text", "BasicText", "AnnotatedString"} and (parameter == "text" or (not parameter and argument_index == 0)):
            return True
        if call in {"setContentTitle", "setContentText", "setSubText", "showSnackbar"} and argument_index == 0:
            return True
        if call == "makeText" and argument_index == 1:
            return True
        if parameter in {"text", "title", "message", "contentDescription", "label"}:
            # Compose animation labels are debugger identifiers, not UI copy.
            if parameter == "label" and (call.startswith("animate") or call in {"rememberInfiniteTransition", "updateTransition"}):
                continue
            return True
    return False


def format_issues(root: Path) -> list[Issue]:
    """Catch dropped/type-changed arguments; positional reordering is allowed."""
    def signature(value):
        tokens = re.finditer(r"%%|%(?:(\d+)\$)?(?:\.\d+)?(lld|ld|d|lf|f|@)", value)
        result = Counter()
        next_index = 1
        for match in tokens:
            if not match[2]:
                continue
            index = int(match[1]) if match[1] else next_index
            if not match[1]:
                next_index += 1
            result[(index, match[2])] += 1
        return result
    issues = []
    for relative in CATALOGS:
        for key, entry in json.loads((root / relative).read_text())["strings"].items():
            if not entry.get("shouldTranslate", True):
                continue
            localizations = entry.get("localizations", {})
            source = localizations.get("ko", {}).get("stringUnit", {}).get("value", key)
            if not HANGUL.search(source) and "%" not in source:
                continue
            for language in LANGUAGES:
                value = localizations.get(language, {}).get("stringUnit", {}).get("value")
                if value is not None and signature(source) != signature(value):
                    issues.append(Issue(relative, 0, key, f"{language} format argument indices/types/count differ"))
    return issues


def language_gate(source: str) -> bool:
    # Include Swift scalar ranges and Kotlin character/regex ranges. Comments
    # are removed by callers, but string contents matter for Regex("[가-힣]").
    return bool(re.search(r"\bcontainsKorean\b|0x[Aa][Cc]00|\\u\{?[Aa][Cc]00|가(?:-|\.{2,3})힣", source))


def audit(root: Path, rules: list[tuple[str, str, str, str]]) -> list[Issue]:
    sources = {str(p.relative_to(root)): p.read_text() for relative in SWIFT_ROOTS for p in (root / relative).rglob("*.swift")}
    declarations = Declarations(sources)
    catalogs = {relative: json.loads((root / relative).read_text())["strings"] for relative in CATALOGS}
    issues = []
    for path, source in sources.items():
        for literal in SwiftLexer(source, path).run():
            value = literal_value(literal)
            localized, kind = localized_context(path, source, literal, declarations)
            if string_in_key_parameter(path, source, literal, declarations):
                issues.append(Issue(path, literal["line"], value, "String(localized:) passed to a key/resource parameter; retain its literal key"))
            if not HANGUL.search(value) and not localized:
                continue
            if literal["debug"] or kind == "comment" or value == "" or allowed(path, value, rules):
                continue
            calls = [call_at(source, pos) for token, pos in literal["stack"] if token == "("]
            if "#Preview" in calls:
                continue
            if any(re.search(r"(?:AlarmTalkLog\.\w+|(?:\w*[Ll]ogger)\.(?:info|debug|error|warning|notice)|print)$", call) for call in calls):
                continue
            if not localized:
                issues.append(Issue(path, literal["line"], value, "literal is not in a proven localization context"))
                continue
            if kind == "default":
                # The corresponding semantic key is audited as its own literal.
                continue
            targets = CATALOGS if "/Shared/" in path else (CATALOGS[1] if "/AlarmTalkWidget/" in path else CATALOGS[0],)
            pattern = key_pattern(literal)
            for target in targets:
                matches = [(key, entry) for key, entry in catalogs[target].items() if pattern.fullmatch(key)]
                # Language-neutral punctuation/brand strings need no translation.
                if not matches:
                    issues.append(Issue(path, literal["line"], value, f"key missing from {target}"))
                elif not any(not entry.get("shouldTranslate", True) or all(
                    entry.get("localizations", {}).get(language, {}).get("stringUnit", {}).get("state") == "translated"
                    for language in LANGUAGES) for _, entry in matches):
                    issues.append(Issue(path, literal["line"], value, f"key has unfinished en/ja translations in {target}"))
        code = code_only(source, SwiftLexer(source, path).run())
        gate_source = code + "\n" + "\n".join(literal_value(l) for l in SwiftLexer(source, path).run())
        if language_gate(gate_source) and not allowed(path, "language-gate", rules):
            issues.append(Issue(path, 0, "containsKorean", "language-based server-error filter is forbidden"))
    for file in (root / "apps/android-native/app/src/main/java").rglob("*.kt"):
        path, source = str(file.relative_to(root)), file.read_text()
        literals = kotlin_literals(source)
        masked = list(source)
        for start, end, _, _ in literals:
            masked[start:end] = [" " for _ in source[start:end]]
        code = blank_comments("".join(masked))
        pairs = delimiter_pairs(code)
        static = {start: value for start, _, value, _ in kotlin_literals(source, static_text=True)}
        for start, _, value, _ in literals:
            if allowed(path, value, rules):
                continue
            ui_copy = any(char.isalpha() for char in static[start]) and kotlin_ui_context(code, start, pairs)
            if HANGUL.search(value) or ui_copy:
                issues.append(Issue(path, source.count("\n", 0, start) + 1, value, "Kotlin UI text must use resources or a documented exception"))
        gate_source = code + "\n" + "\n".join(value for _, _, value, _ in literals)
        if language_gate(gate_source) and not allowed(path, "language-gate", rules):
            issues.append(Issue(path, 0, "containsKorean", "language-based server-error filter is forbidden"))
    issues.extend(issue for issue in catalog_issues(root) if not allowed(issue.path, issue.value, rules))
    issues.extend(format_issues(root))
    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--write-baseline", action="store_true", help="write candidates for manual review; never use this to approve UI omissions")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        return 0 if unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(SelfTests)).wasSuccessful() else 1
    root = args.root.resolve()
    rules = read_allowlist(root / "scripts/hangul-literal-allowlist.txt")
    found = audit(root, rules)
    baseline_path = root / "scripts/hangul-literal-baseline.txt"
    if args.write_baseline:
        entries = sorted({issue.identity for issue in found if issue.reason == "literal is not in a proven localization context"})
        baseline_path.write_text("# Review every candidate; user-visible untranslated text is not an exception.\n" + "".join(key + "\tREVIEW REQUIRED\n" for key in entries))
        print(f"Wrote {len(entries)} candidates. Review and replace each reason before committing.")
        return 1 if entries else 0
    issues = apply_baseline(found, read_baseline(baseline_path))
    if args.json:
        print(json.dumps([issue.__dict__ for issue in issues], ensure_ascii=False, indent=2))
    else:
        for issue in issues:
            print(f"{issue.path}:{issue.line}: {issue.reason}: {issue.value!r}")
        print(f"Localization audit: {len(issues)} violation(s); {len(rules)} documented exceptions.")
    return 1 if issues else 0


class SelfTests(unittest.TestCase):
    def test_comments_raw_strings_and_interpolation(self):
        source = '// "주석"\nText(#"안녕 \#(name)"#) /* nested /* "제외" */ */'
        literals = SwiftLexer(source).run()
        self.assertEqual(len(literals), 1)
        self.assertEqual(literals[0]["parts"], [("lit", "안녕 "), ("interp", "name")])

    def test_contexts_use_parameter_types(self):
        declarations = Declarations({"sample.swift": "struct Title { let title: LocalizedStringKey }\nstruct Plain { let title: String }"})
        cases = [('Text("안녕")', True), ('Text(flag ? "안녕" : other)', False),
                 ('Text(other ?? "안녕")', False), ('Title(title: "안녕")', True),
                 ('Plain(title: "안녕")', False), ('String(localized: "안녕")', True)]
        for source, expected in cases:
            literal = SwiftLexer(source).run()[0]
            self.assertEqual(localized_context("sample.swift", source, literal, declarations)[0], expected, source)

    def test_typed_returns_do_not_certify_nested_string_helpers(self):
        for expression, expected in [('return "안녕"', True), ('if flag { return "안녕" }; return other', True),
                                     ('return flag ? "안녕" : other', True), ('return helper(title: "안녕")', False)]:
            source = 'var title: LocalizedStringKey { ' + expression + ' }'
            literal = SwiftLexer(source).run()[0]
            self.assertEqual(localized_context("a.swift", source, literal, Declarations({"a.swift": source}))[0], expected)

    def test_typed_ternary_condition_is_not_a_key(self):
        source = 'struct Row { let title: LocalizedStringKey }\nRow(title: plan == "couple" ? "엄마" : "아빠")'
        declarations = Declarations({"a.swift": source})
        actual = [localized_context("a.swift", source, l, declarations)[0] for l in SwiftLexer(source).run()]
        self.assertEqual(actual, [False, True, True])

    def test_translated_string_cannot_replace_custom_key_argument(self):
        declaration = 'struct Row { let title: LocalizedStringKey }\n'
        for expression in ['Row(title: String(localized: "안녕"))',
                           'Row(title: busy ? String(localized: "안녕") : other)']:
            source = declaration + expression
            literal = SwiftLexer(source).run()[0]
            self.assertTrue(string_in_key_parameter("a.swift", source, literal, Declarations({"a.swift": source})))
        source = 'struct Row { let title: String }\nRow(title: String(localized: "안녕"))'
        literal = SwiftLexer(source).run()[0]
        self.assertFalse(string_in_key_parameter("a.swift", source, literal, Declarations({"a.swift": source})))

    def test_overloads_are_conservative_and_private_declarations_are_local(self):
        sources = {"a.swift": 'struct Row { let title: String }', "b.swift": 'struct Row { let title: LocalizedStringKey }'}
        declarations = Declarations(sources)
        self.assertFalse(declarations.accepts("a.swift", "Row", "title"))
        self.assertTrue(declarations.accepts("b.swift", "Row", "title"))
        self.assertFalse(declarations.accepts("c.swift", "Row", "title"))
        declarations = Declarations({"a.swift": 'func row(title: String) {}\nfunc row(title: LocalizedStringKey) {}'})
        self.assertFalse(declarations.accepts("a.swift", "row", "title"))

    def test_percent_and_multiline_keys(self):
        literal = SwiftLexer('String(localized: "진행 \\(percent)%")').run()[0]
        self.assertTrue(key_pattern(literal).fullmatch("진행 %lld%%"))
        self.assertFalse(key_pattern(literal).fullmatch("진행 %lld%"))
        literal = SwiftLexer('String(localized: """\n    첫 줄\n    둘째 줄\n    """)').run()[0]
        self.assertTrue(key_pattern(literal).fullmatch("첫 줄\n둘째 줄"))

    def fixture(self, source='String(localized: "안녕")', key="안녕"):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        korean_value = key if HANGUL.search(key) else "안녕"
        entry = {"localizations": {language: {"stringUnit": {"state": "translated", "value": korean_value if language == "ko" else "Hello"}}
                                    for language in (*LANGUAGES, "ko")}}
        for path in (*CATALOGS, "apps/ios-native/AlarmTalk/InfoPlist.xcstrings"):
            file = root / path
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(json.dumps({"strings": {key: entry}}))
        file = root / SWIFT_ROOTS[0] / "Screen.swift"
        file.write_text(source)
        for language in ("", "-en", "-ja"):
            directory = root / ("apps/android-native/app/src/main/res/values" + language)
            directory.mkdir(parents=True)
            (directory / "strings.xml").write_text('<resources><string name="hello">Hello</string></resources>')
        return root

    def test_missing_catalog_key_and_translation_fail(self):
        root = self.fixture()
        self.assertEqual(audit(root, []), [])
        file = root / CATALOGS[0]
        file.write_text('{"strings": {}}')
        self.assertTrue(any("key missing" in issue.reason for issue in audit(root, [])))
        file.write_text(json.dumps({"strings": {"안녕": {"localizations": {"en": {"stringUnit": {"state": "new", "value": "Hello"}}}}}}))
        self.assertTrue(any("unfinished" in issue.reason for issue in audit(root, [])))

    def test_permission_and_semantic_keys_require_all_translations(self):
        root = self.fixture()
        for relative in (*CATALOGS, "apps/ios-native/AlarmTalk/InfoPlist.xcstrings"):
            file = root / relative
            original = file.read_text()
            for language in LANGUAGES:
                for state in [None, "new"]:
                    entry = {"localizations": {lang: {"stringUnit": {"state": "translated", "value": "Permission"}}
                                               for lang in LANGUAGES}}
                    if state is None:
                        del entry["localizations"][language]
                    else:
                        entry["localizations"][language]["stringUnit"]["state"] = state
                    file.write_text(json.dumps({"strings": {"NSAlarmKitUsageDescription": entry}}))
                    issues = catalog_issues(root)
                    self.assertTrue(any(i.path == relative and i.value == "NSAlarmKitUsageDescription"
                                        and i.reason.startswith(language) for i in issues))
            file.write_text(json.dumps({"strings": {"CFBundleDisplayName": {"shouldTranslate": False}}}))
            self.assertFalse(any(i.path == relative for i in catalog_issues(root)))
            file.write_text(original)

    def test_translated_catalog_leaves_cannot_be_blank(self):
        root = self.fixture()
        for relative in (*CATALOGS, "apps/ios-native/AlarmTalk/InfoPlist.xcstrings"):
            file = root / relative
            original = file.read_text()
            for language in LANGUAGES:
                for value in [None, "", " \n\t "]:
                    for variation in [False, True]:
                        leaf = {"state": "translated"}
                        if value is not None:
                            leaf["value"] = value
                        entry = {"localizations": {lang: {"stringUnit": {"state": "translated", "value": "Permission"}}
                                                   for lang in LANGUAGES}}
                        unit = {"stringUnit": leaf}
                        if variation:
                            unit = {"variations": {"plural": {
                                "one": {"stringUnit": {"state": "translated", "value": "One"}}, "other": unit}}}
                        entry["localizations"][language] = unit
                        file.write_text(json.dumps({"strings": {"NSAlarmKitUsageDescription": entry}}))
                        self.assertTrue(any(i.path == relative and i.reason.startswith(language)
                                            and "empty" in i.reason for i in catalog_issues(root)))
                        entry["shouldTranslate"] = False
                        file.write_text(json.dumps({"strings": {"Brand": entry}}))
                        self.assertFalse(any(i.path == relative for i in catalog_issues(root)))
            file.write_text(original)

    def test_semantic_keys_require_a_nonempty_korean_translation(self):
        for key in ["group.plan.shared", "member.unnamed", "code.redeem.submit", "NSAlarmKitUsageDescription"]:
            root = self.fixture(source="", key=key)
            for relative in (*CATALOGS, "apps/ios-native/AlarmTalk/InfoPlist.xcstrings"):
                file = root / relative
                original = file.read_text()
                for ko in [None, {"state": "new", "value": "공유"},
                           {"state": "translated", "value": ""}, {"state": "translated", "value": "  "}]:
                    data = json.loads(original)
                    localizations = data["strings"][key]["localizations"]
                    if ko is None:
                        del localizations["ko"]
                    else:
                        localizations["ko"] = {"stringUnit": ko}
                    file.write_text(json.dumps(data))
                    self.assertTrue(any(i.path == relative and i.reason.startswith("ko ") for i in catalog_issues(root)))
                file.write_text(original)
            self.assertEqual(catalog_issues(root), [])
        root = self.fixture()
        for relative in (*CATALOGS, "apps/ios-native/AlarmTalk/InfoPlist.xcstrings"):
            file = root / relative
            data = json.loads(file.read_text())
            del data["strings"]["안녕"]["localizations"]["ko"]
            file.write_text(json.dumps(data))
        self.assertEqual(catalog_issues(root), [])

    def test_semantic_default_and_comments(self):
        root = self.fixture('String(localized: "hello.title", defaultValue: "안녕", comment: "번역 설명")', "hello.title")
        self.assertEqual(audit(root, []), [])

    def test_shared_keys_are_required_in_both_targets(self):
        root = self.fixture(source="")
        file = root / SWIFT_ROOTS[2] / "Intents.swift"
        file.parent.mkdir(parents=True)
        file.write_text('let title: LocalizedStringResource = "안녕"')
        (root / CATALOGS[1]).write_text('{"strings": {}}')
        self.assertTrue(any(CATALOGS[1] in issue.reason for issue in audit(root, [])))

    def test_android_literals_resources_and_hangul_translations(self):
        root = self.fixture()
        file = root / "apps/android-native/app/src/main/java/example/Screen.kt"
        file.parent.mkdir(parents=True)
        file.write_text('Text("안녕")')
        self.assertTrue(any("Kotlin UI" in issue.reason for issue in audit(root, [])))
        rules = [("data-contract", str(file.relative_to(root)), "안녕", "fixture contract")]
        self.assertEqual(audit(root, rules), [])
        path = root / "apps/android-native/app/src/main/res/values-en/strings.xml"
        path.write_text('<resources/>')
        self.assertTrue(any("Android en resource missing" in issue.reason for issue in audit(root, rules)))
        path.write_text('<resources><string name="hello">안녕</string></resources>')
        self.assertTrue(any("contains Hangul" in issue.reason for issue in audit(root, rules)))

    def test_kotlin_ui_literals_are_checked_in_every_language(self):
        root = self.fixture(source="")
        file = root / "apps/android-native/app/src/main/java/example/Screen.kt"
        file.parent.mkdir(parents=True)
        for source in ['Text("Try again")', 'BasicText(text = "Retry")',
                       'Text("再試行")', 'Text(text = if (busy) "Wait" else "Retry")',
                       'Text(text = if (busy) { "Wait" } else { "Retry" })',
                       'Icon(imageVector = icon, contentDescription = "Delete")',
                       'Card(title = "Settings")', 'builder.setContentText("Ready")',
                       'Toast.makeText(context, "Ready", 0)', 'state.showSnackbar("Failed")',
                       'Text(format("Count: %d", count))', 'Text("Retry $count")']:
            file.write_text(source)
            self.assertTrue(any("Kotlin UI" in issue.reason for issue in audit(root, [])), source)
        for source in ['val route = "settings"', 'Text(stringResource(R.string.title))',
                       'Text("$count%")', 'Text("${format(count)}%")',
                       'Text("\\n")', 'Card(title = if (plan == "couple") resource else other)',
                       'Button(onClick = { Log.d("Tag", "Clicked") }) {}',
                       'animateFloatAsState(targetValue = value, label = "progress")',
                       '// Text("Retry")\n/* Text("Again") */']:
            file.write_text(source)
            self.assertEqual(audit(root, []), [], source)

    def test_catalog_target_languages_reject_hangul_in_every_leaf(self):
        root = self.fixture(source="")
        for relative in (*CATALOGS, "apps/ios-native/AlarmTalk/InfoPlist.xcstrings"):
            file = root / relative
            original = file.read_text()
            for language in LANGUAGES:
                for variation in [False, True]:
                    data = json.loads(original)
                    unit = {"stringUnit": {"state": "translated", "value": "Hello 안녕"}}
                    if variation:
                        unit = {"variations": {"plural": {"other": unit}}}
                    data["strings"]["안녕"]["localizations"][language] = unit
                    file.write_text(json.dumps(data))
                    self.assertTrue(any(i.path == relative and i.reason.startswith(language)
                                        and "contains Hangul" in i.reason for i in catalog_issues(root)))
            file.write_text(original)

    def test_android_translations_cannot_have_blank_leaves(self):
        root = self.fixture(source="")
        base = root / "apps/android-native/app/src/main/res"
        for tag, contents in [("string", "{value}"),
                              ("string-array", '<item>Hello</item><item>{value}</item>'),
                              ("plurals", '<item quantity="other">{value}</item>')]:
            for language in LANGUAGES:
                for value in ["", " \n\t ", r"\n\t", '""', '" "']:
                    xml = '<resources><' + tag + ' name="hello">' + contents + '</' + tag + '></resources>'
                    (base / "values/strings.xml").write_text(xml.format(value="Hello"))
                    (base / f"values-{language}/strings.xml").write_text(xml.format(value=value))
                    self.assertTrue(any(i.reason == f"Android {language} resource contains an empty translation"
                                        for i in catalog_issues(root)))
        # Documented English date units may be empty, but not missing or Korean.
        key = "editorp_fortune_unit_year"
        (base / "values/strings.xml").write_text(f'<resources><string name="{key}">년</string></resources>')
        file = base / "values-en/strings.xml"
        file.write_text(f'<resources><string name="{key}"></string></resources>')
        self.assertFalse(any("Android en" in i.reason for i in catalog_issues(root)))
        file.write_text('<resources/>')
        self.assertTrue(any(i.reason == "Android en resource missing" for i in catalog_issues(root)))
        file.write_text(f'<resources><string name="{key}">년</string></resources>')
        self.assertTrue(any(i.reason == "Android en resource contains Hangul" for i in catalog_issues(root)))

    def test_language_gate_is_forbidden_even_with_no_korean_ui_literals(self):
        for source in ['var containsKorean = true', 'let range = 0xAC00...0xD7A3', 'let pattern = "[가-힣]"']:
            root = self.fixture(source=source)
            self.assertTrue(any("filter is forbidden" in issue.reason for issue in audit(root, [])))
        root = self.fixture()
        file = root / "apps/android-native/app/src/main/java/example/Errors.kt"
        file.parent.mkdir(parents=True)
        file.write_text('fun containsKorean(text: String) = text.any { it in \'가\'..\'힣\' }')
        self.assertTrue(any("filter is forbidden" in issue.reason for issue in audit(root, [])))

    def test_baseline_ratchets(self):
        issue = Issue("a.swift", 2, "안녕", "literal is not in a proven localization context")
        self.assertEqual(apply_baseline([issue], {}), [issue])
        self.assertEqual(apply_baseline([issue], {issue.identity: "reviewed"}), [])
        self.assertEqual(len(apply_baseline([], {issue.identity: "reviewed"})), 1)
        forbidden = Issue("a.swift", 2, "안녕", "language-based server-error filter is forbidden")
        self.assertIn(forbidden, apply_baseline([forbidden], {forbidden.identity: "reviewed"}))

    def test_kotlin_nested_literals(self):
        source = '/* "제외" */ val text = "${get("내부")} 한글"'
        self.assertEqual(len(kotlin_literals(source)), 2)
        self.assertTrue(allowed("a.kt", "내부", [("data-contract", "a.kt", "내부", "stored value")]))
        self.assertFalse(allowed("b.kt", "내부", [("data-contract", "a.kt", "내부", "stored value")]))
        self.assertEqual(kotlin_literals('val text = "\\uD55C\\uAE00"')[0][2], "한글")

    def test_debug_branch_and_inner_interpolation(self):
        source = '#if DEBUG\nText("디버그")\n#else\nText("실제")\n#endif\nText("이름 \\(raw ?? "폴백")")'
        literals = SwiftLexer(source).run()
        self.assertEqual([literal["debug"] for literal in literals[:2]], [True, False])
        inner = next(l for l in literals if literal_value(l) == "폴백")
        self.assertFalse(localized_context("a.swift", source, inner, Declarations({"a.swift": source}))[0])

    def test_translation_format_arguments_cannot_disappear(self):
        root = self.fixture(source='String(localized: "알람 %lld개")', key="알람 %lld개")
        self.assertTrue(any("format argument" in issue.reason for issue in audit(root, [])))

    def test_format_arguments_keep_indices_and_allow_reordering(self):
        cases = [
            ("이름 %@와 %@", "%2$@ and %1$@", False),
            ("이름 %1$@와 %2$@", "%1$@ and %1$@", True),
            ("이름 %@와 %@", "%1$@", True),
            ("이름 %@ 수 %lld", "%2$lld: %1$@", False),
            ("이름 %@ 수 %lld", "%1$lld: %2$@", True),
            ("진행 %lld%% 이름 %@", "%2$@: %1$lld%%", False),
        ]
        for source, translated, fails in cases:
            root = self.fixture(source="")
            entry = {"localizations": {lang: {"stringUnit": {"state": "translated", "value": translated}}
                                       for lang in LANGUAGES}}
            (root / CATALOGS[0]).write_text(json.dumps({"strings": {source: entry}}))
            self.assertEqual(bool(format_issues(root)), fails, (source, translated))


if __name__ == "__main__":
    sys.exit(main())
