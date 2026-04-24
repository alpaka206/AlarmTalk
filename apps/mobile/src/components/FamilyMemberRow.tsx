import { memo, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { FamilyGroupMember } from '../services/api';
import { buildMemberDisplayName } from '../lib/familyAlarmForm';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import { useTheme, type ThemeColors } from '../hooks/useTheme';

interface Props {
  member: FamilyGroupMember;
  isCouple?: boolean;
}

export const FamilyMemberRow = memo(function FamilyMemberRow({ member, isCouple }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const dynStyles = useMemo(() => createStyles(colors), [colors]);
  const displayName = buildMemberDisplayName(member, t);

  return (
    <View style={[dynStyles.card, isCouple && dynStyles.coupleCard]}>
      <View style={[dynStyles.avatar, member.role === 'owner' && dynStyles.ownerAvatar]}>
        <Text style={dynStyles.avatarText}>
          {displayName.charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={dynStyles.info}>
        <View style={dynStyles.nameRow}>
          <Text style={dynStyles.name} numberOfLines={1}>{displayName}</Text>
          <View style={[dynStyles.roleBadge, member.role === 'owner' ? dynStyles.ownerBadge : dynStyles.memberBadge]}>
            <Text style={dynStyles.roleBadgeText}>
              {member.role === 'owner' ? t('people.owner') : t('people.member')}
            </Text>
          </View>
        </View>
        {member.email && <Text style={dynStyles.email}>{member.email}</Text>}
        {member.allow_family_alarms && (
          <Text style={dynStyles.alarmAllowed}>⏰ {t('people.alarmAllowed')}</Text>
        )}
      </View>
    </View>
  );
});

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
      marginBottom: Spacing.md,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 1,
      shadowRadius: 6,
      elevation: 2,
    },
    coupleCard: {
      borderWidth: 1,
      borderColor: colors.primaryLight,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.primaryLight,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: Spacing.md,
    },
    ownerAvatar: {
      backgroundColor: colors.primary,
    },
    avatarText: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
      color: colors.primaryDark,
    },
    info: {
      flex: 1,
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    name: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
      color: colors.text,
      flexShrink: 1,
    },
    email: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginTop: 2,
    },
    roleBadge: {
      paddingHorizontal: Spacing.xs + 2,
      paddingVertical: 1,
      borderRadius: BorderRadius.full,
    },
    ownerBadge: {
      backgroundColor: `${colors.primary}20`,
    },
    memberBadge: {
      backgroundColor: colors.surfaceVariant,
    },
    roleBadgeText: {
      fontSize: FontSize.xs - 1,
      fontFamily: FontFamily.semibold,
      color: colors.textSecondary,
    },
    alarmAllowed: {
      fontSize: FontSize.xs,
      color: colors.success,
      marginTop: 2,
    },
  });
}
