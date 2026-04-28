import { memo, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { FamilyGroupMember } from '../services/api';
import { buildMemberDisplayName } from '../lib/familyAlarmForm';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import { useTheme, type ThemeColors } from '../hooks/useTheme';

interface Props {
  member: FamilyGroupMember;
  isCouple?: boolean;
  onRemove?: () => void;
  onTransfer?: () => void;
}

export const FamilyMemberRow = memo(function FamilyMemberRow({ member, isCouple, onRemove, onTransfer }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const dynStyles = useMemo(() => createStyles(colors), [colors]);
  const displayName = buildMemberDisplayName(member, t);
  const hasActions = onRemove != null || onTransfer != null;

  return (
    <View
      style={[dynStyles.card, isCouple && dynStyles.coupleCard]}
      accessibilityLabel={`${displayName}, ${member.role === 'owner' ? t('people.owner') : t('people.member')}`}
    >
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
      {hasActions && (
        <View style={dynStyles.actions}>
          {onTransfer != null && (
            <TouchableOpacity
              onPress={onTransfer}
              hitSlop={8}
              style={dynStyles.actionBtn}
              accessibilityRole="button"
              accessibilityLabel={t('people.transferOwnership')}
            >
              <Text style={dynStyles.actionBtnText}>👑</Text>
            </TouchableOpacity>
          )}
          {onRemove != null && (
            <TouchableOpacity
              onPress={onRemove}
              hitSlop={8}
              style={dynStyles.removeActionBtn}
              accessibilityRole="button"
              accessibilityLabel={t('people.removeMember')}
            >
              <Text style={dynStyles.removeActionBtnText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
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
    actions: {
      flexDirection: 'row',
      gap: Spacing.xs,
      marginLeft: Spacing.sm,
    },
    actionBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceVariant,
      justifyContent: 'center',
      alignItems: 'center',
    },
    actionBtnText: {
      fontSize: FontSize.md,
    },
    removeActionBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: `${colors.error}15`,
      justifyContent: 'center',
      alignItems: 'center',
    },
    removeActionBtnText: {
      fontSize: FontSize.sm,
      color: colors.error,
    },
  });
}
