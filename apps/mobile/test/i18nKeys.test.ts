import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const I18N_DIR = path.join(ROOT, 'src', 'i18n');
const APP_DIR = path.join(ROOT, 'app');
const SRC_DIR = path.join(ROOT, 'src');

const ko: Record<string, unknown> = JSON.parse(
  fs.readFileSync(path.join(I18N_DIR, 'ko.json'), 'utf-8'),
);
const en: Record<string, unknown> = JSON.parse(
  fs.readFileSync(path.join(I18N_DIR, 'en.json'), 'utf-8'),
);

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      keys.push(...flattenKeys(v as Record<string, unknown>, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

const koKeys = new Set(flattenKeys(ko));
const enKeys = new Set(flattenKeys(en));

function readAllSources(dir: string): Array<{ file: string; content: string }> {
  const results: Array<{ file: string; content: string }> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'i18n') continue;
      results.push(...readAllSources(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      results.push({ file: full, content: fs.readFileSync(full, 'utf-8') });
    }
  }
  return results;
}

function rel(absPath: string): string {
  return path.relative(ROOT, absPath).replace(/\\/g, '/');
}

function extractLiteralKeys(content: string): string[] {
  const keys: string[] = [];
  const patterns = [
    /\bt\(\s*'([^']+)'\s*[,)]/g,
    /\bt\(\s*"([^"]+)"\s*[,)]/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      keys.push(m[1]!);
    }
  }

  const mapRe = /:\s*'([\w.]+)'/g;
  let mm: RegExpExecArray | null;
  while ((mm = mapRe.exec(content))) {
    const val = mm[1]!;
    if (val.includes('.') && koKeys.has(val)) {
      keys.push(val);
    }
  }

  return keys;
}

const allFiles = [...readAllSources(APP_DIR), ...readAllSources(SRC_DIR)];

describe('i18n — locale parity', () => {
  test('ko.json and en.json have the same top-level namespaces', () => {
    const koNs = Object.keys(ko).sort();
    const enNs = Object.keys(en).sort();
    expect(enNs).toEqual(koNs);
  });

  test('every key in ko.json exists in en.json', () => {
    const missing = [...koKeys].filter((k) => !enKeys.has(k));
    expect(missing).toEqual([]);
  });

  test('every key in en.json exists in ko.json', () => {
    const missing = [...enKeys].filter((k) => !koKeys.has(k));
    expect(missing).toEqual([]);
  });

  test('leaf key count matches between locales', () => {
    expect(enKeys.size).toBe(koKeys.size);
  });

  test('no empty string values in ko.json', () => {
    const empty = [...koKeys].filter((k) => {
      const parts = k.split('.');
      let val: unknown = ko;
      for (const p of parts) val = (val as Record<string, unknown>)?.[p];
      return val === '';
    });
    expect(empty).toEqual([]);
  });

  test('no empty string values in en.json', () => {
    const empty = [...enKeys].filter((k) => {
      const parts = k.split('.');
      let val: unknown = en;
      for (const p of parts) val = (val as Record<string, unknown>)?.[p];
      return val === '';
    });
    expect(empty).toEqual([]);
  });
});

