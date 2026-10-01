#!/usr/bin/env python3
"""날씨 지역 목록(`packages/shared/src/weather-regions.json`)에서 두 앱의 코드를 만든다.

## 왜 있는가

지역 목록은 **한 벌**이어야 한다. 예전에는 안드로이드 `WeatherPresetCityKeys`·로케일별
`hs_weather_preset_cities`, iOS `WeatherCityPickerSheet.presetCities` 가 **손으로 맞춘 세 벌**
이었고, 실제로 갈라져 있었다 — 안드로이드 영어 목록은 비어 있었고, 일본어 목록은 일본 도시인데
나라는 `대한민국` 으로 보냈다(docs/spec/voice-and-message.md 「5-1」). 서버는 그걸 동명 마을로
지오코딩했다(부산 → 경북 의성군의 마을).

이제 원본은 JSON 하나다. 백엔드는 `@alarmtalk/shared` 로 JSON 을 그대로 읽고, TypeScript 를
못 쓰는 두 앱은 이 스크립트가 만든 파일을 쓴다. **만든 파일을 손으로 고치지 말 것** — 다음
생성이 덮고, `--check` 가 CI 에서 어긋남을 잡는다.

## 만드는 것

| 대상 | 파일 |
| --- | --- |
| Android 코드 | `apps/android-native/app/src/main/java/com/alarmtalk/app/data/WeatherRegions.kt` |
| Android 이름 | `apps/android-native/app/src/main/res/values{,-en,-ja}/weather_regions.xml` |
| iOS | `apps/ios-native/AlarmTalk/Generated/WeatherRegions.generated.swift` |

이름을 안드로이드는 **리소스**로(앱 언어 설정을 시스템이 따라가게), iOS 는 **코드 안 표**로
(`Localizable.xcstrings` 는 사람이 고치는 큰 파일이라 생성물을 섞지 않는다) 싣는다. 어느 언어로
보일지는 iOS 도 다른 문자열과 같은 기준(`Bundle.preferredLocalizations`)을 쓴다.

## 별칭 정규화 — 세 언어가 **글자 하나까지** 같아야 한다

옛 앱이 저장한 `country`/`city` 문자열을 지역 키로 되짚는 규칙이다(`resolve`). 이 파일의
`canon`·`alias_key`·`strip_suffix`·`resolve` 가 원본이고, TypeScript
(`packages/shared/src/weather-regions.ts`)·Kotlin·Swift(아래 생성 코드)가 같은 것을 한다.
하나만 고치면 서버와 앱이 같은 옛 값을 다른 지역으로 읽는다.

실행:
  python3 scripts/gen-weather-regions.py          # 파일을 새로 쓴다
  python3 scripts/gen-weather-regions.py --check  # 디스크의 파일이 JSON 과 맞는지만 본다(CI)
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "packages/shared/src/weather-regions.json"
ANDROID_KT = ROOT / "apps/android-native/app/src/main/java/com/alarmtalk/app/data/WeatherRegions.kt"
ANDROID_RES = ROOT / "apps/android-native/app/src/main/res"
ANDROID_XML = {
    "ko": ANDROID_RES / "values/weather_regions.xml",
    "en": ANDROID_RES / "values-en/weather_regions.xml",
    "ja": ANDROID_RES / "values-ja/weather_regions.xml",
}
IOS_SWIFT = ROOT / "apps/ios-native/AlarmTalk/Generated/WeatherRegions.generated.swift"

LOCALES = ("ko", "en", "ja")
COUNTRY_CODES = ("KR", "JP", "US")
KEY_RE = re.compile(r"^(kr|jp|us)-[a-z0-9]+(-[a-z0-9]+)*$")
TZ_RE = re.compile(r"^[A-Za-z_]+(/[A-Za-z0-9_+\-]+)+$")

# ── 정규화(세 언어 공통 규칙) ──────────────────────────────────────────────
# 1. NFKC(전각 괄호·전각 공백을 반각으로) → 2. 소문자 → 3. 아래 글자를 공백으로 →
# 4. 공백 여러 개를 하나로, 앞뒤 공백 제거. 별칭 표의 **열쇠**는 여기서 공백까지 뺀 것이다
# (`alias_key`) — "오클라호마 시티" 와 "오클라호마시티", "New York" 을 "New"·"York" 으로 가른
# 옛 입력을 한 열쇠로 모은다.
SEPARATORS = " \t\n\r\x0b\x0c.,·・'’\"()/_-、。"
# 한 번만 떼어 본다(정확히 맞는 별칭이 없을 때만). 긴 것부터 — '특별자치시' 를 '시' 보다 먼저.
SUFFIXES = (
    "특별자치시", "특별자치도", "특별시", "광역시",
    " prefecture", " city", " ken", " shi", " si", " gun", " do", " to", " fu",
    "시", "도", "군", "都", "道", "府", "県", "市",
)


def canon(raw: str | None) -> str:
    text = unicodedata.normalize("NFKC", raw or "").lower()
    text = "".join(" " if ch in SEPARATORS else ch for ch in text)
    return " ".join(part for part in text.split(" ") if part)


def alias_key(raw: str | None) -> str:
    return canon(raw).replace(" ", "")


def strip_suffix(text: str) -> str | None:
    for suffix in SUFFIXES:
        if text.endswith(suffix):
            rest = text[: -len(suffix)].strip()
            return rest or None
    return None


def has_latin(text: str) -> bool:
    """정규형 글자에 로마자(a-z)가 있는가 — 첫 낱말로 다시 찾을지 가른다(`resolve`)."""
    return any("a" <= ch <= "z" for ch in text)


class Catalog:
    def __init__(self, data: dict):
        self.data = data
        self.countries: list[dict] = data["countries"]
        self.regions: list[dict] = sorted(
            data["regions"],
            key=lambda r: (COUNTRY_CODES.index(r["country"]), r["order"]),
        )
        self.country_by_code = {c["code"]: c for c in self.countries}
        self.region_by_key = {r["key"]: r for r in self.regions}
        self.alias_index: dict[str, str] = {}
        self.country_index: dict[str, str] = {}

    # 지역이 받아 주는 글자 — 세 언어 이름 + 대표 도시 이름 + 별칭.
    @staticmethod
    def region_labels(region: dict) -> list[str]:
        labels = [region.get("names", {}).get(l) for l in LOCALES]
        labels += [(region.get("seatNames") or {}).get(l) for l in LOCALES]
        return [label for label in labels + list(region.get("aliases", [])) if label]

    @staticmethod
    def country_labels(country: dict) -> list[str]:
        labels = [country.get("names", {}).get(l) for l in LOCALES] + [country.get("legacyLabel")]
        return [label for label in labels + list(country.get("aliases", [])) if label]

    def match(self, text: str) -> str | None:
        if not text:
            return None
        hit = self.alias_index.get(alias_key(text))
        if hit:
            return hit
        stripped = strip_suffix(text)
        return self.alias_index.get(alias_key(stripped)) if stripped else None

    def country_of(self, text: str) -> str | None:
        return self.country_index.get(alias_key(text)) if text else None

    def resolve(self, country: str | None, city: str | None) -> str | None:
        """옛 (나라, 도시) 문자열 → 지역 키. 못 찾으면 None.

        - 나라가 비었거나 **아는 나라**(KR/JP/US 표기)면 도시로 찾는다. 나라가 `대한민국`(또는 빈 값)
          이면 도시가 다른 나라 지역이어도 받는다 — 옛 앱은 공백 없는 입력에 나라를 자동으로
          `대한민국` 으로 붙였다(일본어 목록의 東京, 영어 기기의 "Tokyo"). 일본·미국이라고 적었으면
          그 나라 안에서만 찾는다.
        - **모르는 나라**면 옛 입력칸이 첫 낱말을 나라로 떼어 간 것이다("New York" → "New"/"York",
          "경기도 수원시", "서울 강남구"). 둘을 이어 붙여 찾는다. 도시만으로는 찾지 않는다 —
          "영국 버밍엄" 이 앨라배마로 가면 안 된다.
        - **첫 낱말로 한 번 더** 찾는 것(여러 낱말 도시의 첫 낱말, 모르는 나라 자리의 낱말)은 그 낱말에
          **로마자가 없을 때만**이다. 한국어·일본어 주소는 넓은 곳이 앞이지만("서울 강남구"),
          영어는 도시가 앞이고 뒤가 주·나라라서("Birmingham England", "La Paz", "Jackson Hole")
          앞 낱말만 보면 다른 나라의 같은 이름 도시로 간다.
        """
        c, t = canon(country), canon(city)
        if not c and not t:
            return None
        code = self.country_of(c) if c else None
        if not c or code:
            first = t.split(" ")[0] if " " in t else ""
            hit = self.match(t) or (self.match(first) if not has_latin(first) else None)
            if hit and code and code != "KR" and self.region_by_key[hit]["country"] != code:
                return None
            return hit
        return self.match(canon(f"{c} {t}")) or (self.match(c) if not has_latin(c) else None)


# ── 검증 ──────────────────────────────────────────────────────────────────


def load() -> Catalog:
    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    cat = Catalog(data)
    problems: list[str] = []

    if data.get("version") != 1:
        problems.append("version 은 1 이어야 한다")
    codes = [c["code"] for c in cat.countries]
    if codes != list(COUNTRY_CODES):
        problems.append(f"countries 는 {COUNTRY_CODES} 순서여야 한다: {codes}")

    for country in cat.countries:
        for label in cat.country_labels(country):
            key = alias_key(label)
            owner = cat.country_index.setdefault(key, country["code"])
            if owner != country["code"]:
                problems.append(f"나라 별칭 '{label}' 이 {owner}·{country['code']} 에 겹친다")
        for alias in country.get("aliases", []):
            if canon(alias) != alias:
                problems.append(f"나라 별칭 '{alias}' 은 정규형 '{canon(alias)}' 으로 적어야 한다")

    seen_keys: set[str] = set()
    orders: dict[str, list[int]] = {code: [] for code in COUNTRY_CODES}
    for region in cat.regions:
        key = region["key"]
        where = f"지역 {key}"
        if not KEY_RE.match(key):
            problems.append(f"{where}: 키 형식")
        if key in seen_keys:
            problems.append(f"{where}: 키가 겹친다")
        seen_keys.add(key)
        if region["country"] not in COUNTRY_CODES or not key.startswith(region["country"].lower() + "-"):
            problems.append(f"{where}: 키 접두사와 나라가 맞지 않는다")
        orders.setdefault(region["country"], []).append(region["order"])
        for group in ("names", "seatNames"):
            names = region.get(group)
            if names is None and group == "seatNames":
                continue
            if set(names or {}) != set(LOCALES) or not all(str(names[l]).strip() for l in LOCALES):
                problems.append(f"{where}: {group} 에 ko·en·ja 가 모두 있어야 한다")
        if not (-90 <= region["lat"] <= 90 and -180 <= region["lon"] <= 180):
            problems.append(f"{where}: 좌표 범위")
        if not TZ_RE.match(region["tz"]):
            problems.append(f"{where}: 시간대 형식 '{region['tz']}'")
        else:
            try:
                from zoneinfo import ZoneInfo

                ZoneInfo(region["tz"])
            except ImportError:
                pass
            except Exception:  # noqa: BLE001 — 없는 시간대
                problems.append(f"{where}: 없는 시간대 '{region['tz']}'")
        for alias in region.get("aliases", []):
            if canon(alias) != alias:
                problems.append(f"{where}: 별칭 '{alias}' 은 정규형 '{canon(alias)}' 으로 적어야 한다")
        for label in cat.region_labels(region):
            k = alias_key(label)
            if not k:
                problems.append(f"{where}: '{label}' 은 정규화하면 빈 글자다")
                continue
            if k in cat.country_index:
                problems.append(f"{where}: '{label}' 이 나라 별칭과 겹친다")
            owner = cat.alias_index.setdefault(k, key)
            if owner != key:
                problems.append(f"{where}: '{label}' 이 {owner} 와 겹친다")

    for code, found in orders.items():
        if sorted(found) != list(range(1, len(found) + 1)):
            problems.append(f"{code} 의 order 는 1..{len(found)} 이 빠짐·겹침 없이 있어야 한다")

    # 옛 앱용 글자 왕복은 모양이 맞을 때만 볼 수 있다.
    for region in [] if problems else cat.regions:
        labels = canonical_labels(cat, region)
        back = cat.resolve(*labels)
        if back != region["key"]:
            problems.append(f"지역 {region['key']}: 옛 앱용 글자 {labels} 가 {back} 로 되짚힌다")

    if problems:
        print("weather-regions.json 이 규칙을 어긴다:\n")
        for p in problems:
            print(f"  - {p}")
        sys.exit(1)
    return cat


def canonical_labels(cat: Catalog, region: dict) -> tuple[str, str]:
    return cat.country_by_code[region["country"]]["legacyLabel"], region["names"]["ko"]


# ── 생성: Android ─────────────────────────────────────────────────────────

HEADER_NOTE = "이 파일은 scripts/gen-weather-regions.py 가 만든다. 직접 고치지 말 것."


def res_name(key: str) -> str:
    return key.replace("-", "_")


def kt_str(value: str) -> str:
    out = []
    for ch in value:
        if ch == "\\":
            out.append("\\\\")
        elif ch == '"':
            out.append('\\"')
        elif ch == "$":
            out.append("\\$")
        elif ord(ch) < 0x20:
            out.append(f"\\u{ord(ch):04X}")
        else:
            out.append(ch)
    return '"' + "".join(out) + '"'


def xml_str(value: str) -> str:
    out = value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    out = out.replace("\\", "\\\\").replace("'", "\\'").replace('"', '\\"')
    if out[:1] in ("@", "?"):
        out = "\\" + out
    return out


def gen_android_xml(cat: Catalog, locale: str) -> str:
    lines = [
        '<?xml version="1.0" encoding="utf-8"?>',
        f"<!-- {HEADER_NOTE}",
        "     출처: packages/shared/src/weather-regions.json. 저장·전송 값은 이 이름이 아니라 지역 키다. -->",
        "<resources>",
    ]
    for country in cat.countries:
        lines.append(
            f'    <string name="weather_country_{country["code"].lower()}">{xml_str(country["names"][locale])}</string>'
        )
    for region in cat.regions:
        lines.append(f'    <string name="weather_region_{res_name(region["key"])}">{xml_str(region["names"][locale])}</string>')
        if region.get("seatNames"):
            lines.append(
                f'    <string name="weather_region_seat_{res_name(region["key"])}">'
                f'{xml_str(region["seatNames"][locale])}</string>'
            )
    lines.append("</resources>")
    return "\n".join(lines) + "\n"


def gen_android_kt(cat: Catalog) -> str:
    out: list[str] = []
    w = out.append
    w(f"// {HEADER_NOTE}")
    w("// 출처: packages/shared/src/weather-regions.json — 지역 목록의 유일한 출처다.")
    w("// 규칙: docs/spec/voice-and-message.md 「5-1」의 '날씨 지역은 목록에서만 고른다'.")
    w('@file:Suppress("SpellCheckingInspection", "MaxLineLength", "LargeClass")')
    w("")
    w("package com.alarmtalk.app.data")
    w("")
    w("import androidx.annotation.StringRes")
    w("import com.alarmtalk.app.R")
    w("import java.text.Normalizer")
    w("import java.util.Locale")
    w("")
    w("/**")
    w(" * 지역 목록의 나라. 공휴일 달력 국가([HolidayCountryPreferenceStore])도 같은 코드를 쓴다 —")
    w(" * 지역을 고르면 그 나라가 공휴일 국가가 된다.")
    w(" */")
    w("enum class WeatherCountry(")
    w("    val code: String,")
    w("    /** 옛 앱이 읽는 `country` 칸에 쓰는 글자. 언어와 무관하게 한국어다. */")
    w("    val legacyLabel: String,")
    w("    @StringRes val nameRes: Int,")
    w(") {")
    for country in cat.countries:
        code = country["code"]
        w(f"    {code}({kt_str(code)}, {kt_str(country['legacyLabel'])}, R.string.weather_country_{code.lower()}),")
    w("    ;")
    w("")
    w("    companion object {")
    w("        /** \"KR\"·\"jp\" 같은 코드 → 나라. 모르는 코드면 null. */")
    w("        fun fromCode(code: String?): WeatherCountry? {")
    w("            val wanted = code?.trim()?.uppercase(Locale.ROOT) ?: return null")
    w("            return entries.firstOrNull { it.code == wanted }")
    w("        }")
    w("    }")
    w("}")
    w("")
    w("/**")
    w(" * 고를 수 있는 지역 하나. 저장·전송 값은 [key] 이고, 보이는 이름은 [nameRes] 다.")
    w(" * [seatNameRes] 는 날씨를 재는 대표 도시(경기 → 수원)가 지역 이름과 다를 때만 있다.")
    w(" */")
    w("data class WeatherRegion(")
    w("    val key: String,")
    w("    val country: WeatherCountry,")
    w("    /** 나라 안에서의 목록 순서(1부터). */")
    w("    val order: Int,")
    w("    @StringRes val nameRes: Int,")
    w("    @StringRes val seatNameRes: Int?,")
    w("    /** 옛 앱이 읽는 `city` 칸에 쓰는 글자(한국어 이름). */")
    w("    val legacyCity: String,")
    w(") {")
    w("    /** 옛 앱이 읽는 `country` 칸에 쓰는 글자. */")
    w("    val legacyCountry: String get() = country.legacyLabel")
    w("}")
    w("")
    w("/** 옛 앱이 읽는 (나라, 도시) 글자 한 벌. */")
    w("data class WeatherRegionLabels(val country: String, val city: String)")
    w("")
    w("object WeatherRegions {")
    w("    /** 전체 목록 — 나라(KR·JP·US) 순, 나라 안에서는 [WeatherRegion.order] 순. */")
    w("    val all: List<WeatherRegion> = listOf(")
    for region in cat.regions:
        rn = res_name(region["key"])
        seat = f"R.string.weather_region_seat_{rn}" if region.get("seatNames") else "null"
        w(
            f"        WeatherRegion({kt_str(region['key'])}, WeatherCountry.{region['country']}, {region['order']}, "
            f"R.string.weather_region_{rn}, {seat}, {kt_str(region['names']['ko'])}),"
        )
    w("    )")
    w("")
    w("    private val byKeyIndex: Map<String, WeatherRegion> = all.associateBy { it.key }")
    w("")
    w("    /** 키 → 지역. 목록에 없는 키(옛 버전·오타)면 null. */")
    w("    fun byKey(key: String?): WeatherRegion? = key?.trim()?.let { byKeyIndex[it] }")
    w("")
    w("    /** 그 나라의 지역들, 목록 순서대로. */")
    w("    fun byCountry(country: WeatherCountry): List<WeatherRegion> = all.filter { it.country == country }")
    w("")
    w("    /** 지역 키 → 옛 앱이 읽는 (나라, 도시) 글자. 알람의 `voiceWeatherCountry`/`City` 에 이걸 적는다. */")
    w("    fun canonicalLabels(key: String?): WeatherRegionLabels? =")
    w("        byKey(key)?.let { WeatherRegionLabels(it.legacyCountry, it.legacyCity) }")
    w("")
    w("    /** 나라 표기(\"대한민국\"·\"Japan\"·\"アメリカ\"·\"US\" …) → 나라. 모르는 표기면 null. */")
    w("    fun countryForLabel(label: String?): WeatherCountry? {")
    w("        val key = aliasKey(label)")
    w("        return if (key.isEmpty()) null else countryAliasIndex[key]")
    w("    }")
    w("")
    w("    /**")
    w("     * 옛 (나라, 도시) 문자열 → 지역. 못 찾으면 null — 그 값은 서버의 옛 경로(엄격한 지오코딩)로")
    w("     * 계속 돌고, 화면은 다시 고르라고 권한다. 규칙은 `scripts/gen-weather-regions.py` 의")
    w("     * `resolve` 와 글자 하나까지 같다(서버 `WeatherRegions.resolveAlias` 도 같다).")
    w("     */")
    w("    fun resolveAlias(country: String?, city: String?): WeatherRegion? {")
    w("        val c = canonicalize(country)")
    w("        val t = canonicalize(city)")
    w("        if (c.isEmpty() && t.isEmpty()) return null")
    w("        val code = if (c.isEmpty()) null else countryForLabel(c)")
    w("        if (c.isEmpty() || code != null) {")
    w("            val first = if (' ' in t) t.substringBefore(' ') else \"\"")
    w("            val hit = byKey(match(t) ?: if (hasLatin(first)) null else match(first)) ?: return null")
    w("            // 일본·미국이라고 적었으면 그 나라 안에서만. 대한민국은 옛 앱이 자동으로 붙인 값이라 어긋나도 받는다.")
    w("            return if (code != null && code != WeatherCountry.KR && hit.country != code) null else hit")
    w("        }")
    w("        return byKey(match(canonicalize(\"$c $t\")) ?: if (hasLatin(c)) null else match(c))")
    w("    }")
    w("")
    w("    /** 로마자가 있는 낱말은 첫 낱말로 다시 찾지 않는다(\"Birmingham England\" 가 앨라배마로 간다). */")
    w("    private fun hasLatin(text: String): Boolean = text.any { it in 'a'..'z' }")
    w("")
    w("    /** NFKC → 소문자 → 구분 글자를 공백으로 → 공백 하나로·앞뒤 제거. */")
    w("    fun canonicalize(raw: String?): String {")
    w("        if (raw.isNullOrEmpty()) return \"\"")
    w("        val folded = Normalizer.normalize(raw, Normalizer.Form.NFKC).lowercase(Locale.ROOT)")
    w("        val spaced = buildString(folded.length) {")
    w("            for (ch in folded) append(if (SEPARATORS.indexOf(ch) >= 0) ' ' else ch)")
    w("        }")
    w("        return spaced.split(' ').filter { it.isNotEmpty() }.joinToString(\" \")")
    w("    }")
    w("")
    w("    /** 별칭 표의 열쇠 — [canonicalize] 에서 공백까지 뺀 것. */")
    w("    fun aliasKey(raw: String?): String = canonicalize(raw).replace(\" \", \"\")")
    w("")
    w("    private fun match(text: String): String? {")
    w("        if (text.isEmpty()) return null")
    w("        aliasIndex[aliasKey(text)]?.let { return it }")
    w("        val stripped = stripSuffix(text) ?: return null")
    w("        return aliasIndex[aliasKey(stripped)]")
    w("    }")
    w("")
    w("    private fun stripSuffix(text: String): String? {")
    w("        for (suffix in SUFFIXES) {")
    w("            if (text.endsWith(suffix)) return text.dropLast(suffix.length).trim().ifEmpty { null }")
    w("        }")
    w("        return null")
    w("    }")
    w("")
    w(f"    private const val SEPARATORS = {kt_str(SEPARATORS)}")
    w("")
    w("    private val SUFFIXES = listOf(" + ", ".join(kt_str(s) for s in SUFFIXES) + ")")
    w("")
    w("    /** 나라 별칭 열쇠([aliasKey]) → 나라. */")
    w("    internal val countryAliasIndex: Map<String, WeatherCountry> = mapOf(")
    for k, code in sorted(cat.country_index.items()):
        w(f"        {kt_str(k)} to WeatherCountry.{code},")
    w("    )")
    w("")
    w("    /** 지역 별칭 열쇠([aliasKey]) → 지역 키. 이름·대표 도시·별칭이 모두 들어 있다. */")
    w("    internal val aliasIndex: Map<String, String> = mapOf(")
    for k, key in sorted(cat.alias_index.items(), key=lambda kv: (kv[1], kv[0])):
        w(f"        {kt_str(k)} to {kt_str(key)},")
    w("    )")
    w("}")
    return "\n".join(out) + "\n"


# ── 생성: iOS ─────────────────────────────────────────────────────────────


def swift_str(value: str) -> str:
    out = []
    for ch in value:
        if ch == "\\":
            out.append("\\\\")
        elif ch == '"':
            out.append('\\"')
        elif ord(ch) < 0x20:
            out.append(f"\\u{{{ord(ch):X}}}")
        else:
            out.append(ch)
    return '"' + "".join(out) + '"'


def swift_names(names: dict) -> str:
    return f"WeatherRegionNames(ko: {swift_str(names['ko'])}, en: {swift_str(names['en'])}, ja: {swift_str(names['ja'])})"


def gen_ios(cat: Catalog) -> str:
    out: list[str] = []
    w = out.append
    w(f"// {HEADER_NOTE}")
    w("// 출처: packages/shared/src/weather-regions.json — 지역 목록의 유일한 출처다.")
    w("// 규칙: docs/spec/voice-and-message.md 「5-1」의 '날씨 지역은 목록에서만 고른다'.")
    w("// 안드로이드 대응: data/WeatherRegions.kt(같은 스크립트가 만든다).")
    w("import Foundation")
    w("")
    w("/// 지역 목록의 나라. 공휴일 달력 국가도 같은 코드를 쓴다 — 지역을 고르면 그 나라가 공휴일 국가가 된다.")
    w("enum WeatherCountry: String, CaseIterable, Sendable {")
    for country in cat.countries:
        w(f"    case {country['code'].lower()} = {swift_str(country['code'])}")
    w("")
    w("    var code: String { rawValue }")
    w("")
    w("    /// 옛 앱이 읽는 `country` 칸에 쓰는 글자. 언어와 무관하게 한국어다.")
    w("    var legacyLabel: String {")
    w("        switch self {")
    for country in cat.countries:
        w(f"        case .{country['code'].lower()}: return {swift_str(country['legacyLabel'])}")
    w("        }")
    w("    }")
    w("")
    w("    var names: WeatherRegionNames {")
    w("        switch self {")
    for country in cat.countries:
        w(f"        case .{country['code'].lower()}: return {swift_names(country['names'])}")
    w("        }")
    w("    }")
    w("")
    w("    func displayName(language: String = WeatherRegions.currentLanguage()) -> String {")
    w("        names.value(for: language)")
    w("    }")
    w("")
    w("    /// \"KR\"·\"jp\" 같은 코드 → 나라. 모르는 코드면 nil.")
    w("    static func fromCode(_ code: String?) -> WeatherCountry? {")
    w("        guard let code else { return nil }")
    w("        return WeatherCountry(rawValue: code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased())")
    w("    }")
    w("}")
    w("")
    w("/// 세 언어 이름. 앱 언어가 en·ja 가 아니면 한국어를 쓴다.")
    w("struct WeatherRegionNames: Hashable, Sendable {")
    w("    let ko: String")
    w("    let en: String")
    w("    let ja: String")
    w("")
    w("    func value(for language: String) -> String {")
    w("        switch language {")
    w("        case \"en\": return en")
    w("        case \"ja\": return ja")
    w("        default: return ko")
    w("        }")
    w("    }")
    w("}")
    w("")
    w("/// 고를 수 있는 지역 하나. 저장·전송 값은 `key` 이고, 보이는 이름은 `displayName` 이다.")
    w("/// `seatNames` 는 날씨를 재는 대표 도시(경기 → 수원)가 지역 이름과 다를 때만 있다.")
    w("struct WeatherRegion: Hashable, Sendable, Identifiable {")
    w("    let key: String")
    w("    let country: WeatherCountry")
    w("    /// 나라 안에서의 목록 순서(1부터).")
    w("    let order: Int")
    w("    let names: WeatherRegionNames")
    w("    let seatNames: WeatherRegionNames?")
    w("")
    w("    var id: String { key }")
    w("    /// 옛 앱이 읽는 `country` 칸에 쓰는 글자.")
    w("    var legacyCountry: String { country.legacyLabel }")
    w("    /// 옛 앱이 읽는 `city` 칸에 쓰는 글자(한국어 이름).")
    w("    var legacyCity: String { names.ko }")
    w("")
    w("    func displayName(language: String = WeatherRegions.currentLanguage()) -> String {")
    w("        names.value(for: language)")
    w("    }")
    w("")
    w("    func seatDisplayName(language: String = WeatherRegions.currentLanguage()) -> String? {")
    w("        seatNames?.value(for: language)")
    w("    }")
    w("}")
    w("")
    w("enum WeatherRegions {")
    w("    /// 전체 목록 — 나라(KR·JP·US) 순, 나라 안에서는 `order` 순.")
    w("    static let all: [WeatherRegion] = [")
    for region in cat.regions:
        seat = swift_names(region["seatNames"]) if region.get("seatNames") else "nil"
        w(
            f"        WeatherRegion(key: {swift_str(region['key'])}, country: .{region['country'].lower()}, "
            f"order: {region['order']}, names: {swift_names(region['names'])}, seatNames: {seat}),"
        )
    w("    ]")
    w("")
    w("    private static let byKeyIndex: [String: WeatherRegion] = Dictionary(")
    w("        uniqueKeysWithValues: all.map { ($0.key, $0) }")
    w("    )")
    w("")
    w("    /// 키 → 지역. 목록에 없는 키(옛 버전·오타)면 nil.")
    w("    static func byKey(_ key: String?) -> WeatherRegion? {")
    w("        guard let key else { return nil }")
    w("        return byKeyIndex[key.trimmingCharacters(in: .whitespacesAndNewlines)]")
    w("    }")
    w("")
    w("    /// 그 나라의 지역들, 목록 순서대로.")
    w("    static func byCountry(_ country: WeatherCountry) -> [WeatherRegion] {")
    w("        all.filter { $0.country == country }")
    w("    }")
    w("")
    w("    /// 지역 키 → 옛 앱이 읽는 (나라, 도시) 글자. 알람 행의 날씨 나라·도시 칸에 이걸 적는다.")
    w("    static func canonicalLabels(key: String?) -> (country: String, city: String)? {")
    w("        guard let region = byKey(key) else { return nil }")
    w("        return (region.legacyCountry, region.legacyCity)")
    w("    }")
    w("")
    w("    /// 나라 표기(\"대한민국\"·\"Japan\"·\"アメリカ\"·\"US\" …) → 나라. 모르는 표기면 nil.")
    w("    static func country(forLabel label: String?) -> WeatherCountry? {")
    w("        let key = aliasKey(label)")
    w("        return key.isEmpty ? nil : countryAliasIndex[key]")
    w("    }")
    w("")
    w("    /// 옛 (나라, 도시) 문자열 → 지역. 못 찾으면 nil — 그 값은 서버의 옛 경로(엄격한 지오코딩)로")
    w("    /// 계속 돌고, 화면은 다시 고르라고 권한다. 규칙은 scripts/gen-weather-regions.py 의 resolve 와")
    w("    /// 글자 하나까지 같다(서버·안드로이드도 같다).")
    w("    static func resolveAlias(country: String?, city: String?) -> WeatherRegion? {")
    w("        let c = canonicalize(country)")
    w("        let t = canonicalize(city)")
    w("        if c.isEmpty && t.isEmpty { return nil }")
    w("        let code = c.isEmpty ? nil : self.country(forLabel: c)")
    w("        if c.isEmpty || code != nil {")
    w("            let first = t.contains(\" \") ? String(t.prefix { $0 != \" \" }) : \"\"")
    w("            guard let hit = byKey(match(t) ?? (hasLatin(first) ? nil : match(first))) else { return nil }")
    w("            // 일본·미국이라고 적었으면 그 나라 안에서만. 대한민국은 옛 앱이 자동으로 붙인 값이라 어긋나도 받는다.")
    w("            if let code, code != .kr, hit.country != code { return nil }")
    w("            return hit")
    w("        }")
    w("        return byKey(match(canonicalize(c + \" \" + t)) ?? (hasLatin(c) ? nil : match(c)))")
    w("    }")
    w("")
    w("    /// 로마자가 있는 낱말은 첫 낱말로 다시 찾지 않는다(\"Birmingham England\" 가 앨라배마로 간다).")
    w("    private static func hasLatin(_ text: String) -> Bool {")
    w("        text.unicodeScalars.contains { $0.value >= 0x61 && $0.value <= 0x7A }")
    w("    }")
    w("")
    w("    /// 앱이 지금 쓰는 언어(ko·en·ja). 다른 문자열과 같은 기준 — 번들이 고른 현지화다.")
    w("    static func currentLanguage(bundle: Bundle = .main) -> String {")
    w("        let code = bundle.preferredLocalizations.first")
    w("            .flatMap { Locale(identifier: $0).language.languageCode?.identifier }")
    w("        switch code {")
    w("        case \"en\": return \"en\"")
    w("        case \"ja\": return \"ja\"")
    w("        default: return \"ko\"")
    w("        }")
    w("    }")
    w("")
    w("    /// NFKC → 소문자 → 구분 글자를 공백으로 → 공백 하나로·앞뒤 제거.")
    w("    static func canonicalize(_ raw: String?) -> String {")
    w("        guard let raw, !raw.isEmpty else { return \"\" }")
    w("        let folded = raw.precomposedStringWithCompatibilityMapping.lowercased()")
    w("        var spaced = String.UnicodeScalarView()")
    w("        for scalar in folded.unicodeScalars {")
    w("            spaced.append(separators.contains(scalar) ? \" \" : scalar)")
    w("        }")
    w("        return spaced.split(separator: \" \")")
    w("            .map { String($0) }")
    w("            .joined(separator: \" \")")
    w("    }")
    w("")
    w("    /// 별칭 표의 열쇠 — `canonicalize` 에서 공백까지 뺀 것.")
    w("    static func aliasKey(_ raw: String?) -> String {")
    w("        canonicalize(raw).replacingOccurrences(of: \" \", with: \"\")")
    w("    }")
    w("")
    w("    private static func match(_ text: String) -> String? {")
    w("        if text.isEmpty { return nil }")
    w("        if let hit = aliasIndex[aliasKey(text)] { return hit }")
    w("        guard let stripped = stripSuffix(text) else { return nil }")
    w("        return aliasIndex[aliasKey(stripped)]")
    w("    }")
    w("")
    w("    private static func stripSuffix(_ text: String) -> String? {")
    w("        for suffix in suffixes where text.hasSuffix(suffix) {")
    w("            let rest = String(text.unicodeScalars.dropLast(suffix.unicodeScalars.count))")
    w("                .trimmingCharacters(in: CharacterSet(charactersIn: \" \"))")
    w("            return rest.isEmpty ? nil : rest")
    w("        }")
    w("        return nil")
    w("    }")
    w("")
    sep_scalars = ", ".join(f"0x{ord(ch):04X}" for ch in SEPARATORS)
    w("    private static let separators: Set<Unicode.Scalar> = Set(")
    w(f"        [{sep_scalars}].compactMap(Unicode.Scalar.init)")
    w("    )")
    w("")
    w("    private static let suffixes: [String] = [" + ", ".join(swift_str(s) for s in SUFFIXES) + "]")
    w("")
    w("    /// 나라 별칭 열쇠(`aliasKey`) → 나라.")
    w("    static let countryAliasIndex: [String: WeatherCountry] = [")
    for k, code in sorted(cat.country_index.items()):
        w(f"        {swift_str(k)}: .{code.lower()},")
    w("    ]")
    w("")
    w("    /// 지역 별칭 열쇠(`aliasKey`) → 지역 키. 이름·대표 도시·별칭이 모두 들어 있다.")
    w("    static let aliasIndex: [String: String] = [")
    for k, key in sorted(cat.alias_index.items(), key=lambda kv: (kv[1], kv[0])):
        w(f"        {swift_str(k)}: {swift_str(key)},")
    w("    ]")
    w("}")
    return "\n".join(out) + "\n"


# ── 실행 ──────────────────────────────────────────────────────────────────


def outputs(cat: Catalog) -> dict[Path, str]:
    files = {ANDROID_KT: gen_android_kt(cat), IOS_SWIFT: gen_ios(cat)}
    for locale, path in ANDROID_XML.items():
        files[path] = gen_android_xml(cat, locale)
    return files


def main(argv: list[str]) -> int:
    check = "--check" in argv
    cat = load()
    files = outputs(cat)
    if check:
        stale = [p for p, text in files.items() if not p.exists() or p.read_text(encoding="utf-8") != text]
        if stale:
            print("생성 파일이 weather-regions.json 과 맞지 않는다 — `python3 scripts/gen-weather-regions.py` 로 다시 만들 것:\n")
            for p in stale:
                print(f"  - {p.relative_to(ROOT)}")
            return 1
        print(f"날씨 지역 {len(cat.regions)}곳 — 생성 파일 {len(files)}개가 JSON 과 맞다.")
        return 0
    for path, text in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        print(f"썼다: {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
