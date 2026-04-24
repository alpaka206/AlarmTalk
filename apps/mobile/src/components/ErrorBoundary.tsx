import { Component, useMemo, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import { useTheme, type ThemeColors } from '../hooks/useTheme';
import { Sentry } from '../lib/sentry';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string | null;
}

function ErrorFallback({ errorMessage, onRetry }: { errorMessage: string | null; onRetry: () => void }) {
  const { colors } = useTheme();
  const dynStyles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={dynStyles.container} accessibilityRole="alert">
      <Text style={dynStyles.emoji}>😵</Text>
      <Text style={dynStyles.title}>문제가 발생했습니다</Text>
      <Text style={dynStyles.subtitle}>앱을 다시 시도해 주세요</Text>
      {errorMessage && (
        <Text style={dynStyles.detail} numberOfLines={3}>
          {errorMessage}
        </Text>
      )}
      <Pressable
        onPress={onRetry}
        style={dynStyles.retryButton}
        accessibilityRole="button"
        accessibilityLabel="다시 시도"
      >
        <Text style={dynStyles.retryText}>다시 시도</Text>
      </Pressable>
    </View>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorMessage: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorMessage: null });
  };

  render() {
    if (this.state.hasError) {
      return <ErrorFallback errorMessage={this.state.errorMessage} onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: Spacing.xl,
      backgroundColor: colors.background,
    },
    emoji: {
      fontSize: 48,
      marginBottom: Spacing.md,
    },
    title: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
      color: colors.text,
      marginBottom: Spacing.sm,
    },
    subtitle: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginBottom: Spacing.md,
      textAlign: 'center',
    },
    detail: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      marginBottom: Spacing.lg,
      textAlign: 'center',
      maxWidth: 280,
    },
    retryButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.md,
      minHeight: 44,
      justifyContent: 'center',
    },
    retryText: {
      color: '#FFFFFF',
      fontSize: FontSize.sm,
      fontFamily: FontFamily.semibold,
    },
  });
}
