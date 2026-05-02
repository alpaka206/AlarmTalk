import { useEffect, useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import { initSentry } from '../src/lib/sentry';
import { parseDeepLink } from '../src/lib/deepLink';
import { useAppStore } from '../src/stores/useAppStore';
import { useTheme } from '../src/hooks/useTheme';
import { setupAudioSession, ensureAudioDir, cleanupAudioCache } from '../src/services/audio';
import { checkForOTAUpdate } from '../src/services/updates';
import { OfflineBanner } from '../src/components/OfflineBanner';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { AuthProvider } from '../src/hooks/useAuth';
import { startAlarmKeepAlive } from '../src/services/alarmRinger';
import {
  configureNotifeeAlarmChannel,
  requestAlarmNotificationPermissions,
  scheduleNotifeeSnooze,
  NOTIFEE_SNOOZE_ACTION_ID,
  NOTIFEE_DISMISS_ACTION_ID,
} from '../src/services/notifeeAlarms';
import notifee, { EventType } from '@notifee/react-native';
import '../src/i18n';

// Module-scope registration — required by notifee so the JS runtime can
// receive the event even when the app was killed and woken by the
// alarm fire. The actual ringing UI is shown after the app reaches
// foreground; this just acknowledges the event.
notifee.onBackgroundEvent(async () => {
  // No-op — the press/full-screen-intent will bring the app foreground
  // and `onForegroundEvent` (registered below) handles routing.
});

initSentry();
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,   // 30s → 5min: Tailscale 환경 재요청 폭발 방지
      gcTime: 30 * 60 * 1000,     // 30min: 화면 전환 시 캐시 살아있음
      refetchOnWindowFocus: false,
      refetchOnReconnect: 'always',
      retry: 1,                    // 2 → 1: 재시도 비용이 큰 환경
    },
  },
});

