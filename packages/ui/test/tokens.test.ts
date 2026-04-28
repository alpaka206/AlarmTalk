import { describe, it, expect } from 'vitest';
import {
  ColorPalette,
  LightColors,
  DarkColors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  getColors,
} from '../src/index';

describe('ColorPalette', () => {
  it('contains hex color values', () => {
    for (const [_key, val] of Object.entries(ColorPalette)) {
      expect(val).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe('LightColors / DarkColors', () => {
  it('have matching semantic keys', () => {
    const lightKeys = Object.keys(LightColors).sort();
    const darkKeys = Object.keys(DarkColors).sort();
    expect(lightKeys).toEqual(darkKeys);
  });

  it('primary is coral in light mode', () => {
    expect(LightColors.primary).toBe('#FF7F6B');
  });

  it('background differs between modes', () => {
    expect(LightColors.background).not.toBe(DarkColors.background);
  });
});

describe('getColors', () => {
  it('returns light colors for light mode', () => {
    expect(getColors('light')).toBe(LightColors);
  });
  it('returns dark colors for dark mode', () => {
    expect(getColors('dark')).toBe(DarkColors);
  });
});

describe('Spacing', () => {
  it('values are ascending', () => {
    expect(Spacing.xs).toBeLessThan(Spacing.sm);
    expect(Spacing.sm).toBeLessThan(Spacing.md);
    expect(Spacing.md).toBeLessThan(Spacing.lg);
    expect(Spacing.lg).toBeLessThan(Spacing.xl);
    expect(Spacing.xl).toBeLessThan(Spacing.xxl);
  });
});

describe('BorderRadius', () => {
  it('full is 9999', () => {
    expect(BorderRadius.full).toBe(9999);
  });
});

describe('FontSize', () => {
  it('xs < sm < md < lg', () => {
    expect(FontSize.xs).toBeLessThan(FontSize.sm);
    expect(FontSize.sm).toBeLessThan(FontSize.md);
    expect(FontSize.md).toBeLessThan(FontSize.lg);
  });
});

describe('FontWeight', () => {
  it('bold is 700', () => {
    expect(FontWeight.bold).toBe('700');
  });
});
