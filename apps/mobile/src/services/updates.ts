import { Alert, Platform } from 'react-native';
import * as Updates from 'expo-updates';
import type { TFunction } from 'i18next';

export async function checkForOTAUpdate(t: TFunction): Promise<void> {
  if (__DEV__ || Platform.OS === 'web') return;

  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) return;

    const fetched = await Updates.fetchUpdateAsync();
    if (!fetched.isNew) return;

    Alert.alert(t('update.title'), t('update.message'), [
      { text: t('update.later'), style: 'cancel' },
      {
        text: t('update.now'),
        onPress: () => Updates.reloadAsync(),
      },
    ]);
  } catch {
    // silent — update check failure should never block the app
  }
}
