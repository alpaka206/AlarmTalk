import { Tabs } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const insets = useSafeAreaInsets();

  const tabBarBaseHeight = 64;
  const tabBarExtraBreathingRoom = 16;
  const tabBarBottomPadding =
    (insets.bottom > 0 ? insets.bottom : 8) + tabBarExtraBreathingRoom;

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
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            borderTopWidth: StyleSheet.hairlineWidth,
            height: tabBarBaseHeight + tabBarBottomPadding,
            paddingTop: 10,
            paddingBottom: tabBarBottomPadding,
          },
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
