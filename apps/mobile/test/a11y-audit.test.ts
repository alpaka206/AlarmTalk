import * as fs from 'fs';
import * as path from 'path';
import { Colors } from '../src/constants/theme';

const MIN_TOUCH_TARGET = 44;
const WCAG_AA_NORMAL = 4.5;
const WCAG_AA_LARGE = 3.0;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, '');
  const n =
    h.length === 3
      ? [h[0]! + h[0]!, h[1]! + h[1]!, h[2]! + h[2]!]
      : [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  return [parseInt(n[0]!, 16), parseInt(n[1]!, 16), parseInt(n[2]!, 16)];
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b)
  );
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function meetsAA(fg: string, bg: string, isLargeText = false): boolean {
  const ratio = contrastRatio(fg, bg);
  return ratio >= (isLargeText ? WCAG_AA_LARGE : WCAG_AA_NORMAL);
}

const LightColors = Colors.light;
const DarkColors = Colors.dark;

function findTsxFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (
      entry.isDirectory() &&
      !entry.name.startsWith('.') &&
      entry.name !== 'node_modules'
    ) {
      results.push(...findTsxFiles(fullPath));
    } else if (entry.name.endsWith('.tsx')) {
      results.push(fullPath);
    }
  }
  return results;
}

function flatKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const result: string[] = [];
  for (const key in obj) {
    const val = obj[key];
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof val === 'object' && val !== null) {
      result.push(...flatKeys(val as Record<string, unknown>, full));
    } else {
      result.push(full);
    }
  }
  return result;
}

const APP_DIR = path.resolve(__dirname, '..', 'app');
const COMPONENTS_DIR = path.resolve(__dirname, '..', 'src', 'components');
const tsxFiles = [...findTsxFiles(APP_DIR), ...findTsxFiles(COMPONENTS_DIR)];
const relPath = (f: string) =>
  path.relative(path.resolve(__dirname, '..'), f).replace(/\\/g, '/');

describe('접근성 자동 검증', () => {
  test('검증 대상 TSX 파일이 존재한다', () => {
    expect(tsxFiles.length).toBeGreaterThan(10);
  });

  describe('인터랙티브 요소 accessibilityLabel 커버리지', () => {
    const TOUCHABLE_PATTERN =
      /<(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback)\b/g;

    const filesWithTouchables = tsxFiles
      .map((f) => ({
        path: f,
        content: fs.readFileSync(f, 'utf-8'),
      }))
      .filter((f) => TOUCHABLE_PATTERN.test(f.content));

    test('터치 가능 요소를 사용하는 파일이 존재한다', () => {
      expect(filesWithTouchables.length).toBeGreaterThan(0);
    });

    test('터치 가능 요소를 사용하는 모든 파일에 accessibilityLabel이 있다', () => {
      const missing: string[] = [];
      for (const file of filesWithTouchables) {
        if (!file.content.includes('accessibilityLabel')) {
          missing.push(relPath(file.path));
        }
      }
      expect(missing).toEqual([]);
    });

    test('터치 가능 요소를 사용하는 모든 파일에 accessibilityRole이 있다', () => {
      const missing: string[] = [];
      for (const file of filesWithTouchables) {
        if (!file.content.includes('accessibilityRole')) {
          missing.push(relPath(file.path));
        }
      }
      expect(missing).toEqual([]);
    });
  });

  describe('Switch 접근성', () => {
    const filesWithSwitch = tsxFiles
      .map((f) => ({
        path: f,
        content: fs.readFileSync(f, 'utf-8'),
      }))
      .filter(
        (f) =>
          f.content.includes('<Switch') &&
          !f.content.includes('// no-a11y-audit'),
      );

    test('Switch를 사용하는 파일이 존재한다', () => {
      expect(filesWithSwitch.length).toBeGreaterThan(0);
    });

    test('모든 Switch에 accessibilityLabel이 있다', () => {
      const missing: string[] = [];
      for (const file of filesWithSwitch) {
        const lines = file.content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i]!.includes('<Switch') && !lines[i]!.includes('//')) {
            const context = lines.slice(i, Math.min(i + 15, lines.length)).join('\n');
            if (!context.includes('accessibilityLabel')) {
              missing.push(`${relPath(file.path)}:${i + 1}`);
            }
          }
        }
      }
      expect(missing).toEqual([]);
    });
  });

  describe('TextInput 접근성', () => {
    const filesWithInput = tsxFiles
      .map((f) => ({
        path: f,
        content: fs.readFileSync(f, 'utf-8'),
      }))
      .filter((f) => f.content.includes('<TextInput'));

    test('TextInput를 사용하는 파일이 존재한다', () => {
      expect(filesWithInput.length).toBeGreaterThan(0);
    });

    test('모든 TextInput에 accessibilityLabel 또는 placeholder가 있다', () => {
      const missing: string[] = [];
      for (const file of filesWithInput) {
        const lines = file.content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i]!.includes('<TextInput') && !lines[i]!.includes('//')) {
            const context = lines
              .slice(i, Math.min(i + 10, lines.length))
              .join('\n');
            if (
              !context.includes('accessibilityLabel') &&
              !context.includes('placeholder')
            ) {
              missing.push(`${relPath(file.path)}:${i + 1}`);
            }
          }
        }
      }
      expect(missing).toEqual([]);
    });
  });
});

