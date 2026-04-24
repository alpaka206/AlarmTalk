import { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { FamilyGroupMember } from '../services/api';
import { buildMemberDisplayName } from '../lib/familyAlarmForm';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import { useTheme, type ThemeColors } from '../hooks/useTheme';

interface Props {
  members: FamilyGroupMember[];
  onSendAlarm?: () => void;
}

export function CoupleView({ members, onSendAlarm }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const sorted = [...members].sort((a, b) =>
    a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0,
  );
  const [first, second] = sorted;

  if (!first || !second) return null;

  return (
    <View style={styles.card}>
      <View style={styles.coupleRow}>
        <MemberAvatar member={first} styles={styles} />
        <View style={styles.heartContainer}>
          <Text style={styles.heartEmoji} accessibilityLabel={t('people.coupleConnected')}>
            💕
          </Text>
        </View>
        <MemberAvatar member={second} styles={styles} />
      </View>

      <View style={styles.statusRow}>
        {first.allow_family_alarms && second.allow_family_alarms ? (
          <Text style={styles.statusText}>⏰ {t('people.bothAlarmAllowed')}</Text>
        ) : (
          <Text style={styles.statusHint}>{t('people.coupleAlarmHint')}</Text>
        )}
      </View>

      {onSendAlarm && (
        <TouchableOpacity
          style={styles.alarmBtn}
          onPress={onSendAlarm}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('people.sendFamilyAlarm')}
        >
          <Text style={styles.alarmBtnText}>⏰ {t('people.sendFamilyAlarm')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function MemberAvatar({
  member,
  styles,
}: {
  member: FamilyGroupMember;
  styles: ReturnType<typeof createStyles>;
}) {
  const { t } = useTranslation();
  const displayName = buildMemberDisplayName(member, t);

  return (
    <View style={styles.memberCol}>
      <View style={[styles.avatar, member.role === 'owner' && styles.ownerAvatar]}>
        <Text style={styles.avatarText}>
          {displayName.charAt(0).toUpperCase()}
        </Text>
      </View>
      <Text style={styles.memberName} numberOfLines={1}>
        {displayName}
      </Text>
      <Text style={styles.roleBadgeText}>
        {member.role === 'owner' ? t('people.owner') : t('people.member')}
      </Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.lg,
      marginHorizontal: Spacing.lg,
      marginTop: Spacing.md,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 1,
      shadowRadius: 6,
      elevation: 2,
    },
    coupleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.md,
    },
    memberCol: {
      alignItems: 'center',
      flex: 1,
    },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.primaryLight,
      justifyContent: 'center',
      alignItems: 'center',
    },
    ownerAvatar: {
      backgroundColor: colors.primary,
    },
    avatarText: {
      fontSize: FontSize.xl,
      fontFamily: FontFamily.bold,
      color: '#FFF',
    },
    memberName: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
      color: colors.text,
      marginTop: Spacing.xs,
      textAlign: 'center',
    },
    roleBadgeText: {
      fontSize: FontSize.xs,
      fontFamily: FontFamily.medium,
      color: colors.textTertiary,
      marginTop: 2,
    },
    heartContainer: {
      paddingHorizontal: Spacing.xs,
    },
    heartEmoji: {
      fontSize: 24,
    },
    statusRow: {
      alignItems: 'center',
      marginTop: Spacing.md,
      paddingTop: Spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    statusText: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.medium,
      color: colors.success,
    },
    statusHint: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.regular,
      color: colors.textTertiary,
    },
    alarmBtn: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.sm + 2,
      alignItems: 'center',
      marginTop: Spacing.md,
      minHeight: 44,
      justifyContent: 'center',
    },
    alarmBtnText: {
      color: '#FFF',
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
    },
  });
}
