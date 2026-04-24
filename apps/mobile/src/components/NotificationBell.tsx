import { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { FontSize, FontFamily, Spacing } from '../constants/theme';
import { useTheme, type ThemeColors } from '../hooks/useTheme';
import { useAppStore } from '../stores/useAppStore';
import { getPendingRequests } from '../services/api';

export function NotificationBell() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  const { data: pending } = useQuery({
    queryKey: ['pending-requests'],
    queryFn: getPendingRequests,
    enabled: isAuthenticated,
  });

  const badgeCount = pending?.length ?? 0;

  return (
    <TouchableOpacity
      style={styles.button}
      onPress={() => router.push('/people')}
      accessibilityRole="button"
      accessibilityLabel={
        badgeCount > 0
          ? t('profile.notificationsBadge', { count: badgeCount })
          : t('profile.notifications')
      }
    >
      <Text style={styles.icon}>🔔</Text>
      {badgeCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {badgeCount > 9 ? '9+' : badgeCount}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    button: {
      padding: Spacing.xs,
      position: 'relative',
    },
    icon: {
      fontSize: 22,
    },
    badge: {
      position: 'absolute',
      top: 2,
      right: 0,
      minWidth: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: colors.error,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 3,
    },
    badgeText: {
      fontSize: 10,
      fontFamily: FontFamily.bold,
      color: '#FFF',
    },
  });
}
