"""Conservative inference for the primitive types used in localized interpolation.

This is deliberately not a Swift type checker. Unknown or conflicting types
stay unknown so callers can request an explicit typed expression.
"""
import re
from localization_lexers import SwiftLexer


# A type body brace: `struct A: B where T: C {`. Headers with a member keyword
# (`class func`, `class var`) or a parameter list are declarations, not types.
TYPE_BODY = re.compile(r"\b(?:struct|class|enum|extension|actor|protocol)\s+[^{};]*\{")
NOT_TYPE_HEADER = re.compile(r"\b(?:func|var|let|init|subscript|case)\b|\(")


def innermost_braces(braces, positions):
    """Map each position to the opening of its innermost enclosing brace."""
    result, stack, index = {}, [], 0
    for position in sorted(positions):
        while index < len(braces) and braces[index][0] < position:
            opening, closing = braces[index]
            while stack and stack[-1][1] < opening:
                stack.pop()
            stack.append((opening, closing))
            index += 1
        while stack and stack[-1][1] < position:
            stack.pop()
        result[position] = stack[-1][0] if stack else None
    return result


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
        self.member_values = {}
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
                    # Stop at the brace/paren that closes the enclosing scope, so
                    # `struct B { let value = 3 }` yields `3`, not `3 }`.
                    end, depth = match.end(2), 0
                    for i in range(match.start(2), match.end(2)):
                        if code[i] in "([{":
                            depth += 1
                        elif code[i] in ")]}":
                            if not depth:
                                end = i
                                break
                            depth -= 1
                    value = re.split(r"\s+else\s*\{|\s+\{", source[match.start(2):end], maxsplit=1)[0].strip()
                    entries.append((match[1], match.start(), None, value))
            self.entries[path] = entries
            for name, pos, typename, value in entries:
                if typename:
                    self.members.setdefault(name, set()).add(FORMATS.get(typename))
            # Inferred stored members (`let value = 3` in a type body) can be read
            # as `b.value` too; without them an unrelated `A.value: String` would
            # decide the type of `B.value`.
            type_bodies = {match.end() - 1 for match in TYPE_BODY.finditer(code)
                           if not NOT_TYPE_HEADER.search(match[0][:-1])}
            braces = sorted((a, b) for a, b in delimiters.items() if code[a] == "{")
            inferred = [(name, pos, value) for name, pos, typename, value in entries if not typename]
            enclosing = innermost_braces(braces, [pos for _, pos, _ in inferred])
            for name, pos, value in inferred:
                if enclosing[pos] in type_bodies:
                    self.member_values.setdefault(name, []).append((path, pos, value))
            for match in re.finditer(r"\bfunc\s+(\w+)\s*\([^{}]*?\)\s*(?:async\s*)?(?:throws\s*)?->\s*(\w+)", code):
                self.functions.setdefault(match[1], set()).add(FORMATS.get(match[2]))

    def member_formats(self, name, seen):
        """Formats of every same-named member, explicit or inferred (None = unknown)."""
        formats = set(self.members.get(name, ()))
        for path, pos, value in self.member_values.get(name, ()):
            if len(formats) > 1 or None in formats:
                break
            formats.add(self.infer(value, path, pos, seen))
        return formats

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
            # Collection/String count, unless a custom `count` member disagrees.
            return "lld" if self.member_formats(name, seen) <= {"lld"} else None
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
        # Member properties and functions may be declared in another file. The
        # receiver's type is not resolved, so every same-named declaration must
        # agree; conflicting or unknown types never choose one arbitrarily.
        types = self.member_formats(name, seen)
        return next(iter(types)) if len(types) == 1 and None not in types else None
