#!/usr/bin/env python3
"""Check UI localization without Xcode/Gradle (Python standard library only).

Swift is checked by literal context and a declaration index, not by searching
for Text() alone. Stored Korean values, generated data and TTS inputs require
documented exceptions. The baseline identifies reviewed contexts the index
cannot prove; removed entries fail, so it cannot silently become a dump.
"""
from __future__ import annotations

import argparse
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
from localization_formats import android_format_mismatches, catalog_format_mismatches, line_breaks
from localization_swift_types import SwiftTypes

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
# LandingScreen concatenates these fragments around the highlighted word. The
# English sentence moves the break to the prefix; compare the rendered whole.
ANDROID_LINE_BREAK_GROUPS = (("auth_landing_headline_pre", "auth_landing_headline_keyword", "auth_landing_headline_post"),)
# Snackbar colour markers are word sets matched with `contains`, not positional
# translations, so each language may have a different number of items. Only the
# length comparison is exempted: an empty item would match every message.
UNALIGNED_ANDROID_ARRAYS = {"snackbar_error_markers", "snackbar_success_markers"}
# Resource and catalog checks are never allowlisted by key: a key-level rule
# would also hide empty, Hangul and format failures. Scope exceptions above.
RESOURCE_SUFFIXES = (".xml", ".xcstrings")
# CLDR plural categories every translation must provide, on both platforms.
# Korean and Japanese use only `other`; English also needs `one`, otherwise a
# count of one falls back to the plural sentence.
PLURAL_CATEGORIES = {"en": {"one", "other"}, "ja": {"other"}, "ko": {"other"}}


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


def call_span(source: str, opening: int) -> tuple[int, int]:
    """Span of the callee token (`[#\\w.]+`) before an opening delimiter.

    Scans backwards from the delimiter only as far as that token reaches;
    a `$`-anchored regex over `source[:opening]` was quadratic per file.
    """
    end = opening
    while end > 0 and source[end - 1].isspace():
        end -= 1
    start = end
    while start > 0 and (source[start - 1].isalnum() or source[start - 1] in "_#."):
        start -= 1
    return start, end


def call_at(source: str, opening: int) -> str:
    start, end = call_span(source, opening)
    return source[start:end]


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


def format_template(literal: dict, infer=lambda expression: None) -> str:
    """The format string Swift builds from a LocalizationValue literal.

    Preserve the actual primitive interpolation type. Unknown expressions
    require an explicit typed expression instead of matching every format.
    """
    interpolated = any(kind == "interp" for kind, _ in literal["parts"])
    parts = []
    for kind, value in literal["parts"]:
        if kind == "lit":
            parts.append(value.replace("%", "%%") if interpolated else value)
        else:
            conversion = infer(value)
            if conversion is None:
                raise ValueError(value)
            parts.append("%" + conversion)
    value = "".join(parts)
    if literal["multiline"]:
        value = textwrap.dedent(value.removeprefix("\n")).rstrip(" \t").removesuffix("\n")
    return value


def key_pattern(literal: dict, infer=lambda expression: None) -> re.Pattern:
    return re.compile("^" + re.escape(format_template(literal, infer)) + "$")


def semantic_key(source: str, literals: list[dict], default: dict) -> str | None:
    """The static key literal of the call that owns a `defaultValue:` literal."""
    openings = [pos for kind, pos in default["stack"] if kind == "("]
    for literal in literals:
        if literal["start"] >= default["start"]:
            continue  # Interpolated literals are listed before their outer string.
        own = [pos for kind, pos in literal["stack"] if kind == "("]
        if own and own[-1] == openings[-1] and argument_prefix(source, literal, own[-1]) in {"localized:", ""}:
            interpolated = any(kind == "interp" for kind, _ in literal["parts"])
            return None if interpolated else literal_value(literal)
    return None


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
    start = call_span(source, stack[-1])[0]
    prefix = argument_prefix(source, {"start": start}, stack[-2])
    argument = re.match(r"(\w+)\s*:", prefix)
    call = call_at(source, stack[-2]).split(".")[-1]
    return bool(argument and declarations.accepts(path, call, argument[1]))


def swift_ui_context(source: str, code: str, literal: dict) -> bool:
    """Plain String display arguments need lookup regardless of source language."""
    for kind, opening in reversed(literal["stack"]):
        if kind == "{":
            break  # A UI callback's body is a separate context (e.g. a log).
        if kind != "(":
            continue
        call = call_at(source, opening).split(".")[-1]
        if call == "DispatchQueue":
            return False  # Its label identifies a queue in diagnostics.
        prefix = argument_prefix(code, literal, opening)
        if re.search(r"(?:==|!=|>=|<=)\s*$", prefix):
            return False  # Compared contract identifiers are not display copy.
        parameter = re.match(r"(\w+)\s*:", prefix)
        parameter = parameter[1] if parameter else None
        if call in SWIFT_UI and parameter in {None, "verbatim", "title", "text"}:
            return True
        if parameter in {"title", "text", "message", "label", "subtitle", "placeholder", "accessibilityLabel", "accessibilityHint"}:
            return True
    return False


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
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        category, pattern, literal, reason = line.split("\t", 3)
        if category not in CATEGORIES or not reason.strip():
            raise ValueError("Invalid allowlist rule: " + line)
        if pattern.endswith(RESOURCE_SUFFIXES):
            raise ValueError("Translation resources cannot be allowlisted; scope the exception in code: " + line)
        rules.append((category, pattern, json.loads(literal), reason))
    return rules


def allowed(path: str, value: str, rules: list[tuple[str, str, str, str]]) -> bool:
    return any(fnmatch.fnmatchcase(path, pattern) and (literal == "*" or literal == value)
               for _, pattern, literal, _ in rules)


