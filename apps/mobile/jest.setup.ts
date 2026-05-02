/**
 * Stub native modules introduced this cycle so unit tests run without a
 * device. Kept dependency-free so it can run in `setupFiles` (before the
 * jest framework boots — no `React` / no `expect`).
 */

jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: () => null,
  Svg: () => null,
  Circle: () => null,
  Ellipse: () => null,
  G: () => null,
  Text: () => null,
  TSpan: () => null,
  TextPath: () => null,
  Path: () => null,
  Polygon: () => null,
  Polyline: () => null,
  Line: () => null,
  Rect: () => null,
  Use: () => null,
  Image: () => null,
  Symbol: () => null,
  Defs: () => null,
  LinearGradient: () => null,
  RadialGradient: () => null,
  Stop: () => null,
  ClipPath: () => null,
  Pattern: () => null,
  Mask: () => null,
}));

jest.mock('phosphor-react-native', () => {
  const Stub = () => null;
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === '__esModule') return true;
        return Stub;
      },
    },
  );
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    setItem: jest.fn().mockResolvedValue(undefined),
    getItem: jest.fn().mockResolvedValue(null),
    removeItem: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
    getAllKeys: jest.fn().mockResolvedValue([]),
    multiGet: jest.fn().mockResolvedValue([]),
    multiSet: jest.fn().mockResolvedValue(undefined),
    multiRemove: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn: jest.fn().mockResolvedValue({ type: 'cancelled' }),
    signOut: jest.fn().mockResolvedValue(undefined),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  },
  isErrorWithCode: (err: unknown): err is { code: string } =>
    typeof err === 'object' && err !== null && 'code' in err,
}));
