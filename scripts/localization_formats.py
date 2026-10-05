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


def catalog_values(node, path=()):
    """Keep the variation path so device/plural leaves compare to their peers."""
    if not isinstance(node, dict):
        return {}
    values = {}
    for key, child in node.items():
        if key == "stringUnit" and isinstance(child, dict) and isinstance(child.get("value"), str):
            values[path] = child["value"]
        elif isinstance(child, dict):
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
            if any(format_signature(expected) != format_signature(value)
                   for expected in source_values_for_path(sources, path))]


def android_format_mismatches(source, target):
    if source.get("formatted") == "false" or source.tag != target.tag:
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
    return [path for path, a, b in pairs
            if format_signature("".join(a.itertext()), "android")
            != format_signature("".join(b.itertext()), "android")]
