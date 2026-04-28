export const MIN_TOUCH_TARGET = 44;

export const WCAG_AA_NORMAL = 4.5;
export const WCAG_AA_LARGE = 3.0;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, '');
  const n =
    h.length === 3
      ? [h[0] + h[0], h[1] + h[1], h[2] + h[2]]
      : [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  return [parseInt(n[0], 16), parseInt(n[1], 16), parseInt(n[2], 16)];
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsAA(fg: string, bg: string, isLargeText = false): boolean {
  const ratio = contrastRatio(fg, bg);
  return ratio >= (isLargeText ? WCAG_AA_LARGE : WCAG_AA_NORMAL);
}
