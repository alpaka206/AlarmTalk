"""Localization audit lexers (standard library only).

Skip comments, preserve expression nesting and source offsets, and recurse into
interpolations. These lexers do not type-check Swift or Kotlin; callers must
validate the contexts they accept rather than assume every UI string is a key.
"""
import re, bisect

HANGUL = re.compile(r'[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]')

def build_cond(lines):
    stack = []
    cond_at_line = {}
    for idx, ln in enumerate(lines, 1):
        s = ln.strip()
        if s.startswith('#if ') or s.startswith('#if('):
            stack.append([s[3:].strip(), False])
        elif s.startswith('#elseif'):
            if stack: stack[-1] = [s[7:].strip(), False]
        elif s == '#else' or s.startswith('#else ') or s.startswith('#else/'):
            if stack: stack[-1][1] = True
        elif s.startswith('#endif'):
            if stack: stack.pop()
        cond_at_line[idx] = [tuple(x) for x in stack]
    return cond_at_line

def is_debug_only(cond):
    for text, in_else in cond:
        t = text.replace(' ', '')
        if t in ('DEBUG',) and not in_else:
            return True
        if t == '!DEBUG' and in_else:
            return True
    return False

class SwiftLexer:
    def __init__(self, src, fname=''):
        self.src = src; self.n = len(src); self.fname = fname
        self.line_starts = [0] + [m.end() for m in re.finditer('\n', src)]
        self.cond = build_cond(src.split('\n'))
        self.lits = []
    def lineno(self, pos):
        return bisect.bisect_right(self.line_starts, pos)
    def parse_string(self, pos, hashes, stack, parent=None):
        src = self.src; n = self.n
        multiline = src.startswith('"""', pos)
        q = '"""' if multiline else '"'
        j = pos + len(q)
        parts = []; buf = []
        close = q + '#'*hashes
        esc = '\\' + '#'*hashes
        interps = []
        while j < n:
            if src.startswith(close, j):
                if buf: parts.append(('lit', ''.join(buf)))
                return j + len(close), parts, multiline, interps
            if src.startswith(esc, j):
                k = j + len(esc)
                c = src[k] if k < n else ''
                if c == '(':
                    if buf: parts.append(('lit', ''.join(buf))); buf = []
                    k += 1
                    estart = k
                    k = self.scan_code(k, stack + [('interp', estart-1)], until_close=True)
                    parts.append(('interp', src[estart:k]))
                    interps.append((estart, k))
                    j = k + 1
                    continue
                mp = {'n':'\n','t':'\t','"':'"','\\':'\\',"'":"'",'0':'\0','r':'\r'}
                if c in mp: buf.append(mp[c]); j = k+1; continue
                if c == 'u':
                    m = re.match(r'u\{([0-9a-fA-F]+)\}', src[k:])
                    if m: buf.append(chr(int(m.group(1),16))); j = k + m.end(); continue
                if c == '\n' and multiline:
                    j = k+1
                    while j < n and src[j] in " \t": j += 1
                    continue
                buf.append(src[j:k+1]); j = k+1; continue
            buf.append(src[j]); j += 1
        raise ValueError(f'unterminated string in {self.fname} at line {self.lineno(pos)}')
    def scan_code(self, i, stack, until_close=False):
        """Scan code from i. If until_close, stop at the ')' closing the interpolation (returns its index)."""
        src = self.src; n = self.n
        stack = list(stack)
        base = len(stack)
        while i < n:
            c = src[i]
            if src.startswith('//', i):
                e = src.find('\n', i); i = n if e < 0 else e; continue
            if src.startswith('/*', i):
                depth = 1; k = i + 2
                while k < n and depth:
                    if src.startswith('/*', k): depth += 1; k += 2
                    elif src.startswith('*/', k): depth -= 1; k += 2
                    else: k += 1
                i = k; continue
            if c == '#' and re.match(r'#+"', src[i:]):
                h = 0
                while src[i+h] == '#': h += 1
                start = i
                e, parts, ml, interps = self.parse_string(i+h, h, stack)
                self.lits.append(dict(start=start, end=e, parts=parts, multiline=ml, stack=list(stack)))
                i = e; continue
            if c == '"':
                start = i
                e, parts, ml, interps = self.parse_string(i, 0, stack)
                self.lits.append(dict(start=start, end=e, parts=parts, multiline=ml, stack=list(stack)))
                i = e; continue
            if c in '([{':
                stack.append((c, i)); i += 1; continue
            if c in ')]}':
                if until_close and len(stack) == base and c == ')':
                    return i
                if len(stack) > base or not until_close:
                    if stack: stack.pop()
                i += 1; continue
            i += 1
        return i
    def run(self):
        self.scan_code(0, [])
        for l in self.lits:
            l['line'] = self.lineno(l['start'])
            l['endline'] = self.lineno(l['end']-1)
            l['cond'] = self.cond.get(l['line'], [])
            l['debug'] = is_debug_only(l['cond'])
        return self.lits


