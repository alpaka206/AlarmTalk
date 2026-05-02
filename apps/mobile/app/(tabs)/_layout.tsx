import { useMemo } from 'react';
import { Tabs } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { FontFamily, Spacing } from '../../src/constants/theme';
import { useTheme } from '../../src/hooks/useTheme';
import { ProfileDropdown } from '../../src/components/ProfileDropdown';
import { AppIcon, type AppIconName } from '../../src/components/AppIcon';

const TAB_ICONS: Record<string, AppIconName> = {
  home: 'home',
  voices: 'mic',
  alarms: 'alarm',
  compose: 'message',
};

function TabIcon({
  name,
  focused,
  activeColor,
  inactiveColor,
}: {
  name: string;
  focused: boolean;
  activeColor: string;
  inactiveColor: string;
}) {
  const iconName = TAB_ICONS[name] ?? 'home';
  // Active tab: full duotone (mustard fill on navy stroke).
  // Inactive: regular weight, stroke = textTertiary so it recedes.
  return (
    <AppIcon
      name={iconName}
      size={26}
      weight={focused ? 'duotone' : 'regular'}
      color={focused ? activeColor : inactiveColor}
    />
  );
}

export default function TabLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const screenOptions = useMemo(() => {
    const tabBarBaseHeight = 64;
    // Just hug the system nav inset — no extra padding. The previous +16
    // breathing room pushed the tab bar up over the content area, which
    // showed up as a strip of background color overlaying the last row of
    // cards on the home screen. Edge-to-edge phones (gesture nav) already
    // get a comfortable inset; legacy 3-button phones report 0 and the
    // small floor of 8 keeps the tab labels from touching the system nav.
    const tabBarBottomPadding = insets.bottom > 0 ? insets.bottom : 8;

    return {
      headerShown: true,
      headerTitle: '',
      headerStyle: { backgroundColor: colors.background },
      headerShadowVisible: false,
      headerRight: () => (
        <View style={styles.headerRight}>
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
    };
  }, [colors, insets.bottom]);

  const rootStyle = useMemo(
    () => [styles.root, { backgroundColor: colors.surface }],
    [colors.surface],
  );

  return (
    <View style={rootStyle}>
      <Tabs screenOptions={screenOptions}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('tab.home'),
          // Home renders its own header inline (greeting + bell + profile in
          // one row) so the stack header would just be a blank box clipping
          // the greeting glyphs.
          headerShown: false,
          tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} activeColor={colors.primary} inactiveColor={colors.textTertiary} />,
        }}
      />
      <Tabs.Screen
        name="voices"
        options={{
          title: t('tab.voices'),
          tabBarIcon: ({ focused }) => <TabIcon name="voices" focused={focused} activeColor={colors.primary} inactiveColor={colors.textTertiary} />,
        }}
      />
      <Tabs.Screen
        name="alarms"
        options={{
          title: t('tab.alarms'),
          tabBarIcon: ({ focused }) => <TabIcon name="alarms" focused={focused} activeColor={colors.primary} inactiveColor={colors.textTertiary} />,
        }}
      />
      <Tabs.Screen
        name="compose"
        options={{
          title: t('tab.compose'),
          tabBarIcon: ({ focused }) => <TabIcon name="compose" focused={focused} activeColor={colors.primary} inactiveColor={colors.textTertiary} />,
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
  headerRight: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Spacing.xs,
    marginRight: Spacing.md,
  },
});
