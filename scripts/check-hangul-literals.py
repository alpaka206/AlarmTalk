#!/usr/bin/env python3
"""Check UI localization without Xcode/Gradle (Python standard library only).

Swift is checked by literal context and a declaration index, not by searching
for Text() alone. Stored Korean values, generated data and TTS inputs require
documented exceptions. The baseline identifies reviewed contexts the index
cannot prove; removed entries fail, so it cannot silently become a dump.

Known limitations — what this static guard intentionally does not prove:
- It is not a type checker or data-flow analysis. A literal is UI copy when it
  reaches a display sink through call arguments, result branches (if/else,
  when, ternary, ??, ?:), value lambdas/closures, text builders, a direct
  `val/let` binding in the same block, or an app function/view whose String
  parameter it derives as displayed. Text that travels further (stored in a
  field, returned from a helper, passed through a collection, built across
  files) is not traced; review it by hand.
- Display sinks are a curated list of SwiftUI/Compose/notification APIs plus
  derived app wrappers. Parameter-name heuristics (`title:`, `text =`) apply at
  call sites only, never when deriving wrappers.
- Interpolation types come from declarations, not inference: unknown or
  conflicting types fail and need an explicit conversion (`Int(x)`).
- Catalog/resource checks compare structure (keys, plural/device branches,
  placeholders, line breaks, empty or copied values) — not translation quality,
  grammar, truncation on screen, or whether a sentence reads naturally.
- Runtime-only facts (the device's locale, AlarmKit or notification rendering,
  server-provided text) need tests on devices.
"""
from __future__ import annotations

import argparse
import bisect
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
from localization_swift_types import SwiftTypes, innermost_delimiters

ROOT = Path(__file__).resolve().parents[1]
LANGUAGES = ("en", "ja")
SWIFT_ROOTS = ("apps/ios-native/AlarmTalk", "apps/ios-native/AlarmTalkWidget", "apps/ios-native/Shared")
CATALOGS = ("apps/ios-native/AlarmTalk/Localizable.xcstrings", "apps/ios-native/AlarmTalkWidget/Localizable.xcstrings")
CATEGORIES = {"generated", "seed-data", "data-contract", "debug-preview", "log", "endonym", "tts-content", "not-rendered", "language-neutral"}
# SwiftUI views and modifiers whose first unlabeled String literal is a
# LocalizedStringKey (`NavigationLink("Settings", destination:)`, `.help("…")`).
SWIFT_UI = {"Text", "Button", "Label", "Toggle", "TextField", "SecureField", "Section", "Picker", "Link",
            "NavigationLink", "DisclosureGroup", "Menu", "ProgressView", "Stepper", "DatePicker", "MultiDatePicker",
            "ColorPicker", "ShareLink", "LabeledContent", "GroupBox", "ControlGroup", "ContentUnavailableView", "Tab",
            "navigationTitle", "navigationBarTitle", "navigationSubtitle", "alert", "confirmationDialog",
            "accessibilityLabel", "accessibilityHint", "accessibilityValue", "accessibilityRotor",
            "accessibilityCustomContent", "help", "badge"}
# Labeled LocalizedStringKey parameters of SwiftUI modifiers.
SWIFT_UI_LABELED = {("searchable", "prompt:"), ("accessibilityAction", "named:")}
LOCALIZED_TYPE = r"LocalizedString(?:Key|Resource)"
# English date pickers use bare numbers; Korean/Japanese append year/month/day.
# Only emptiness is exempted. Missing resources or copied Korean still fail.
EMPTY_ANDROID_UNITS = {("en", "editorp_fortune_unit_" + unit) for unit in ("year", "month", "day")}
# LandingScreen concatenates these fragments around the highlighted word. The
# English sentence moves the break to the prefix; compare the rendered whole.
ANDROID_LINE_BREAK_GROUPS = (("auth_landing_headline_pre", "auth_landing_headline_keyword", "auth_landing_headline_post"),)
# Resource and catalog checks are never allowlisted by key: a key-level rule
# would also hide empty, Hangul and format failures. Scope exceptions above.
RESOURCE_SUFFIXES = (".xml", ".xcstrings")
# Deliberately identical in every language (brand, endonyms, document names).
# Only these may opt out of translation (`shouldTranslate: false`,
# `translatable="false"`) or keep the same English and Japanese text; keys with
# no letters (punctuation, format-only) need no entry.
LANGUAGE_NEUTRAL_CATALOG_KEYS = {"AlarmTalk", "English", "日本語", "EULA", "CFBundleDisplayName", "CFBundleName"}
LANGUAGE_NEUTRAL_ANDROID_RESOURCES = {"app_name", "label_vibration_sos", "voices_lang_ko", "voices_lang_en", "voices_lang_ja"}
FORMAT_TOKEN = re.compile(r"%(?:\d+\$)?(?:#@\w+@|arg\b|[-+ #0,(<]*\d*(?:\.\d+)?(?:hh|h|ll|l|L|q|[tT])?[A-Za-z@%])")


def has_words(text: str) -> bool:
    """True if text has letters once format placeholders are removed."""
    return bool(re.search(r"[^\W\d_]", FORMAT_TOKEN.sub("", text)))


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


def statement_end(code: str, pairs: dict[int, int], start: int) -> int:
    """End of the Swift expression that starts at start: the first top-level
    line break whose next line does not continue it (`? "A"`, `: "B"`)."""
    i = start
    while i < len(code):
        if code[i] in "([{" and i in pairs:
            i = pairs[i] + 1
            continue
        if code[i] in ")]};":
            return i
        if code[i] == "\n":
            following = i + 1
            while following < len(code) and code[following].isspace():
                following += 1
            if not SWIFT_CONTINUATION.match(code, following):
                return i
            i = following
            continue
        i += 1
    return i


def result_groups(code: str, pairs: dict[int, int], start: int, end: int) -> list[int]:
    """Collection/tuple literals that are a result of the expression [start, end)
    — first in it or after a result token (`?`, `:`, `??`, `=`, `return`) —
    never a call's argument list."""
    found, i = [], start
    while i < end:
        if code[i] in "[(" and i in pairs:
            previous = i
            while previous > start and code[previous - 1].isspace():
                previous -= 1
            if previous == start or SWIFT_BINDING.before.search(code[max(0, previous - 16):previous]):
                found.append(i)
            i = pairs[i] + 1
            continue
        if code[i] == "{" and i in pairs:
            i = pairs[i] + 1
            continue
        i += 1
    return found


def split_top_level(text: str, separator: str, brackets: str = "([{") -> list[str]:
    """Split at separators outside nested brackets (types also nest `<>`)."""
    openers, closers = brackets, {"(": ")", "[": "]", "{": "}", "<": ">"}
    closing = "".join(closers[b] for b in openers)
    parts, depth, last, i = [], 0, 0, 0
    while i < len(text):
        if text.startswith("->", i):
            i += 2  # A function type arrow is not a closing `>`.
            continue
        char = text[i]
        if char in openers:
            depth += 1
        elif char in closing:
            depth -= 1
        elif char == separator and depth == 0:
            parts.append(text[last:i])
            last = i + 1
        i += 1
    parts.append(text[last:])
    return parts


def parse_type(text: str) -> tuple:
    """A declared type's shape: key, array, dict(key, value), tuple(...) or other."""
    text = text.strip()
    while text.endswith(("?", "!")):
        text = text[:-1].rstrip()
    if "->" in text:
        return ("other",)
    if re.fullmatch(LOCALIZED_TYPE, text):
        return ("key",)
    generic = re.fullmatch(r"(?:Swift\.)?(Array|ContiguousArray|Set|Dictionary)\s*<(.*)>", text, re.S)
    if generic:
        arguments = split_top_level(generic[2], ",", "([<")
        if generic[1] == "Dictionary":
            return ("dict", parse_type(arguments[0]), parse_type(arguments[1])) if len(arguments) == 2 else ("other",)
        return ("array", parse_type(arguments[0])) if len(arguments) == 1 else ("other",)
    if text.startswith("[") and text.endswith("]"):
        halves = split_top_level(text[1:-1], ":", "([<")
        return ("dict", parse_type(halves[0]), parse_type(halves[1])) if len(halves) == 2 else ("array", parse_type(text[1:-1]))
    if text.startswith("(") and text.endswith(")"):
        elements = [re.sub(r"^\s*\w+\s*:", "", element) for element in split_top_level(text[1:-1], ",", "([<")]
        return parse_type(elements[0]) if len(elements) == 1 else ("tuple", tuple(parse_type(e) for e in elements))
    return ("other",)


def holds_key(shape: tuple) -> bool:
    if shape[0] == "key":
        return True
    children = shape[1] if shape[0] == "tuple" else shape[1:]
    return any(holds_key(child) for child in children)


def read_type(code: str, start: int, stops: str) -> int:
    """End of a type annotation that begins at start."""
    depth, i = 0, start
    while i < len(code):
        if code.startswith("->", i):
            i += 2
            continue
        char = code[i]
        if char in "([<":
            depth += 1
        elif char in ")]>":
            if not depth:
                break
            depth -= 1
        elif not depth and char in stops:
            break
        i += 1
    return i


def key_element(source: str, literal: dict, value_start: int, shape: tuple) -> bool:
    """True if the literal is a direct element at a key-typed position of the
    collection/tuple value that starts at value_start, e.g. `["Settings"]`."""
    containers = [(kind, pos) for kind, pos in literal["stack"] if pos >= value_start]
    if not containers or containers[0][1] != value_start or any(kind not in "([" for kind, _ in containers):
        return False
    text = source[value_start:literal["start"]]
    code = code_only(text, SwiftLexer(text).run())
    for index, (kind, pos) in enumerate(containers):
        end = containers[index + 1][1] - value_start if index + 1 < len(containers) else len(code)
        elements = split_top_level(code[pos - value_start + 1:end], ",")
        element = elements[-1]
        if kind == "[" and shape[0] == "array":
            shape = shape[1]
        elif kind == "[" and shape[0] == "dict":
            halves = split_top_level(element, ":")
            shape, element = (shape[2], halves[1]) if len(halves) == 2 else (shape[1], element)
        elif kind == "(" and shape[0] == "tuple" and len(elements) <= len(shape[1]):
            shape, element = shape[1][len(elements) - 1], re.sub(r"^\s*\w+\s*:", "", element)
        else:
            return False
        if element.strip():
            return False  # The literal is only part of this element's expression.
    return shape == ("key",) and source[literal["end"]:].lstrip()[:1] in {",", "]", ")", ":"}


