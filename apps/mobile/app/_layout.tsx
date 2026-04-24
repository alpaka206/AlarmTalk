import { useEffect, useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useTranslation } from 'react-i18next';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import { initSentry } from '../src/lib/sentry';
import { parseDeepLink } from '../src/lib/deepLink';
import type * as Notifications from 'expo-notifications';
import { useAppStore } from '../src/stores/useAppStore';
import { useTheme } from '../src/hooks/useTheme';
import { setupAudioSession, ensureAudioDir } from '../src/services/audio';
import { checkForOTAUpdate } from '../src/services/updates';
import {
  requestNotificationPermissions,
  addNotificationResponseListener,
  scheduleSnoozeNotification,
  registerPushTokenWithServer,
  configureNotificationChannels,
  SNOOZE_ACTION,
  DISMISS_ACTION,
} from '../src/services/notifications';
import { OfflineBanner } from '../src/components/OfflineBanner';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { AuthProvider } from '../src/hooks/useAuth';
import '../src/i18n';

initSentry();
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
    },
  },
});

export default function RootLayout() {
  const loadPersistedState = useAppStore((s) => s.loadPersistedState);
  const { hasCompletedOnboarding, stateLoaded } = useAppStore();
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const responseListener = useRef<Notifications.EventSubscription | null>(null);
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
      router.replace('/onboarding');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateLoaded, hasCompletedOnboarding]);

  useEffect(() => {
    loadPersistedState();
    setupAudioSession();
    ensureAudioDir();
    checkForOTAUpdate(t);
    configureNotificationChannels(t);

    if (Platform.OS !== 'web') {
      requestNotificationPermissions().then((granted) => {
        if (granted) registerPushTokenWithServer();
      });

      responseListener.current = addNotificationResponseListener((response) => {
        const actionId = response.actionIdentifier;
        const { content } = response.notification.request;
        const data = content.data;

        if (actionId === DISMISS_ACTION) return;

        if (actionId === SNOOZE_ACTION && data) {
          const minutes = typeof data.snoozeMinutes === 'number' ? data.snoozeMinutes : 5;
          scheduleSnoozeNotification(
            content.title || '⏰ VoiceAlarm',
            content.body || '',
            data as Record<string, unknown>,
            minutes,
          );
          return;
        }

        if (data?.messageId) {
          router.push({
            pathname: '/player',
            params: {
              messageId: String(data.messageId),
              text: String(data.text || ''),
              voiceName: String(data.voiceName || ''),
              category: String(data.category || ''),
            },
          });
        }
      });
    }

    return () => {
      responseListener.current?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <ErrorBoundary>
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayoutRootView}>
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
              name="family-alarm/create"
              options={{
                headerShown: true,
                title: t('familyAlarm.title'),
                presentation: 'modal',
              }}
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
    </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
