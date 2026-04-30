import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Vibration,
  Platform,
  StatusBar,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Audio } from 'expo-av';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/hooks/useTheme';
import { Spacing, FontFamily } from '../../src/constants/theme';
import { AppIcon } from '../../src/components/AppIcon';
import { clearFiringState } from '../../src/services/alarmRinger';

const VIBRATION_PATTERN = [0, 800, 400, 800, 400];
const KOREAN_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

function formatHHmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const wd = KOREAN_WEEKDAYS[d.getDay()];
  return `${y}.${mo}.${da} ${wd}`;
}

export default function AlarmRingingScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    alarmId?: string;
    text?: string;
    voiceName?: string;
  }>();

  const soundRef = useRef<Audio.Sound | null>(null);
  const stoppedRef = useRef(false);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          staysActiveInBackground: false,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
        });
        const { sound } = await Audio.Sound.createAsync(
          require('../../assets/sounds/default_alarm.wav'),
          { isLooping: true, volume: 1.0, shouldPlay: true },
        );
        if (cancelled || stoppedRef.current) {
          await sound.unloadAsync();
          return;
        }
        soundRef.current = sound;
      } catch {
        // ignore — vibration still fires below
      }
      Vibration.vibrate(VIBRATION_PATTERN, true);
    }
    void start();
    return () => {
      cancelled = true;
    };
  }, []);

  const stopAlarm = async () => {
    stoppedRef.current = true;
    Vibration.cancel();
    const s = soundRef.current;
    soundRef.current = null;
    if (s) {
      try {
        await s.stopAsync();
        await s.unloadAsync();
      } catch {
        // already disposed
      }
    }
    if (params.alarmId) clearFiringState(String(params.alarmId));
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  useEffect(() => {
    return () => {
      // safety: stop sound + vibration if the user backs out via the OS
      Vibration.cancel();
      const s = soundRef.current;
      soundRef.current = null;
      if (s) {
        s.stopAsync().catch(() => {});
        s.unloadAsync().catch(() => {});
      }
    };
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: colors.primary }]}>
      <StatusBar barStyle="light-content" />
      <View style={styles.top}>
        <Text style={styles.timeText}>{formatHHmm(now)}</Text>
        <Text style={styles.dateText}>{formatDate(now)}</Text>
      </View>

      <View style={styles.middle}>
        <View style={styles.bellWrap}>
          <AppIcon name="alarm" size={120} color="#FFFFFF" duotoneColor="#FFFFFF" />
        </View>
        {params.voiceName ? (
          <Text style={styles.voiceName}>{params.voiceName}</Text>
        ) : null}
        {params.text ? (
          <Text style={styles.message} numberOfLines={3}>
            "{params.text}"
          </Text>
        ) : (
          <Text style={styles.message}>{t('alarmRinging.title') || '알람'}</Text>
        )}
      </View>

      <View style={styles.bottom}>
        <TouchableOpacity
          style={styles.dismissButton}
          onPress={stopAlarm}
          accessibilityRole="button"
          accessibilityLabel={t('alarmRinging.dismiss') || '알람 끄기'}
        >
          <Text style={styles.dismissText}>
            {t('alarmRinging.dismiss') || '알람 끄기'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 40,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'space-between',
  },
  top: {
    alignItems: 'center',
  },
  timeText: {
    fontSize: 80,
    fontFamily: FontFamily.bold,
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  dateText: {
    fontSize: 16,
    fontFamily: FontFamily.regular,
    color: '#FFFFFF',
    opacity: 0.85,
    marginTop: 4,
  },
  middle: {
    alignItems: 'center',
    gap: Spacing.md,
  },
  bellWrap: {
    marginBottom: Spacing.md,
  },
  voiceName: {
    fontSize: 22,
    fontFamily: FontFamily.semibold,
    color: '#FFFFFF',
  },
  message: {
    fontSize: 18,
    fontFamily: FontFamily.regular,
    color: '#FFFFFF',
    textAlign: 'center',
    paddingHorizontal: Spacing.lg,
  },
  bottom: {
    alignItems: 'center',
  },
  dismissButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingVertical: 18,
    paddingHorizontal: 56,
    minWidth: 220,
    alignItems: 'center',
  },
  dismissText: {
    fontSize: 18,
    fontFamily: FontFamily.bold,
    color: '#000000',
  },
});
