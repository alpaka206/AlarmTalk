"""Format-argument contracts for Apple string catalogs and Android resources."""
from collections import Counter
import re


def format_signature(value, platform="swift"):
    if platform == "android":
        pattern = r"%(?:(\d+)\$)?([-#+ 0,(<]*)(?:\d+)?(?:\.\d+)?([tT][A-Za-z]|[bBhHsScCdoxXeEfgGaA%n])"
    else:
        pattern = r"%(?:(\d+)\$)?[-+ #0]*\d*(?:\.\d+)?(hh|h|ll|l|L|j|z|t|q)?([@diuoxXfFeEgGaAcCsSp%])"
    result = Counter()
    next_index, previous_index = 1, 0
    for match in re.finditer(pattern, value):
        conversion = match[3]
        if conversion == "%" or (platform == "android" and conversion == "n"):
            continue
        if platform == "android" and "<" in match[2]:
            index = previous_index
        elif match[1]:
            index = int(match[1])
        else:
            index = next_index
            next_index += 1
        previous_index = index
        kind = conversion if platform == "android" else (match[2] or "") + conversion
        result[(index, kind)] += 1
    return result


SUBSTITUTION = re.compile(r"%(?:\d+\$)?#@(\w+)@")


def render_substitutions(value, substitutions, path):
    """Expand `%#@name@` into each variation leaf, `%arg` into its argument.

    The rendered strings carry the substitution's `argNum` and
    `formatSpecifier`, so changing either (or dropping `%arg`) changes the
    signature. A token without metadata is left as is and fails to match.
    """
    rendered = {path: value}
    for name in dict.fromkeys(SUBSTITUTION.findall(value)):
        meta = substitutions.get(name) if isinstance(substitutions, dict) else None
        if not isinstance(meta, dict):
            continue
        argument = "%{}${}".format(meta.get("argNum"), meta.get("formatSpecifier"))
        token = re.compile(r"%(?:\d+\$)?#@" + re.escape(name) + "@")
        choices = catalog_values({key: child for key, child in meta.items() if key == "variations"})
        if not choices:
            continue  # Leave the token; it then fails to match the source.
        rendered = {base + ("substitutions", name) + leaf_path: token.sub(lambda _: leaf.replace("%arg", argument), text)
                    for base, text in rendered.items() for leaf_path, leaf in choices.items()}
    return rendered


def catalog_values(node, path=()):
    """Keep the variation path so device/plural leaves compare to their peers."""
    if not isinstance(node, dict):
        return {}
    values = {}
    for key, child in node.items():
        if key == "stringUnit" and isinstance(child, dict) and isinstance(child.get("value"), str):
            values.update(render_substitutions(child["value"], node.get("substitutions"), path))
        elif key != "substitutions" and isinstance(child, dict):
            values.update(catalog_values(child, path + (key,)))
    return values


def source_values_for_path(source, path):
    if path in source:
        return [source[path]]
    # Korean/Japanese commonly have only `other`; English additionally has `one`.
    # Device variations also use `other` as their common fallback.
    fallback = tuple("other" if i > 0 and path[i - 1] in {"plural", "device"} else part
                     for i, part in enumerate(path))
    if fallback in source:
        return [source[fallback]]
    if () in source:
        return [source[()]]
    # A common target leaf must preserve the arguments of every source variant.
    return list(source.values())


def catalog_format_mismatches(source, target, source_key):
    sources = catalog_values(source) or {(): source_key}
    return [path for path, value in catalog_values(target).items()
            if any(format_signature(expected) != format_signature(value) or line_breaks(expected) != line_breaks(value)
                   for expected in source_values_for_path(sources, path))]


def android_format_mismatches(source, target, check_line_breaks=True):
    if source.tag != target.tag:
        return []
    if source.tag == "string":
        pairs = [("string", source, target)]
    elif source.tag == "string-array":
        pairs = [(str(index), a, b) for index, (a, b) in enumerate(zip(source, target))]
    else:
        sources = {item.get("quantity"): item for item in source}
        pairs = []
        for item in target:
            quantity = item.get("quantity")
            expected = sources.get(quantity)
            if expected is None:
                expected = sources.get("other")
            if expected is not None:
                pairs.append((quantity, expected, item))
    mismatches = []
    for path, a, b in pairs:
        first, second = "".join(a.itertext()), "".join(b.itertext())
        formatted = source.get("formatted") != "false"
        if (formatted and format_signature(first, "android") != format_signature(second, "android")) or (check_line_breaks and line_breaks(first, "android", formatted) != line_breaks(second, "android", formatted)):
            mismatches.append(path)
    return mismatches


def line_breaks(value, platform="swift", formatted=True):
    if platform == "android":
        # Decode escapes once: \\n is a newline, but \\\\n is literal text.
        value = re.sub(r'\\(u[0-9a-fA-F]{4}|.)',
                       lambda match: chr(int(match[1][1:], 16)) if match[1].startswith('u') else {'n': '\n', 'r': '\r'}.get(match[1], match[1]), value)
        if formatted:
            value = re.sub(r'%%|%n', lambda match: '\n' if match[0] == '%n' else '%', value)
    return len(re.findall(r'\r\n|\r|\n', value))
