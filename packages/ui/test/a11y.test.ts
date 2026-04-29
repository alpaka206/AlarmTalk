import { describe, it, expect } from 'vitest';
import {
  contrastRatio,
  meetsAA,
  relativeLuminance,
  MIN_TOUCH_TARGET,
  WCAG_AA_NORMAL,
  WCAG_AA_LARGE,
  LightColors,
  DarkColors,
} from '../src/index';

describe('relativeLuminance', () => {
  it('black is 0', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 4);
  });
  it('white is 1', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 4);
  });
});

describe('contrastRatio', () => {
  it('black on white is 21:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
  });
  it('same color is 1:1', () => {
    expect(contrastRatio('#FF7F6B', '#FF7F6B')).toBeCloseTo(1, 2);
  });
  it('order does not matter', () => {
    const a = contrastRatio('#2D2D2D', '#FFF5F3');
    const b = contrastRatio('#FFF5F3', '#2D2D2D');
    expect(a).toBeCloseTo(b, 4);
  });
});

describe('meetsAA', () => {
  it('black on white passes normal text', () => {
    expect(meetsAA('#000000', '#FFFFFF')).toBe(true);
  });
  it('light gray on white fails normal text', () => {
    expect(meetsAA('#CCCCCC', '#FFFFFF')).toBe(false);
  });
  it('isLargeText uses lower threshold', () => {
    expect(meetsAA('#777777', '#FFFFFF', true)).toBe(true);
    expect(meetsAA('#777777', '#FFFFFF', false)).toBe(false);
  });
});

describe('constants', () => {
  it('MIN_TOUCH_TARGET is 44', () => {
    expect(MIN_TOUCH_TARGET).toBe(44);
  });
  it('WCAG_AA thresholds', () => {
    expect(WCAG_AA_NORMAL).toBe(4.5);
    expect(WCAG_AA_LARGE).toBe(3.0);
  });
});

describe('design token color contrast audit', () => {
  it('light mode: primary text on background meets AA for large text', () => {
    expect(meetsAA(LightColors.text, LightColors.background)).toBe(true);
  });
  it('light mode: primary on surface — mustard on white has low contrast (known, decorative use)', () => {
    // Mustard primary is intended for icons/CTAs paired with charcoal text,
    // never for raw primary-on-surface text. Audit just confirms it stays
    // below AA-large so reviewers do not accidentally rely on it for body copy.
    const ratio = contrastRatio(LightColors.primary, LightColors.surface);
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(WCAG_AA_LARGE);
  });
  it('light mode: charcoal on mustard meets AA (textOnPrimary contract)', () => {
    expect(meetsAA(LightColors.textOnPrimary, LightColors.primary)).toBe(true);
  });
  it('dark mode: text on background meets AA', () => {
    expect(meetsAA(DarkColors.text, DarkColors.background)).toBe(true);
  });
});