export default function RootLayout() {
  const loadPersistedState = useAppStore((s) => s.loadPersistedState);
  const { hasCompletedOnboarding, stateLoaded } = useAppStore();
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const hasNavigatedToOnboarding = useRef(false);
  const deepLinkHandled = useRef(false);

  const handleDeepLink = useCallback(
    (url: string) => {
      const route = parseDeepLink(url);
      if (!route) return;

      const { isAuthenticated, hasCompletedOnboarding: onboarded } = useAppStore.getState();

      if (!onboarded) return;
      if (route.requiresAuth && !isAuthenticated) return;

      router.push({
        pathname: route.pathname as never,
        params: route.params,
      });
    },
    [router],
  );

  useEffect(() => {
    if (!stateLoaded || deepLinkHandled.current) return;
    deepLinkHandled.current = true;

    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink(url);
    });

    const sub = Linking.addEventListener('url', (event) => {
      handleDeepLink(event.url);
    });

    return () => sub.remove();
  }, [stateLoaded, handleDeepLink]);

  const [fontsLoaded, fontError] = useFonts({
    'Pretendard-Regular': require('../assets/fonts/Pretendard-Regular.otf'),
    'Pretendard-Medium': require('../assets/fonts/Pretendard-Medium.otf'),
    'Pretendard-SemiBold': require('../assets/fonts/Pretendard-SemiBold.otf'),
    'Pretendard-Bold': require('../assets/fonts/Pretendard-Bold.otf'),
  });

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded || fontError) {
      await SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    if (stateLoaded && !hasCompletedOnboarding && !hasNavigatedToOnboarding.current) {
      hasNavigatedToOnboarding.current = true;
      // Defer outside the current navigation/render cycle to avoid
      // re-entering the routing queue (causes Maximum update depth).
      const id = setTimeout(() => router.replace('/onboarding'), 0);
      return () => clearTimeout(id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateLoaded, hasCompletedOnboarding]);

  useEffect(() => {
    loadPersistedState();
    setupAudioSession();
    ensureAudioDir().then(() => cleanupAudioCache());
    checkForOTAUpdate(t);
    void configureNotifeeAlarmChannel();
    // Start the Alarmy-style background-audio keep-alive. It only actually
    // plays once an active alarm exists (setMonitoredAlarms toggles it).
    void startAlarmKeepAlive();

    if (Platform.OS !== 'web') {
      // notifee is the single source of truth for alarm notifications;
      // expo-notifications was removed to avoid double-firing the same
      // alarm. The dialog this surfaces is POST_NOTIFICATIONS on Android
      // 13+ and the standard system prompt on iOS.
      void requestAlarmNotificationPermissions();
    }

    // If the app was launched from a notifee full-screen-intent (cold
    // start while ringing), jump straight to the ringing screen.
    void notifee
      .getInitialNotification()
      .then((initial: Awaited<ReturnType<typeof notifee.getInitialNotification>>) => {
        const data = initial?.notification?.data as
          | Record<string, unknown>
          | undefined;
        if (data?.alarmId) {
          router.push({
            pathname: '/alarm/ringing',
            params: {
              alarmId: String(data.alarmId),
              text: String(data.text ?? ''),
              voiceName: String(data.voiceName ?? ''),
            },
          });
        }
      });

    // notifee fullScreenIntent / press / action buttons
    const fgUnsub = notifee.onForegroundEvent(({ type, detail }) => {
      const data = detail.notification?.data as
        | Record<string, unknown>
        | undefined;

      if (type === EventType.ACTION_PRESS && data?.alarmId) {
        const actionId = detail.pressAction?.id;
        if (actionId === NOTIFEE_DISMISS_ACTION_ID) {
          // Drop the ongoing notification; the alarm is silenced for
          // this occurrence (the next scheduled trigger fires as usual).
          if (detail.notification?.id) {
            void notifee.cancelTriggerNotification(detail.notification.id);
            void notifee.cancelDisplayedNotification(detail.notification.id);
          }
          return;
        }
        if (actionId === NOTIFEE_SNOOZE_ACTION_ID) {
          const rawMinutes = data.snoozeMinutes;
          const minutes =
            typeof rawMinutes === 'string'
              ? parseInt(rawMinutes, 10)
              : typeof rawMinutes === 'number'
                ? rawMinutes
                : 5;
          if (detail.notification?.id) {
            void notifee.cancelDisplayedNotification(detail.notification.id);
          }
          void scheduleNotifeeSnooze({
            alarmId: String(data.alarmId),
            text: String(data.text ?? ''),
            voiceName: String(data.voiceName ?? ''),
            snoozeMinutes: Number.isFinite(minutes) ? minutes : 5,
            t,
          });
          return;
        }
      }

      if (
        (type === EventType.PRESS || type === EventType.DELIVERED) &&
        data?.alarmId
      ) {
        router.push({
          pathname: '/alarm/ringing',
          params: {
            alarmId: String(data.alarmId),
            text: String(data.text ?? ''),
            voiceName: String(data.voiceName ?? ''),
          },
        });
      }
    });

    return () => {
      fgUnsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <ErrorBoundary>
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style={isDark ? 'light' : 'dark'} />
          <OfflineBanner />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
              animation: 'slide_from_right',
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
            <Stack.Screen
              name="character/index"
              options={{ headerShown: true, title: t('screen.character') }}
            />
            <Stack.Screen
              name="library/index"
              options={{ headerShown: true, title: t('screen.library') }}
            />
            <Stack.Screen
              name="voice/[id]"
              options={{ headerShown: true, title: t('screen.voiceDetail') }}
            />
            <Stack.Screen
              name="voice/create"
              options={{ headerShown: true, title: t('voiceCreate.title'), presentation: 'modal' }}
            />
            <Stack.Screen
              name="voice/record"
              options={{ headerShown: true, title: t('screen.voiceRecord'), presentation: 'modal' }}
            />
            <Stack.Screen
              name="voice/upload"
              options={{ headerShown: true, title: t('screen.fileUpload'), presentation: 'modal' }}
            />
            <Stack.Screen
              name="voice/diarize"
              options={{ headerShown: true, title: t('screen.diarize'), presentation: 'modal' }}
            />
            <Stack.Screen
              name="alarm/create"
              options={{
                headerShown: true,
                title: t('screen.alarmSetting'),
                presentation: 'modal',
              }}
            />
            <Stack.Screen
              name="alarm/edit"
              options={{ headerShown: true, title: t('alarmEdit.title'), presentation: 'modal' }}
            />
            <Stack.Screen
              name="alarm/snooze"
              options={{ headerShown: true, title: t('alarmCreate.snoozeScreen') }}
            />
            <Stack.Screen
              name="alarm/source-record"
              options={{ headerShown: true, title: t('alarmSource.screenTitle'), presentation: 'modal' }}
            />
            <Stack.Screen
              name="alarm/source-upload"
              options={{ headerShown: true, title: t('alarmSource.screenTitle'), presentation: 'modal' }}
            />
            <Stack.Screen
              name="alarm/vibration"
              options={{ headerShown: true, title: t('alarmCreate.vibrationScreen') }}
            />
            <Stack.Screen
              name="alarm/ringing"
              options={{
                headerShown: false,
                gestureEnabled: false,
                animation: 'fade',
                presentation: 'fullScreenModal',
              }}
            />
            <Stack.Screen
              name="message/[id]"
              options={{
                headerShown: true,
                title: t('messageDetail.title'),
                presentation: 'modal',
              }}
            />
            <Stack.Screen
              name="message/create"
              options={{
                headerShown: true,
                title: t('screen.writeMessage'),
                presentation: 'modal',
              }}
            />
            <Stack.Screen
              name="gift/received"
              options={{
                headerShown: true,
                title: t('screen.receivedGifts'),
                presentation: 'modal',
              }}
            />
            <Stack.Screen
              name="code-register/index"
              options={{
                headerShown: true,
                title: t('codeRegister.title'),
                presentation: 'modal',
              }}
            />
            <Stack.Screen
              name="note/create"
              options={{
                headerShown: true,
                title: t('note.title'),
                presentation: 'modal',
              }}
            />
            <Stack.Screen
              name="note/[id]"
              options={{
                headerShown: true,
                title: t('noteDetail.title'),
              }}
            />
            <Stack.Screen
              name="people/index"
              options={{ headerShown: true, title: t('people.title') }}
            />
            <Stack.Screen
              name="settings/index"
              options={{ headerShown: true, title: t('settings.title') }}
            />
            <Stack.Screen
              name="subscription/index"
              options={{ headerShown: true, title: t('subscription.title') }}
            />
            <Stack.Screen
              name="family-alarm/create"
              options={{
                headerShown: true,
                title: t('familyAlarm.title'),
                presentation: 'modal',
              }}
            />
            <Stack.Screen
              name="voice/picker"
              options={{ headerShown: true, title: t('screen.speakerPicker'), presentation: 'modal' }}
            />
            <Stack.Screen
              name="friend/[id]"
              options={{ headerShown: true, title: t('screen.friendProfile') }}
            />
            <Stack.Screen
              name="dub/translate"
              options={{ headerShown: true, title: t('dub.title'), presentation: 'modal' }}
            />
            <Stack.Screen
              name="player"
              options={{ presentation: 'transparentModal', animation: 'fade' }}
            />
          </Stack>
        </AuthProvider>
      </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
