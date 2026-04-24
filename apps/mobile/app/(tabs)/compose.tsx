import { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../../src/constants/theme';
import { useTheme, type ThemeColors } from '../../src/hooks/useTheme';
import { useAppStore } from '../../src/stores/useAppStore';

export default function ComposeScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const plan = useAppStore((s) => s.plan);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  const isFamilyOrCouple = plan === 'family';

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>💌</Text>
          <Text style={styles.emptyText}>{t('compose.loginRequired')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!isFamilyOrCouple) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('compose.title')}</Text>
        </View>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>💌</Text>
          <Text style={styles.emptyText}>{t('compose.familyOnly')}</Text>
          <Text style={styles.emptyHint}>{t('compose.familyOnlyHint')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('compose.title')}</Text>
      </View>
      <View style={styles.content}>
        <TouchableOpacity
          style={styles.actionCard}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('compose.sendAlarm')}
        >
          <Text style={styles.actionEmoji}>⏰</Text>
          <View style={styles.actionInfo}>
            <Text style={styles.actionTitle}>{t('compose.sendAlarm')}</Text>
            <Text style={styles.actionDesc}>{t('compose.sendAlarmDesc')}</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionCard}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('compose.sendNote')}
        >
          <Text style={styles.actionEmoji}>✉️</Text>
          <View style={styles.actionInfo}>
            <Text style={styles.actionTitle}>{t('compose.sendNote')}</Text>
            <Text style={styles.actionDesc}>{t('compose.sendNoteDesc')}</Text>
          </View>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.sm,
    },
    title: {
      fontSize: FontSize.hero,
      fontFamily: FontFamily.bold,
      color: colors.text,
    },
    content: {
      flex: 1,
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.md,
      gap: Spacing.md,
    },
    actionCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.lg,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 1,
      shadowRadius: 6,
      elevation: 2,
    },
    actionEmoji: {
      fontSize: 32,
      marginRight: Spacing.md,
    },
    actionInfo: {
      flex: 1,
    },
    actionTitle: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.semibold,
      color: colors.text,
    },
    actionDesc: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginTop: Spacing.xs,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: Spacing.xl,
    },
    emptyEmoji: {
      fontSize: 48,
      marginBottom: Spacing.md,
    },
    emptyText: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    emptyHint: {
      fontSize: FontSize.sm,
      color: colors.textTertiary,
      textAlign: 'center',
      marginTop: Spacing.xs,
    },
  });
}