def read_baseline(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    entries = {}
    for line in path.read_text(encoding="utf-8").splitlines():
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


def plural_categories_missing(node, required: set[str]) -> bool:
    """True if any plural variation (including substitutions) lacks a category."""
    if isinstance(node, dict):
        for key, child in node.items():
            if key == "variations" and isinstance(child, dict) and "plural" in child:
                plural = child["plural"]
                if not isinstance(plural, dict) or not required <= plural.keys():
                    return True
            if plural_categories_missing(child, required):
                return True
    elif isinstance(node, list):
        return any(plural_categories_missing(child, required) for child in node)
    return False


def translated_leaves(node) -> bool:
    leaves = list(string_units(node))
    return bool(leaves) and all(leaf.get("state") == "translated"
                                and isinstance(leaf.get("value"), str)
                                and leaf["value"].strip() for leaf in leaves)


def catalog_issues(root: Path) -> list[Issue]:
    issues = []
    for relative in (*CATALOGS, "apps/ios-native/AlarmTalk/InfoPlist.xcstrings"):
        data = json.loads((root / relative).read_text(encoding="utf-8"))
        for key, entry in data["strings"].items():
            if not entry.get("shouldTranslate", True):
                continue
            # A Korean source-text key can fall back to the key itself. An opaque
            # identifier cannot: require an explicit Korean value as well.
            localizations = entry.get("localizations", {})
            required_languages = (*LANGUAGES, "ko") if not HANGUL.search(key) or "ko" in localizations else LANGUAGES
            for language in required_languages:
                units = entry.get("localizations", {}).get(language, {})
                leaves = list(string_units(units))
                if not translated_leaves(units):
                    issues.append(Issue(relative, 0, key, f"{language} translation missing, unfinished or empty"))
                if plural_categories_missing(units, PLURAL_CATEGORIES[language]):
                    issues.append(Issue(relative, 0, key, f"{language} required plural variations missing"))
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
            if entry.tag != other.tag or (entry.tag == "string-array" and len(entry) != len(other)
                                          and key not in UNALIGNED_ANDROID_ARRAYS):
                issues.append(Issue(target, 0, key, "resource type/array length differs"))
            if other.tag == "plurals":
                if not PLURAL_CATEGORIES[language] <= {item.get("quantity") for item in other}:
                    issues.append(Issue(target, 0, key, f"Android {language} required plural quantities missing"))
            if HANGUL.search("".join(other.itertext())):
                issues.append(Issue(target, 0, key, f"Android {language} resource contains Hangul"))
            leaves = [other] if other.tag == "string" else list(other)
            if (not leaves or any(android_text_is_blank("".join(leaf.itertext())) for leaf in leaves)) and (language, key) not in EMPTY_ANDROID_UNITS:
                issues.append(Issue(target, 0, key, f"Android {language} resource contains an empty translation"))
            grouped = any(key in group for group in ANDROID_LINE_BREAK_GROUPS)
            for leaf in android_format_mismatches(entry, other, check_line_breaks=not grouped):
                issues.append(Issue(target, 0, key, f"Android {language} format argument indices/types/count or line breaks differ ({leaf})"))
    for group in ANDROID_LINE_BREAK_GROUPS:
        for language in LANGUAGES:
            if not all(key in localized[locale] for locale in ("ko", language) for key in group):
                continue  # Individual missing-resource checks report these.
            counts = [sum(line_breaks("".join(localized[locale][key][0].itertext()), "android") for key in group)
                      for locale in ("ko", language)]
            if counts[0] != counts[1]:
                issues.append(Issue(localized[language][group[0]][1], 0, "+".join(group), f"Android {language} combined line breaks differ"))
    return issues


# Kotlin display sinks, matched by callee name and argument position. Second
# positional argument: Toast text, notification action title, channel name.
KOTLIN_TEXT_CALLS = {"Text", "BasicText", "AnnotatedString"}
KOTLIN_FIRST_ARGUMENT_SINKS = {"setContentTitle", "setContentText", "setSubText", "setTicker", "setBigContentTitle",
                               "setSummaryText", "bigText", "showSnackbar"}
KOTLIN_SECOND_ARGUMENT_SINKS = {"makeText", "addAction", "Action.Builder", "NotificationChannel", "NotificationChannelGroup"}
KOTLIN_NAMED_SINKS = {"text", "title", "message", "contentDescription", "label"}
# `append("…")` inside these lambdas becomes the builder's result, which is
# then checked at the call that receives it (e.g. `Text(buildAnnotatedString {…})`).
KOTLIN_TEXT_BUILDERS = {"buildAnnotatedString", "buildString", "withStyle", "withLink", "withAnnotation"}
KOTLIN_APPENDS = {"append", "appendLine"}
# Assignment sinks in small receiver lambdas.
KOTLIN_SEMANTICS_BLOCKS = {"semantics", "clearAndSetSemantics"}
KOTLIN_SEMANTICS_PROPERTIES = {"contentDescription", "stateDescription", "paneTitle"}
KOTLIN_CHANNELS = {"NotificationChannel", "NotificationChannelGroup"}
KOTLIN_CHANNEL_PROPERTIES = {"name", "description"}


def kotlin_ui_context(code: str, start: int, pairs: dict[int, int], closers: dict[int, int] | None = None) -> bool:
    """Recognize literal arguments at text/notification sinks, in any language.

    Code has strings/comments blanked, preserving offsets. A lambda body starts
    a new context: an onClick log is not a title merely because it is inside UI.
    Text builders are the exception: appended text flows to the enclosing call.
    This is a call-site check, not Kotlin data-flow/type analysis.
    """
    if closers is None:
        closers = {end: opening for opening, end in pairs.items()}

    def before(position):
        while position > 0 and code[position - 1].isspace():
            position -= 1
        return position

    def expression_branch(opening):
        # Look back only over the token before the brace, not the whole file.
        end = before(opening)
        if code.endswith("->", 0, end):
            return True
        if code.endswith("else", 0, end) and (end == 4 or not (code[end - 5].isalnum() or code[end - 5] == "_")):
            return True
        if end and code[end - 1] == ")":
            condition = closers.get(end - 1)
            return condition is not None and call_at(code, condition) in {"if", "when"}
        return False

    def lambda_call(opening):
        """`withStyle(style) {` -> withStyle; `channel.apply {` -> channel.apply."""
        end = before(opening)
        if end and code[end - 1] == ")" and end - 1 in closers:
            return call_at(code, closers[end - 1])
        return call_at(code, opening)

    def receiver_call(opening):
        """`NotificationChannel(…).apply {` -> NotificationChannel."""
        token = call_span(code, opening)[0]
        if not code.startswith(".", token):
            return ""
        end = before(token)
        return call_at(code, closers[end - 1]) if end and code[end - 1] == ")" and end - 1 in closers else ""

    def assigned_property(opening):
        """Property assigned by the statement that holds the literal."""
        depth, begin = 0, opening + 1
        for i in range(opening + 1, start):
            char = code[i]
            if char in "([{":
                depth += 1
            elif char in ")]}":
                depth -= 1
            elif depth == 0 and char in "\n;":
                previous = i - 1
                while previous > opening and code[previous] in " \t\r":
                    previous -= 1
                if code[previous] != "=":  # `x =` continues on the next line.
                    begin = i + 1
        assignment = re.match(r"\s*(?:(?:this|it)\.)?(\w+)\s*=(?!=)", code[begin:start])
        return assignment[1] if assignment else None

    enclosing = sorted(opening for opening, end in pairs.items() if opening < start < end)
    appended = False
    for opening in reversed(enclosing):
        if code[opening] == "{":
            if expression_branch(opening):
                continue
            call = lambda_call(opening).split(".")[-1]
            if appended and call in KOTLIN_TEXT_BUILDERS:
                continue
            if call in KOTLIN_SEMANTICS_BLOCKS:
                return assigned_property(opening) in KOTLIN_SEMANTICS_PROPERTIES
            if call in {"apply", "also"} and receiver_call(opening).split(".")[-1] in KOTLIN_CHANNELS:
                return assigned_property(opening) in KOTLIN_CHANNEL_PROPERTIES
            return False
        if code[opening] != "(":
            continue
        qualified = call_at(code, opening)
        call = qualified.split(".")[-1]
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
        if call in KOTLIN_TEXT_CALLS and (parameter == "text" or (not parameter and argument_index == 0)):
            return True
        if call in KOTLIN_FIRST_ARGUMENT_SINKS and argument_index == 0:
            return True
        if not parameter and argument_index == 1 and (call in KOTLIN_SECOND_ARGUMENT_SINKS
                                                       or ".".join(qualified.split(".")[-2:]) in KOTLIN_SECOND_ARGUMENT_SINKS):
            return True
        if parameter in KOTLIN_NAMED_SINKS:
            # Compose animation labels are debugger identifiers, not UI copy.
            if parameter == "label" and (call.startswith("animate") or call in {"rememberInfiniteTransition", "updateTransition"}):
                continue
            return True
        if call in KOTLIN_APPENDS and not parameter and argument_index == 0:
            appended = True
    return False


def format_issues(root: Path) -> list[Issue]:
    """Catch dropped/type-changed arguments; positional reordering is allowed."""
    issues = []
    for relative in CATALOGS:
        for key, entry in json.loads((root / relative).read_text(encoding="utf-8"))["strings"].items():
            if not entry.get("shouldTranslate", True):
                continue
            localizations = entry.get("localizations", {})
            languages = (*LANGUAGES, "ko") if HANGUL.search(key) and "ko" in localizations else LANGUAGES
            for language in languages:
                source = {} if language == "ko" else localizations.get("ko", {})
                for path in catalog_format_mismatches(source, localizations.get(language, {}), key):
                    issues.append(Issue(relative, 0, key, f"{language} format argument indices/types/count or line breaks differ ({'/'.join(path) or 'string'})"))
    return issues


def language_gate(source: str) -> bool:
    # Include Swift scalar ranges and Kotlin character/regex ranges. Comments
    # are removed by callers, but string contents matter for Regex("[가-힣]").
    return bool(re.search(r"\bcontainsKorean\b|0x[Aa][Cc]00|\\u\{?[Aa][Cc]00|가(?:-|\.{2,3})힣", source))


def audit(root: Path, rules: list[tuple[str, str, str, str]]) -> list[Issue]:
    sources = {str(p.relative_to(root)): p.read_text(encoding="utf-8") for relative in SWIFT_ROOTS for p in (root / relative).rglob("*.swift")}
    declarations = Declarations(sources)
    types = SwiftTypes(sources, lambda source: code_only(source, SwiftLexer(source).run()), delimiter_pairs)
    catalogs = {relative: json.loads((root / relative).read_text(encoding="utf-8"))["strings"] for relative in CATALOGS}
    issues = []
    for path, source in sources.items():
        literals = SwiftLexer(source, path).run()
        code = code_only(source, literals)
        for literal in literals:
            value = literal_value(literal)
            localized, kind = localized_context(path, source, literal, declarations)
            if string_in_key_parameter(path, source, literal, declarations):
                issues.append(Issue(path, literal["line"], value, "String(localized:) passed to a key/resource parameter; retain its literal key"))
            if literal["debug"] or kind == "comment" or value == "" or allowed(path, value, rules):
                continue
            ui_copy = not HANGUL.search(value) and not localized and any(char.isalpha() for kind, part in literal["parts"] if kind == "lit" for char in part) and swift_ui_context(source, code, literal)
            if not HANGUL.search(value) and not localized and not ui_copy:
                continue
            calls = [call_at(source, pos) for token, pos in literal["stack"] if token == "("]
            if "#Preview" in calls:
                continue
            if any(re.search(r"(?:AlarmTalkLog\.\w+|(?:\w*[Ll]ogger)\.(?:info|debug|error|warning|notice)|print)$", call) for call in calls):
                continue
            if not localized:
                issues.append(Issue(path, literal["line"], value, "literal is not in a proven localization context"))
                continue
            targets = CATALOGS if "/Shared/" in path else (CATALOGS[1] if "/AlarmTalkWidget/" in path else CATALOGS[0],)
            if kind == "default":
                # The semantic key is looked up as its own literal; the default
                # value supplies the format arguments for every translation, so
                # its signature and line breaks must match the Korean value.
                key = semantic_key(source, literals, literal)
                if key is None:
                    continue
                try:
                    template = format_template(literal, lambda expression: types.infer(expression, path, literal["start"]))
                except ValueError as error:
                    issues.append(Issue(path, literal["line"], value, f"interpolation type unknown; use an explicit primitive conversion: {error}"))
                    continue
                for target in targets:
                    entry = catalogs[target].get(key)
                    if entry is None or not entry.get("shouldTranslate", True):
                        continue  # A missing key is reported by its own literal.
                    korean = entry.get("localizations", {}).get("ko", {})
                    if catalog_format_mismatches(korean, {"stringUnit": {"state": "translated", "value": template}}, key):
                        issues.append(Issue(path, literal["line"], value, f"defaultValue format arguments or line breaks differ from the ko value of {key!r} in {target}"))
                continue
            try:
                pattern = key_pattern(literal, lambda expression: types.infer(expression, path, literal["start"]))
            except ValueError as error:
                issues.append(Issue(path, literal["line"], value, f"interpolation type unknown; use an explicit primitive conversion: {error}"))
                continue
            for target in targets:
                matches = [(key, entry) for key, entry in catalogs[target].items() if pattern.fullmatch(key)]
                # Language-neutral punctuation/brand strings need no translation.
                if not matches:
                    issues.append(Issue(path, literal["line"], value, f"key missing from {target}"))
                elif not any(not entry.get("shouldTranslate", True) or all(
                    translated_leaves(entry.get("localizations", {}).get(language, {}))
                    for language in LANGUAGES) for _, entry in matches):
                    issues.append(Issue(path, literal["line"], value, f"key has unfinished en/ja translations in {target}"))
        gate_source = code + "\n" + "\n".join(literal_value(l) for l in literals)
        if language_gate(gate_source) and not allowed(path, "language-gate", rules):
            issues.append(Issue(path, 0, "containsKorean", "language-based server-error filter is forbidden"))
    for file in (root / "apps/android-native/app/src/main/java").rglob("*.kt"):
        path, source = str(file.relative_to(root)), file.read_text(encoding="utf-8")
        literals = kotlin_literals(source)
        masked = list(source)
        for start, end, _, _ in literals:
            masked[start:end] = [" " for _ in source[start:end]]
        code = blank_comments("".join(masked))
        pairs = delimiter_pairs(code)
        closers = {end: opening for opening, end in pairs.items()}
        static = {start: value for start, _, value, _ in kotlin_literals(source, static_text=True)}
        for start, _, value, _ in literals:
            if allowed(path, value, rules):
                continue
            ui_copy = any(char.isalpha() for char in static[start]) and kotlin_ui_context(code, start, pairs, closers)
            if HANGUL.search(value) or ui_copy:
                issues.append(Issue(path, source.count("\n", 0, start) + 1, value, "Kotlin UI text must use resources or a documented exception"))
        gate_source = code + "\n" + "\n".join(value for _, _, value, _ in literals)
        if language_gate(gate_source) and not allowed(path, "language-gate", rules):
            issues.append(Issue(path, 0, "containsKorean", "language-based server-error filter is forbidden"))
    issues.extend(catalog_issues(root))
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
        baseline_path.write_text("# Review every candidate; user-visible untranslated text is not an exception.\n" + "".join(key + "\tREVIEW REQUIRED\n" for key in entries), encoding="utf-8")
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
    def test_explicit_korean_for_source_keys_must_be_valid(self):
        root = self.fixture()
        file = root / CATALOGS[0]
        original = file.read_text(encoding="utf-8")
        for value, state in [("", "translated"), (" \n", "translated"), ("안녕", "new")]:
            data = json.loads(original)
            data["strings"]["안녕"]["localizations"]["ko"]["stringUnit"] = {"value": value, "state": state}
            file.write_text(json.dumps(data), encoding="utf-8")
            self.assertTrue(any(i.reason.startswith("ko translation") for i in audit(root, [])))

    def test_source_key_format_cannot_be_lost_in_all_languages(self):
        root = self.fixture(source='', key='안녕 %@')
        file = root / CATALOGS[0]
        data = json.loads(file.read_text(encoding="utf-8"))
        for language in (*LANGUAGES, 'ko'):
            data['strings']['안녕 %@']['localizations'][language]['stringUnit']['value'] = 'Hello'
        file.write_text(json.dumps(data), encoding="utf-8")
        self.assertTrue(any(i.reason.startswith('ko format argument') for i in format_issues(root)))

    def test_call_sites_accept_translated_variations(self):
        root = self.fixture()
        file = root / CATALOGS[0]
        original = json.loads(file.read_text(encoding="utf-8"))
        for kind in ['plural', 'device']:
            data = json.loads(json.dumps(original))
            for language in LANGUAGES:
                localization = data['strings']['안녕']['localizations'][language]
                # English plurals need `one` as well; see test_catalog_plurals_require_locale_categories.
                variants = ['one', 'other'] if kind == 'plural' and language == 'en' else ['other']
                data['strings']['안녕']['localizations'][language] = {'variations': {kind: {
                    variant: json.loads(json.dumps(localization)) for variant in variants}}}
            file.write_text(json.dumps(data), encoding="utf-8")
            self.assertEqual(audit(root, []), [])
            data['strings']['안녕']['localizations']['en']['variations'][kind]['other']['stringUnit']['state'] = 'new'
            file.write_text(json.dumps(data), encoding="utf-8")
            self.assertTrue(any('unfinished en/ja' in i.reason for i in audit(root, [])))

    def test_catalog_plurals_require_locale_categories(self):
        def leaf(value):
            return {"stringUnit": {"state": "translated", "value": value}}
        def plural(categories):
            return {"variations": {"plural": {category: leaf("%lld") for category in categories}}}
        def substitution(categories):
            return {"stringUnit": {"state": "translated", "value": "%#@count@"}, "substitutions": {"count": {
                "argNum": 1, "formatSpecifier": "lld", "variations": {"plural": {c: leaf("%arg") for c in categories}}}}}
        root = self.fixture(source="", key="alarm.count")
        for relative in (*CATALOGS, "apps/ios-native/AlarmTalk/InfoPlist.xcstrings"):
            file = root / relative
            original = file.read_text(encoding="utf-8")
            for language, valid, invalid in [("en", ["one", "other"], ["other"]), ("ja", ["other"], ["one"]),
                                             ("ko", ["other"], ["one"])]:
                for shape in (plural, substitution):
                    for categories, fails in [(valid, False), (invalid, True)]:
                        data = json.loads(original)
                        localizations = {lang: plural(PLURAL_CATEGORIES[lang]) for lang in (*LANGUAGES, "ko")}
                        localizations[language] = shape(categories)
                        data["strings"]["alarm.count"]["localizations"] = localizations
                        file.write_text(json.dumps(data), encoding="utf-8")
                        issues = [i for i in catalog_issues(root) if i.reason == f"{language} required plural variations missing"]
                        self.assertEqual(bool(issues), fails, (relative, language, shape.__name__, categories))
            file.write_text(original, encoding="utf-8")

    def test_interpolation_type_must_match_catalog_key(self):
        for declaration, expression, correct, wrong in [
            ('let count: Int = 3', 'count', 'lld', '@'),
            ('let count = 3', 'count', 'lld', '@'),
            ('let name: String = "Sam"', 'name', '@', 'lld'),
            ('', 'Int(3)', 'lld', '@'), ('', 'String(3)', '@', 'lld'),
            ('let count = 3', 'count + 1', 'lld', '@')]:
            source = declaration + '\nString(localized: "알람 \\(' + expression + ')개")'
            for conversion in (correct, wrong):
                root = self.fixture(source=source, key='알람 %' + conversion + '개')
                issues = audit(root, [])
                self.assertEqual(any('key missing' in i.reason for i in issues), conversion == wrong, source)
        root = self.fixture(source='String(localized: "알람 \\(unknown())개")', key='알람 %@개')
        self.assertTrue(any('interpolation type unknown' in i.reason for i in audit(root, [])))

    def test_interpolation_does_not_borrow_another_functions_parameter(self):
        source = 'func first(count: Int) {}\nfunc second(count: String) { String(localized: "알람 \\(count)개") }'
        root = self.fixture(source=source, key='알람 %lld개')
        self.assertTrue(any('key missing' in i.reason for i in audit(root, [])))
        source = 'func first(count: Int) {}\nfunc second() { String(localized: "알람 \\(count)개") }'
        root = self.fixture(source=source, key='알람 %lld개')
        self.assertTrue(any('interpolation type unknown' in i.reason for i in audit(root, [])))

    def test_member_types_are_not_borrowed_by_name(self):
        use = '\nfunc show(b: B) -> String { String(localized: "알람 \\(b.value)개") }'
        for declarations, expected in [
                # An inferred member conflicts with another type's annotation.
                ('struct A { let value: String }\nstruct B { let value = 3 }', None),
                ('struct A { let value: String }\nstruct B { var value = Double(3) }', None),
                ('struct A { let value: String }\nstruct B { let value = helper() }', None),
                ('struct A { let value: Int }\nstruct B { static let value = 3 }', 'lld'),
                # A function-local inference is not a member of any type.
                ('struct B { let value: String }\nfunc local() { let value = 3 }', '@'),
                ('class B { class var other: Int { 1 }\n let value = "x" }', '@')]:
            for conversion in ('@', 'lld'):
                root = self.fixture(source=declarations + use, key='알람 %' + conversion + '개')
                issues = audit(root, [])
                if expected is None:
                    self.assertTrue(any('interpolation type unknown' in i.reason for i in issues), declarations)
                else:
                    self.assertEqual(any('key missing' in i.reason for i in issues), conversion != expected, declarations)
        # `.count` is Int unless a custom `count` member says otherwise.
        use = '\nfunc show(items: [Int]) -> String { String(localized: "알람 \\(items.count)개") }'
        root = self.fixture(source='struct A { let count: Int }' + use, key='알람 %lld개')
        self.assertFalse(any(i.path.endswith('.swift') for i in audit(root, [])))
        root = self.fixture(source='struct A { let count = "many" }' + use, key='알람 %lld개')
        self.assertTrue(any('interpolation type unknown' in i.reason for i in audit(root, [])))

    def test_android_plural_requires_locale_quantities(self):
        root = self.fixture(source='')
        base = root / 'apps/android-native/app/src/main/res'
        for language, quantities in [('', ['other']), ('-ja', ['other']), ('-en', ['one', 'other'])]:
            items = ''.join('<item quantity="' + q + '">Hello</item>' for q in quantities)
            (base / ('values' + language) / 'strings.xml').write_text('<resources><plurals name="hello">' + items + '</plurals></resources>', encoding="utf-8")
        self.assertEqual(catalog_issues(root), [])
        for language in LANGUAGES:
            file = base / ('values-' + language) / 'strings.xml'
            original = file.read_text(encoding="utf-8")
            file.write_text(re.sub('<item quantity="' + ('one' if language == 'en' else 'other') + '">.*?</item>', '', original), encoding="utf-8")
            self.assertTrue(any(i.reason == f'Android {language} required plural quantities missing' for i in catalog_issues(root)))
            file.write_text(original, encoding="utf-8")

    def test_line_break_contract_in_each_leaf(self):
        from localization_formats import line_breaks
        self.assertEqual(line_breaks(r'first\nsecond', 'android'), 1)
        self.assertEqual(line_breaks(r'first\\nsecond', 'android'), 0)
        self.assertEqual(line_breaks('first%%nsecond', 'android'), 0)
        self.assertEqual(line_breaks('first%nsecond', 'android'), 1)
        self.assertEqual(line_breaks('first%nsecond', 'android', formatted=False), 0)
        self.assertEqual(line_breaks('first\r\nsecond'), 1)
        def leaf(value):
            return {'stringUnit': {'state': 'translated', 'value': value}}
        for kind in ['plural', 'device']:
            source = {'variations': {kind: {'other': leaf('첫 줄\n둘째 줄')}}}
            self.assertTrue(catalog_format_mismatches(source, leaf('One line'), 'key'))
            self.assertEqual(catalog_format_mismatches(source, leaf('First\nSecond'), 'key'), [])
        for tag in ['string', 'string-array', 'plurals']:
            wrap = (lambda text: text) if tag == 'string' else (lambda text: '<item quantity="other">' + text + '</item>')
            source = ET.fromstring('<' + tag + ' name="value" formatted="false">' + wrap(r'First\nSecond') + '</' + tag + '>')
            target = ET.fromstring('<' + tag + ' name="value">' + wrap('One line') + '</' + tag + '>')
            self.assertTrue(android_format_mismatches(source, target))

    def test_combined_landing_line_breaks(self):
        root = self.fixture(source='')
        base = root / 'apps/android-native/app/src/main/res'
        group = ANDROID_LINE_BREAK_GROUPS[0]
        for language, values in [('', ['First', 'word', r'\nlast']),
                                 ('-en', [r'First\n', 'word', 'last']),
                                 ('-ja', ['First', 'word', r'\nlast'])]:
            xml = '<resources>' + ''.join('<string name="' + name + '">' + value + '</string>' for name, value in zip(group, values)) + '</resources>'
            (base / ('values' + language) / 'strings.xml').write_text(xml, encoding="utf-8")
        self.assertEqual(catalog_issues(root), [])
        file = base / 'values-en/strings.xml'
        file.write_text(file.read_text(encoding="utf-8").replace(r'\n', ''), encoding="utf-8")
        self.assertTrue(any('combined line breaks differ' in i.reason for i in catalog_issues(root)))

    def test_comments_raw_strings_and_interpolation(self):
        source = r'// "주석"' + '\n' + r'Text(#"안녕 \#(name)"#) /* nested /* "제외" */ */'
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
        self.assertTrue(key_pattern(literal, lambda _: "lld").fullmatch("진행 %lld%%"))
        self.assertFalse(key_pattern(literal, lambda _: "lld").fullmatch("진행 %lld%"))
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
            file.write_text(json.dumps({"strings": {key: entry}}), encoding="utf-8")
        file = root / SWIFT_ROOTS[0] / "Screen.swift"
        file.write_text(source, encoding="utf-8")
        for language in ("", "-en", "-ja"):
            directory = root / ("apps/android-native/app/src/main/res/values" + language)
            directory.mkdir(parents=True)
            (directory / "strings.xml").write_text('<resources><string name="hello">Hello</string></resources>', encoding="utf-8")
        return root

    def test_missing_catalog_key_and_translation_fail(self):
        root = self.fixture()
        self.assertEqual(audit(root, []), [])
        file = root / CATALOGS[0]
        file.write_text('{"strings": {}}', encoding="utf-8")
        self.assertTrue(any("key missing" in issue.reason for issue in audit(root, [])))
        file.write_text(json.dumps({"strings": {"안녕": {"localizations": {"en": {"stringUnit": {"state": "new", "value": "Hello"}}}}}}), encoding="utf-8")
        self.assertTrue(any("unfinished" in issue.reason for issue in audit(root, [])))

    def test_permission_and_semantic_keys_require_all_translations(self):
        root = self.fixture()
        for relative in (*CATALOGS, "apps/ios-native/AlarmTalk/InfoPlist.xcstrings"):
            file = root / relative
            original = file.read_text(encoding="utf-8")
            for language in LANGUAGES:
                for state in [None, "new"]:
                    entry = {"localizations": {lang: {"stringUnit": {"state": "translated", "value": "Permission"}}
                                               for lang in LANGUAGES}}
                    if state is None:
                        del entry["localizations"][language]
                    else:
                        entry["localizations"][language]["stringUnit"]["state"] = state
                    file.write_text(json.dumps({"strings": {"NSAlarmKitUsageDescription": entry}}), encoding="utf-8")
                    issues = catalog_issues(root)
                    self.assertTrue(any(i.path == relative and i.value == "NSAlarmKitUsageDescription"
                                        and i.reason.startswith(language) for i in issues))
            file.write_text(json.dumps({"strings": {"CFBundleDisplayName": {"shouldTranslate": False}}}), encoding="utf-8")
            self.assertFalse(any(i.path == relative for i in catalog_issues(root)))
            file.write_text(original, encoding="utf-8")

    def test_translated_catalog_leaves_cannot_be_blank(self):
        root = self.fixture()
        for relative in (*CATALOGS, "apps/ios-native/AlarmTalk/InfoPlist.xcstrings"):
            file = root / relative
            original = file.read_text(encoding="utf-8")
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
                        file.write_text(json.dumps({"strings": {"NSAlarmKitUsageDescription": entry}}), encoding="utf-8")
                        self.assertTrue(any(i.path == relative and i.reason.startswith(language)
                                            and "empty" in i.reason for i in catalog_issues(root)))
                        entry["shouldTranslate"] = False
                        file.write_text(json.dumps({"strings": {"Brand": entry}}), encoding="utf-8")
                        self.assertFalse(any(i.path == relative for i in catalog_issues(root)))
            file.write_text(original, encoding="utf-8")

    def test_semantic_keys_require_a_nonempty_korean_translation(self):
        for key in ["group.plan.shared", "member.unnamed", "code.redeem.submit", "NSAlarmKitUsageDescription"]:
            root = self.fixture(source="", key=key)
            for relative in (*CATALOGS, "apps/ios-native/AlarmTalk/InfoPlist.xcstrings"):
                file = root / relative
                original = file.read_text(encoding="utf-8")
                for ko in [None, {"state": "new", "value": "공유"},
                           {"state": "translated", "value": ""}, {"state": "translated", "value": "  "}]:
                    data = json.loads(original)
                    localizations = data["strings"][key]["localizations"]
                    if ko is None:
                        del localizations["ko"]
                    else:
                        localizations["ko"] = {"stringUnit": ko}
                    file.write_text(json.dumps(data), encoding="utf-8")
                    self.assertTrue(any(i.path == relative and i.reason.startswith("ko ") for i in catalog_issues(root)))
                file.write_text(original, encoding="utf-8")
            self.assertEqual(catalog_issues(root), [])
        root = self.fixture()
        for relative in (*CATALOGS, "apps/ios-native/AlarmTalk/InfoPlist.xcstrings"):
            file = root / relative
            data = json.loads(file.read_text(encoding="utf-8"))
            del data["strings"]["안녕"]["localizations"]["ko"]
            file.write_text(json.dumps(data), encoding="utf-8")
        self.assertEqual(catalog_issues(root), [])

    def test_semantic_default_and_comments(self):
        root = self.fixture('String(localized: "hello.title", defaultValue: "안녕", comment: "번역 설명")', "hello.title")
        self.assertEqual(audit(root, []), [])

    def test_semantic_default_values_match_korean_format(self):
        def check(source, korean):
            root = self.fixture(source=source, key="item.count")
            for relative in CATALOGS:
                file = root / relative
                data = json.loads(file.read_text(encoding="utf-8"))
                data["strings"]["item.count"]["localizations"]["ko"]["stringUnit"]["value"] = korean
                file.write_text(json.dumps(data), encoding="utf-8")
            return [i.reason for i in audit(root, []) if i.path.endswith(".swift")]
        declaration = 'func label(count: Int, name: String) -> String { '
        for call in ['String(localized: "item.count", defaultValue: {value})',
                     'String(localized: "item.count", defaultValue: {value}, bundle: bundle)',
                     'LocalizedStringResource("item.count", defaultValue: {value})']:
            for value, korean, fails in [('"\\(count)개"', '%lld개', False), ('"\\(count)개"', '%@개', True),
                                         ('"\\(count)개"', '개', True), ('"\\(name) \\(count)개"', '%1$@ %2$lld개', False),
                                         ('"\\(name) \\(count)개"', '%2$lld %1$@', False), ('"\\(name) \\(count)개"', '%1$lld %2$@', True),
                                         ('"첫 줄\\n둘째 줄"', '첫 줄\n둘째 줄', False), ('"첫 줄\\n둘째 줄"', '첫 줄 둘째 줄', True),
                                         ('"진행 \\(count)%"', '진행 %lld%%', False)]:
                source = declaration + call.format(value=value) + ' }'
                reasons = check(source, korean)
                self.assertEqual(any('defaultValue format' in r for r in reasons), fails, (source, korean))
        reasons = check(declaration + 'String(localized: "item.count", defaultValue: "\\(mystery())개") }', '%lld개')
        self.assertTrue(any('interpolation type unknown' in r for r in reasons))

    def test_shared_keys_are_required_in_both_targets(self):
        root = self.fixture(source="")
        file = root / SWIFT_ROOTS[2] / "Intents.swift"
        file.parent.mkdir(parents=True)
        file.write_text('let title: LocalizedStringResource = "안녕"', encoding="utf-8")
        (root / CATALOGS[1]).write_text('{"strings": {}}', encoding="utf-8")
        self.assertTrue(any(CATALOGS[1] in issue.reason for issue in audit(root, [])))

    def test_android_literals_resources_and_hangul_translations(self):
        root = self.fixture()
        file = root / "apps/android-native/app/src/main/java/example/Screen.kt"
        file.parent.mkdir(parents=True)
        file.write_text('Text("안녕")', encoding="utf-8")
        self.assertTrue(any("Kotlin UI" in issue.reason for issue in audit(root, [])))
        rules = [("data-contract", str(file.relative_to(root)), "안녕", "fixture contract")]
        self.assertEqual(audit(root, rules), [])
        path = root / "apps/android-native/app/src/main/res/values-en/strings.xml"
        path.write_text('<resources/>', encoding="utf-8")
        self.assertTrue(any("Android en resource missing" in issue.reason for issue in audit(root, rules)))
        path.write_text('<resources><string name="hello">안녕</string></resources>', encoding="utf-8")
        self.assertTrue(any("contains Hangul" in issue.reason for issue in audit(root, rules)))

    def test_plain_swift_display_arguments_need_lookup_in_every_language(self):
        for source in ['struct Plain { let title: String }\nPlain(title: "Try again")',
                       'Plain(title: "再試行")', 'Text(verbatim: "Retry")',
                       'Text(flag ? "Retry" : other)', 'Plain(message: "Please wait")']:
            root = self.fixture(source=source)
            self.assertTrue(any("not in a proven localization context" in i.reason for i in audit(root, [])), source)
        for source in ['let route = "settings"', 'Image(systemName: "gear")',
                       'DispatchQueue(label: "test.queue")',
                       'Plain(title: mode == "custom" ? translated : other)',
                       'Button("안녕") { print("Debug") }']:
            root = self.fixture(source=source)
            self.assertEqual(audit(root, []), [], source)

    def test_android_format_positions_types_and_each_leaf(self):
        cases = [('Hello %1$s: %2$d', '%2$d: %1$s', False),
                 ('Hello %1$s', 'Hello', True), ('Hello %1$s', 'Hello %1$d', True),
                 ('Hello %1$s %2$s', '%1$s %1$s', True),
                 ('%1$s: %2$03d%%', '%2$03d%%: %1$s', False),
                 ('%1$s %1$s', '%1$s %<s', False),
                 ('%1$tY %2$s', '%2$s %1$tY', False),
                 ('%1$tY', '%1$s', True)]
        for source, translated, fails in cases:
            for tag in ['string', 'string-array', 'plurals']:
                if tag == 'string':
                    a, b = source, translated
                elif tag == 'string-array':
                    a, b = '<item>Same</item><item>' + source + '</item>', '<item>Same</item><item>' + translated + '</item>'
                else:
                    a = '<item quantity="other">' + source + '</item>'
                    b = '<item quantity="one">' + translated + '</item><item quantity="other">' + source + '</item>'
                # Escape XML text while keeping the fixture's item elements.
                a, b = re.sub(r'%<(?=[A-Za-z])', '%&lt;', a), re.sub(r'%<(?=[A-Za-z])', '%&lt;', b)
                first = ET.fromstring('<' + tag + ' name="value">' + a + '</' + tag + '>')
                second = ET.fromstring('<' + tag + ' name="value">' + b + '</' + tag + '>')
                self.assertEqual(bool(android_format_mismatches(first, second)), fails, (tag, source, translated))
        source = ET.fromstring('<string name="value" formatted="false">%1$s</string>')
        target = ET.fromstring('<string name="value">Plain</string>')
        self.assertEqual(android_format_mismatches(source, target), [])

    def test_catalog_variation_format_contracts(self):
        def leaf(value):
            return {"stringUnit": {"state": "translated", "value": value}}
        def variation(kind, values):
            return {"variations": {kind: {key: leaf(value) for key, value in values.items()}}}
        for kind in ['plural', 'device']:
            variant = 'one' if kind == 'plural' else 'iphone'
            source = variation(kind, {'other': '이름 %@ 수 %lld'})
            for translated, fails in [('%2$lld: %1$@', False), ('%1$@', True),
                                      ('%1$@ %1$@', True), ('%1$lld: %2$@', True)]:
                target = variation(kind, {variant: translated, 'other': '%2$lld: %1$@'})
                self.assertEqual(bool(catalog_format_mismatches(source, target, 'key')), fails)
                self.assertEqual(bool(catalog_format_mismatches(leaf('이름 %@ 수 %lld'), target, 'key')), fails)
                self.assertEqual(bool(catalog_format_mismatches(source, leaf(translated), 'key')), fails)
            # Corresponding device leaves may legitimately have different signatures.
            source = variation(kind, {variant: '이름 %@', 'other': '수 %lld'})
            target = variation(kind, {variant: 'Name %@', 'other': 'Count %lld'})
            self.assertEqual(catalog_format_mismatches(source, target, 'key'), [])
            target = variation(kind, {variant: 'Name %lld', 'other': 'Count %@'})
            self.assertEqual(len(catalog_format_mismatches(source, target, 'key')), 2)

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
            file.write_text(source, encoding="utf-8")
            self.assertTrue(any("Kotlin UI" in issue.reason for issue in audit(root, [])), source)
        for source in ['val route = "settings"', 'Text(stringResource(R.string.title))',
                       'Text("$count%")', 'Text("${format(count)}%")',
                       'Text("\\n")', 'Card(title = if (plan == "couple") resource else other)',
                       'Button(onClick = { Log.d("Tag", "Clicked") }) {}',
                       'animateFloatAsState(targetValue = value, label = "progress")',
                       '// Text("Retry")\n/* Text("Again") */']:
            file.write_text(source, encoding="utf-8")
            self.assertEqual(audit(root, []), [], source)

    def test_kotlin_builders_notifications_and_semantics_are_sinks(self):
        root = self.fixture(source="")
        file = root / "apps/android-native/app/src/main/java/example/Screen.kt"
        file.parent.mkdir(parents=True)
        for source in ['Text(text = buildAnnotatedString { append("Try again") })',
                       'Text(buildAnnotatedString {\n    append(stringResource(R.string.a))\n    withStyle(style) { append("Retry") }\n})',
                       'Text(text = buildAnnotatedString { withStyle(SpanStyle(color = c)) { appendLine("Retry $n") } })',
                       'Card(title = buildString { append("Settings") })',
                       'builder.addAction(R.drawable.ic_alarm_24, "Snooze", pendingIntent)',
                       'NotificationCompat.Action.Builder(icon, "Dismiss", pendingIntent).build()',
                       'NotificationChannel(CHANNEL_ID, "Alarms", NotificationManager.IMPORTANCE_HIGH)',
                       'NotificationChannelGroup(GROUP_ID, "Family")',
                       'NotificationChannel(id, name, importance).apply {\n    description = "Rings alarms"\n}',
                       'NotificationChannel(id, name, importance)\n    .apply { this.description =\n        "Rings alarms" }',
                       'Modifier.semantics { contentDescription = "Delete" }',
                       'Modifier.clearAndSetSemantics { stateDescription = if (on) "On" else "Off" }',
                       'Modifier.semantics(mergeDescendants = true) {\n    role = Role.Button\n    this.contentDescription = "Play"\n}',
                       'builder.setStyle(NotificationCompat.BigTextStyle().bigText("Ready"))']:
            file.write_text(source, encoding="utf-8")
            self.assertTrue(any("Kotlin UI" in issue.reason for issue in audit(root, [])), source)
        for source in ['Log.d(TAG, buildString { append("Debug") })',
                       'val key = buildString { append("prefix") }',
                       'Text(buildAnnotatedString { pushStringAnnotation(tag = "URL", annotation = url); append(label) })',
                       'Text(buildAnnotatedString { withStyle(SpanStyle(fontFeatureSettings = "tnum")) { append(time) } })',
                       'fun breakBlock() { append("Debug") }', 'builder.append("Debug").toString()',
                       'NotificationChannel("alarm_channel", name, importance)',
                       'NotificationChannel(id, name, importance).apply { setShowBadge(false); group = "family" }',
                       'Settings(id).apply { description = "debug" }',
                       'Modifier.semantics { testTag = "row" }',
                       'builder.addAction(action)']:
            file.write_text(source, encoding="utf-8")
            self.assertEqual(audit(root, []), [], source)

    def test_catalog_target_languages_reject_hangul_in_every_leaf(self):
        root = self.fixture(source="")
        for relative in (*CATALOGS, "apps/ios-native/AlarmTalk/InfoPlist.xcstrings"):
            file = root / relative
            original = file.read_text(encoding="utf-8")
            for language in LANGUAGES:
                for variation in [False, True]:
                    data = json.loads(original)
                    unit = {"stringUnit": {"state": "translated", "value": "Hello 안녕"}}
                    if variation:
                        unit = {"variations": {"plural": {"other": unit}}}
                    data["strings"]["안녕"]["localizations"][language] = unit
                    file.write_text(json.dumps(data), encoding="utf-8")
                    self.assertTrue(any(i.path == relative and i.reason.startswith(language)
                                        and "contains Hangul" in i.reason for i in catalog_issues(root)))
            file.write_text(original, encoding="utf-8")

    def test_android_translations_cannot_have_blank_leaves(self):
        root = self.fixture(source="")
        base = root / "apps/android-native/app/src/main/res"
        for tag, contents in [("string", "{value}"),
                              ("string-array", '<item>Hello</item><item>{value}</item>'),
                              ("plurals", '<item quantity="other">{value}</item>')]:
            for language in LANGUAGES:
                for value in ["", " \n\t ", r"\n\t", '""', '" "']:
                    xml = '<resources><' + tag + ' name="hello">' + contents + '</' + tag + '></resources>'
                    (base / "values/strings.xml").write_text(xml.format(value="Hello"), encoding="utf-8")
                    (base / f"values-{language}/strings.xml").write_text(xml.format(value=value), encoding="utf-8")
                    self.assertTrue(any(i.reason == f"Android {language} resource contains an empty translation"
                                        for i in catalog_issues(root)))
        # Documented English date units may be empty, but not missing or Korean.
        key = "editorp_fortune_unit_year"
        (base / "values/strings.xml").write_text(f'<resources><string name="{key}">년</string></resources>', encoding="utf-8")
        file = base / "values-en/strings.xml"
        file.write_text(f'<resources><string name="{key}"></string></resources>', encoding="utf-8")
        self.assertFalse(any("Android en" in i.reason for i in catalog_issues(root)))
        file.write_text('<resources/>', encoding="utf-8")
        self.assertTrue(any(i.reason == "Android en resource missing" for i in catalog_issues(root)))
        file.write_text(f'<resources><string name="{key}">년</string></resources>', encoding="utf-8")
        self.assertTrue(any(i.reason == "Android en resource contains Hangul" for i in catalog_issues(root)))

    def test_unaligned_marker_arrays_only_skip_the_length_check(self):
        root = self.fixture(source="")
        base = root / "apps/android-native/app/src/main/res"
        def write(language, name, items):
            xml = '<resources><string-array name="' + name + '">' + "".join("<item>" + item + "</item>" for item in items) + "</string-array></resources>"
            (base / ("values" + language) / "strings.xml").write_text(xml, encoding="utf-8")
        name = "snackbar_error_markers"
        write("", name, ["실패", "오류"])
        write("-ja", name, ["失敗", "エラー"])
        write("-en", name, ["failed", "error", "unable"])
        self.assertEqual(catalog_issues(root), [])
        for items in (["failed", "", "unable"], ["failed", " ", "unable"]):
            write("-en", name, items)
            self.assertTrue(any(i.reason == "Android en resource contains an empty translation" for i in catalog_issues(root)))
        write("-en", name, ["failed", "오류", "unable"])
        self.assertTrue(any(i.reason == "Android en resource contains Hangul" for i in catalog_issues(root)))
        for language in ("", "-ja"):
            write(language, "other_array", ["하나", "둘"])
        write("-en", "other_array", ["One", "Two", "Three"])
        self.assertTrue(any(i.reason == "resource type/array length differs" for i in catalog_issues(root)))
        # A key-level allowlist rule for a resource would hide all of the above.
        file = root / "allowlist.txt"
        file.write_text("data-contract\tapps/android-native/app/src/main/res/values-en/strings.xml\t\"" + name + "\"\treason\n", encoding="utf-8")
        with self.assertRaises(ValueError):
            read_allowlist(file)

    def test_language_gate_is_forbidden_even_with_no_korean_ui_literals(self):
        for source in ['var containsKorean = true', 'let range = 0xAC00...0xD7A3', 'let pattern = "[가-힣]"']:
            root = self.fixture(source=source)
            self.assertTrue(any("filter is forbidden" in issue.reason for issue in audit(root, [])))
        root = self.fixture()
        file = root / "apps/android-native/app/src/main/java/example/Errors.kt"
        file.parent.mkdir(parents=True)
        file.write_text('fun containsKorean(text: String) = text.any { it in \'가\'..\'힣\' }', encoding="utf-8")
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
            (root / CATALOGS[0]).write_text(json.dumps({"strings": {source: entry}}), encoding="utf-8")
            self.assertEqual(bool(format_issues(root)), fails, (source, translated))


if __name__ == "__main__":
    sys.exit(main())
