import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../../src/constants/theme';
import { useAppStore } from '../../src/stores/useAppStore';
import { useTheme, type ThemeColors } from '../../src/hooks/useTheme';
import { getUserProfile, deleteAccount } from '../../src/services/api';
import { useState, useEffect, useMemo } from 'react';
import { Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getAudioCacheSize } from '../../src/services/audio';

export default function SettingsScreen() {
  const { plan, isAuthenticated, clearAuth, defaultSnoozeMinutes, setDefaultSnoozeMinutes, darkMode, setDarkMode } = useAppStore();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [cacheSize, setCacheSize] = useState(0);
  const [notifStatus, setNotifStatus] = useState<string>('undetermined');
  const { t } = useTranslation();

  const { data: profile } = useQuery({
    queryKey: ['userProfile'],
    queryFn: getUserProfile,
    enabled: isAuthenticated,
  });

  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  useEffect(() => {
    getAudioCacheSize().then(setCacheSize);
    Notifications.getPermissionsAsync().then(({ status }) => setNotifStatus(status));
  }, []);

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getPlanLabel = () => {
    const labels: Record<string, string> = {
      free: t('settings.planFree'),
      plus: t('settings.planPlus'),
      family: t('settings.planFamily'),
    };
    return labels[plan] || plan;
  };

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleLogout = () => {
    Alert.alert(t('common.logout'), t('settings.logoutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.logout'), style: 'destructive', onPress: () => clearAuth() },
    ]);
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      await deleteAccount();
      clearAuth();
    } catch {
      setDeleting(false);
      Alert.alert(t('common.error'), t('settings.deleteAccountError'));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('settings.title')}</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.account')}</Text>
          <View style={styles.card}>
            {profile?.name && (
              <SettingRow colors={colors} label={t('settings.name', '이름')} value={profile.name} />
            )}
            {profile?.email && (
              <SettingRow colors={colors} label={t('settings.email', '이메일')} value={profile.email} />
            )}
            <SettingRow colors={colors} label={t('settings.plan')} value={getPlanLabel()} />
            <SettingRow colors={colors} label={t('settings.managePlan')} value="→" onPress={() => {}} />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.notifications')}</Text>
          <View style={styles.card}>
            <SettingRow
              colors={colors}
              label={t('settings.notifPermission', '알림 권한')}
              value={notifStatus === 'granted' ? t('settings.permitted', '허용됨') : t('settings.notPermitted', '허용 안 됨')}
              valueColor={notifStatus === 'granted' ? colors.primary : colors.error}
              onPress={async () => {
                if (notifStatus !== 'granted') {
                  const { status } = await Notifications.requestPermissionsAsync();
                  setNotifStatus(status);
                  if (status !== 'granted') {
                    Linking.openSettings();
                  }
                }
              }}
            />
            <SettingRow
              colors={colors}
              label={t('settings.alarmNotif')}
              trailing={<Switch value={true} trackColor={{ true: colors.primary }} />}
            />
            <SettingRow
              colors={colors}
              label={t('settings.messageNotif')}
              trailing={<Switch value={true} trackColor={{ true: colors.primary }} />}
            />
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>{t('settings.defaultSnooze')}</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {[5, 10, 15].map((m) => (
                  <TouchableOpacity
                    key={m}
                    onPress={() => setDefaultSnoozeMinutes(m)}
                    style={{
                      paddingHorizontal: Spacing.md - 4,
                      paddingVertical: Spacing.xs,
                      borderRadius: BorderRadius.md,
                      backgroundColor: defaultSnoozeMinutes === m ? colors.primary : colors.surfaceVariant,
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: defaultSnoozeMinutes === m }}
                    accessibilityLabel={`${m}${t('settings.minutes')}`}
                  >
                    <Text style={{
                      fontSize: FontSize.sm,
                      fontFamily: FontFamily.semibold,
                      color: defaultSnoozeMinutes === m ? colors.surface : colors.textSecondary,
                    }}>
                      {m}{t('settings.minutes')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.voice')}</Text>
          <View style={styles.card}>
            <SettingRow
              colors={colors}
              label={t('settings.voiceQuality')}
              value={t('settings.voiceQualityHigh')}
              onPress={() => {}}
            />
            <SettingRow colors={colors} label={t('settings.cacheSize')} value={formatBytes(cacheSize)} />
            <SettingRow
              colors={colors}
              label={t('settings.clearCache')}
              valueColor={colors.error}
              value={t('common.delete')}
              onPress={() => Alert.alert(t('settings.clearCache'), t('settings.clearCacheConfirm'))}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.app')}</Text>
          <View style={styles.card}>
            <SettingRow
              colors={colors}
              label={t('settings.darkMode')}
              trailing={
                <Switch
                  value={darkMode}
                  onValueChange={setDarkMode}
                  trackColor={{ true: colors.primary }}
                />
              }
            />
            <SettingRow
              colors={colors}
              label={t('settings.language')}
              value={t('settings.languageKorean')}
              onPress={() => {}}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.info')}</Text>
          <View style={styles.card}>
            <SettingRow colors={colors} label={t('settings.version')} value={`${appVersion} (${Constants.expoConfig?.extra?.eas?.projectId ? 'EAS' : t('settings.buildNumber')})`} />
            <SettingRow
              colors={colors}
              label={t('settings.terms')}
              value="→"
              onPress={() => Linking.openURL('https://voicealarm.app/terms')}
            />
            <SettingRow
              colors={colors}
              label={t('settings.privacy')}
              value="→"
              onPress={() => Linking.openURL('https://voicealarm.app/privacy')}
            />
            <SettingRow
              colors={colors}
              label={t('settings.openSource')}
              value="→"
              onPress={() => Linking.openURL('https://voicealarm.app/licenses')}
            />
            <SettingRow
              colors={colors}
              label={t('settings.contactSupport')}
              value="→"
              onPress={() => Linking.openURL('mailto:devrel.365@gmail.com?subject=VoiceAlarm%20Support')}
            />
          </View>
        </View>

        <View style={styles.appFooter}>
          <Text style={styles.footerAppName}>VoiceAlarm</Text>
          <Text style={styles.footerDescription}>{t('settings.appDescription')}</Text>
          <Text style={styles.footerCopyright}>© 2026 VoiceAlarm</Text>
        </View>

        {isAuthenticated && (
          <>
            <TouchableOpacity
              style={styles.logoutButton}
              onPress={handleLogout}
              accessibilityRole="button"
              accessibilityLabel={t('common.logout')}
            >
              <Text style={styles.logoutText}>{t('common.logout')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.deleteAccountButton}
              onPress={() => setShowDeleteDialog(true)}
              accessibilityRole="button"
              accessibilityLabel={t('settings.deleteAccount')}
            >
              <Text style={styles.deleteAccountText}>{t('settings.deleteAccount')}</Text>
            </TouchableOpacity>
          </>
        )}

        {showDeleteDialog && (
          <View style={styles.deleteDialog}>
            <Text style={styles.deleteDialogTitle}>{t('settings.deleteAccount')}</Text>
            <Text style={styles.deleteDialogWarning}>{t('settings.deleteAccountWarning')}</Text>
            <Text style={styles.deleteDialogPrompt}>{t('settings.deleteAccountConfirmPrompt')}</Text>
            <TextInput
              style={styles.deleteDialogInput}
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!deleting}
            />
            <View style={styles.deleteDialogButtons}>
              <TouchableOpacity
                style={styles.deleteDialogCancel}
                onPress={() => {
                  setShowDeleteDialog(false);
                  setDeleteConfirmText('');
                }}
                disabled={deleting}
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
              >
                <Text style={styles.deleteDialogCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.deleteDialogConfirm,
                  deleteConfirmText !== t('settings.deleteAccountConfirmWord') && styles.disabled,
                ]}
                onPress={handleDeleteAccount}
                disabled={deleteConfirmText !== t('settings.deleteAccountConfirmWord') || deleting}
                accessibilityRole="button"
                accessibilityLabel={t('settings.deleteAccount')}
              >
                {deleting ? (
                  <ActivityIndicator color={colors.surface} size="small" />
                ) : (
                  <Text style={styles.deleteDialogConfirmText}>{t('settings.deleteAccount')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingRow({
  colors,
  label,
  value,
  valueColor,
  trailing,
  onPress,
}: {
  colors: ThemeColors;
  label: string;
  value?: string;
  valueColor?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
}) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: Spacing.md,
        borderBottomWidth: 0.5,
        borderBottomColor: colors.border,
      }}
      onPress={onPress}
      {...(onPress ? { accessibilityRole: 'button' as const, accessibilityLabel: label } : { accessible: true, accessibilityLabel: `${label} ${value ?? ''}` })}
    >
      <Text style={{ fontSize: FontSize.md, color: colors.text }}>{label}</Text>
      {trailing || (
        <Text style={{ fontSize: FontSize.md, color: valueColor ?? colors.textSecondary }}>
          {value}
        </Text>
      )}
    </Wrapper>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: Spacing.lg,
      paddingBottom: 120,
    },
    title: {
      fontSize: FontSize.hero,
      fontFamily: FontFamily.bold,
      color: colors.text,
      marginBottom: Spacing.lg,
    },
    section: {
      marginBottom: Spacing.lg,
    },
    sectionTitle: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.semibold,
      color: colors.textSecondary,
      textTransform: 'uppercase',
      marginBottom: Spacing.sm,
      marginLeft: Spacing.xs,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      paddingHorizontal: Spacing.lg,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 1,
      shadowRadius: 6,
      elevation: 2,
    },
    settingRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: Spacing.md,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
    },
    settingLabel: {
      fontSize: FontSize.md,
      color: colors.text,
    },
    logoutButton: {
      alignItems: 'center',
      paddingVertical: Spacing.md,
      marginTop: Spacing.lg,
    },
    logoutText: {
      fontSize: FontSize.md,
      color: colors.error,
      fontFamily: FontFamily.semibold,
    },
    deleteAccountButton: {
      alignItems: 'center',
      paddingVertical: Spacing.sm,
      marginTop: Spacing.xs,
    },
    deleteAccountText: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
    },
    deleteDialog: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.lg,
      marginTop: Spacing.lg,
      borderWidth: 1,
      borderColor: colors.error,
    },
    deleteDialogTitle: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
      color: colors.error,
      marginBottom: Spacing.sm,
    },
    deleteDialogWarning: {
      fontSize: FontSize.sm,
      color: colors.text,
      lineHeight: 20,
      marginBottom: Spacing.md,
    },
    deleteDialogPrompt: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginBottom: Spacing.sm,
    },
    deleteDialogInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.md,
      padding: Spacing.sm,
      fontSize: FontSize.md,
      color: colors.text,
      marginBottom: Spacing.md,
    },
    deleteDialogButtons: {
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    deleteDialogCancel: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.md,
      backgroundColor: colors.surfaceVariant,
    },
    deleteDialogCancelText: {
      fontSize: FontSize.md,
      color: colors.text,
      fontFamily: FontFamily.semibold,
    },
    deleteDialogConfirm: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.md,
      backgroundColor: colors.error,
    },
    deleteDialogConfirmText: {
      fontSize: FontSize.md,
      color: colors.surface,
      fontFamily: FontFamily.semibold,
    },
    disabled: {
      opacity: 0.5,
    },
    appFooter: {
      alignItems: 'center',
      paddingTop: Spacing.xl,
      paddingBottom: Spacing.md,
    },
    footerAppName: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
      color: colors.primary,
      marginBottom: Spacing.xs,
    },
    footerDescription: {
      fontSize: FontSize.sm,
      color: colors.textTertiary,
      textAlign: 'center',
      marginBottom: Spacing.xs,
    },
    footerCopyright: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
    },
  });
}
