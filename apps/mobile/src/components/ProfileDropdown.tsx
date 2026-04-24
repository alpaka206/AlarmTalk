import { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Switch,
  Alert,
  Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import { useTheme, type ThemeColors } from '../hooks/useTheme';
import { useAppStore } from '../stores/useAppStore';
import { getUserProfile, deleteAccount } from '../services/api';

export function ProfileDropdown() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const [visible, setVisible] = useState(false);

  const {
    isAuthenticated,
    plan,
    clearAuth,
    darkMode,
    setDarkMode,
  } = useAppStore();

  const { data: profile } = useQuery({
    queryKey: ['userProfile'],
    queryFn: getUserProfile,
    enabled: isAuthenticated,
  });

  const getPlanLabel = useCallback(() => {
    const labels: Record<string, string> = {
      free: t('settings.planFree'),
      plus: t('settings.planPlus'),
      family: t('settings.planFamily'),
    };
    return labels[plan] || plan;
  }, [plan, t]);

  const handleLogout = useCallback(() => {
    setVisible(false);
    Alert.alert(t('common.logout'), t('settings.logoutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.logout'), style: 'destructive', onPress: () => clearAuth() },
    ]);
  }, [t, clearAuth]);

  const handleDeleteAccount = useCallback(() => {
    setVisible(false);
    Alert.alert(t('settings.deleteAccount'), t('settings.deleteAccountWarning'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.deleteAccount'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAccount();
            clearAuth();
          } catch {
            Alert.alert(t('common.error'), t('settings.deleteAccountError'));
          }
        },
      },
    ]);
  }, [t, clearAuth]);

  const toggleLanguage = useCallback(() => {
    const next = i18n.language === 'ko' ? 'en' : 'ko';
    i18n.changeLanguage(next);
  }, [i18n]);

  const initial = (profile?.name || profile?.email || '?').charAt(0).toUpperCase();

  return (
    <>
      <TouchableOpacity
        style={styles.avatarButton}
        onPress={() => setVisible(true)}
        accessibilityRole="button"
        accessibilityLabel={t('profile.openMenu')}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
      </TouchableOpacity>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setVisible(false)}>
          <Pressable style={styles.menu} onPress={() => {}}>
            {isAuthenticated && profile && (
              <View style={styles.profileSection}>
                <View style={styles.profileAvatar}>
                  <Text style={styles.profileAvatarText}>{initial}</Text>
                </View>
                <View style={styles.profileInfo}>
                  {profile.name && (
                    <Text style={styles.profileName}>{profile.name}</Text>
                  )}
                  <Text style={styles.profileEmail}>{profile.email}</Text>
                  <View style={styles.planBadge}>
                    <Text style={styles.planBadgeText}>{getPlanLabel()}</Text>
                  </View>
                </View>
              </View>
            )}

            <View style={styles.divider} />

            <MenuItem
              styles={styles}
              label={t('profile.people')}
              icon="👤"
              onPress={() => { setVisible(false); router.push('/people'); }}
            />

            <MenuItem
              styles={styles}
              label={t('profile.codeRegister')}
              icon="🎟️"
              onPress={() => { setVisible(false); router.push('/gift/received'); }}
            />

            <View style={styles.divider} />

            <View style={styles.menuItem}>
              <Text style={styles.menuIcon}>🌙</Text>
              <Text style={styles.menuLabel}>{t('settings.darkMode')}</Text>
              <Switch
                value={darkMode}
                onValueChange={setDarkMode}
                trackColor={{ true: colors.primary }}
                style={styles.menuSwitch}
              />
            </View>

            <MenuItem
              styles={styles}
              label={i18n.language === 'ko' ? 'English' : '한국어'}
              icon="🌐"
              onPress={toggleLanguage}
            />

            <MenuItem
              styles={styles}
              label={t('profile.settings')}
              icon="⚙️"
              onPress={() => { setVisible(false); router.push('/settings'); }}
            />

            {isAuthenticated && (
              <>
                <View style={styles.divider} />
                <MenuItem
                  styles={styles}
                  label={t('common.logout')}
                  icon="🚪"
                  onPress={handleLogout}
                  destructive
                />
                <MenuItem
                  styles={styles}
                  label={t('settings.deleteAccount')}
                  icon="⚠️"
                  onPress={handleDeleteAccount}
                  destructive
                  subtle
                />
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function MenuItem({
  styles,
  label,
  icon,
  onPress,
  destructive,
  subtle,
}: {
  styles: ReturnType<typeof createStyles>;
  label: string;
  icon: string;
  onPress: () => void;
  destructive?: boolean;
  subtle?: boolean;
}) {
  return (
    <TouchableOpacity
      style={styles.menuItem}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.menuIcon}>{icon}</Text>
      <Text
        style={[
          styles.menuLabel,
          destructive && styles.menuLabelDestructive,
          subtle && styles.menuLabelSubtle,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    avatarButton: {
      padding: Spacing.xs,
    },
    avatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.primaryLight,
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarText: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.bold,
      color: colors.primaryDark,
    },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.3)',
      justifyContent: 'flex-start',
      alignItems: 'flex-end',
      paddingTop: 100,
      paddingRight: Spacing.md,
    },
    menu: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      paddingVertical: Spacing.sm,
      minWidth: 240,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 12,
      elevation: 8,
    },
    profileSection: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    profileAvatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.primaryLight,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: Spacing.sm,
    },
    profileAvatarText: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
      color: colors.primaryDark,
    },
    profileInfo: {
      flex: 1,
    },
    profileName: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
      color: colors.text,
    },
    profileEmail: {
      fontSize: FontSize.xs,
      color: colors.textSecondary,
      marginTop: 2,
    },
    planBadge: {
      alignSelf: 'flex-start',
      backgroundColor: colors.primaryLight,
      borderRadius: BorderRadius.sm,
      paddingHorizontal: Spacing.xs,
      paddingVertical: 2,
      marginTop: Spacing.xs,
    },
    planBadgeText: {
      fontSize: FontSize.xs,
      fontFamily: FontFamily.semibold,
      color: colors.primaryDark,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: Spacing.xs,
    },
    menuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      minHeight: 44,
    },
    menuIcon: {
      fontSize: 18,
      width: 28,
      textAlign: 'center',
    },
    menuLabel: {
      flex: 1,
      fontSize: FontSize.md,
      color: colors.text,
      fontFamily: FontFamily.regular,
    },
    menuLabelDestructive: {
      color: colors.error,
    },
    menuLabelSubtle: {
      color: colors.textSecondary,
      fontSize: FontSize.sm,
    },
    menuSwitch: {
      marginLeft: Spacing.sm,
    },
  });
}