class Declarations:
    """File-scoped lookup wins for private types with the same name."""
    def __init__(self, sources: dict[str, str]):
        # Callable name -> external label -> declared type shapes of every
        # overload (functions, initializers, memberwise properties).
        self.labeled: dict[tuple[str, str], dict[str, set[tuple]]] = {}
        self.returns: dict[str, list[tuple[int, int]]] = {}
        # Overload signatures by position: the shape of each unlabeled (`_`)
        # parameter, None where the parameter needs a label.
        self.unlabeled: dict[tuple[str, str], list[list[tuple | None]]] = {}
        # Collection/tuple values holding a key: `[LocalizedStringKey]`,
        # `[String: LocalizedStringKey]`, `(LocalizedStringKey, Int)`.
        self.collection_values: dict[str, list[tuple[int, int, tuple]]] = {}
        for path, source in sources.items():
            literals = SwiftLexer(source, path).run()
            code = code_only(source, literals)
            pairs = delimiter_pairs(code)

            def collection_shape(start: int, stops: str) -> tuple[tuple | None, int]:
                end = read_type(code, start, stops)
                shape = parse_type(code[start:end])
                return (shape if shape[0] != "key" and holds_key(shape) else None), end

            def parameters(opening: int) -> tuple[dict[str, tuple], list[tuple | None]]:
                """Labeled parameter shapes and the positional signature of a list."""
                close, labels, positions, offset = pairs.get(opening, opening), {}, [], opening + 1
                for part in split_top_level(code[opening + 1:close], ","):
                    label = re.match(r"\s*(\w+)(?:\s+\w+)?\s*:\s*", part)
                    if label:
                        end = read_type(code, offset + label.end(), "=,")
                        shape = parse_type(code[offset + label.end():end])
                        positions.append(shape if label[1] == "_" else None)
                        if label[1] != "_":
                            labels[label[1]] = shape
                    offset += len(part) + 1
                return labels, positions

            def declare(name: str, opening: int) -> None:
                labels, positions = parameters(opening)
                table = self.labeled.setdefault((path, name), {})
                for label, shape in labels.items():
                    table.setdefault(label, set()).add(shape)
                self.unlabeled.setdefault((path, name), []).append(positions)

            spans = sorted(pairs.items())
            for match in re.finditer(r"\b(struct|class|extension)\s+(\w+)[^\n{]*\{", code):
                start = match.end() - 1
                end = pairs.get(start, start)
                # Initializers declared in the body (or an extension) are the
                # type's callables; `init(heading: LocalizedStringKey)` makes
                # `Row(heading: "Settings")` a lookup.
                inits = list(re.finditer(r"\binit[?!]?\s*(?:<[^>]*>)?\s*\(", code[start:end]))
                owner = innermost_delimiters(spans, [start + init.start() for init in inits])
                inits = [init for init in inits if owner[start + init.start()] == start]
                for init in inits:
                    declare(match[2], start + init.end() - 1)
                if match[1] == "extension" or inits:
                    continue
                # Otherwise the memberwise initializer: stored properties declared
                # directly in the body (not a method's local `let title`).
                members = list(re.finditer(r"\b(?:let|var)\s+(\w+)\s*:\s*", code[start:end]))
                owner = innermost_delimiters(spans, [start + member.start() for member in members])
                table = self.labeled.setdefault((path, match[2]), {})
                for member in members:
                    if owner[start + member.start()] == start:
                        type_end = read_type(code, start + member.end(), "={}\n;,")
                        table.setdefault(member[1], set()).add(parse_type(code[start + member.end():type_end]))
            for match in re.finditer(r"\bfunc\s+(\w+)\s*(?:<[^>]*>)?\s*\(", code):
                declare(match[1], match.end() - 1)
            values = []
            for match in re.finditer(r"\b(?:let|var)\s+\w+\s*:\s*|->\s*", code):
                shape, end = collection_shape(match.end(), "={}\n;,")
                if not shape:
                    continue
                following = end
                while following < len(code) and code[following] in " \t":
                    following += 1
                if code.startswith("=", following) and not code.startswith("==", following):
                    starts = [following + 1]
                elif code.startswith("{", following) and following in pairs:
                    body = code[following:pairs[following]]
                    starts = [following + 1] + [following + m.end() for m in re.finditer(r"\breturn\b", body)]
                else:
                    continue
                for value in starts:
                    while value < len(code) and code[value].isspace():
                        value += 1
                    # Every result of the expression: `["A"]`, `flag ? ["A"] : ["B"]`, `x ?? ["A"]`.
                    for group in result_groups(code, pairs, value, statement_end(code, pairs, value)):
                        values.append((group, pairs[group] + 1, shape))
            self.collection_values[path] = values
            spans = []
            pattern = r"(?:\b(?:var|let)\s+\w+\s*:\s*" + LOCALIZED_TYPE + r"\??|->\s*" + LOCALIZED_TYPE + r")\s*"
            for match in re.finditer(pattern, code):
                pos = match.end()
                if pos < len(code) and code[pos] == "{":
                    spans.append((pos, pairs.get(pos, pos)))
                elif pos < len(code) and code[pos] == "=":
                    spans.append((pos, statement_end(code, pairs, pos + 1)))
            self.returns[path] = spans

    def label_shapes(self, path: str, call: str, label: str) -> set[tuple]:
        declared = [key for key in self.labeled if key[1] == call]
        if (path, call) in declared:
            declared = [(path, call)]
        return set().union(*(self.labeled[key].get(label, set()) for key in declared))

    def unlabeled_shape(self, path: str, call: str, index: int) -> tuple | None:
        """The agreed shape of an unlabeled argument at index, across overloads."""
        declared = [key for key in self.unlabeled if key[1] == call]
        if (path, call) in declared:
            declared = [(path, call)]
        shapes = {signature[index] for key in declared for signature in self.unlabeled[key]
                  if index < len(signature) and signature[index] is not None}
        return next(iter(shapes)) if len(shapes) == 1 else None

    def collection_shape(self, path: str, call: str, argument: str) -> tuple | None:
        shapes = self.label_shapes(path, call, argument)
        shape = next(iter(shapes)) if len(shapes) == 1 else None
        return shape if shape and shape[0] != "key" and holds_key(shape) else None

    def collection_element(self, path: str, source: str, literal: dict) -> bool:
        """A literal element of a value typed `[LocalizedStringKey]` and the like."""
        for start, end, shape in self.collection_values.get(path, ()):
            if start <= literal["start"] < end and key_element(source, literal, start, shape):
                return True
        frames = literal["stack"]
        for index in range(len(frames) - 1, -1, -1):
            kind, opening = frames[index]
            call = call_at(source, opening) if kind == "(" else ""
            if not call or not (call[-1].isalnum() or call[-1] == "_"):
                continue  # A tuple or collection, not the call that receives the value.
            if index + 1 == len(frames):
                return False  # A direct scalar argument; the scalar rules apply.
            value_start = frames[index + 1][1]
            prefix = argument_prefix(source, {"start": value_start}, opening)
            label = re.fullmatch(r"(\w+)\s*:", prefix)
            if label:
                shape = self.collection_shape(path, call.split(".")[-1], label[1])
            else:
                shape = not prefix and self.unlabeled_shape(path, call.split(".")[-1], argument_index(source, opening, value_start))
            return bool(shape) and key_element(source, literal, value_start, shape)
        return False

    def accepts(self, path: str, call: str, argument: str) -> bool:
        # Every overload that takes this label must agree; a String overload
        # cannot certify a call.
        return self.label_shapes(path, call, argument) == {("key",)}


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


def argument_index(source: str, opening: int, position: int) -> int:
    """Index of the call argument that contains position."""
    fragment = source[opening + 1:position]
    return len(split_top_level(code_only(fragment, SwiftLexer(fragment).run()), ",")) - 1


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
        if (call == "localizedString" and prefix == "forKey:") or (call == "NSLocalizedString" and prefix == ""):
            return True, None
        if call in {"localizedString", "NSLocalizedString"} and prefix in {"value:", "comment:", "tableName:"}:
            return False, "comment"  # Fallback text, translator note or table name; not a key.
        if call in {"String", "LocalizedStringKey", "LocalizedStringResource"} and prefix == "comment:":
            return False, "comment"
        if call in {"LocalizedStringKey", "LocalizedStringResource"} and prefix in {"", "stringLiteral:", "defaultValue:"}:
            return True, "default" if prefix == "defaultValue:" else None
        if call == "LocalizationValue" and prefix in {"", "stringLiteral:"}:
            return True, None  # `String.LocalizationValue("key")` is looked up by String(localized:).
        # A ternary or ?? at an overloaded SwiftUI call often produces String.
        # Only a lone first argument is certified here.
        if (call in SWIFT_UI and prefix == "") or (call, prefix) in SWIFT_UI_LABELED:
            tail = source[literal["end"]:].lstrip()
            return tail.startswith((",", ")")), None
        argument = re.match(r"(\w+)\s*:", prefix)
        if argument and prefix.endswith((":", "?")) and declarations.accepts(path, call, argument[1]):
            return True, None
        if (prefix == "" and source[literal["end"]:].lstrip().startswith((",", ")"))
                and declarations.unlabeled_shape(path, call, argument_index(source, opening, literal["start"])) == ("key",)):
            return True, None  # `func row(_ title: LocalizedStringKey)` called as `row("Settings")`.
    if declarations.collection_element(path, source, literal):
        return True, None
    for start, end in declarations.returns.get(path, []):
        if start < literal["start"] < end:
            if stack and stack[-1][1] > start:
                # An inner String helper does not inherit its caller's return type.
                continue
            previous = source[max(start, source.rfind("\n", start, literal["start"]) + 1):literal["start"]].strip()
            # The whole value or a result branch (`flag ? "A" : "B"`, `x ?? "A"`,
            # `case .a: "A"`); not an operand such as `x == "a"`.
            if previous in {"{", "="} or re.search(r"(?:^|\W)return$", previous) or previous.endswith(("?", ":")):
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


# Closures whose result is the call's value (`value.map { _ in "On" } ?? …`).
SWIFT_VALUE_CLOSURES = {"map", "flatMap", "compactMap"}
# A line starting with one of these continues the previous expression.
SWIFT_CONTINUATION = re.compile(r"\?\?|[?:.]|&&|\|\||[-+*/%]|[=!]=|[<>]=?|else\b|as\b|is\b")


def mark_literals(code: str, literals: list[dict]) -> str:
    """`code_only` output with literals as visible placeholders, not spaces,
    so line analysis does not read `x = "…"` as a line ending in `=`."""
    out = list(code)
    for literal in literals:
        out[literal["start"]:literal["end"]] = '"' * (literal["end"] - literal["start"])
    return "".join(out)


def swift_closure_value(marked: str, opening: int, literal: dict) -> bool:
    """True if the literal is the result of a value-producing closure.

    Single-expression closures return their expression; otherwise only a
    `return` statement does. Callbacks (Button actions, onTapGesture) are not
    value closures and stop the display-context search.
    """
    depth, close = 0, None
    for i in range(opening, len(marked)):
        if marked[i] in "([{":
            depth += 1
        elif marked[i] in ")]}":
            depth -= 1
            if not depth:
                close = i
                break
    if close is None:
        return False
    callee = call_at(marked, opening)
    end = opening
    while end > 0 and marked[end - 1].isspace():
        end -= 1
    if not callee and end and marked[end - 1] == "(":
        callee = call_at(marked, end - 1)  # `value.map({ … })`
    if callee.split(".")[-1] not in SWIFT_VALUE_CLOSURES and not marked.startswith("(", close + 1):
        return False  # Neither a value closure nor an immediately invoked one.
    body = opening + 1
    header = re.match(r"\s*(?!(?:for|if|guard|switch|while|let|var|return)\b)(?:\[[^\]\n]*\]\s*)?(?:\([^)\n]*\)|[\w\s,]*?)\s*\bin\b",
                      marked[body:close])
    if header:
        body += header.end()

    def next_code(i):
        while i < close and marked[i].isspace():
            i += 1
        return i

    starts, depth, i = [next_code(body)], 0, next_code(body)
    while i < close:
        char = marked[i]
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
        elif not depth and char in "\n;":
            following = next_code(i + 1)
            if following < close and (char == ";" or not SWIFT_CONTINUATION.match(marked, following)):
                starts.append(following)
            i = following
            continue
        i += 1
    own = max(start for start in starts if start <= literal["start"])
    return bool(re.match(r"return\b", marked[own:])) or len(starts) == 1


SWIFT_DISPLAY_PARAMETERS = {"title", "text", "message", "label", "subtitle", "placeholder", "accessibilityLabel", "accessibilityHint"}


def swift_ui_context(source: str, code: str, literal: dict, marked: str | None = None,
                     wrappers: dict[str, list[list[tuple[str, bool]]]] | None = None,
                     tree: "KotlinTree | None" = None, depth: int = 0, strict: bool = False) -> bool:
    """Plain String display arguments need lookup regardless of source language.

    `strict` drops the parameter-name heuristic (`text:`, `title:` on any call):
    wrapper inference must not turn `computeCacheKey(text:)` into a view.
    """
    through = False
    for kind, opening in reversed(literal["stack"]):
        if kind == "{":
            if marked is not None and swift_closure_value(marked, opening, literal):
                continue  # The closure's result is the enclosing argument.
            break  # A UI callback's body is a separate context (e.g. a log).
        if kind != "(":
            through = through or kind == "["
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
        if parameter in SWIFT_DISPLAY_PARAMETERS and not strict:
            return True
        if wrappers and call in wrappers:
            # App views/functions whose plain-String parameter reaches a sink.
            index = None if parameter else argument_index(code, opening, literal["start"])
            if any(any(label == (parameter or "_") and shown for label, shown in
                       (overload if parameter else overload[index:index + 1]))
                   for overload in wrappers[call]):
                return True
        through = True  # Past a call, the token is an argument, not the value.
    if through or marked is None or tree is None or depth >= 3:
        return False
    # A result of `let title = …` is shown wherever `title` is shown.
    return any(swift_ui_context(source, code, {"start": use, "end": use, "stack": [(code[o], o) for o in tree.enclosing(use)]},
                                marked, wrappers, tree, depth + 1, strict)
               for use in binding_uses(marked, tree, literal["start"], SWIFT_BINDING))


