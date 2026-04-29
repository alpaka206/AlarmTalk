export interface ThemeColorScheme {
  primary: string;
  primaryLight: string;
  primaryDark: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  surfaceVariant: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  success: string;
  warning: string;
  error: string;
  shadow: string;
  textOnPrimary: string;
  overlay: string;
}

// Mustard Yellow + Deep Navy. Source of truth lives in packages/ui/src/tokens.ts;
// this is the mobile-side mirror because the mobile app currently does not
// import from @voice-alarm/ui directly.
export const Colors: { light: ThemeColorScheme; dark: ThemeColorScheme } = {
  light: {
    primary: '#E8B341',          // mustard
    primaryLight: '#F2C669',
    primaryDark: '#C9982C',
    secondary: '#2D3E5C',        // deep navy
    accent: '#C97B5C',           // terracotta
    background: '#FBF8F2',       // warm cream
    surface: '#FFFFFF',
    surfaceVariant: '#F5EFE0',
    text: '#2C2620',             // warm charcoal
    textSecondary: '#6B6358',
    textTertiary: '#9C9080',
    border: '#EAE3D2',
    success: '#5C8A6B',          // sage
    warning: '#D89A2C',
    error: '#B84A3D',            // brick
    shadow: 'rgba(45, 62, 92, 0.12)',
    textOnPrimary: '#2C2620',    // charcoal on mustard (WCAG AA)
    overlay: 'rgba(31, 27, 20, 0.5)',
  },
  dark: {
    primary: '#F0C25C',          // chroma-dimmed mustard for dark
    primaryLight: '#F5D387',
    primaryDark: '#D8A93D',
    secondary: '#7B8FB5',        // lifted navy for dark surfaces
    accent: '#D89677',           // softer terracotta
    background: '#1F1B14',       // dark mocha (not pure black)
    surface: '#2A251D',
    surfaceVariant: '#332C22',
    text: '#F0EBE0',             // warm cream text
    textSecondary: '#A89F8F',
    textTertiary: '#7A7165',
    border: '#3A332A',
    success: '#7FA88B',
    warning: '#E0AB42',
    error: '#D86F5E',
    shadow: 'rgba(0, 0, 0, 0.4)',
    textOnPrimary: '#1F1B14',    // mocha on dimmed mustard
    overlay: 'rgba(0, 0, 0, 0.6)',
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const BorderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export const FontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 28,
  hero: 34,
} as const;

export const FontFamily = {
  regular: 'Pretendard-Regular',
  medium: 'Pretendard-Medium',
  semibold: 'Pretendard-SemiBold',
  bold: 'Pretendard-Bold',
} as const;