def kotlin_literals(src):
    """Return (start, end, decoded text, raw) for strings and nested templates."""
    i = 0
    n = len(src)
    results = []

    def skip_block_comment(i):
        depth = 1
        i += 2
        while i < n and depth:
            if src.startswith("/*", i):
                depth += 1
                i += 2
            elif src.startswith("*/", i):
                depth -= 1
                i += 2
            else:
                i += 1
        return i

    def read_string(i):
        """i points at opening quote(s). Returns end index (after closing)."""
        raw = src.startswith('"""', i)
        start = i
        i += 3 if raw else 1
        buf = []
        while i < n:
            if raw:
                if src.startswith('"""', i):
                    # raw strings can end with extra quotes """"
                    j = i + 3
                    while j < n and src[j] == '"':
                        j += 1
                    buf.append(src[i:j - 3])
                    results.append((start, j, "".join(buf), True))
                    return j
            else:
                c = src[i]
                if c == "\\":
                    unicode_escape = re.match(r"\\u([0-9a-fA-F]{4})", src[i:])
                    if unicode_escape:
                        buf.append(chr(int(unicode_escape[1], 16)))
                        i += unicode_escape.end()
                        continue
                    buf.append(src[i:i + 2])
                    i += 2
                    continue
                if c == '"':
                    results.append((start, i + 1, "".join(buf), False))
                    return i + 1
                if c == "\n":
                    # unterminated; bail
                    results.append((start, i, "".join(buf), False))
                    return i
            if src.startswith("${", i):
                # template expression: scan code until matching }
                j = i + 2
                depth = 1
                while j < n and depth:
                    if src[j] == '"':
                        j = read_string(j)
                        continue
                    if src.startswith("//", j):
                        while j < n and src[j] != "\n":
                            j += 1
                        continue
                    if src.startswith("/*", j):
                        j = skip_block_comment(j)
                        continue
                    if src[j] == "'":
                        j = read_char(j)
                        continue
                    if src[j] == "{":
                        depth += 1
                    elif src[j] == "}":
                        depth -= 1
                    j += 1
                buf.append("${" + src[i + 2:j - 1] + "}")
                i = j
                continue
            buf.append(src[i])
            i += 1
        return i

    def read_char(i):
        # 'x' or '\n' or 'ሴ'
        j = i + 1
        if j < n and src[j] == "\\":
            j += 2
            while j < n and src[j] != "'":
                j += 1
            return j + 1
        # could be a char literal
        if j + 1 < n and src[j + 1] == "'":
            return j + 2
        return i + 1

    while i < n:
        c = src[i]
        if src.startswith("//", i):
            while i < n and src[i] != "\n":
                i += 1
            continue
        if src.startswith("/*", i):
            i = skip_block_comment(i)
            continue
        if c == '"':
            i = read_string(i)
            continue
        if c == "'":
            i = read_char(i)
            continue
        i += 1
    return results

