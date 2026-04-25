import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  PanResponder,
  LayoutChangeEvent,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../src/hooks/useTheme';
import { playAudio, getLocalAudioPath } from '../src/services/audio';
import { useAppStore } from '../src/stores/useAppStore';
import { generateWaveform, formatTime } from '../src/utils/waveform';
import {
  createPlayerStyles,
  WAVEFORM_BAR_COUNT,
  WAVEFORM_BAR_WIDTH,
  WAVEFORM_BAR_GAP,
  WAVEFORM_HEIGHT,
  WAVEFORM_TOTAL_WIDTH,
  ACTIVE_PULSE_RANGE,
} from '../src/styles/playerStyles';
import { TIME_OF_DAY_BACKGROUNDS, TIME_OF_DAY_EMOJIS } from '../src/constants/player';

function WaveformBar({
  height,
  played,
  isNearPlayhead,
  isPlaying,
}: {
  height: number;
  played: boolean;
  isNearPlayhead: boolean;
  isPlaying: boolean;
}) {
  const { colors } = useTheme();
  const pulseAnim = useMemo(() => new Animated.Value(1), []);

  useEffect(() => {
    if (isPlaying && isNearPlayhead) {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.25,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]),
      );
      animation.start();
      return () => animation.stop();
    }
    pulseAnim.setValue(1);
  }, [isPlaying, isNearPlayhead, pulseAnim]);

  return (
    <Animated.View
      style={[
        { width: WAVEFORM_BAR_WIDTH, borderRadius: WAVEFORM_BAR_WIDTH / 2 },
        {
          height: height * WAVEFORM_HEIGHT,
          backgroundColor: played ? colors.primary : colors.primaryLight,
          transform: [{ scaleY: pulseAnim }],
        },
      ]}
    />
  );
}

