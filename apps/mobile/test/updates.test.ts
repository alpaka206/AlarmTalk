import { Alert, Platform } from 'react-native';
import * as Updates from 'expo-updates';
import { checkForOTAUpdate } from '../src/services/updates';

jest.mock('expo-updates', () => ({
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));

const mockT = (key: string) => key;
const mockCheck = Updates.checkForUpdateAsync as jest.Mock;
const mockFetch = Updates.fetchUpdateAsync as jest.Mock;
const mockReload = Updates.reloadAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('checkForOTAUpdate', () => {
  it('does nothing in __DEV__ mode', async () => {
    await checkForOTAUpdate(mockT as never);
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it('does nothing on web platform', async () => {
    const origDev = (globalThis as Record<string, unknown>).__DEV__;
    (globalThis as Record<string, unknown>).__DEV__ = false;
    const origPlatform = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });

    await checkForOTAUpdate(mockT as never);
    expect(mockCheck).not.toHaveBeenCalled();

    Object.defineProperty(Platform, 'OS', { value: origPlatform, configurable: true });
    (globalThis as Record<string, unknown>).__DEV__ = origDev;
  });

  it('does nothing when no update available', async () => {
    const origDev = (globalThis as Record<string, unknown>).__DEV__;
    (globalThis as Record<string, unknown>).__DEV__ = false;
    const origPlatform = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });

    mockCheck.mockResolvedValue({ isAvailable: false });

    await checkForOTAUpdate(mockT as never);
    expect(mockCheck).toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();

    Object.defineProperty(Platform, 'OS', { value: origPlatform, configurable: true });
    (globalThis as Record<string, unknown>).__DEV__ = origDev;
  });

  it('fetches and shows alert when update available', async () => {
    const origDev = (globalThis as Record<string, unknown>).__DEV__;
    (globalThis as Record<string, unknown>).__DEV__ = false;
    const origPlatform = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const alertSpy = jest.spyOn(Alert, 'alert');

    mockCheck.mockResolvedValue({ isAvailable: true });
    mockFetch.mockResolvedValue({ isNew: true });

    await checkForOTAUpdate(mockT as never);
    expect(mockFetch).toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      'update.title',
      'update.message',
      expect.arrayContaining([
        expect.objectContaining({ text: 'update.later' }),
        expect.objectContaining({ text: 'update.now' }),
      ]),
    );

    Object.defineProperty(Platform, 'OS', { value: origPlatform, configurable: true });
    (globalThis as Record<string, unknown>).__DEV__ = origDev;
    alertSpy.mockRestore();
  });

  it('does not show alert when fetched update is not new', async () => {
    const origDev = (globalThis as Record<string, unknown>).__DEV__;
    (globalThis as Record<string, unknown>).__DEV__ = false;
    const origPlatform = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    const alertSpy = jest.spyOn(Alert, 'alert');

    mockCheck.mockResolvedValue({ isAvailable: true });
    mockFetch.mockResolvedValue({ isNew: false });

    await checkForOTAUpdate(mockT as never);
    expect(mockFetch).toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();

    Object.defineProperty(Platform, 'OS', { value: origPlatform, configurable: true });
    (globalThis as Record<string, unknown>).__DEV__ = origDev;
    alertSpy.mockRestore();
  });

  it('silently catches errors', async () => {
    const origDev = (globalThis as Record<string, unknown>).__DEV__;
    (globalThis as Record<string, unknown>).__DEV__ = false;
    const origPlatform = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });

    mockCheck.mockRejectedValue(new Error('network error'));

    await expect(checkForOTAUpdate(mockT as never)).resolves.toBeUndefined();

    Object.defineProperty(Platform, 'OS', { value: origPlatform, configurable: true });
    (globalThis as Record<string, unknown>).__DEV__ = origDev;
  });

  it('calls reloadAsync when user taps update now', async () => {
    const origDev = (globalThis as Record<string, unknown>).__DEV__;
    (globalThis as Record<string, unknown>).__DEV__ = false;
    const origPlatform = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const alertSpy = jest.spyOn(Alert, 'alert');

    mockCheck.mockResolvedValue({ isAvailable: true });
    mockFetch.mockResolvedValue({ isNew: true });

    await checkForOTAUpdate(mockT as never);

    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    const updateButton = buttons.find((b) => b.text === 'update.now');
    updateButton?.onPress?.();
    expect(mockReload).toHaveBeenCalled();

    Object.defineProperty(Platform, 'OS', { value: origPlatform, configurable: true });
    (globalThis as Record<string, unknown>).__DEV__ = origDev;
    alertSpy.mockRestore();
  });
});
