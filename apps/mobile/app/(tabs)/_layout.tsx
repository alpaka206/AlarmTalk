import { Tabs } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FontFamily, Spacing } from '../../src/constants/theme';
import { useTheme } from '../../src/hooks/useTheme';
import { OfflineBanner } from '../../src/components/OfflineBanner';
import { ProfileDropdown } from '../../src/components/ProfileDropdown';
import { NotificationBell } from '../../src/components/NotificationBell';

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = {
    home: '🏠',
    voices: '🎙️',
    alarms: '⏰',
    compose: '💌',
  };
  return <Text style={[styles.icon, focused && styles.iconFocused]}>{icons[name] || '📱'}</Text>;
}

export default function TabLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();

  return (
    <View style={styles.root}>
      <OfflineBanner />
      <Tabs
        screenOptions={{
          headerShown: true,
          headerTitle: '',
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerRight: () => (
            <View style={styles.headerRight}>
              <NotificationBell />
              <ProfileDropdown />
            </View>
          ),
          tabBarStyle: [styles.tabBar, { backgroundColor: colors.surface, borderTopColor: colors.border }],
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textTertiary,
          tabBarLabelStyle: styles.tabLabel,
        }}
      >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tab.home'),
          tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="voices"
        options={{
          title: t('tab.voices'),
          tabBarIcon: ({ focused }) => <TabIcon name="voices" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="alarms"
        options={{
          title: t('tab.alarms'),
          tabBarIcon: ({ focused }) => <TabIcon name="alarms" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="compose"
        options={{
          title: t('tab.compose'),
          tabBarIcon: ({ focused }) => <TabIcon name="compose" focused={focused} />,
        }}
      />
    </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  tabBar: {
    borderTopWidth: 1,
    height: 85,
    paddingTop: 8,
    paddingBottom: 28,
  },
  tabLabel: {
    fontSize: 11,
    fontFamily: FontFamily.semibold,
  },
  icon: {
    fontSize: 22,
    opacity: 0.5,
  },
  iconFocused: {
    opacity: 1,
  },
  headerRight: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Spacing.xs,
    marginRight: Spacing.md,
  },
});