export default function PlayerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    messageId: string;
    text: string;
    voiceName: string;
    category: string;
  }>();

  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = createPlayerStyles(colors);
  const { setPlaying } = useAppStore();
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [reacted, setReacted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);
  const waveformWidth = useRef(WAVEFORM_TOTAL_WIDTH);
  const progressRef = useRef(0);
  const durationRef = useRef(0);
  const playheadAnim = useMemo(() => new Animated.Value(0), []);

  const waveformBars = useMemo(
    () => generateWaveform(params.messageId || 'default', WAVEFORM_BAR_COUNT),
    [params.messageId],
  );

  const activeBarIndex = Math.floor(progress * WAVEFORM_BAR_COUNT);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    durationRef.current = durationMs;
  }, [durationMs]);

  useEffect(() => {
    if (!isSeeking) {
      playheadAnim.setValue(progress);
    }
  }, [progress, isSeeking, playheadAnim]);

  const seekToPosition = useCallback(
    async (x: number) => {
      const w = waveformWidth.current;
      const clamped = Math.max(0, Math.min(x, w));
      const seekProgress = clamped / w;
      const dur = durationRef.current;
      setProgress(seekProgress);
      setPositionMs(seekProgress * dur);
      playheadAnim.setValue(seekProgress);
      if (soundRef.current && dur > 0) {
        await soundRef.current.setPositionAsync(seekProgress * dur);
      }
    },
    [playheadAnim],
  );

  /* eslint-disable react-hooks/refs */
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          setIsSeeking(true);
          seekToPosition(evt.nativeEvent.locationX);
        },
        onPanResponderMove: (evt) => {
          seekToPosition(evt.nativeEvent.locationX);
        },
        onPanResponderRelease: () => {
          setIsSeeking(false);
        },
      }),
    [seekToPosition],
  );
  /* eslint-enable react-hooks/refs */

  const onPlaybackStatus = useCallback(
    (status: AVPlaybackStatus) => {
      if (!status.isLoaded) return;
      if (status.durationMillis && status.durationMillis > 0) {
        setDurationMs(status.durationMillis);
        if (!isSeeking) {
          setPositionMs(status.positionMillis);
          setProgress(status.positionMillis / status.durationMillis);
        }
      }
      if (status.didJustFinish) {
        setIsPlaying(false);
        setPlaying(null);
        setProgress(1);
      }
    },
    [setPlaying, isSeeking],
  );

  const getBackgroundColor = () => {
    return TIME_OF_DAY_BACKGROUNDS[params.category]?.[0] || colors.background;
  };

  const getEmoji = () => {
    return TIME_OF_DAY_EMOJIS[params.category] || '💌';
  };

  const handlePlay = useCallback(async () => {
    if (sound) {
      if (isPlaying) {
        await sound.pauseAsync();
        setIsPlaying(false);
      } else {
        if (progress >= 1) {
          await sound.setPositionAsync(0);
          setProgress(0);
        }
        await sound.playAsync();
        setIsPlaying(true);
      }
      return;
    }

    const localPath = getLocalAudioPath(params.messageId);
    const newSound = await playAudio(localPath);
    setSound(newSound);
    soundRef.current = newSound;
    setIsPlaying(true);
    setPlaying(params.messageId);
    newSound.setOnPlaybackStatusUpdate(onPlaybackStatus);
  }, [sound, isPlaying, progress, params.messageId, setPlaying, onPlaybackStatus]);

  /* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
  useEffect(() => {
    handlePlay();
    return () => {
      soundRef.current?.unloadAsync();
    };
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */

  const handleClose = async () => {
    if (sound) {
      await sound.unloadAsync();
    }
    setPlaying(null);
    router.back();
  };

  const onWaveformLayout = (e: LayoutChangeEvent) => {
    waveformWidth.current = e.nativeEvent.layout.width;
  };

  const playheadLeft = playheadAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, WAVEFORM_TOTAL_WIDTH],
  });

  return (
    <View style={[styles.container, { backgroundColor: getBackgroundColor() }]}>
      <TouchableOpacity
        style={styles.closeButton}
        onPress={handleClose}
        accessibilityRole="button"
        accessibilityLabel={t('player.a11yClose')}
      >
        <Text style={styles.closeText}>✕</Text>
      </TouchableOpacity>

      <View style={styles.content}>
        <Text style={styles.categoryEmoji} accessibilityElementsHidden>{getEmoji()}</Text>

        <View
          style={styles.profileSection}
          accessibilityLabel={t('player.a11yVoice', { name: params.voiceName })}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{params.voiceName?.charAt(0) || '?'}</Text>
          </View>
          <Text style={styles.voiceName}>{params.voiceName}</Text>
        </View>

        <Text style={styles.messageText}>"{params.text}"</Text>

        <View
          style={styles.waveformContainer}
          accessibilityRole="adjustable"
          accessibilityLabel={t('player.a11yWaveform')}
          accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
        >
          <View
            style={styles.waveformBars}
            onLayout={onWaveformLayout}
            {...panResponder.panHandlers}
          >
            {waveformBars.map((height, i) => {
              const played = i / WAVEFORM_BAR_COUNT < progress;
              const distance = Math.abs(i - activeBarIndex);
              const isNearPlayhead = distance <= ACTIVE_PULSE_RANGE;
              return (
                <View key={i} style={styles.waveformBarTouch}>
                  <WaveformBar
                    height={height}
                    played={played}
                    isNearPlayhead={isNearPlayhead}
                    isPlaying={isPlaying}
                  />
                </View>
              );
            })}
            <Animated.View
              style={[
                styles.playhead,
                { transform: [{ translateX: playheadLeft }] },
              ]}
            />
          </View>
          <View style={styles.timeRow}>
            <Text style={styles.timeText}>{formatTime(positionMs)}</Text>
            <Text style={styles.timeText}>
              {durationMs > 0 ? formatTime(durationMs) : '--:--'}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.playButton}
          onPress={handlePlay}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? t('player.a11yPause') : t('player.a11yPlay')}
        >
          <Text style={styles.playIcon}>{isPlaying ? '⏸' : '▶️'}</Text>
        </TouchableOpacity>

        {!reacted ? (
          <TouchableOpacity
            style={styles.reactionButton}
            onPress={() => setReacted(true)}
            accessibilityRole="button"
            accessibilityLabel={t('player.a11yReaction')}
          >
            <Text style={styles.reactionText}>{t('player.thanks')}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.reactedText}>{t('player.thanked')}</Text>
        )}
      </View>
    </View>
  );
}
