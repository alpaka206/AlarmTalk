// 디자인 토큰: 색상 팔레트 · 라이트/다크 시맨틱 색상 · 간격 · 모서리 · 타이포.
//
// 팔레트 콘셉트 — Mustard Yellow + Deep Navy, "해 뜨는 시간, 따뜻한 모던"
//   Mustard = primary(일출), Navy = secondary(신뢰), Terracotta = accent(온기)
// 라이트/다크 모드의 시맨틱 색상은 WCAG AA 대비를 만족하도록 선택했다
// (예: mustard 위 텍스트는 흰색이 아니라 charcoal).
export const ColorPalette = {
  // Mustard scale (primary)
  mustard: '#E8B341',
  mustardLight: '#F2C669',
  mustardDark: '#C9982C',
  mustardDimmed: '#F0C25C',     // dark-mode primary, lower chroma
  mustardOnDarkLight: '#F5D387',
  mustardOnDarkDark: '#D8A93D',
  // Deep navy scale (secondary)
  navy: '#2D3E5C',
  navyLight: '#7B8FB5',         // dark-mode secondary
  // Terracotta (accent)
  terracotta: '#C97B5C',
  terracottaLight: '#D89677',
  // Surfaces
  white: '#FFFFFF',
  creamBg: '#FBF8F2',
  creamSurfaceVariant: '#F5EFE0',
  creamBorder: '#EAE3D2',
  mochaBg: '#1F1B14',
  mochaSurface: '#2A251D',
  mochaSurfaceVariant: '#332C22',
  mochaBorder: '#3A332A',
  // Text
  charcoal: '#2C2620',
  charcoalSecondary: '#6B6358',
  charcoalTertiary: '#9C9080',
  cream: '#F0EBE0',
  creamSecondary: '#A89F8F',
  creamTertiary: '#7A7165',
  // Status
  sage: '#5C8A6B',
  sageLight: '#7FA88B',
  brick: '#B84A3D',
  brickLight: '#D86F5E',
  warningOchre: '#D89A2C',
  warningOchreLight: '#E0AB42',
} as const;

export type ColorPaletteKey = keyof typeof ColorPalette;

export const LightColors = {
  primary: ColorPalette.mustard,
  primaryLight: ColorPalette.mustardLight,
  primaryDark: ColorPalette.mustardDark,
  secondary: ColorPalette.navy,
  accent: ColorPalette.terracotta,
  background: ColorPalette.creamBg,
  surface: ColorPalette.white,
  surfaceVariant: ColorPalette.creamSurfaceVariant,
  text: ColorPalette.charcoal,
  textSecondary: ColorPalette.charcoalSecondary,
  textTertiary: ColorPalette.charcoalTertiary,
  border: ColorPalette.creamBorder,
  success: ColorPalette.sage,
  warning: ColorPalette.warningOchre,
  error: ColorPalette.brick,
  shadow: 'rgba(45, 62, 92, 0.12)',
  // Charcoal (not white) on mustard for WCAG AA compliance.
  textOnPrimary: ColorPalette.charcoal,
  overlay: 'rgba(31, 27, 20, 0.5)',
} as const;

export const DarkColors = {
  primary: ColorPalette.mustardDimmed,
  primaryLight: ColorPalette.mustardOnDarkLight,
  primaryDark: ColorPalette.mustardOnDarkDark,
  secondary: ColorPalette.navyLight,
  accent: ColorPalette.terracottaLight,
  background: ColorPalette.mochaBg,
  surface: ColorPalette.mochaSurface,
  surfaceVariant: ColorPalette.mochaSurfaceVariant,
  text: ColorPalette.cream,
  textSecondary: ColorPalette.creamSecondary,
  textTertiary: ColorPalette.creamTertiary,
  border: ColorPalette.mochaBorder,
  success: ColorPalette.sageLight,
  warning: ColorPalette.warningOchreLight,
  error: ColorPalette.brickLight,
  shadow: 'rgba(0, 0, 0, 0.4)',
  // Mocha on dimmed mustard keeps the same charcoal/mocha-on-yellow feel.
  textOnPrimary: ColorPalette.mochaBg,
  overlay: 'rgba(0, 0, 0, 0.6)',
} as const;

export type SemanticColorKey = keyof typeof LightColors;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export type SpacingKey = keyof typeof Spacing;

export const BorderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export type BorderRadiusKey = keyof typeof BorderRadius;

export const FontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 28,
  hero: 34,
} as const;

export type FontSizeKey = keyof typeof FontSize;

export const FontWeight = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export type FontWeightKey = keyof typeof FontWeight;

export type FontFamilyKey = keyof typeof FontFamily;

export const FontFamily = {
  regular: 'Pretendard-Regular',
  medium: 'Pretendard-Medium',
  semibold: 'Pretendard-SemiBold',
  bold: 'Pretendard-Bold',
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  mono: "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace",
} as const;

export function getColors(mode: 'light' | 'dark') {
  return mode === 'dark' ? DarkColors : LightColors;
}
