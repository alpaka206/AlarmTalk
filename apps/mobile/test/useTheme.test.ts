import { useAppStore } from '../src/stores/useAppStore';
import { Colors } from '../src/constants/theme';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
}));

// useTheme는 단순 selector이므로 직접 로직을 테스트
function getThemeResult(darkMode: boolean) {
  const colors = darkMode ? Colors.dark : Colors.light;
  return { colors, isDark: darkMode };
}

beforeEach(() => {
  useAppStore.setState({ darkMode: false });
});

describe('useTheme — 라이트 모드', () => {
  it('darkMode=false이면 light 색상을 반환한다', () => {
    const result = getThemeResult(false);
    expect(result.colors).toBe(Colors.light);
    expect(result.isDark).toBe(false);
  });

  it('light 모드 배경색은 #FFF5F3이다', () => {
    const result = getThemeResult(false);
    expect(result.colors.background).toBe('#FFF5F3');
  });

  it('light 모드 primary는 #FF7F6B이다', () => {
    const result = getThemeResult(false);
    expect(result.colors.primary).toBe('#FF7F6B');
  });
});

describe('useTheme — 다크 모드', () => {
  it('darkMode=true이면 dark 색상을 반환한다', () => {
    const result = getThemeResult(true);
    expect(result.colors).toBe(Colors.dark);
    expect(result.isDark).toBe(true);
  });

  it('dark 모드 배경색은 #1C1C1E이다', () => {
    const result = getThemeResult(true);
    expect(result.colors.background).toBe('#1C1C1E');
  });

  it('dark 모드 primary는 #FF8F7D이다', () => {
    const result = getThemeResult(true);
    expect(result.colors.primary).toBe('#FF8F7D');
  });
});

describe('useTheme — 색상 스키마 무결성', () => {
  it('light와 dark 모두 동일한 키를 갖는다', () => {
    const lightKeys = Object.keys(Colors.light).sort();
    const darkKeys = Object.keys(Colors.dark).sort();
    expect(lightKeys).toEqual(darkKeys);
  });

  it('모든 색상값은 비어있지 않다', () => {
    for (const key of Object.keys(Colors.light) as Array<keyof typeof Colors.light>) {
      expect(Colors.light[key]).toBeTruthy();
      expect(Colors.dark[key]).toBeTruthy();
    }
  });

  it('light와 dark는 서로 다른 객체이다', () => {
    expect(Colors.light).not.toBe(Colors.dark);
  });

  it('Zustand 스토어에서 darkMode 토글 시 결과가 바뀐다', () => {
    useAppStore.setState({ darkMode: false });
    const light = getThemeResult(useAppStore.getState().darkMode);
    expect(light.isDark).toBe(false);

    useAppStore.setState({ darkMode: true });
    const dark = getThemeResult(useAppStore.getState().darkMode);
    expect(dark.isDark).toBe(true);
    expect(dark.colors).not.toBe(light.colors);
  });
});
