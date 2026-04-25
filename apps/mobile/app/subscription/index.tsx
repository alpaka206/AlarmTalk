import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useCallback } from 'react';
import { useTheme } from '../../src/hooks/useTheme';
import { useAppStore } from '../../src/stores/useAppStore';
import { createSubscriptionStyles } from '../../src/styles/subscriptionStyles';
import { getSubscription, checkout } from '../../src/services/api';
import { ErrorView } from '../../src/components/QueryStateView';
import { getApiErrorMessage } from '../../src/lib/apiErrors';
import { useToast } from '../../src/hooks/useToast';
import { Toast } from '../../src/components/Toast';

interface PlanOption {
  key: string;
  nameKey: string;
  priceKey: string;
  descKey: string;
  features: string[];
}

const PLANS: PlanOption[] = [
  {
    key: 'free',
    nameKey: 'subscription.planFreeName',
    priceKey: 'subscription.planFreePrice',
    descKey: 'subscription.planFreeDesc',
    features: [
      'subscription.featureVoice1',
      'subscription.featureAlarmBasic',
      'subscription.featureCharacter',
    ],
  },
  {
    key: 'personal',
    nameKey: 'subscription.planPlusName',
    priceKey: 'subscription.planPlusPrice',
    descKey: 'subscription.planPlusDesc',
    features: [
      'subscription.featureVoice2',
      'subscription.featureAlarmUnlimited',
      'subscription.featureCharacter',
      'subscription.featurePresets',
    ],
  },
  {
    key: 'family',
    nameKey: 'subscription.planFamilyName',
    priceKey: 'subscription.planFamilyPrice',
    descKey: 'subscription.planFamilyDesc',
    features: [
      'subscription.featureVoice2',
      'subscription.featureAlarmUnlimited',
      'subscription.featureCharacter',
      'subscription.featurePresets',
      'subscription.featureFamilyGroup',
      'subscription.featureFamilyAlarm',
    ],
  },
];

function planTypeToUserPlan(planType: string): 'free' | 'plus' | 'family' {
  if (planType === 'family') return 'family';
  if (planType === 'personal') return 'plus';
  return 'free';
}

export default function SubscriptionScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createSubscriptionStyles(colors), [colors]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { plan, isAuthenticated } = useAppStore();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['subscription'],
    queryFn: getSubscription,
    enabled: isAuthenticated,
  });

  const checkoutMutation = useMutation({
    mutationFn: checkout,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      queryClient.invalidateQueries({ queryKey: ['userProfile'] });
      useAppStore.getState().setPlan(planTypeToUserPlan(result.plan.plan_type));
      toast.show(t('subscription.checkoutSuccess'));
    },
    onError: (err: unknown) => {
      toast.show(getApiErrorMessage(err, t, t('subscription.checkoutError')));
    },
  });

  const handleCheckout = useCallback((planKey: string) => {
    Alert.alert(
      t('subscription.checkoutTitle'),
      t('subscription.checkoutConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          onPress: () => checkoutMutation.mutate(planKey),
        },
      ],
    );
  }, [t, checkoutMutation]);

  const formatDate = useCallback((dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(i18n.language === 'ko' ? 'ko-KR' : 'en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }, [i18n.language]);

  const activePlanType = data?.plan?.plan_type ?? 'free';

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView style={styles.container}>
        <ErrorView onRetry={refetch} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.currentPlanCard}>
          <Text style={styles.currentPlanLabel} accessibilityRole="header">
            {t('subscription.currentPlan')}
          </Text>
          <Text style={styles.currentPlanName}>
            {data?.plan ? data.plan.name : t('subscription.planFreeName')}
          </Text>
          {data?.subscription && (
            <View style={styles.expiryRow}>
              <Text style={styles.expiryLabel}>{t('subscription.expiresAt')}</Text>
              <Text style={styles.expiryDate}>{formatDate(data.subscription.expires_at)}</Text>
            </View>
          )}
          <View style={[
            styles.statusBadge,
            data?.subscription ? styles.statusBadgeActive : styles.statusBadgeFree,
          ]}>
            <Text style={[
              styles.statusText,
              data?.subscription ? styles.statusTextActive : styles.statusTextFree,
            ]}>
              {data?.subscription ? t('subscription.statusActive') : t('subscription.statusFree')}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle} accessibilityRole="header">
          {t('subscription.availablePlans')}
        </Text>

        {PLANS.map((planOption) => {
          const isCurrent = planOption.key === activePlanType ||
            (planOption.key === 'free' && activePlanType === 'free' && !data?.subscription);
          const isUpgrade = planOption.key !== 'free' && planOption.key !== activePlanType;

          return (
            <View
              key={planOption.key}
              style={[styles.planCard, isCurrent && styles.planCardActive]}
              accessibilityLabel={`${t(planOption.nameKey)} ${t(planOption.priceKey)}`}
            >
              <View style={styles.planHeader}>
                <Text style={styles.planName}>{t(planOption.nameKey)}</Text>
                {isCurrent ? (
                  <View style={styles.currentBadge}>
                    <Text style={styles.currentBadgeText}>{t('subscription.current')}</Text>
                  </View>
                ) : (
                  <Text style={styles.planPrice}>{t(planOption.priceKey)}</Text>
                )}
              </View>
              <Text style={styles.planDescription}>{t(planOption.descKey)}</Text>
              <View style={styles.featureList}>
                {planOption.features.map((featureKey) => (
                  <View key={featureKey} style={styles.featureRow}>
                    <Text style={styles.featureCheck}>✓</Text>
                    <Text style={styles.featureText}>{t(featureKey)}</Text>
                  </View>
                ))}
              </View>
              {isUpgrade && (
                <TouchableOpacity
                  style={[
                    styles.checkoutButton,
                    checkoutMutation.isPending && styles.checkoutButtonDisabled,
                  ]}
                  onPress={() => handleCheckout(planOption.key)}
                  disabled={checkoutMutation.isPending}
                  accessibilityRole="button"
                  accessibilityLabel={t('subscription.upgrade', { plan: t(planOption.nameKey) })}
                >
                  {checkoutMutation.isPending ? (
                    <ActivityIndicator color={colors.surface} size="small" />
                  ) : (
                    <Text style={styles.checkoutButtonText}>
                      {t('subscription.upgrade', { plan: t(planOption.nameKey) })}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          );
        })}

        <TouchableOpacity
          style={styles.codeLink}
          onPress={() => router.push('/code-register')}
          accessibilityRole="button"
          accessibilityLabel={t('subscription.haveCode')}
        >
          <Text style={styles.codeLinkText}>{t('subscription.haveCode')}</Text>
        </TouchableOpacity>
      </ScrollView>
      <Toast message={toast.message} opacity={toast.opacity} />
    </SafeAreaView>
  );
}
