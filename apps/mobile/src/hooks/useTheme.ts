import { useAppStore } from '../stores/useAppStore';
import { Colors, type ThemeColorScheme } from '../constants/theme';

export type ThemeColors = ThemeColorScheme;

export function useTheme() {
  const darkMode = useAppStore((s) => s.darkMode);
  const colors = darkMode ? Colors.dark : Colors.light;
  return { colors, isDark: darkMode };
}
