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
CATEGORIES = {"generated", "seed-data", "data-contract", "debug-preview", "log", "endonym", "tts-content", "not-rendered"}
SWIFT_UI = {"Text", "Button", "Label", "Toggle", "TextField", "SecureField", "Section", "Picker", "Link",
            "navigationTitle", "alert", "confirmationDialog", "accessibilityLabel", "accessibilityHint"}
LOCALIZED_TYPE = r"LocalizedString(?:Key|Resource)"


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


def catalog_issues(root: Path) -> list[Issue]:
    issues = []
    for relative in (*CATALOGS, "apps/ios-native/AlarmTalk/InfoPlist.xcstrings"):
        data = json.loads((root / relative).read_text())
        for key, entry in data["strings"].items():
            if not entry.get("shouldTranslate", True):
                continue
            for language in LANGUAGES:
                units = entry.get("localizations", {}).get(language, {})
                # Includes plural/variation entries, if introduced later.
                string_units = re.findall(r'"state"\s*:\s*"([^"]+)"', json.dumps(units))
                if not string_units or any(state != "translated" for state in string_units):
                    issues.append(Issue(relative, 0, key, f"{language} translation missing or unfinished"))
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
    return issues


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
        for start, _, value, _ in literals:
            if HANGUL.search(value) and not allowed(path, value, rules):
                issues.append(Issue(path, source.count("\n", 0, start) + 1, value, "Kotlin UI text must use resources or a documented exception"))
        masked = list(source)
        for start, end, _, _ in literals:
            masked[start:end] = [" " for _ in source[start:end]]
        gate_source = blank_comments("".join(masked)) + "\n" + "\n".join(value for _, _, value, _ in literals)
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
        entry = {"localizations": {language: {"stringUnit": {"state": "translated", "value": "Hello"}}
                                    for language in LANGUAGES}}
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
