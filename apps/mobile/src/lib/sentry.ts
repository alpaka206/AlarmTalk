import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';

export function initSentry() {
  if (!SENTRY_DSN) return;

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: __DEV__ ? 'development' : 'production',
    release: `com.devrel.voicealarm@${Constants.expoConfig?.version ?? '1.0.0'}`,
    dist: String(Constants.expoConfig?.android?.versionCode ?? '1'),
    tracesSampleRate: __DEV__ ? 1.0 : 0.2,
    enabled: !__DEV__,
    beforeSend(event) {
      if (__DEV__) return null;
      return event;
    },
  });
}

export { Sentry };