SWIFT_TEXT_TYPE = re.compile(r"(?:String|Substring)[?!]?")


def swift_wrappers(files: dict[str, tuple[str, str, str, "KotlinTree"]]) -> dict[str, list[list[tuple[str, bool]]]]:
    """App views and functions whose plain-String parameters reach a display sink.

    Like `kotlin_wrappers`: a stored property shown in the type's body makes its
    memberwise label a sink (`PromptDetailCard(value: "…")`); an initializer or
    function parameter is a sink when its body shows it or stores it in such a
    property (`self.value = value`). Resolved to a fixed point.
    """
    names = []  # (path, name, [(label, internal, is_text)], span, owner)
    properties = {}  # (path, type) -> {name: (span, is_text)}
    for path, (source, code, marked, tree) in files.items():
        spans = sorted(tree.pairs.items())

        def parameters(opening):
            result, close = [], tree.pairs.get(opening, opening)
            for part in split_top_level(code[opening + 1:close], ","):
                match = re.match(r"\s*(\w+)(?:\s+(\w+))?\s*:\s*(?:@\w+\s+)*(?:inout\s+)?([^=]+)", part)
                if match:
                    result.append((match[1], match[2] or match[1], bool(SWIFT_TEXT_TYPE.fullmatch(match[3].strip()))))
            return result

        def body(close):
            match = re.compile(r"[^{};=]*?\{").match(code, close + 1)
            return (match.end() - 1, tree.pairs.get(match.end() - 1)) if match else None

        for match in re.finditer(r"\b(struct|class|extension)\s+(\w+)[^\n{]*\{", code):
            start = match.end() - 1
            end = tree.pairs.get(start, start)
            members = list(re.finditer(r"\b(?:let|var)\s+(\w+)\s*:\s*([^=\n{};,)]+)", code[start:end]))
            inits = list(re.finditer(r"\binit[?!]?\s*(?:<[^>]*>)?\s*\(", code[start:end]))
            owner = innermost_delimiters(spans, [start + m.start() for m in members + inits])
            table = properties.setdefault((path, match[2]), {})
            ordered = []
            for member in members:
                if owner[start + member.start()] == start and not code.startswith("{", read_type(code, start + member.end(), "={}\n;,")):
                    table[member[1]] = ((start, end), bool(SWIFT_TEXT_TYPE.fullmatch(member[2].strip())))
                    ordered.append((member[1], member[1], table[member[1]][1]))
            own_inits = [init for init in inits if owner[start + init.start()] == start]
            for init in own_inits:
                opening = start + init.end() - 1
                span = body(tree.pairs.get(opening, opening))
                if span and span[1]:
                    names.append((path, match[2], parameters(opening), span, (path, match[2])))
            if match[1] == "struct" and not own_inits:
                names.append((path, match[2], ordered, None, (path, match[2])))  # memberwise
        for match in re.finditer(r"\bfunc\s+(\w+)\s*(?:<[^>]*>)?\s*\(", code):
            opening = match.end() - 1
            span = body(tree.pairs.get(opening, opening))
            if span and span[1]:
                names.append((path, match[1], parameters(opening), span, None))
    shown_properties: set[tuple] = set()
    shown: dict[int, set[str]] = {}
    wrappers: dict[str, list[list[tuple[str, bool]]]] = {}

    def uses(path, name, span):
        source, code, marked, tree = files[path]
        pattern = re.compile(r"(?:(?<=self\.)|(?<![\w.$]))" + re.escape(name) + r"\b(?!\s*=(?!=))(?!:)")
        return any(swift_ui_context(source, code, {"start": use.start(), "end": use.end(),
                                                    "stack": [(code[o], o) for o in tree.enclosing(use.start())]},
                                    marked, wrappers, tree, strict=True)
                   for use in pattern.finditer(code, span[0], span[1]))

    changed = True
    while changed:
        changed = False
        for (path, owner), table in properties.items():
            for name, (span, text) in table.items():
                if text and (path, owner, name) not in shown_properties and uses(path, name, span):
                    shown_properties.add((path, owner, name))
                    changed = True
        for index, (path, name, params, span, owner) in enumerate(names):
            found = shown.setdefault(index, set())
            code = files[path][1]
            for label, internal, text in params:
                if not text or internal in found:
                    continue
                if span is None:
                    hit = (path, name, internal) in shown_properties
                else:
                    stored = owner and any((path, owner[1], m[1]) in shown_properties for m in re.finditer(
                        r"\bself\.(\w+)\s*=\s*" + re.escape(internal) + r"\b", code[span[0]:span[1]]))
                    hit = bool(stored) or uses(path, internal, span)
                if hit:
                    found.add(internal)
                    changed = True
        wrappers = {}
        for index, (path, name, params, span, owner) in enumerate(names):
            wrappers.setdefault(name, []).append([(label, internal in shown.get(index, set())) for label, internal, _ in params])
        wrappers = {name: overloads for name, overloads in wrappers.items() if any(shown for o in overloads for _, shown in o)}
    return wrappers


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
    """An exception names a path and literal. Callers apply it only to
    occurrences that are not localization lookups: a stored contract value
    (`"남성"`) may also appear in `String(localized:)`, and that lookup must
    still find its catalog key. A `*` rule covers the file's literals only;
    the language gate needs its own explicit `language-gate` entry."""
    return any(fnmatch.fnmatchcase(path, pattern) and (literal == value or (literal == "*" and value != "language-gate"))
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


def has_plural_variation(node) -> bool:
    if isinstance(node, dict):
        return any((key == "variations" and isinstance(child, dict) and "plural" in child) or has_plural_variation(child)
                   for key, child in node.items())
    return isinstance(node, list) and any(has_plural_variation(child) for child in node)


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


def empty_variation_branch(node) -> bool:
    """A declared variation, category or substitution with no translated leaf.

    Leaves alone cannot show this: `"other": {}` next to a valid top-level unit
    has nothing to yield, yet that category renders nothing at runtime.
    """
    if isinstance(node, dict):
        for key, child in node.items():
            if key == "variations":
                if not isinstance(child, dict) or not child or any(
                        not isinstance(branches, dict) or not branches
                        or any(not list(string_units(branch)) for branch in branches.values())
                        for branches in child.values()):
                    return True
            elif key == "substitutions":
                if not isinstance(child, dict) or not child or any(
                        not isinstance(meta, dict) or not isinstance(meta.get("variations"), dict)
                        for meta in child.values()):
                    return True
            if empty_variation_branch(child):
                return True
    elif isinstance(node, list):
        return any(empty_variation_branch(child) for child in node)
    return False


def device_fallback_missing(node) -> bool:
    """A device variation without `other`: other devices get no usable branch."""
    if isinstance(node, dict):
        for key, child in node.items():
            if key == "variations" and isinstance(child, dict) and isinstance(child.get("device"), dict) \
                    and "other" not in child["device"]:
                return True
            if device_fallback_missing(child):
                return True
    elif isinstance(node, list):
        return any(device_fallback_missing(child) for child in node)
    return False


def device_categories(node) -> set[str]:
    """Device names declared anywhere under a localization (`iphone`, `other`, …)."""
    found = set()
    if isinstance(node, dict):
        for key, child in node.items():
            if key == "variations" and isinstance(child, dict) and isinstance(child.get("device"), dict):
                found |= set(child["device"])
            found |= device_categories(child)
    elif isinstance(node, list):
        for child in node:
            found |= device_categories(child)
    return found


def leaf_values(node) -> list[str]:
    return [leaf["value"] for leaf in string_units(node) if isinstance(leaf.get("value"), str)]


def translated_leaves(node) -> bool:
    leaves = list(string_units(node))
    return bool(leaves) and not empty_variation_branch(node) and all(
        leaf.get("state") == "translated" and isinstance(leaf.get("value"), str) and leaf["value"].strip()
        for leaf in leaves)


def catalog_issues(root: Path) -> list[Issue]:
    issues = []
    for relative in (*CATALOGS, "apps/ios-native/AlarmTalk/InfoPlist.xcstrings"):
        data = json.loads((root / relative).read_text(encoding="utf-8"))
        for key, entry in data["strings"].items():
            if not entry.get("shouldTranslate", True):
                # Not an escape hatch: an opted-out key shows its source text in
                # every language, so only language-neutral keys may opt out.
                if has_words(key) and key not in LANGUAGE_NEUTRAL_CATALOG_KEYS:
                    issues.append(Issue(relative, 0, key, "shouldTranslate=false is only for language-neutral keys"))
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
                # A plain leaf is the `other` sentence for every count. That is
                # only equivalent where `other` is the sole category.
                if (language != "ko" and PLURAL_CATEGORIES[language] != {"other"} and units
                        and has_plural_variation(localizations.get("ko", {})) and not has_plural_variation(units)):
                    issues.append(Issue(relative, 0, key, f"{language} must vary by plural like the Korean source"))
                if language in LANGUAGES and any(HANGUL.search(str(leaf.get("value", ""))) for leaf in leaves):
                    issues.append(Issue(relative, 0, key, f"{language} translation contains Hangul"))
                if device_fallback_missing(units):
                    issues.append(Issue(relative, 0, key, f"{language} device variations need an other fallback"))
                # Without the source's device branch, that device gets the
                # generic fallback instead of its own sentence.
                missing = device_categories(localizations.get("ko", {})) - device_categories(units) if language != "ko" else set()
                if units and missing:
                    issues.append(Issue(relative, 0, key, f"{language} device variations missing: {', '.join(sorted(missing))}"))
            # A Japanese leaf equal to the English one (or to an English source
            # key) was copied, not translated; Hangul copies are caught above.
            english = set(leaf_values(localizations.get("en", {}))) | ({key} if not HANGUL.search(key) else set())
            if key not in LANGUAGE_NEUTRAL_CATALOG_KEYS and any(
                    has_words(value) and value in english for value in leaf_values(localizations.get("ja", {}))):
                issues.append(Issue(relative, 0, key, "ja translation is copied from English"))
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
            if key not in LANGUAGE_NEUTRAL_ANDROID_RESOURCES and has_words("".join(entry.itertext())):
                issues.append(Issue(relative, 0, key, 'translatable="false" is only for language-neutral resources'))
            continue
        # The Korean default resource is what Korean users see; it cannot be blank either.
        sources = [entry] if entry.tag == "string" else list(entry)
        if not sources or any(android_text_is_blank("".join(leaf.itertext())) for leaf in sources):
            issues.append(Issue(relative, 0, key, "Android ko resource contains an empty value"))
        if entry.tag == "plurals" and not PLURAL_CATEGORIES["ko"] <= {item.get("quantity") for item in entry}:
            issues.append(Issue(relative, 0, key, "Android ko required plural quantities missing"))
        for language in LANGUAGES:
            match = localized[language].get(key)
            if match is None:
                issues.append(Issue(relative, 0, key, f"Android {language} resource missing"))
                continue
            other, target = match
            if entry.tag != other.tag or (entry.tag == "string-array" and len(entry) != len(other)):
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
        if key not in LANGUAGE_NEUTRAL_ANDROID_RESOURCES and all(key in localized[language] for language in LANGUAGES):
            def texts(element):
                return {"".join(leaf.itertext()) for leaf in ([element] if element.tag == "string" else element)}
            english, japanese = texts(localized["en"][key][0]), texts(localized["ja"][key][0])
            if any(has_words(text) for text in english & japanese):
                issues.append(Issue(localized["ja"][key][1], 0, key, "Android ja resource is copied from English"))
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
# Lambdas whose last expression is the call's value (`Text(remember { "…" })`).
# Callbacks (onClick, LaunchedEffect, apply/also) are statements and stop here.
KOTLIN_VALUE_LAMBDAS = {"remember", "rememberSaveable", "derivedStateOf", "run", "let", "with",
                        "getOrElse", "ifEmpty", "ifBlank"}
# A lambda passed inside the parentheses is the same lambda when it is named
# by one of these (`remember(key, calculation = { … })`); other named lambdas
# (`onClick = { … }`) are callbacks.
KOTLIN_LAMBDA_VALUE_PARAMETERS = {"calculation", "init", "block", "defaultValue", "builder"}
# A line starting with one of these continues the previous expression.
# Inside a `when` body `else`/`in`/`is` start a new branch; only operators
# (and an if-expression's `else` without `->`) continue the previous line.
KOTLIN_WHEN_CONTINUATION = re.compile(r"\?[.:]|\.|&&|\|\||[-+*/%]|[=!]=|[<>]=?|as\b|else\b(?!\s*->)")
KOTLIN_CONTINUATION = re.compile(r"else\b|\?[.:]|\.|&&|\|\||[-+*/%]|[=!]=|[<>]=?|as\b|!?is\b|!?in\b")
# Assignment sinks in small receiver lambdas.
KOTLIN_SEMANTICS_BLOCKS = {"semantics", "clearAndSetSemantics"}
KOTLIN_SEMANTICS_PROPERTIES = {"contentDescription", "stateDescription", "paneTitle"}
KOTLIN_CHANNELS = {"NotificationChannel", "NotificationChannelGroup"}
KOTLIN_CHANNEL_PROPERTIES = {"name", "description"}


class KotlinTree:
    """Delimiter nesting of masked Kotlin code for fast enclosing lookups."""
    def __init__(self, code: str):
        self.pairs = delimiter_pairs(code)
        self.closers = {end: opening for opening, end in self.pairs.items()}
        self.openers = sorted(self.pairs)
        self.parent, stack = {}, []
        for opening in self.openers:
            while stack and self.pairs[stack[-1]] < opening:
                stack.pop()
            self.parent[opening] = stack[-1] if stack else None
            stack.append(opening)

    def enclosing(self, position: int) -> list[int]:
        """Openers containing position, outermost first."""
        index = bisect.bisect_left(self.openers, position) - 1
        opening = self.openers[index] if index >= 0 else None
        while opening is not None and self.pairs[opening] < position:
            opening = self.parent[opening]
        chain = []
        while opening is not None:
            chain.append(opening)
            opening = self.parent[opening]
        return chain[::-1]


class BindingRules:
    """How a language binds a name to an expression and continues lines."""
    def __init__(self, head: str, before: str, after: str, continuation: re.Pattern, conditions: set[str]):
        self.head = re.compile(head)            # `val name =` / `let name =`
        self.before = re.compile(before)        # token before a result of the expression
        self.after = re.compile(after)          # token after a result of the expression
        self.continuation = continuation        # a next line that continues the expression
        self.conditions = conditions            # `if (…)` before a branch result


def token_end(code: str, start: int) -> int:
    """End of the masked literal or identifier at start."""
    end = start
    if code[start] in "\"'":
        while end < len(code) and code[end] == code[start]:
            end += 1
        return end
    while end < len(code) and (code[end].isalnum() or code[end] == "_"):
        end += 1
    return end


def binding_uses(code: str, tree: "KotlinTree", start: int, rules: BindingRules) -> list[int]:
    """Uses of a name whose initializer has the token at start as a result.

    `val title = "Try again"`, `val title = if (on) "On" else "Off"`,
    `let title = flag ? "A" : "B"`, `x ?: "Guest"`: the token is a result when
    it stands alone between result tokens, never an operand (`a == "b"`,
    `"a" + b`). Callers only ask after the token passed no call or collection.
    Uses are the name's later occurrences in the binding's block (or file).
    """
    end = token_end(code, start)
    previous = start
    while previous > 0 and code[previous - 1].isspace():
        previous -= 1
    condition = previous and code[previous - 1] == ")" and previous - 1 in tree.closers and \
        call_at(code, tree.closers[previous - 1]) in rules.conditions
    if not rules.after.match(code, end) or not (condition or rules.before.search(code[max(0, previous - 16):previous])):
        return []
    window = max(0, start - 2000)
    heads = [match for match in rules.head.finditer(code, window, start)]
    if not heads:
        return []
    binding = heads[-1]
    depth, i = 0, binding.end()
    while i < start:
        char = code[i]
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
            if depth < 0:
                return []  # The binding's block closed before the token.
        elif not depth and char in "\n;":
            previous = i
            while previous > binding.end() and code[previous - 1].isspace():
                previous -= 1
            following = i + 1
            while following < start and code[following].isspace():
                following += 1
            joined = code.endswith(("=", "(", ",", ".", "+", "-", "*", "/", "&&", "||", "?", ":", "->", "else"), 0, previous) \
                or (previous and code[previous - 1] == ")" and previous - 1 in tree.closers
                    and call_at(code, tree.closers[previous - 1]) in rules.conditions)
            if char == ";" or not (joined or rules.continuation.match(code, following) or following >= start):
                return []
        i += 1
    if re.search(r"(?:\b(?:if|guard|while|case|for)\s*|,\s*)$", code[max(0, binding.start() - 12):binding.start()]):
        return []  # `if let x = …` binds inside a condition, not a value.
    braces = [opening for opening in tree.enclosing(binding.start()) if code[opening] == "{"]
    limit = tree.pairs[braces[-1]] if braces else len(code)
    use = re.compile(r"(?:(?<=self\.)|(?<![\w.$]))" + re.escape(binding[1]) + r"\b(?!\s*=(?!=))(?!:)")
    return [match.start() for match in use.finditer(code, end, limit)]


KOTLIN_BINDING = BindingRules(
    r"\b(?:val|var)\s+(\w+)\s*(?::\s*[^=\n]+?)?\s*=(?!=)",
    r"(?:(?<![=!<>])=|\belse|->|\?:|\{)$",
    r"[ \t]*(?:$|[\n;})]|else\b|\?:)",
    re.compile(r"else\b|\?[.:]|\.|&&|\|\||[-+*/%]|[=!]=|[<>]=?|as\b|!?is\b|!?in\b"),
    {"if", "while", "for"})
SWIFT_BINDING = BindingRules(
    r"\b(?:let|var)\s+(\w+)\s*(?::\s*[^=\n]+?)?\s*=(?!=)",
    r"(?:(?<![=!<>])=|(?<![?.])\?|(?<!:):|\?\?|\breturn|\bin|\belse|\{)$",
    r"[ \t]*(?:$|[\n;})]|:|\?\?)",
    re.compile(r"\?\?|[?:.]|&&|\|\||[-+*/%]|[=!]=|[<>]=?|else\b|as\b|is\b"),
    set())


KOTLIN_TEXT_TYPE = re.compile(r"(?:String|CharSequence|AnnotatedString)\??")


def kotlin_expression_end(code: str, tree: KotlinTree, start: int) -> int:
    """End of an expression body: the first top-level newline not continued."""
    i = start
    while i < len(code) and code[i].isspace():
        i += 1
    while i < len(code):
        if code[i] in "([{" and i in tree.pairs:
            i = tree.pairs[i] + 1
            continue
        if code[i] in ")]}" or code[i] == ";":
            return i
        if code[i] == "\n":
            following = i + 1
            while following < len(code) and code[following].isspace():
                following += 1
            if not KOTLIN_CONTINUATION.match(code, following):
                return i
            i = following
            continue
        i += 1
    return i


def kotlin_wrappers(files: dict[str, tuple[str, KotlinTree]]) -> dict[str, dict]:
    """App functions whose String parameters reach a display sink.

    `fun WakerSheetOptionRow(title: String, description: String?)` that passes
    `description` to `Text` makes `description = "…"` at its call sites a sink.
    Wrappers of wrappers resolve by iterating to a fixed point.
    """
    declarations = []
    for path, (code, tree) in files.items():
        for match in re.finditer(r"\bfun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?(\w+)\s*\(", code):
            opening = match.end() - 1
            close = tree.pairs.get(opening)
            if close is None:
                continue
            order, texts = [], []
            for part in split_top_level(code[opening + 1:close], ","):
                parameter = re.match(r"\s*(?:@[\w.]+(?:\([^)]*\))?\s*)*(?:(?:vararg|noinline|crossinline)\s+)?(\w+)\s*:\s*([^=]+)", part)
                if parameter:
                    order.append(parameter[1])
                    if KOTLIN_TEXT_TYPE.fullmatch(parameter[2].strip()):
                        texts.append(parameter[1])
            body = re.compile(r"\s*(?::\s*[^{=]+?)?\s*([{=])").match(code, close + 1)
            if not texts or not body:
                continue
            start = body.start(1)
            if body[1] == "{" and start in tree.pairs:
                declarations.append((path, match[1], order, texts, start, tree.pairs[start]))
            elif body[1] == "=" and not code.startswith("==", start):
                # `fun Card(title: String) = Text(title)`: the expression runs to
                # the next top-level line that does not continue it.
                declarations.append((path, match[1], order, texts, start, kotlin_expression_end(code, tree, start + 1)))
    wrappers = {}
    for _, name, order, _, _, _ in declarations:
        wrappers.setdefault(name, {"display": set(), "orders": []})["orders"].append(order)
    changed = True
    while changed:
        changed = False
        for path, name, _, texts, start, end in declarations:
            code, tree = files[path]
            for parameter in texts:
                if parameter in wrappers[name]["display"]:
                    continue
                # A use, not a named-argument label (`title = …`) or a declaration.
                use = re.compile(r"(?<![\w.$])" + re.escape(parameter) + r"\b(?!\s*=(?!=))(?!\s*:)")
                if any(kotlin_ui_context(code, occurrence.start(), tree.pairs, tree.closers, wrappers, tree, strict=True)
                       for occurrence in use.finditer(code, start, end)):
                    wrappers[name]["display"].add(parameter)
                    changed = True
    return {name: info for name, info in wrappers.items() if info["display"]}


def kotlin_ui_context(code: str, start: int, pairs: dict[int, int], closers: dict[int, int] | None = None,
                      wrappers: dict[str, dict] | None = None, tree: KotlinTree | None = None, depth: int = 0,
                      strict: bool = False) -> bool:
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

    def keyword_before(end, word):
        return code.endswith(word, 0, end) and (end == len(word) or not (code[end - len(word) - 1].isalnum()
                                                                         or code[end - len(word) - 1] == "_"))

    def expression_branch(opening):
        # Look back only over the token before the brace, not the whole file.
        end = before(opening)
        if code.endswith("->", 0, end) or keyword_before(end, "else"):
            return True
        if end and code[end - 1] == ")":
            condition = closers.get(end - 1)
            return condition is not None and call_at(code, condition) == "if"
        return False

    def when_body(opening):
        end = before(opening)
        if keyword_before(end, "when"):
            return True
        return bool(end) and code[end - 1] == ")" and end - 1 in closers and call_at(code, closers[end - 1]) == "when"

    def when_branch_value(opening):
        """True after a branch's `->`; a literal before it is a compared condition."""
        depth, value, i = 0, False, opening + 1
        while i < start:
            char = code[i]
            if char in "([{":
                depth += 1
            elif char in ")]}":
                depth -= 1
            elif depth == 0 and code.startswith("->", i):
                value, i = True, i + 2
                continue
            elif depth == 0 and char in "\n;":
                previous = before(i)
                following = i + 1
                while following < start and code[following].isspace():
                    following += 1
                joined = code.endswith("->", 0, previous) or (previous and code[previous - 1] in ",=(")
                if char == ";" or not (joined or (following < start and KOTLIN_WHEN_CONTINUATION.match(code, following))):
                    value = False
            i += 1
        return value

    def lambda_call(opening, outer=None):
        """The call a lambda belongs to: `withStyle(style) {` -> withStyle,
        `channel.apply {` -> channel.apply, and inside parentheses
        `remember(key, calculation = { … })` -> remember (with its label)."""
        end = before(opening)
        if end and code[end - 1] == ")" and end - 1 in closers:
            return call_at(code, closers[end - 1]), None
        if outer is not None and code[outer] == "(" and end and code[end - 1] in "=(,":
            label = re.search(r"(\w+)\s*=$", code[outer + 1:end]) if code[end - 1] == "=" else None
            if label is None or label[1] in KOTLIN_LAMBDA_VALUE_PARAMETERS:
                return call_at(code, outer), label and label[1]
            return "", label[1]
        return call_at(code, opening), None

    def receiver_call(opening):
        """`NotificationChannel(…).apply {` -> NotificationChannel."""
        token = call_span(code, opening)[0]
        if not code.startswith(".", token):
            return ""
        end = before(token)
        return call_at(code, closers[end - 1]) if end and code[end - 1] == ")" and end - 1 in closers else ""

    def lambda_result(opening, depth):
        """True if the literal is in the lambda's last statement, i.e. its value."""
        close, i = pairs[opening], start
        while i < close:
            char = code[i]
            if char in "([{":
                depth += 1
            elif char in ")]}":
                depth -= 1
            elif depth == 0 and char in "\n;":
                following = i + 1
                while following < close and code[following].isspace():
                    following += 1
                if following >= close:
                    return True
                if char == ";" or not KOTLIN_CONTINUATION.match(code, following):
                    return False
                i = following
                continue
            i += 1
        return True

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

    enclosing = tree.enclosing(start) if tree else sorted(opening for opening, end in pairs.items() if opening < start < end)
    def bound():
        """A result of `val name = …` shown wherever the name is shown."""
        if through or tree is None or depth >= 3:
            return False
        return any(kotlin_ui_context(code, use, pairs, closers, wrappers, tree, depth + 1, strict)
                   for use in binding_uses(code, tree, start, KOTLIN_BINDING))

    outers = [None] + enclosing[:-1]
    builders = [code[opening] == "{" and lambda_call(opening, outer)[0].split(".")[-1] in KOTLIN_TEXT_BUILDERS
                for opening, outer in zip(enclosing, outers)]
    appended = through = False
    for index in range(len(enclosing) - 1, -1, -1):
        opening = enclosing[index]
        if code[opening] == "{":
            if when_body(opening):
                if not when_branch_value(opening):
                    return False  # A compared condition, not the branch's value.
                continue
            if expression_branch(opening):
                continue
            call = lambda_call(opening, outers[index])[0].split(".")[-1]
            # Appended text stays builder content through nested lambdas
            # (`forEach { append(…) }`) up to the outermost builder.
            if appended and any(builders[:index + 1]):
                continue
            if call in KOTLIN_VALUE_LAMBDAS and lambda_result(opening, len(enclosing) - 1 - index):
                continue
            if call in KOTLIN_SEMANTICS_BLOCKS:
                return assigned_property(opening) in KOTLIN_SEMANTICS_PROPERTIES
            if call in {"apply", "also"} and receiver_call(opening).split(".")[-1] in KOTLIN_CHANNELS:
                return assigned_property(opening) in KOTLIN_CHANNEL_PROPERTIES
            return bound()
        through = True  # Past a call or collection, the token is an argument, not the value.
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
        if parameter in KOTLIN_NAMED_SINKS and (not strict or parameter == "contentDescription"):
            # Compose animation labels are debugger identifiers, not UI copy.
            if parameter == "label" and (call.startswith("animate") or call in {"rememberInfiniteTransition", "updateTransition"}):
                continue
            return True
        if wrappers and call in wrappers:
            info = wrappers[call]
            if parameter in info["display"] if parameter else any(
                    argument_index < len(order) and order[argument_index] in info["display"] for order in info["orders"]):
                return True
        if call in KOTLIN_APPENDS and not parameter and argument_index == 0:
            appended = True
    return bound()


def format_issues(root: Path) -> list[Issue]:
    """Catch dropped/type-changed arguments; positional reordering is allowed."""
    issues = []
    # The permission catalog keeps the same argument and line-break contract.
    for relative in (*CATALOGS, "apps/ios-native/AlarmTalk/InfoPlist.xcstrings"):
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
    return bool(re.search(r"\b(?:contains|has|is)(?:Korean|Hangul)\b|0x[Aa][Cc]00|\\u\{?[Aa][Cc]00|가(?:-|\.{2,3})힣"
                          r"|p\{(?:Is|In|Script=|sc=)?Hangul|UnicodeBlock\.HANGUL|UnicodeScript\.HANGUL"
                          r"|Hangul_Syllables|\.hangul\b", source, re.IGNORECASE))


def stale_rules(rules: list[tuple[str, str, str, str]], literals: dict[str, set[str]], gated: set[str]) -> list[Issue]:
    """Allowlist entries that no longer match any literal in their path.

    Like the baseline, the allowlist must shrink when code moves: a stale entry
    would silently excuse the same literal if it came back as UI copy.
    """
    issues = []
    for _, pattern, literal, _ in rules:
        if literal == "language-gate":
            paths = gated
        elif literal == "*":
            paths = {path for values in literals.values() for path in values}
        else:
            paths = literals.get(literal, set())
        if not any(fnmatch.fnmatchcase(path, pattern) for path in paths):
            issues.append(Issue("scripts/hangul-literal-allowlist.txt", 0, pattern + "\t" + literal, "stale allowlist entry; remove it"))
    return issues


def audit(root: Path, rules: list[tuple[str, str, str, str]]) -> list[Issue]:
    seen: dict[str, set[str]] = {}  # literal -> paths, for stale allowlist entries
    gated: set[str] = set()
    sources = {str(p.relative_to(root)): p.read_text(encoding="utf-8") for relative in SWIFT_ROOTS for p in (root / relative).rglob("*.swift")}
    declarations = Declarations(sources)
    types = SwiftTypes(sources, lambda source: code_only(source, SwiftLexer(source).run()), delimiter_pairs)
    catalogs = {relative: json.loads((root / relative).read_text(encoding="utf-8"))["strings"] for relative in CATALOGS}
    issues = []
    swift_files = {}
    for path, source in sources.items():
        literals = SwiftLexer(source, path).run()
        code = code_only(source, literals)
        swift_files[path] = (source, code, mark_literals(code, literals), KotlinTree(code), literals)
    wrappers = swift_wrappers({path: entry[:4] for path, entry in swift_files.items()})
    for path, (source, code, marked, swift_tree, literals) in swift_files.items():
        for literal in literals:
            value = literal_value(literal)
            localized, kind = localized_context(path, source, literal, declarations)
            if not localized:
                # Only occurrences an exception can excuse keep it alive.
                seen.setdefault(value, set()).add(path)
            if string_in_key_parameter(path, source, literal, declarations):
                issues.append(Issue(path, literal["line"], value, "String(localized:) passed to a key/resource parameter; retain its literal key"))
            if literal["debug"] or kind == "comment" or value == "":
                continue
            if not localized and allowed(path, value, rules):
                continue
            words = has_words("".join(part for kind, part in literal["parts"] if kind == "lit"))
            ui_copy = not HANGUL.search(value) and not localized and words and swift_ui_context(
                source, code, literal, marked, wrappers, swift_tree)
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
        if language_gate(gate_source):
            gated.add(path)
        if language_gate(gate_source) and not allowed(path, "language-gate", rules):
            issues.append(Issue(path, 0, "containsKorean", "language-based server-error filter is forbidden"))
    kotlin = {}
    for file in (root / "apps/android-native/app/src/main/java").rglob("*.kt"):
        path, source = str(file.relative_to(root)), file.read_text(encoding="utf-8")
        chars = []
        literals = kotlin_literals(source, chars=chars)
        masked = list(source)
        for start, end, _, _ in literals:
            # A visible placeholder, not spaces: statement/line analysis must
            # not mistake `x = "…"\n` for a line that ends with `=`.
            masked[start:end] = ['"' for _ in source[start:end]]
        for start, end, _ in chars:
            masked[start:end] = ["'" for _ in source[start:end]]  # `'('` is not a delimiter.
        code = blank_comments("".join(masked))
        kotlin[path] = (source, literals, code, KotlinTree(code), chars)
    wrappers = kotlin_wrappers({path: (code, tree) for path, (_, _, code, tree, _) in kotlin.items()})
    for path, (source, literals, code, tree, chars) in kotlin.items():
        pairs, closers = tree.pairs, tree.closers
        static = {start: value for start, _, value, _ in kotlin_literals(source, static_text=True)}
        for start, end, value, _ in literals:
            seen.setdefault(value, set()).add(path)
            if allowed(path, value, rules):
                continue  # Kotlin has no literal lookups; resources are ids.
            # Letters outside format placeholders: `"%02d:%02d"` is not copy.
            ui_copy = has_words(static[start]) and kotlin_ui_context(code, start, pairs, closers, wrappers, tree)
            if HANGUL.search(value) or ui_copy:
                issues.append(Issue(path, source.count("\n", 0, start) + 1, value, "Kotlin UI text must use resources or a documented exception"))
        for start, _, value in chars:
            # `Text('월'.toString())`: a letter shown as text needs a resource.
            if has_words(value) and not allowed(path, value, rules) and kotlin_ui_context(code, start, pairs, closers, wrappers, tree):
                issues.append(Issue(path, source.count("\n", 0, start) + 1, value, "Kotlin UI text must use resources or a documented exception"))
        # Character ranges (`'가'..'힣'`) are masked in code; keep them for the gate.
        ranges = [first[2] + ".." + second[2] for first, second in zip(chars, chars[1:])
                  if re.fullmatch(r"\s*\.\.[.<]?\s*", source[first[1]:second[0]])]
        gate_source = code + "\n" + "\n".join(value for _, _, value, _ in literals) + "\n" + "\n".join(ranges)
        if language_gate(gate_source):
            gated.add(path)
        if language_gate(gate_source) and not allowed(path, "language-gate", rules):
            issues.append(Issue(path, 0, "containsKorean", "language-based server-error filter is forbidden"))
    issues.extend(catalog_issues(root))
    issues.extend(format_issues(root))
    issues.extend(stale_rules(rules, seen, gated))
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
                # A non-primitive annotation is also a same-named declaration.
                ('struct A { let value: Date }\nstruct B { let value: Int }', None),
                ('struct A { let value: [Int] }\nstruct B { let value = 3 }', None),
                ('struct A { let value: (Item) -> Label }\nstruct B { let value: Int }', None),
                ('struct A { var value: Int? }\nstruct B { let value = 3 }', 'lld'),
                # Parameters, locals and tuple labels are not members of any type.
                ('func f(value: String) {}', None),
                ('struct A { func f() { let value: String = name } }', None),
                ('func days() -> (value: String, other: Int)? { nil }', None),
                ('struct B { let value: Int }\nfunc f(value: String) {}\nfunc g() { var value: String = "" }', 'lld'),
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
        for language, quantities, text in [('', ['other'], '안녕'), ('-ja', ['other'], 'こんにちは'), ('-en', ['one', 'other'], 'Hello')]:
            items = ''.join('<item quantity="' + q + '">' + text + '</item>' for q in quantities)
            (base / ('values' + language) / 'strings.xml').write_text('<resources><plurals name="hello">' + items + '</plurals></resources>', encoding="utf-8")
        self.assertEqual(catalog_issues(root), [])
        # Korean resolves every count through `other`; the source needs it too.
        source = base / 'values' / 'strings.xml'
        original = source.read_text(encoding="utf-8")
        source.write_text(original.replace('quantity="other"', 'quantity="one"'), encoding="utf-8")
        self.assertTrue(any(i.reason == 'Android ko required plural quantities missing' for i in catalog_issues(root)))
        source.write_text(original, encoding="utf-8")
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
                                 ('-ja', ['最初', '単語', r'\n最後'])]:
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

    def test_memberwise_parameters_are_direct_stored_properties(self):
        source = 'struct Row {\n    let title: String\n    func f() { let title: LocalizedStringKey = "x" }\n}'
        self.assertFalse(Declarations({"a.swift": source}).accepts("a.swift", "Row", "title"))
        source = 'struct Row {\n    let title: LocalizedStringKey\n    func f(title: String) {}\n}'
        self.assertTrue(Declarations({"a.swift": source}).accepts("a.swift", "Row", "title"))
        source = 'struct Row {\n    let titles: [String]\n    func f() { let titles: [LocalizedStringKey] = [] }\n}'
        self.assertIsNone(Declarations({"a.swift": source}).collection_shape("a.swift", "Row", "titles"))

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
        values = {"ko": korean_value, "en": "Hello", "ja": "こんにちは"}
        entry = {"localizations": {language: {"stringUnit": {"state": "translated", "value": values[language]}}
                                    for language in (*LANGUAGES, "ko")}}
        for path in (*CATALOGS, "apps/ios-native/AlarmTalk/InfoPlist.xcstrings"):
            file = root / path
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(json.dumps({"strings": {key: entry}}), encoding="utf-8")
        file = root / SWIFT_ROOTS[0] / "Screen.swift"
        file.write_text(source, encoding="utf-8")
        for language, text in (("", "안녕"), ("-en", "Hello"), ("-ja", "こんにちは")):
            directory = root / ("apps/android-native/app/src/main/res/values" + language)
            directory.mkdir(parents=True)
            (directory / "strings.xml").write_text('<resources><string name="hello">' + text + '</string></resources>', encoding="utf-8")
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

    def test_declared_variation_branches_need_a_translated_leaf(self):
        def leaf(value):
            return {"stringUnit": {"state": "translated", "value": value}}
        def substitution(variations):
            meta = {"argNum": 1, "formatSpecifier": "lld"}
            if variations is not None:
                meta["variations"] = variations
            return {"stringUnit": {"state": "translated", "value": "%#@count@"}, "substitutions": {"count": meta}}
        english = {"one": leaf("%arg alarm"), "other": leaf("%arg alarms")}
        valid = [substitution({"plural": english}), {"variations": {"plural": english}},
                 {"variations": {"device": {"iphone": leaf("%lld alarms"), "other": leaf("%lld alarms")}}}]
        broken = [substitution({"plural": {"one": leaf("%arg alarm"), "other": {}}}),
                  substitution({"plural": {"one": leaf("%arg alarm"), "other": {"variations": {"device": {}}}}}),
                  substitution({"plural": {}}), substitution({}), substitution(None),
                  {"stringUnit": {"state": "translated", "value": "%#@count@"}, "substitutions": {}},
                  {"variations": {"plural": {"one": leaf("%lld alarm"), "other": {}}}},
                  {"variations": {"plural": {}}}, {"variations": {}},
                  {"variations": {"device": {"iphone": leaf("%lld alarms"), "other": {"stringUnit": "x"}}}}]
        root = self.fixture(source="", key="alarm.count")
        for relative in (*CATALOGS, "apps/ios-native/AlarmTalk/InfoPlist.xcstrings"):
            file = root / relative
            original = file.read_text(encoding="utf-8")
            for english_unit, fails in [(unit, False) for unit in valid] + [(unit, True) for unit in broken]:
                data = json.loads(original)
                data["strings"]["alarm.count"]["localizations"]["en"] = english_unit
                file.write_text(json.dumps(data), encoding="utf-8")
                issues = [i for i in catalog_issues(root) if i.path == relative and i.reason == "en translation missing, unfinished or empty"]
                self.assertEqual(bool(issues), fails, (relative, english_unit))
            file.write_text(original, encoding="utf-8")

    def test_opt_outs_and_copies_are_limited_to_language_neutral_text(self):
        root = self.fixture(source="")
        file = root / CATALOGS[0]
        for key, fails in [("Try again", True), ("plan.name.free", True), ("AlarmTalk", False), ("%@ · %@", False), ("·", False)]:
            file.write_text(json.dumps({"strings": {key: {"shouldTranslate": False}}}), encoding="utf-8")
            self.assertEqual(any("shouldTranslate=false" in i.reason for i in catalog_issues(root)), fails, key)
        def leaf(value):
            return {"stringUnit": {"state": "translated", "value": value}}
        for key, english, japanese, fails in [
                ("Try again", "Try again", "Try again", True), ("Try again", "Retry", "Try again", True),
                ("retry.title", "Retry", "Retry", True), ("다시 시도", "Retry", "Retry", True),
                ("다시 시도", "Retry", "再試行", False), ("%lld%%", "%lld%%", "%lld%%", False),
                ("AlarmTalk", "AlarmTalk", "AlarmTalk", False),
                ("alarm.count", {"variations": {"plural": {"one": leaf("1 alarm"), "other": leaf("%lld alarms")}}}, "%lld alarms", True)]:
            localizations = {"ko": leaf("다시 시도"), "en": english if isinstance(english, dict) else leaf(english), "ja": leaf(japanese)}
            file.write_text(json.dumps({"strings": {key: {"localizations": localizations}}}), encoding="utf-8")
            self.assertEqual(any(i.reason == "ja translation is copied from English" for i in catalog_issues(root)), fails, (key, japanese))
        base = root / "apps/android-native/app/src/main/res"
        file.write_text(json.dumps({"strings": {}}), encoding="utf-8")
        for name, texts, fails in [("retry", ["다시 시도", "Retry", "Retry"], True), ("retry", ["다시 시도", "Retry", "再試行"], False),
                                   ("app_name", ["AlarmTalk", "AlarmTalk", "AlarmTalk"], False)]:
            for language, text in zip(("", "-en", "-ja"), texts):
                (base / ("values" + language) / "strings.xml").write_text(
                    '<resources><string name="' + name + '">' + text + '</string></resources>', encoding="utf-8")
            self.assertEqual(any(i.reason == "Android ja resource is copied from English" for i in catalog_issues(root)), fails, (name, texts))
        for name, text, fails in [("retry", "Retry", True), ("voices_lang_en", "English", False), ("separator", " · ", False)]:
            (base / "values/strings.xml").write_text('<resources><string name="' + name + '" translatable="false">' + text + '</string></resources>', encoding="utf-8")
            self.assertEqual(any('translatable="false"' in i.reason for i in catalog_issues(root)), fails, name)

    def test_device_variations_need_an_other_fallback(self):
        def leaf(value):
            return {"stringUnit": {"state": "translated", "value": value}}
        root = self.fixture(source="", key="alarm.count")
        file = root / CATALOGS[0]
        original = file.read_text(encoding="utf-8")
        for english, fails in [({"variations": {"device": {"iphone": leaf("Tap"), "other": leaf("Click")}}}, False),
                               ({"variations": {"device": {"iphone": leaf("Tap")}}}, True),
                               ({"stringUnit": {"state": "translated", "value": "%#@count@"}, "substitutions": {"count": {
                                   "argNum": 1, "formatSpecifier": "lld",
                                   "variations": {"device": {"iphone": leaf("%arg taps")}}}}}, True)]:
            data = json.loads(original)
            data["strings"]["alarm.count"]["localizations"]["en"] = english
            file.write_text(json.dumps(data), encoding="utf-8")
            self.assertEqual(any(i.reason == "en device variations need an other fallback" for i in catalog_issues(root)), fails, english)

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
                        file.write_text(json.dumps({"strings": {"AlarmTalk": entry}}), encoding="utf-8")
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

    def test_swift_value_closures_flow_into_display_sinks(self):
        declarations = 'struct Plain { let title: String }\n'
        for source, flagged in [
                ('Text(verbatim: value.map { _ in "Enabled" } ?? "Disabled")', {"Enabled", "Disabled"}),
                ('Text(verbatim: items.map { "Item \\($0)" }.joined())', {"Item \\($0)"}),
                ('Plain(title: value.map({ _ in "Enabled" }) ?? other)', {"Enabled"}),
                ('Text(verbatim: { "Ready" }())', {"Ready"}),
                ('Text(verbatim: value.flatMap { item in\n    item.isEmpty\n        ? nil\n        : "Some"\n} ?? other)', {"Some"}),
                ('Text(verbatim: value.map { item -> String in\n    log("Debug")\n    return "Shown"\n} ?? other)', {"Shown"}),
                ('Text(verbatim: value.map { _ in log("Debug"); return label } ?? other)', set()),
                ('Text(verbatim: items.filter { $0 == "x" }.joined())', set()),
                ('Button(action: { save("Debug") }) { Text("안녕") }', set()),
                ('Text(verbatim: value.map { item in\n    log("Debug")\n    item\n} ?? other)', set())]:
            root = self.fixture(source=declarations + source)
            values = {i.value for i in audit(root, []) if "not in a proven localization context" in i.reason}
            self.assertEqual(values, flagged, source)

    def test_collection_key_declarations_are_lookups(self):
        declarations = ('struct Row { let titles: [LocalizedStringKey] }\n'
                        'func row(titles: [LocalizedStringKey], ids: [String]) {}\n')
        for source, keys in [
                ('let tabs: [LocalizedStringKey] = ["Settings", "Alarms"]', {"Settings", "Alarms"}),
                ('let tabs: [LocalizedStringKey]? = [\n    "Settings",\n    "Alarms",\n]', {"Settings", "Alarms"}),
                ('let tabs: Array<LocalizedStringResource> = ["Settings"]', {"Settings"}),
                ('let names: [String: LocalizedStringKey] = ["home": "Home"]', {"Home"}),
                ('let names: [LocalizedStringKey: String] = ["Home": "home"]', {"Home"}),
                ('let rows: [(LocalizedStringKey, Int)] = [("Title", 1), ("Other", 2)]', {"Title", "Other"}),
                ('let row: (title: LocalizedStringKey, id: String) = (title: "Title", id: "row")', {"Title"}),
                ('var tabs: [LocalizedStringKey] { ["Settings"] }', {"Settings"}),
                ('func tabs() -> [LocalizedStringResource] {\n    if flag { return ["Settings"] }\n    return ["Alarms"]\n}', {"Settings", "Alarms"}),
                ('Row(titles: ["Settings"])', {"Settings"}),
                ('row(titles: ["Settings"], ids: ["settings"])', {"Settings"}),
                ('let ids: [String] = ["settings"]', set()),
                ('let tabs: [LocalizedStringKey] = flag ? first : second', set())]:
            root = self.fixture(source=declarations + source)
            missing = {i.value for i in audit(root, []) if "key missing" in i.reason}
            self.assertEqual(missing, keys, source)

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
                       'Text(buildAnnotatedString { items.forEach { item -> append(item); append(" and more") } })',
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
                       'Text(buildAnnotatedString { append(x) }, modifier = Modifier.clickable { log.append("Clicked") })',
                       'Text(buildAnnotatedString { items.forEach { Log.d(TAG, "Item") } })',
                       'NotificationChannel("alarm_channel", name, importance)',
                       'NotificationChannel(id, name, importance).apply { setShowBadge(false); group = "family" }',
                       'Settings(id).apply { description = "debug" }',
                       'Modifier.semantics { testTag = "row" }',
                       'builder.addAction(action)']:
            file.write_text(source, encoding="utf-8")
            self.assertEqual(audit(root, []), [], source)

    def test_catalog_substitutions_keep_argument_and_specifier(self):
        def leaf(value):
            return {"stringUnit": {"state": "translated", "value": value}}
        def substitution(top, spec, argument, leaves):
            return {"stringUnit": {"state": "translated", "value": top}, "substitutions": {"count": {
                "argNum": argument, "formatSpecifier": spec,
                "variations": {"plural": {category: leaf(text) for category, text in leaves.items()}}}}}
        english = {"one": "%arg alarm", "other": "%arg alarms"}
        for source in [leaf("알람 %lld개"), substitution("알람 %#@count@", "lld", 1, {"other": "%arg개"})]:
            for target, fails in [(substitution("%#@count@", "lld", 1, english), False),
                                  (substitution("%1$#@count@", "lld", 1, english), False),
                                  (substitution("%#@count@", "@", 1, english), True),
                                  (substitution("%#@count@", "lld", 2, english), True),
                                  (substitution("%#@count@", "lld", 1, {"one": "One alarm", "other": "%arg alarms"}), True),
                                  (substitution("%#@count@", "lld", 1, {"one": "%arg alarm", "other": "%arg\nalarms"}), True),
                                  (leaf("%#@count@"), True)]:
                self.assertEqual(bool(catalog_format_mismatches(source, target, "key")), fails, (source, target))
        two = substitution("%@ has %#@count@", "lld", 2, english)
        self.assertEqual(catalog_format_mismatches(leaf("%@의 알람 %lld개"), two, "key"), [])
        two["substitutions"]["count"]["argNum"] = 1
        self.assertTrue(catalog_format_mismatches(leaf("%@의 알람 %lld개"), two, "key"))

    def test_english_keeps_plural_variations_of_the_korean_source(self):
        def leaf(value):
            return {"stringUnit": {"state": "translated", "value": value}}
        def plural(values):
            return {"variations": {"plural": {category: leaf(value) for category, value in values.items()}}}
        korean_sources = [plural({"other": "알람 %lld개"}),
                          {"stringUnit": {"state": "translated", "value": "%#@count@"}, "substitutions": {"count": {
                              "argNum": 1, "formatSpecifier": "lld", "variations": {"plural": {"other": leaf("%arg개")}}}}}]
        for korean in korean_sources:
            for english, japanese, fails in [(leaf("%lld alarms"), leaf("%lld件"), True),
                                             (plural({"one": "%lld alarm", "other": "%lld alarms"}), leaf("%lld件"), False)]:
                root = self.fixture(source="", key="alarm.count")
                file = root / CATALOGS[0]
                data = json.loads(file.read_text(encoding="utf-8"))
                data["strings"]["alarm.count"]["localizations"] = {"ko": korean, "en": english, "ja": japanese}
                file.write_text(json.dumps(data), encoding="utf-8")
                issues = [i.reason for i in catalog_issues(root) if i.path == CATALOGS[0]]
                self.assertEqual("en must vary by plural like the Korean source" in issues, fails, (korean, english))
                self.assertNotIn("ja must vary by plural like the Korean source", issues)
        # A plain Korean source does not force plural structure.
        root = self.fixture(source="", key="alarm.count")
        self.assertEqual(catalog_issues(root), [])

    def test_kotlin_value_lambdas_flow_into_display_sinks(self):
        root = self.fixture(source="")
        file = root / "apps/android-native/app/src/main/java/example/Screen.kt"
        file.parent.mkdir(parents=True)
        for source in ['Text(text = remember { "Try again" })',
                       'Text(remember(busy) {\n    if (busy) "Wait"\n    else "Retry"\n})',
                       'Text(text = with(state) { if (busy) { "Wait" } else { "Retry" } })',
                       'Text(name?.let { "Hi $it" } ?: other)',
                       'Text(items.getOrElse(0) { "None" })',
                       'Text(remember { derivedStateOf { "Ready" } }.value)',
                       'Text(text = remember {\n    val count = load()\n    format("Count: %d", count)\n})',
                       'Text(when { busy -> "Wait"; else -> "Retry" })',
                       'Text(text = when (mode) {\n    A -> "Alpha"\n    else ->\n        "Retry"\n})',
                       'Text(when (mode) { A -> if (x) "One" else "Two"; else -> b })']:
            file.write_text(source, encoding="utf-8")
            self.assertTrue(any("Kotlin UI" in issue.reason for issue in audit(root, [])), source)
        for source, flagged in [('Text(text = remember {\n    log("Shown")\n    "Retry"\n})', {"Retry"}),
                                ('Text(when (mode) {\n    A -> "Alpha"\n    "custom" -> b\n})', {"Alpha"}),
                                ('Text(when {\n    busy -> "Wait"\n    mode == "custom" -> b\n    else -> "Retry"\n})', {"Wait", "Retry"}),
                                ('Modifier.semantics {\n    testTag = "row"\n    contentDescription = "Delete"\n}', {"Delete"})]:
            file.write_text(source, encoding="utf-8")
            self.assertEqual({i.value for i in audit(root, []) if "Kotlin UI" in i.reason}, flagged, source)
        for source in ['Text(text = remember { Log.d(TAG, "Debug"); label })',
                       'Text(text = remember {\n    analytics.log("Shown")\n    label\n})',
                       'Text(text = remember {\n    val raw = prefs.getString("saved_key", null)\n    raw.orEmpty()\n})',
                       'val title = remember { "Saved" }',
                       'Button(onClick = { scope.launch { run { "Ignored" } } }) {}',
                       'Text(text = label.also { Log.d(TAG, "Shown") })',
                       'Text(when (mode) { "custom" -> stringResource(R.string.a); else -> b })',
                       'Text(when {\n    mode == "custom" -> a\n    else -> b\n})',
                       'Card(title = when (plan) {\n    "couple",\n    "family" -> group\n    else -> other\n})']:
            file.write_text(source, encoding="utf-8")
            self.assertEqual(audit(root, []), [], source)

    def test_standard_swiftui_initializers_are_key_lookups(self):
        for call in ['NavigationLink("Settings", destination: Detail())', 'DisclosureGroup("Advanced") { Detail() }',
                     'Menu("Options") { Detail() }', 'ProgressView("Loading")', 'Stepper("Count", value: $count)',
                     'DatePicker("Date", selection: $date)', 'ShareLink("Share", item: url)',
                     'LabeledContent("Version", value: version)', 'GroupBox("Account") { Detail() }',
                     'ContentUnavailableView("No alarms", systemImage: "alarm")',
                     'Tab("Alarms", systemImage: "alarm") { Detail() }', 'view.help("Tooltip")', 'view.badge("New")',
                     'view.accessibilityValue("Selected")']:
            root = self.fixture(source=call)
            self.assertTrue(any("key missing" in i.reason for i in audit(root, [])), call)
            root = self.fixture(source=call.replace(call[call.index('"') + 1:call.index('"', call.index('"') + 1)], "안녕", 1))
            self.assertFalse(any(i.path.endswith(".swift") for i in audit(root, [])), call)

    def test_kotlin_app_wrappers_are_display_sinks(self):
        root = self.fixture(source="")
        file = root / "apps/android-native/app/src/main/java/example/Screen.kt"
        file.parent.mkdir(parents=True)
        declarations = ('@Composable\nfun WakerSheetOptionRow(id: String, title: String, description: String? = null) {\n'
                        '    Text(title)\n    description?.let { Text(text = description) }\n}\n'
                        'fun Inner(caption: String) { Text(caption) }\n'
                        'fun Outer(hint: String, onClick: () -> Unit) { Inner(caption = hint) }\n'
                        'fun track(event: String) { Log.d(TAG, event) }\n')
        for call, flagged in [('WakerSheetOptionRow("row_id", "Title", description = "Unavailable")', {"Title", "Unavailable"}),
                              ('WakerSheetOptionRow(id = "row_id", title = "Title")', {"Title"}),
                              ('Outer(hint = "Tap here", onClick = {})', {"Tap here"}),
                              ('Outer("Tap here") {}', {"Tap here"}),
                              ('track(event = "opened")', set()),
                              ('Text("%02d:%02d".format(hour, minute))', set())]:
            file.write_text(declarations + call, encoding="utf-8")
            self.assertEqual({i.value for i in audit(root, []) if "Kotlin UI" in i.reason}, flagged, call)

    def test_allowlisted_values_are_still_validated_as_lookups(self):
        source = 'let stored = "남성"\nlet label = String(localized: "남성")'
        rules = [("data-contract", SWIFT_ROOTS[0] + "/Screen.swift", "남성", "stored value")]
        root = self.fixture(source=source)
        self.assertTrue(any("key missing" in i.reason and i.value == "남성" for i in audit(root, rules)))
        root = self.fixture(source=source, key="남성")
        self.assertEqual([i for i in audit(root, rules) if i.path.endswith(".swift")], [])
        root = self.fixture(source='let stored = "남성"')
        self.assertEqual(audit(root, rules), [])

    def test_string_literal_initializers_are_lookups(self):
        for source in ['let title = LocalizedStringResource(stringLiteral: "Try again")',
                       'let title = LocalizedStringKey(stringLiteral: "Try again")',
                       'let title = String(localized: String.LocalizationValue("Try again"))',
                       'let title = String(localized: String.LocalizationValue(stringLiteral: "Try again"))']:
            root = self.fixture(source=source)
            self.assertTrue(any("key missing" in i.reason and i.value == "Try again" for i in audit(root, [])), source)
            root = self.fixture(source=source.replace("Try again", "안녕"))
            self.assertEqual([i for i in audit(root, []) if i.path.endswith(".swift")], [], source)

    def test_kotlin_expression_wrappers_and_named_value_lambdas(self):
        root = self.fixture(source="")
        file = root / "apps/android-native/app/src/main/java/example/Screen.kt"
        file.parent.mkdir(parents=True)
        declarations = ('@Composable\nfun Card(title: String) = Text(title)\n'
                        'fun Banner(caption: String) =\n    Text(\n        text = caption,\n    )\n'
                        'fun track(event: String) = Log.d(TAG, event)\n')
        for call, flagged in [('Card("Try again")', {"Try again"}), ('Banner(caption = "Offline")', {"Offline"}),
                              ('track("opened")', set()),
                              ('Text(text = remember(key1 = key, calculation = { "Try again" }))', {"Try again"}),
                              ('Text(text = remember(key, { "Try again" }))', {"Try again"}),
                              ('Text(buildAnnotatedString(builder = { append("Retry") }))', {"Retry"}),
                              ('Text(text = remember(key1 = key, calculation = { log("Debug"); label }))', set()),
                              ('Button(onClick = { log("Clicked") }) { Icon(icon, null) }', set()),
                              ('Text(text = label, modifier = Modifier.clickable(onClick = { log("Clicked") }))', set())]:
            file.write_text(declarations + call, encoding="utf-8")
            self.assertEqual({i.value for i in audit(root, []) if "Kotlin UI" in i.reason}, flagged, call)

    def test_unlabeled_key_parameters_are_lookups(self):
        for source, keys in [('func row(_ title: LocalizedStringKey) {}\nrow("Settings")', {"Settings"}),
                             ('func row(_ id: String, _ title: LocalizedStringKey) {}\nrow("row", "Settings")', {"Settings"}),
                             ('struct Row: View {\n    init(_ title: LocalizedStringKey) {}\n    var body: some View { EmptyView() }\n}\nRow("Settings")', {"Settings"}),
                             ('func rows(_ titles: [LocalizedStringKey]) {}\nrows(["Settings", "Alarms"])', {"Settings", "Alarms"}),
                             ('func row(_ title: LocalizedStringKey) {}\nfunc row(_ title: String) {}\nrow("Settings")', set()),
                             ('func row(_ title: LocalizedStringKey) {}\nrow(flag ? "Settings" : "Alarms")', set()),
                             ('func row(title: LocalizedStringKey) {}\nfunc row(_ id: String) {}\nrow("settings")', set())]:
            root = self.fixture(source=source)
            self.assertEqual({i.value for i in audit(root, []) if "key missing" in i.reason}, keys, source)

    def test_target_keeps_the_source_device_branches_and_infoplist_formats(self):
        def leaf(value):
            return {"stringUnit": {"state": "translated", "value": value}}
        root = self.fixture(source="", key="alarm.tap")
        file = root / CATALOGS[0]
        original = file.read_text(encoding="utf-8")
        korean = {"variations": {"device": {"iphone": leaf("탭하세요"), "other": leaf("누르세요")}}}
        for english, fails in [({"variations": {"device": {"iphone": leaf("Tap"), "other": leaf("Press")}}}, False),
                               ({"variations": {"device": {"other": leaf("Press")}}}, True), (leaf("Press"), True)]:
            data = json.loads(original)
            data["strings"]["alarm.tap"]["localizations"].update({"ko": korean, "en": english})
            file.write_text(json.dumps(data), encoding="utf-8")
            self.assertEqual(any(i.reason.startswith("en device variations missing:") and "iphone" in i.reason
                                 for i in catalog_issues(root)), fails, english)
        file.write_text(original, encoding="utf-8")
        plist = root / "apps/ios-native/AlarmTalk/InfoPlist.xcstrings"
        for english, fails in [("First line\nSecond line", False), ("One line", True)]:
            plist.write_text(json.dumps({"strings": {"NSAlarmKitUsageDescription": {"localizations": {
                "ko": leaf("첫 줄\n둘째 줄"), "en": leaf(english), "ja": leaf("一行目\n二行目")}}}}), encoding="utf-8")
            self.assertEqual(any(i.path.endswith("InfoPlist.xcstrings") and "line breaks" in i.reason for i in format_issues(root)), fails, english)

    def test_local_string_bindings_flow_into_display_sinks(self):
        root = self.fixture(source="")
        file = root / "apps/android-native/app/src/main/java/example/Screen.kt"
        file.parent.mkdir(parents=True)
        for source, flagged in [('val title = "Try again"\nText(title)', {"Try again"}),
                                ('fun f() {\n    val title: String = "Try again"\n    Text(text = title)\n}', {"Try again"}),
                                ('private const val ROUTE = "settings"\nfun f() = navigate(ROUTE)', set()),
                                ('fun a() { val title = "Try again" }\nfun b() { Text(title) }', set()),
                                ('val title = "Try again" + suffix\nText(title)', set()),
                                ('val tag = "Screen"\nfun f() { Log.d(tag, message) }', set())]:
            file.write_text(source, encoding="utf-8")
            self.assertEqual({i.value for i in audit(root, []) if "Kotlin UI" in i.reason}, flagged, source)
        file.unlink()
        for source, flagged in [('let title = "Try again"\nText(title)', {"Try again"}),
                                ('struct V: View {\n    let title = "Try again"\n    var body: some View { Text(title) }\n}', {"Try again"}),
                                ('let route = "settings"\nopen(route)', set()),
                                ('func a() { let title = "Try again" }\nfunc b() { Text(title) }', set())]:
            root = self.fixture(source=source)
            self.assertEqual({i.value for i in audit(root, []) if "not in a proven" in i.reason}, flagged, source)

    def test_searchable_prompts_and_unicode_hangul_gates(self):
        for source in ['view.searchable(text: $query, prompt: "Search alarms")',
                       'view.accessibilityAction(named: "Delete") { delete() }']:
            root = self.fixture(source=source)
            self.assertTrue(any("key missing" in i.reason for i in audit(root, [])), source)
        root = self.fixture(source="")
        file = root / "apps/android-native/app/src/main/java/example/Errors.kt"
        file.parent.mkdir(parents=True)
        for source in ['val hangul = Regex("\\\\p{IsHangul}")', 'val script = Character.UnicodeScript.HANGUL',
                       'val block = Character.UnicodeBlock.HANGUL_SYLLABLES', 'fun hasHangul(text: String) = false']:
            file.write_text(source, encoding="utf-8")
            self.assertTrue(any("filter is forbidden" in i.reason for i in audit(root, [])), source)
        for source in ['let pattern = /\\p{Script=Hangul}/', 'var isKorean = true']:
            root = self.fixture(source=source)
            self.assertTrue(any("filter is forbidden" in i.reason for i in audit(root, [])), source)

    def test_typed_key_branches_and_foundation_lookups(self):
        for source, keys in [('let title: LocalizedStringKey = flag ? "Settings" : "Alarms"', {"Settings", "Alarms"}),
                             ('let title: LocalizedStringKey = flag\n    ? "Settings"\n    : "Alarms"', {"Settings", "Alarms"}),
                             ('let title: LocalizedStringResource = plan == "couple" ? "Settings" : "Alarms"', {"Settings", "Alarms"}),
                             ('let title: LocalizedStringKey = custom ?? "Default"', {"Default"}),
                             ('var title: LocalizedStringKey {\n    return mode == "a" ? "Settings" : "Alarms"\n}', {"Settings", "Alarms"}),
                             ('var title: LocalizedStringKey {\n    switch mode {\n    case .a: return "Settings"\n    case .b: "Alarms"\n    }\n}', {"Settings", "Alarms"}),
                             ('let title = NSLocalizedString("Settings", comment: "Shown on the tab")', {"Settings"}),
                             ('let title = NSLocalizedString("Settings", tableName: nil, bundle: .main, value: "Settings fallback", comment: "")', {"Settings"}),
                             ('let title = Bundle.main.localizedString(forKey: "Settings", value: "Fallback", table: nil)', {"Settings"})]:
            root = self.fixture(source=source)
            self.assertEqual({i.value for i in audit(root, []) if "key missing" in i.reason}, keys, source)

    def test_wildcard_rules_do_not_exempt_language_gates(self):
        root = self.fixture(source='let seed = ["설날"]\nvar containsKorean = true')
        path = SWIFT_ROOTS[0] + "/Screen.swift"
        wildcard = [("seed-data", path, "*", "seed names")]
        self.assertTrue(any("filter is forbidden" in i.reason for i in audit(root, wildcard)))
        explicit = wildcard + [("log", path, "language-gate", "documented gate")]
        self.assertFalse(any("filter is forbidden" in i.reason for i in audit(root, explicit)))

    def test_labeled_initializers_kotlin_characters_and_declared_types(self):
        view = 'struct Row: View {\n    init(heading: LocalizedStringKey, rows: [LocalizedStringKey] = []) {}\n    var body: some View { EmptyView() }\n}\n'
        for source, keys in [(view + 'Row(heading: "Settings")', {"Settings"}),
                             (view + 'Row(heading: "Settings", rows: ["Alarms"])', {"Settings", "Alarms"}),
                             ('struct Row { let id: String }\nextension Row {\n    init(heading: LocalizedStringKey) { id = "" }\n}\nRow(heading: "Settings")', {"Settings"}),
                             (view.replace('init(heading: LocalizedStringKey,', 'init(heading: String) {}\n    init(heading: LocalizedStringKey,') + 'Row(heading: "Settings")', set())]:
            root = self.fixture(source=source)
            self.assertEqual({i.value for i in audit(root, []) if "key missing" in i.reason}, keys, source)
        source = 'let count: String = "x"\nfunc f() {\n    consume(count: Int(3))\n    _ = String(localized: "알람 \\(count)개")\n}'
        for conversion, missing in [("@", False), ("lld", True)]:
            root = self.fixture(source=source, key="알람 %" + conversion + "개")
            self.assertEqual(any("key missing" in i.reason for i in audit(root, [])), missing, conversion)
        root = self.fixture(source="")
        file = root / "apps/android-native/app/src/main/java/example/Screen.kt"
        file.parent.mkdir(parents=True)
        for source, flagged in [("Text('월'.toString())", {"월"}), ("Text(text = 'A'.toString())", {"A"}),
                                ("Text(':'.toString())", set()), ("val unit = '월'", set()),
                                ("Text(text = if (c == '(') label else other)", set())]:
            file.write_text(source, encoding="utf-8")
            self.assertEqual({i.value for i in audit(root, []) if "Kotlin UI" in i.reason}, flagged, source)
        file.write_text("fun f(text: String) = text.any { it in '가'..'힣' }", encoding="utf-8")
        self.assertTrue(any("filter is forbidden" in i.reason for i in audit(root, [])))

    def test_conditional_bindings_flow_into_display_sinks(self):
        root = self.fixture(source="")
        file = root / "apps/android-native/app/src/main/java/example/Screen.kt"
        file.parent.mkdir(parents=True)
        for source, flagged in [('val title = if (enabled) "Enabled" else "Disabled"\nText(title)', {"Enabled", "Disabled"}),
                                ('fun f() {\n    val title = if (busy)\n        "Wait"\n    else\n        "Retry"\n    Text(text = title)\n}', {"Wait", "Retry"}),
                                ('val title = when (mode) {\n    A -> "Alpha"\n    else -> "Beta"\n}\nText(title)', {"Alpha", "Beta"}),
                                ('val name = custom ?: "Guest"\nText(name)', {"Guest"}),
                                ('val t = if (x) { "Yes" } else { "No" }\nText(t)', {"Yes", "No"}),
                                ('val key = prefs.getString("saved", null)\nText(key)', set()),
                                ('val title = "Try" + suffix\nText(title)', set()),
                                ('val ok = mode == "custom"\nif (ok) Text(label)', set()),
                                ('fun f() { val t = if (x) "Yes" else "No" }\nfun g() { Text(t) }', set())]:
            file.write_text(source, encoding="utf-8")
            self.assertEqual({i.value for i in audit(root, []) if "Kotlin UI" in i.reason}, flagged, source)
        file.unlink()
        for source, flagged in [('let title = flag ? "Enabled" : "Disabled"\nText(verbatim: title)', {"Enabled", "Disabled"}),
                                ('let title = custom ?? "Guest"\nText(verbatim: title)', {"Guest"}),
                                ('let title = switch mode {\ncase .a: "Alpha"\ndefault: "Beta"\n}\nText(verbatim: title)', {"Alpha", "Beta"}),
                                ('func f() -> String {\n    guard let value = x else { return "fallback" }\n    Text(verbatim: value)\n}', set()),
                                ('let ok = mode == "custom" ? first : second\nText(verbatim: ok)', set())]:
            root = self.fixture(source=source)
            self.assertEqual({i.value for i in audit(root, []) if "not in a proven" in i.reason}, flagged, source)

    def test_ternary_key_collections_are_lookups(self):
        for source, keys in [('let tabs: [LocalizedStringKey] = flag ? ["Settings"] : ["Alarms"]', {"Settings", "Alarms"}),
                             ('let tabs: [LocalizedStringKey] = custom ?? ["Default"]', {"Default"}),
                             ('var tabs: [LocalizedStringKey] {\n    flag ? ["Settings"] : ["Alarms"]\n}', {"Settings", "Alarms"}),
                             ('let tabs: [LocalizedStringKey] = make(["notakey"])', set())]:
            root = self.fixture(source=source)
            self.assertEqual({i.value for i in audit(root, []) if "key missing" in i.reason}, keys, source)

    def test_korean_android_values_cannot_be_empty(self):
        root = self.fixture(source="")
        base = root / "apps/android-native/app/src/main/res"
        for tag, korean, fails in [("string", "", True), ("string", "안녕", False),
                                   ("string-array", "<item>하나</item><item> </item>", True),
                                   ("plurals", '<item quantity="other"></item>', True)]:
            texts = {"": korean, "-en": "Hello", "-ja": "こんにちは"}
            for language, text in texts.items():
                if tag == "string-array":
                    text = korean if not language else "<item>" + text + "</item><item>" + text + "!</item>"
                elif tag == "plurals":
                    text = korean if not language else ('<item quantity="one">' + text + '</item>' if language == "-en" else "") + '<item quantity="other">' + text + '</item>'
                (base / ("values" + language) / "strings.xml").write_text(
                    '<resources><' + tag + ' name="hello">' + text + '</' + tag + '></resources>', encoding="utf-8")
            self.assertEqual(any(i.reason == "Android ko resource contains an empty value" for i in catalog_issues(root)), fails, (tag, korean))

    def test_swift_app_wrappers_are_display_sinks(self):
        declarations = ('struct PromptDetailCard: View {\n    let title: String\n    let value: String\n    let note: String?\n'
                        '    var body: some View { VStack { Text(title); Text(value); if let note { Text(note) } } }\n}\n'
                        'struct Row: View {\n    private let caption: String\n    init(caption: String) { self.caption = caption }\n'
                        '    var body: some View { Text(caption) }\n}\n'
                        'func pill(_ text: String) -> some View { Text(text) }\n'
                        'func cacheKey(category: String) -> String { compute(text: category) }\n'
                        'struct Key { let id: String }\n')
        for call, flagged in [('PromptDetailCard(title: label, value: "Try again", note: nil)', {"Try again"}),
                              ('PromptDetailCard(title: label, value: other, note: "Optional")', {"Optional"}),
                              ('Row(caption: "Tap here")', {"Tap here"}), ('pill("New")', {"New"}),
                              ('cacheKey(category: "custom")', set()), ('Key(id: "row")', set())]:
            root = self.fixture(source=declarations + call)
            self.assertEqual({i.value for i in audit(root, []) if "not in a proven" in i.reason}, flagged, call)

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

    def test_array_lengths_match_and_resources_cannot_be_allowlisted(self):
        root = self.fixture(source="")
        base = root / "apps/android-native/app/src/main/res"
        def write(language, items):
            xml = '<resources><string-array name="choices">' + "".join("<item>" + item + "</item>" for item in items) + "</string-array></resources>"
            (base / ("values" + language) / "strings.xml").write_text(xml, encoding="utf-8")
        write("", ["하나", "둘"])
        write("-ja", ["一つ", "二つ"])
        write("-en", ["One", "Two"])
        self.assertEqual(catalog_issues(root), [])
        write("-en", ["One", "Two", "Three"])
        self.assertTrue(any(i.reason == "resource type/array length differs" for i in catalog_issues(root)))
        for items in (["One", ""], ["One", " "]):
            write("-en", items)
            self.assertTrue(any(i.reason == "Android en resource contains an empty translation" for i in catalog_issues(root)))
        # A key-level allowlist rule for a resource would hide all of the above.
        file = root / "allowlist.txt"
        file.write_text("data-contract\tapps/android-native/app/src/main/res/values-en/strings.xml\t\"choices\"\treason\n", encoding="utf-8")
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

    def test_stale_allowlist_entries_fail(self):
        root = self.fixture(source='let stored = "남성"')
        path = SWIFT_ROOTS[0] + "/Screen.swift"
        rules = [("data-contract", path, "남성", "stored value")]
        self.assertEqual(audit(root, rules), [])
        for rule in [("data-contract", path, "여성", "moved away"), ("data-contract", "other/*.swift", "남성", "wrong path"),
                     ("generated", "other/Generated.swift", "*", "deleted file"), ("log", path, "language-gate", "no gate")]:
            self.assertTrue(any(i.reason == "stale allowlist entry; remove it" for i in audit(root, rules + [rule])), rule)
        self.assertFalse(any("stale" in i.reason for i in audit(root, [("generated", SWIFT_ROOTS[0] + "/*.swift", "*", "all")])))
        root = self.fixture(source='let label = String(localized: "남성")', key="남성")
        self.assertTrue(any(i.reason == "stale allowlist entry; remove it" for i in audit(root, rules)))

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