describe('i18n — interpolation parity', () => {
  test('interpolation variables match between locales', () => {
    const interpRe = /\{\{(\w+)\}\}/g;
    const mismatches: string[] = [];

    for (const key of koKeys) {
      const parts = key.split('.');
      let koVal: unknown = ko;
      let enVal: unknown = en;
      for (const p of parts) {
        koVal = (koVal as Record<string, unknown>)?.[p];
        enVal = (enVal as Record<string, unknown>)?.[p];
      }
      if (typeof koVal !== 'string' || typeof enVal !== 'string') continue;

      const koVars = new Set((koVal.match(interpRe) ?? []).map((m) => m));
      const enVars = new Set((enVal.match(interpRe) ?? []).map((m) => m));

      if (koVars.size !== enVars.size || [...koVars].some((v) => !enVars.has(v))) {
        mismatches.push(`${key}: ko=${[...koVars].join(',')} en=${[...enVars].join(',')}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe('i18n — key usage validation', () => {
  const usedKeys = new Set<string>();
  for (const { content } of allFiles) {
    for (const key of extractLiteralKeys(content)) {
      usedKeys.add(key);
    }
  }

  test('all literal t() keys exist in ko.json', () => {
    const missing = [...usedKeys].filter((k) => !koKeys.has(k)).sort();
    expect(missing).toEqual([]);
  });

  test('all literal t() keys exist in en.json', () => {
    const missing = [...usedKeys].filter((k) => !enKeys.has(k)).sort();
    expect(missing).toEqual([]);
  });

  test('at least 200 unique keys are used in source code', () => {
    expect(usedKeys.size).toBeGreaterThanOrEqual(200);
  });

  test('no translation key exceeds 4 nesting levels', () => {
    const deep = [...koKeys].filter((k) => k.split('.').length > 4);
    expect(deep).toEqual([]);
  });
});

describe('i18n — value quality', () => {
  test('no ko values accidentally left as English', () => {
    const suspectKeys: string[] = [];
    for (const key of koKeys) {
      const parts = key.split('.');
      let koVal: unknown = ko;
      let enVal: unknown = en;
      for (const p of parts) {
        koVal = (koVal as Record<string, unknown>)?.[p];
        enVal = (enVal as Record<string, unknown>)?.[p];
      }
      if (typeof koVal !== 'string' || typeof enVal !== 'string') continue;
      if (koVal === enVal && koVal.length > 5 && !/^[A-Z\s$()./:]+$/.test(koVal) && !/\{\{/.test(koVal)) {
        const hasKorean = /[가-힯]/.test(koVal);
        const hasOnlyAscii = /^[\x00-\x7F]+$/.test(koVal);
        if (!hasKorean && hasOnlyAscii && !key.startsWith('preset.')) {
          suspectKeys.push(`${key}: "${koVal}"`);
        }
      }
    }
    const allowedIdentical = new Set([
      'settings.planFree',
      'settings.languageKorean',
      'compose.title',
      'authForm.emailPlaceholder',
    ]);
    const filtered = suspectKeys.filter((s) => {
      const k = s.split(':')[0]!;
      return !allowedIdentical.has(k);
    });
    expect(filtered).toEqual([]);
  });

  test('no values contain raw HTML tags', () => {
    const htmlRe = /<\/?[a-z][a-z0-9]*\b[^>]*>/i;
    const violations: string[] = [];
    for (const key of koKeys) {
      const parts = key.split('.');
      let koVal: unknown = ko;
      let enVal: unknown = en;
      for (const p of parts) {
        koVal = (koVal as Record<string, unknown>)?.[p];
        enVal = (enVal as Record<string, unknown>)?.[p];
      }
      if (typeof koVal === 'string' && htmlRe.test(koVal)) violations.push(`ko:${key}`);
      if (typeof enVal === 'string' && htmlRe.test(enVal)) violations.push(`en:${key}`);
    }
    expect(violations).toEqual([]);
  });

  test('array values (like sentences) have matching lengths', () => {
    function findArrays(obj: Record<string, unknown>, prefix = ''): Array<{ key: string; length: number }> {
      const result: Array<{ key: string; length: number }> = [];
      for (const [k, v] of Object.entries(obj)) {
        const full = prefix ? `${prefix}.${k}` : k;
        if (Array.isArray(v)) {
          result.push({ key: full, length: v.length });
        } else if (typeof v === 'object' && v !== null) {
          result.push(...findArrays(v as Record<string, unknown>, full));
        }
      }
      return result;
    }

    const koArrays = findArrays(ko);
    const enArrays = findArrays(en);
    const koMap = new Map(koArrays.map((a) => [a.key, a.length]));
    const mismatches: string[] = [];
    for (const { key, length } of enArrays) {
      const koLen = koMap.get(key);
      if (koLen !== undefined && koLen !== length) {
        mismatches.push(`${key}: ko=${koLen} en=${length}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
