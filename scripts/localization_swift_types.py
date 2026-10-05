"""Conservative inference for the primitive types used in localized interpolation.

This is deliberately not a Swift type checker. Unknown or conflicting types
stay unknown so callers can request an explicit typed expression.
"""
import re
from localization_lexers import SwiftLexer


FORMATS = {"String": "@", "Substring": "@", "Int": "lld", "Int64": "lld",
           "Int32": "d", "Int16": "d", "Int8": "d", "UInt": "llu", "UInt64": "llu",
           "UInt32": "u", "UInt16": "u", "UInt8": "u", "Double": "lf", "Float": "f"}


class SwiftTypes:
    def __init__(self, sources, mask, pairs):
        self.sources = sources
        self.entries = {}
        self.functions = {}
        self.scopes = {}
        self.members = {}
        for path, source in sources.items():
            code = mask(source)
            delimiters = pairs(code)
            blocks = [(a, b) for a, b in delimiters.items() if code[a] == "{"]
            # Function parameters are visible only in their own body. Their
            # declaration precedes the brace and needs an explicit scope span.
            for match in re.finditer(r"\b(?:func\s+\w+|init)\s*\(", code):
                opening = match.end() - 1
                closing = delimiters.get(opening, opening)
                body = code.find("{", closing)
                if body in delimiters:
                    blocks.append((opening, delimiters[body]))
            self.scopes[path] = blocks
            entries = []
            # Parameters and explicit property/local declarations.
            for match in re.finditer(r"\b(\w+)\s*:\s*(String|Substring|U?Int(?:8|16|32|64)?|Double|Float)\b", code):
                entries.append((match[1], match.start(), match[2], None))
            for match in re.finditer(r"\b(?:let|var)\s+(\w+)\s*=\s*([^\n;]+)", source):
                if code[match.start():match.start() + 3] in {"let", "var"}:
                    value = re.split(r"\s+else\s*\{|\s+\{", match[2], maxsplit=1)[0]
                    entries.append((match[1], match.start(), None, value))
            self.entries[path] = entries
            for name, pos, typename, value in entries:
                if typename:
                    self.members.setdefault(name, set()).add(FORMATS.get(typename))
            for match in re.finditer(r"\bfunc\s+(\w+)\s*\([^{}]*?\)\s*(?:async\s*)?(?:throws\s*)?->\s*(\w+)", code):
                self.functions.setdefault(match[1], set()).add(FORMATS.get(match[2]))

    def infer(self, expression, path, position, seen=frozenset()):
        expression = expression.strip()
        marker = (path, position, expression)
        if marker in seen or len(seen) > 30:
            return None
        seen = seen | {marker}
        infer = lambda value, pos=position: self.infer(value, path, pos, seen)
        if re.fullmatch(r'[-+]?\d[\d_]*', expression):
            return "lld"
        if re.fullmatch(r'[-+]?\d[\d_]*\.\d[\d_]*', expression):
            return "lf"
        if expression.startswith(('"', '#"')):
            literals = SwiftLexer(expression).run()
            if any(literal["start"] == 0 and literal["end"] == len(expression) for literal in literals):
                return "@"
        # Constructors explicitly select the interpolation overload.
        constructor = re.match(r"^(\w+)\s*\(", expression)
        if constructor and constructor[1] in FORMATS and expression.endswith(")"):
            return FORMATS[constructor[1]]
        if expression.startswith("Text(") or re.search(r"\.formatted\([^)]*\)$", expression):
            return "@"
        if expression.startswith("(") and expression.endswith(")"):
            return infer(expression[1:-1])
        # Split only at top level; calls may contain their own arithmetic/commas.
        depth = 0
        for i, char in enumerate(expression):
            if char in "([{":
                depth += 1
            elif char in ")]}":
                depth -= 1
            elif depth == 0 and (char in "+-*/%" or expression[i:i + 2] == "??"):
                width = 2 if char == "?" else 1
                left, right = infer(expression[:i]), infer(expression[i + width:])
                return left if left and left == right else None
        call = re.fullmatch(r"(?:[\w.]+\.)?(\w+)\((.*)\)", expression)
        if call:
            if call[1] in {"min", "max"}:
                types = {infer(arg) for arg in call[2].split(",")}
                return next(iter(types)) if len(types) == 1 else None
            types = self.functions.get(call[1], set())
            return next(iter(types)) if len(types) == 1 else None
        if not re.fullmatch(r"[\w.?!]+", expression):
            return None
        name = expression.split(".")[-1].rstrip("?!")
        if name == "count" and "." in expression:
            return "lld"
        entries = self.entries[path]
        if "." not in expression:
            # A declaration in an unrelated method/block cannot certify a local.
            candidates = []
            for entry in entries:
                if entry[0] != name or entry[1] > position:
                    continue
                enclosing = [(a, b) for a, b in self.scopes[path] if a < entry[1] < b]
                if all(a < position < b for a, b in enclosing):
                    candidates.append(entry)
            if candidates:
                _, pos, typename, value = max(candidates, key=lambda entry: entry[1])
                return FORMATS.get(typename) if typename else infer(value, pos)
            return None
        # Member properties and functions may be declared in another file.
        # Conflicting primitive types never choose one arbitrarily.
        types = self.members.get(name, set())
        return next(iter(types)) if len(types) == 1 else None
