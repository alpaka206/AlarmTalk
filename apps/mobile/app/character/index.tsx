import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getCharacterMe,
  grantCharacterXp,
} from '../../src/services/api';
import type { XpEvent, StreakAchievement } from '../../src/services/api';
import {
  formatProgress,
  pickStreakAwareDialogue,
  progressBarWidthPct,
  shouldShowStageTransition,
  stageToEmoji,
  stageToLabel,
} from '../../src/lib/character';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/hooks/useTheme';
import { createCharacterStyles } from '../../src/styles/characterStyles';

const DEV_EVENTS: { event: XpEvent; labelKey: string }[] = [
  { event: 'alarm_completed', labelKey: 'character.devAlarmCompleted' },
  { event: 'alarm_snoozed', labelKey: 'character.devAlarmSnoozed' },
  { event: 'family_alarm_received', labelKey: 'character.devFamilyAlarmReceived' },
];

const MILESTONES = [7, 30, 90] as const;

type DynStyles = ReturnType<typeof createCharacterStyles>;

function StatBar({ label, value, max, color, dynStyles, t }: {
  label: string; value: number; max: number; color: string;
  dynStyles: DynStyles; t: ReturnType<typeof useTranslation>['t'];
}) {
  const pct = Math.min((value / Math.max(max, 1)) * 100, 100);
  return (
    <View
      style={dynStyles.statBarRow}
      accessibilityLabel={t('character.a11yStat', { name: label, value })}
    >
      <Text style={dynStyles.statBarLabel}>{label}</Text>
      <View style={dynStyles.statBarTrack}>
        <View style={[dynStyles.statBarFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={dynStyles.statBarValue}>{value}</Text>
    </View>
  );
}

function MilestoneBadge({ milestone, achieved, dynStyles, t }: {
  milestone: number; achieved: boolean;
  dynStyles: DynStyles; t: ReturnType<typeof useTranslation>['t'];
}) {
  const emoji = milestone === 7 ? '🌱' : milestone === 30 ? '🌳' : '🌸';
  return (
    <View
      style={[dynStyles.milestoneBadge, achieved && dynStyles.milestoneBadgeAchieved]}
      accessibilityLabel={t('character.a11yMilestone', {
        days: milestone,
        status: achieved ? t('character.a11yMilestoneAchieved') : t('character.a11yMilestoneNotYet'),
      })}
    >
      <Text style={dynStyles.milestoneEmoji}>{emoji}</Text>
      <Text style={[dynStyles.milestoneDay, achieved && dynStyles.milestoneDayAchieved]}>
        {milestone}
      </Text>
    </View>
  );
}

export default function CharacterScreen() {
  const { colors } = useTheme();
  const dynStyles = useMemo(() => createCharacterStyles(colors), [colors]);
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [dialogueSeed, setDialogueSeed] = useState(0);
  const [lastGrantNotice, setLastGrantNotice] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['character-me'],
    queryFn: getCharacterMe,
  });

  const grantMutation = useMutation({
    mutationFn: grantCharacterXp,
    onSuccess: (res) => {
      const suffix = res.grant.capped ? ` (${t('character.capReached')})` : '';
      setLastGrantNotice(`+${res.grant.granted_xp} XP · +${res.grant.affection} ${t('character.affection')}${suffix}`);
      queryClient.invalidateQueries({ queryKey: ['character-me'] });
    },
    onError: () => {
      setLastGrantNotice(t('character.xpFailed'));
    },
  });

  const stage = data?.character.stage ?? 'seed';
  const prevStageRef = useRef(stage);
  const emojiScale = useMemo(() => new Animated.Value(1), []);
  const emojiOpacity = useMemo(() => new Animated.Value(1), []);

  useEffect(() => {
    if (shouldShowStageTransition(prevStageRef.current, stage)) {
      emojiScale.setValue(0.3);
      emojiOpacity.setValue(0);
      Animated.sequence([
        Animated.parallel([
          Animated.spring(emojiScale, { toValue: 1.2, useNativeDriver: true, speed: 12 }),
          Animated.timing(emojiOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        ]),
        Animated.spring(emojiScale, { toValue: 1, useNativeDriver: true, speed: 14 }),
      ]).start();
    }
    prevStageRef.current = stage;
  }, [stage, emojiScale, emojiOpacity]);

  const currentStreak = data?.streak?.current ?? 0;
  const dialogue = useMemo(
    () => pickStreakAwareDialogue(stage, currentStreak, t, () => ((dialogueSeed * 9301 + 49297) % 233280) / 233280),
    [stage, currentStreak, dialogueSeed, t],
  );

  const handleTap = useCallback(() => {
    setDialogueSeed((n) => n + 1);
  }, []);

  if (isLoading) {
    return (
      <SafeAreaView style={dynStyles.container} edges={['bottom']}>
        <View style={dynStyles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !data) {
    return (
      <SafeAreaView style={dynStyles.container} edges={['bottom']}>
        <View style={dynStyles.errorContainer}>
          <Text style={dynStyles.errorText}>{t('character.loadError')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const { character, progress, streak, stats, achievements } = data;
  const barWidth = progressBarWidthPct(progress);
  const achievedMilestones = new Set(achievements.map((a: StreakAchievement) => a.milestone));

  return (
    <SafeAreaView style={dynStyles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={dynStyles.scrollContent}>
        <Pressable
          onPress={handleTap}
          style={dynStyles.characterCard}
          accessibilityRole="button"
          accessibilityLabel={t('character.tapHint')}
        >
          <Animated.Text
            style={[dynStyles.emoji, { transform: [{ scale: emojiScale }], opacity: emojiOpacity }]}
          >
            {stageToEmoji(character.stage)}
          </Animated.Text>
          <View style={dynStyles.nameRow}>
            <Text style={dynStyles.characterName}>{character.name}</Text>
            <View style={dynStyles.badge}>
              <Text style={dynStyles.badgeText}>
                Lv.{character.level} · {stageToLabel(character.stage, t)}
              </Text>
            </View>
          </View>
          <Text style={dynStyles.dialogue}>{dialogue}</Text>
        </Pressable>

        {/* Streak badge */}
        <View
          style={dynStyles.streakCard}
          accessibilityLabel={t('character.a11yStreak', { count: streak.current, longest: streak.longest })}
        >
          <View style={dynStyles.streakMain}>
            <Text style={dynStyles.streakFire}>🔥</Text>
            <Text style={dynStyles.streakCount}>{streak.current}</Text>
            <Text style={dynStyles.streakLabel}>{t('character.streakDays')}</Text>
          </View>
          <View style={dynStyles.streakMeta}>
            <Text style={dynStyles.streakBest}>
              {t('character.longestStreak')}: {streak.longest}{t('character.dayUnit')}
            </Text>
          </View>
          {/* Milestone badges */}
          <View style={dynStyles.milestoneRow}>
            {MILESTONES.map((m) => (
              <MilestoneBadge key={m} milestone={m} achieved={achievedMilestones.has(m)} dynStyles={dynStyles} t={t} />
            ))}
          </View>
        </View>

        {/* Growth progress */}
        <View style={dynStyles.section}>
          <View style={dynStyles.progressHeader}>
            <Text style={dynStyles.sectionTitle} accessibilityRole="header">{t('character.growthProgress')}</Text>
            <Text style={dynStyles.progressText}>{formatProgress(progress)}</Text>
          </View>
          <View
            style={dynStyles.progressBarBg}
            accessibilityRole="progressbar"
            accessibilityValue={{
              min: 0,
              max: 100,
              now: Math.round(barWidth),
            }}
            accessibilityLabel={t('character.xpProgress')}
          >
            <View style={[dynStyles.progressBarFill, { width: `${barWidth}%` }]} />
          </View>
          <View style={dynStyles.xpStatsRow}>
            <View style={dynStyles.xpStatItem} accessibilityLabel={t('character.a11yXpStat', { label: t('character.totalXp'), value: character.xp })}>
              <Text style={dynStyles.xpStatLabel}>{t('character.totalXp')}</Text>
              <Text style={dynStyles.xpStatValue}>{character.xp}</Text>
            </View>
            <View style={dynStyles.xpStatItem} accessibilityLabel={t('character.a11yXpStat', { label: t('character.affection'), value: character.affection })}>
              <Text style={dynStyles.xpStatLabel}>{t('character.affection')}</Text>
              <Text style={dynStyles.xpStatValue}>💗 {character.affection}</Text>
            </View>
            <View style={dynStyles.xpStatItem} accessibilityLabel={t('character.a11yXpStat', { label: t('character.todayXp'), value: `${character.daily_xp}/200` })}>
              <Text style={dynStyles.xpStatLabel}>{t('character.todayXp')}</Text>
              <Text style={dynStyles.xpStatValue}>{character.daily_xp} / 200</Text>
            </View>
          </View>
        </View>

        {/* Character stats */}
        <View style={dynStyles.section}>
          <Text style={dynStyles.sectionTitle} accessibilityRole="header">{t('character.statsTitle')}</Text>
          <View style={dynStyles.statBarsContainer}>
            <StatBar
              label={t('character.statDiligence')}
              value={stats.diligence}
              max={Math.max(stats.diligence, stats.health, stats.consistency, 10)}
              color="#8B5E3C"
              dynStyles={dynStyles}
              t={t}
            />
            <StatBar
              label={t('character.statHealth')}
              value={stats.health}
              max={Math.max(stats.diligence, stats.health, stats.consistency, 10)}
              color={colors.success}
              dynStyles={dynStyles}
              t={t}
            />
            <StatBar
              label={t('character.statConsistency')}
              value={stats.consistency}
              max={Math.max(stats.diligence, stats.health, stats.consistency, 10)}
              color={colors.primary}
              dynStyles={dynStyles}
              t={t}
            />
          </View>
        </View>

        {__DEV__ && (
        <View style={dynStyles.section}>
          <Text style={dynStyles.sectionTitle}>{t('character.devXpTitle')}</Text>
          <Text style={dynStyles.devHint}>{t('character.devXpHint')}</Text>
          <View style={dynStyles.devButtonsRow}>
            {DEV_EVENTS.map((e) => (
              <Pressable
                key={e.event}
                onPress={() => grantMutation.mutate({ event: e.event })}
                disabled={grantMutation.isPending}
                style={[dynStyles.devButton, grantMutation.isPending && dynStyles.devButtonDisabled]}
              >
                <Text style={dynStyles.devButtonText}>{t(e.labelKey)}</Text>
              </Pressable>
            ))}
          </View>
          {lastGrantNotice && (
            <Text style={dynStyles.grantNotice} accessibilityRole="text">
              {lastGrantNotice}
            </Text>
          )}
        </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

