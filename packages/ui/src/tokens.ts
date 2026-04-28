export const ColorPalette = {
  coral: '#FF7F6B',
  coralLight: '#FFB4A8',
  coralDark: '#E05A47',
  peach: '#FFCBA4',
  pinkAccent: '#FF6B8A',
  white: '#FFFFFF',
  warmBg: '#FFF5F3',
  warmSurface: '#FFF0ED',
  warmBorder: '#F2E8E5',
  darkBg: '#1C1C1E',
  darkSurface: '#2C2C2E',
  darkSurfaceAlt: '#3A3A3C',
  darkBorder: '#38383A',
  text: '#2D2D2D',
  textSecondary: '#6B7280',
  textTertiary: '#AEAEB2',
  darkText: '#FFFFFF',
  darkTextSecondary: '#98989D',
  darkTextTertiary: '#636366',
  success: '#34C759',
  warning: '#FF9500',
  error: '#FF3B30',
  darkSuccess: '#30D158',
  darkWarning: '#FF9F0A',
  darkError: '#FF453A',
} as const;

export type ColorPaletteKey = keyof typeof ColorPalette;

export const LightColors = {
  primary: ColorPalette.coral,
  primaryLight: ColorPalette.coralLight,
  primaryDark: ColorPalette.coralDark,
  secondary: ColorPalette.peach,
  accent: ColorPalette.pinkAccent,
  background: ColorPalette.warmBg,
  surface: ColorPalette.white,
  surfaceVariant: ColorPalette.warmSurface,
  text: ColorPalette.text,
  textSecondary: ColorPalette.textSecondary,
  textTertiary: ColorPalette.textTertiary,
  border: ColorPalette.warmBorder,
  success: ColorPalette.success,
  warning: ColorPalette.warning,
  error: ColorPalette.error,
  shadow: 'rgba(255, 127, 107, 0.15)',
  textOnPrimary: ColorPalette.white,
  overlay: 'rgba(0, 0, 0, 0.3)',
} as const;

export const DarkColors = {
  primary: '#FF8F7D',
  primaryLight: '#FFAA99',
  primaryDark: '#E06A58',
  secondary: '#FFD4B3',
  accent: '#FF7B96',
  background: ColorPalette.darkBg,
  surface: ColorPalette.darkSurface,
  surfaceVariant: ColorPalette.darkSurfaceAlt,
  text: ColorPalette.darkText,
  textSecondary: ColorPalette.darkTextSecondary,
  textTertiary: ColorPalette.darkTextTertiary,
  border: ColorPalette.darkBorder,
  success: ColorPalette.darkSuccess,
  warning: ColorPalette.darkWarning,
  error: ColorPalette.darkError,
  shadow: 'rgba(0, 0, 0, 0.3)',
  textOnPrimary: ColorPalette.white,
  overlay: 'rgba(0, 0, 0, 0.3)',
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