describe('i18n 키 동기화 검증', () => {
  const ko = require('../src/i18n/ko.json');
  const en = require('../src/i18n/en.json');
  const koKeys = flatKeys(ko).sort();
  const enKeys = flatKeys(en).sort();

  test('ko.json과 en.json의 키 개수가 일치한다', () => {
    expect(koKeys.length).toBe(enKeys.length);
  });

  test('ko.json의 모든 키가 en.json에 존재한다', () => {
    const missingInEn = koKeys.filter((k) => !enKeys.includes(k));
    expect(missingInEn).toEqual([]);
  });

  test('en.json의 모든 키가 ko.json에 존재한다', () => {
    const missingInKo = enKeys.filter((k) => !koKeys.includes(k));
    expect(missingInKo).toEqual([]);
  });

  test('모든 값이 빈 문자열이 아니다', () => {
    const emptyKo: string[] = [];
    const emptyEn: string[] = [];
    const resolve = (obj: Record<string, unknown>, key: string): unknown =>
      key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
    for (const key of koKeys) {
      const val = resolve(ko, key);
      if (typeof val === 'string' && val.trim() === '') emptyKo.push(key);
    }
    for (const key of enKeys) {
      const val = resolve(en, key);
      if (typeof val === 'string' && val.trim() === '') emptyEn.push(key);
    }
    expect(emptyKo).toEqual([]);
    expect(emptyEn).toEqual([]);
  });

  test('t() 호출에 폴백 문자열 패턴이 없다', () => {
    const fallbackPattern = /(?<![a-zA-Z_$])t\(\s*['"][^'"]+['"]\s*,\s*['"][^'"]+['"]\s*\)/g;
    const violations: string[] = [];
    for (const file of tsxFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const matches = content.match(fallbackPattern);
      if (matches) {
        violations.push(`${relPath(file)}: ${matches.length} fallback(s)`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('WCAG AA 색상 대비 검증', () => {
  test('MIN_TOUCH_TARGET이 44px이다', () => {
    expect(MIN_TOUCH_TARGET).toBe(44);
  });

  describe('라이트 모드', () => {
    test('본문 텍스트 vs 배경', () => {
      expect(meetsAA(LightColors.text, LightColors.background)).toBe(true);
    });

    test('보조 텍스트 vs 배경', () => {
      expect(
        meetsAA(LightColors.textSecondary, LightColors.background),
      ).toBe(true);
    });

    test('본문 텍스트 vs surface', () => {
      expect(meetsAA(LightColors.text, LightColors.surface)).toBe(true);
    });

    test('보조 텍스트 vs surface', () => {
      expect(meetsAA(LightColors.textSecondary, LightColors.surface)).toBe(
        true,
      );
    });

    test('primaryDark vs 흰색 (버튼 텍스트 역전)', () => {
      expect(meetsAA(LightColors.primaryDark, '#FFFFFF', true)).toBe(true);
    });

    test('error vs surface (에러 배지)', () => {
      expect(meetsAA(LightColors.error, LightColors.surface, true)).toBe(true);
    });
  });

  describe('다크 모드', () => {
    test('본문 텍스트 vs 배경', () => {
      expect(meetsAA(DarkColors.text, DarkColors.background)).toBe(true);
    });

    test('보조 텍스트 vs 배경', () => {
      expect(meetsAA(DarkColors.textSecondary, DarkColors.background)).toBe(
        true,
      );
    });

    test('본문 텍스트 vs surface', () => {
      expect(meetsAA(DarkColors.text, DarkColors.surface)).toBe(true);
    });

    test('보조 텍스트 vs surface', () => {
      expect(meetsAA(DarkColors.textSecondary, DarkColors.surface)).toBe(
        true,
      );
    });

    test('primary vs 배경', () => {
      expect(meetsAA(DarkColors.primary, DarkColors.background)).toBe(true);
    });

    test('error vs 배경', () => {
      expect(meetsAA(DarkColors.error, DarkColors.background)).toBe(true);
    });
  });

  describe('크로스 테마 일관성', () => {
    test('라이트/다크 모두 동일한 시맨틱 컬러 키를 갖는다', () => {
      const lightKeys = Object.keys(LightColors).sort();
      const darkKeys = Object.keys(DarkColors).sort();
      expect(lightKeys).toEqual(darkKeys);
    });
  });
});

describe('접근성 인프라 무결성', () => {
  test('a11y 유틸리티가 올바르게 정의되어 있다', () => {
    expect(typeof MIN_TOUCH_TARGET).toBe('number');
    expect(typeof meetsAA).toBe('function');
  });

  test('accessibilityLabel 사용 파일이 25개 이상이다 (회귀 방지)', () => {
    const filesWithLabels = tsxFiles.filter((f) =>
      fs.readFileSync(f, 'utf-8').includes('accessibilityLabel'),
    );
    expect(filesWithLabels.length).toBeGreaterThanOrEqual(25);
  });

  test('accessibilityRole 사용 파일이 15개 이상이다 (회귀 방지)', () => {
    const filesWithRoles = tsxFiles.filter((f) =>
      fs.readFileSync(f, 'utf-8').includes('accessibilityRole'),
    );
    expect(filesWithRoles.length).toBeGreaterThanOrEqual(15);
  });
});
