import { initSentry } from '../src/lib/sentry';

const mockInit = jest.fn();
jest.mock('@sentry/react-native', () => ({ init: mockInit }));
jest.mock('expo-constants', () => ({
  expoConfig: { version: '1.2.3', android: { versionCode: 7 } },
}));

beforeEach(() => {
  mockInit.mockClear();
});

describe('initSentry', () => {
  const originalEnv = process.env.EXPO_PUBLIC_SENTRY_DSN;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    } else {
      process.env.EXPO_PUBLIC_SENTRY_DSN = originalEnv;
    }
  });

  it('DSN 미설정 시 Sentry.init 호출하지 않는다', () => {
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    jest.resetModules();
    const { initSentry: fresh } = require('../src/lib/sentry');
    fresh();
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('빈 DSN 문자열이면 Sentry.init 호출하지 않는다', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = '';
    jest.resetModules();
    const { initSentry: fresh } = require('../src/lib/sentry');
    fresh();
    expect(mockInit).not.toHaveBeenCalled();
  });
});
