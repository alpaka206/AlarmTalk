import { useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  FlatList,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../src/constants/theme';
import { useTheme, type ThemeColors } from '../src/hooks/useTheme';
import { useAppStore } from '../src/stores/useAppStore';
import { getCharacterMe } from '../src/services/api';

const { width } = Dimensions.get('window');

export default function OnboardingScreen() {
  const router = useRouter();
  const completeOnboarding = useAppStore((s) => s.completeOnboarding);
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const styles = createStyles(colors);

  const ONBOARDING_PAGES = useMemo(() => [
    { emoji: '🎙️', titleKey: 'onboarding.page1Title', descKey: 'onboarding.page1Desc', bgColor: colors.background },
    { emoji: '💌', titleKey: 'onboarding.page2Title', descKey: 'onboarding.page2Desc', bgColor: colors.surfaceVariant },
    { emoji: '⏰', titleKey: 'onboarding.page3Title', descKey: 'onboarding.page3Desc', bgColor: colors.surfaceVariant },
    { emoji: '🌱', titleKey: 'onboarding.page4Title', descKey: 'onboarding.page4Desc', bgColor: colors.background },
  ], [colors]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useMemo(() => new Animated.Value(0), []);

  const finishOnboarding = useCallback(async () => {
    completeOnboarding();
    queryClient.prefetchQuery({ queryKey: ['character'], queryFn: getCharacterMe });
    router.replace('/(tabs)');
  }, [completeOnboarding, queryClient, router]);

  const handleNext = () => {
    if (currentIndex < ONBOARDING_PAGES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1 });
      setCurrentIndex(currentIndex + 1);
    } else {
      finishOnboarding();
    }
  };

  const renderPage = ({ item }: { item: (typeof ONBOARDING_PAGES)[0] }) => (
    <View style={[styles.page, { width, backgroundColor: item.bgColor }]}>
      <Text style={styles.emoji}>{item.emoji}</Text>
      <Text style={styles.title} accessibilityRole="header">{t(item.titleKey)}</Text>
      <Text style={styles.description}>{t(item.descKey)}</Text>
    </View>
  );

  const isLastPage = currentIndex === ONBOARDING_PAGES.length - 1;

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity
        style={styles.skipButton}
        onPress={finishOnboarding}
        accessibilityRole="button"
        accessibilityLabel={t('onboarding.skip')}
      >
        <Text style={styles.skipText}>{t('onboarding.skip')}</Text>
      </TouchableOpacity>

      <FlatList
        ref={flatListRef}
        data={ONBOARDING_PAGES}
        renderItem={renderPage}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
          useNativeDriver: false,
        })}
        onMomentumScrollEnd={(e) => {
          const index = Math.round(e.nativeEvent.contentOffset.x / width);
          setCurrentIndex(index);
        }}
        keyExtractor={(_, i) => i.toString()}
      />

      <View style={styles.indicatorRow}>
        {ONBOARDING_PAGES.map((_, i) => {
          const inputRange = [(i - 1) * width, i * width, (i + 1) * width];
          const dotWidth = scrollX.interpolate({
            inputRange,
            outputRange: [8, 24, 8],
            extrapolate: 'clamp',
          });
          const opacity = scrollX.interpolate({
            inputRange,
            outputRange: [0.3, 1, 0.3],
            extrapolate: 'clamp',
          });
          return <Animated.View key={i} style={[styles.dot, { width: dotWidth, opacity }]} />;
        })}
      </View>

      <TouchableOpacity
        style={styles.nextButton}
        onPress={handleNext}
        accessibilityRole="button"
        accessibilityLabel={isLastPage ? t('onboarding.start') : t('onboarding.next')}
      >
        <Text style={styles.nextText}>
          {isLastPage ? t('onboarding.start') : t('onboarding.next')}
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  skipButton: {
    position: 'absolute',
    top: Spacing.md,
    right: Spacing.lg,
    zIndex: 10,
    padding: Spacing.sm,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  skipText: {
    fontSize: FontSize.md,
    fontFamily: FontFamily.medium,
    color: colors.textSecondary,
  },
  page: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
  },
  emoji: {
    fontSize: 80,
    marginBottom: Spacing.xl,
  },
  title: {
    fontSize: FontSize.hero,
    fontFamily: FontFamily.bold,
    color: colors.text,
    textAlign: 'center',
    lineHeight: 42,
    marginBottom: Spacing.lg,
  },
  description: {
    fontSize: FontSize.lg,
    fontFamily: FontFamily.regular,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 26,
  },
  indicatorRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    gap: Spacing.sm,
  },
  dot: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  nextButton: {
    backgroundColor: colors.primary,
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  nextText: {
    fontSize: FontSize.lg,
    fontFamily: FontFamily.bold,
    color: colors.surface,
  },
});
