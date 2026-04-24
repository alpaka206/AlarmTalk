import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Audio } from 'expo-av';
import { useTranslation } from 'react-i18next';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../../src/constants/theme';
import { useTheme, type ThemeColors } from '../../src/hooks/useTheme';
import { PRESET_CATEGORIES, getCategoryLabel } from '../../src/constants/presets';
import { getVoiceProfiles, generateTTS, getFriendList, sendGift } from '../../src/services/api';
import { saveAudioLocally, playAudio } from '../../src/services/audio';
import { useAppStore } from '../../src/stores/useAppStore';
import type { VoiceProfile, Friend } from '../../src/types';
import { getApiErrorMessage } from '../../src/types';
import { useToast } from '../../src/hooks/useToast';
import { Toast } from '../../src/components/Toast';

export default function CreateMessageScreen() {
  const router = useRouter();
  const { voice_id } = useLocalSearchParams<{ voice_id?: string }>();
  const queryClient = useQueryClient();
  const { isAuthenticated, incrementTtsCount } = useAppStore();
  const { t } = useTranslation();

  const [tab, setTab] = useState<'preset' | 'custom'>('preset');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [customText, setCustomText] = useState('');
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(voice_id ?? null);
  const [generatedAudioId, setGeneratedAudioId] = useState<string | null>(null);
  const [currentSound, setCurrentSound] = useState<Audio.Sound | null>(null);
  const [giftModalVisible, setGiftModalVisible] = useState(false);
  const [giftFriends, setGiftFriends] = useState<Friend[]>([]);
  const [giftNote, setGiftNote] = useState('');
  const [giftSending, setGiftSending] = useState(false);
  const toast = useToast();
  const { colors } = useTheme();
  const styles = createStyles(colors);

  const { data: voiceProfiles } = useQuery({
    queryKey: ['voiceProfiles'],
    queryFn: getVoiceProfiles,
    enabled: isAuthenticated,
  });

  const readyProfiles = voiceProfiles?.filter((p: VoiceProfile) => p.status === 'ready') ?? [];

  const ttsMutation = useMutation({
    mutationFn: generateTTS,
    onSuccess: async (data) => {
      // base64 오디오를 로컬에 저장
      const localPath = await saveAudioLocally(
        data.audio_base64,
        data.message_id,
        data.audio_format,
      );
      setGeneratedAudioId(data.message_id);
      incrementTtsCount();

      // 자동 재생
      const sound = await playAudio(localPath);
      setCurrentSound(sound);
      sound.setOnPlaybackStatusUpdate((status) => {
        if ('didJustFinish' in status && status.didJustFinish) {
          setCurrentSound(null);
        }
      });

      queryClient.invalidateQueries({ queryKey: ['messages'] });
      queryClient.invalidateQueries({ queryKey: ['library'] });
    },
    onError: (err: unknown) => {
      Alert.alert(
        t('messageCreate.generateErrorTitle'),
        getApiErrorMessage(err, t('messageCreate.generateError')),
      );
    },
  });

  const messageText = tab === 'preset' ? selectedPreset : customText;

  const handleGenerate = () => {
    if (!selectedVoiceId) {
      Alert.alert(t('messageCreate.selectVoiceTitle'), t('messageCreate.selectVoice'));
      return;
    }
    if (!messageText?.trim()) {
      Alert.alert(t('messageCreate.enterMessageTitle'), t('messageCreate.enterMessage'));
      return;
    }

    ttsMutation.mutate({
      voice_profile_id: selectedVoiceId,
      text: messageText.trim(),
      category: selectedCategory ?? 'custom',
    });
  };

  const handlePreview = async () => {
    if (!generatedAudioId) return;

    if (currentSound) {
      await currentSound.unloadAsync();
      setCurrentSound(null);
      return;
    }

    const { saveAudioLocally: _, getLocalAudioPath } = await import('../../src/services/audio');
    const path = getLocalAudioPath(generatedAudioId);
    const sound = await playAudio(path);
    setCurrentSound(sound);
    sound.setOnPlaybackStatusUpdate((status) => {
      if ('didJustFinish' in status && status.didJustFinish) {
        setCurrentSound(null);
      }
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* 음성 프로필 선택 */}
      <Text style={styles.sectionTitle} accessibilityRole="header">{t('messageCreate.whoseVoice')}</Text>
      {readyProfiles.length === 0 ? (
        <TouchableOpacity style={styles.emptyVoice} onPress={() => router.push('/voice/record')} accessibilityRole="button" accessibilityLabel={t('messageCreate.emptyVoice')}>
          <Text style={styles.emptyVoiceText}>{t('messageCreate.emptyVoice')}</Text>
        </TouchableOpacity>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.voiceRow}>
          {readyProfiles.map((profile: VoiceProfile) => (
            <TouchableOpacity
              key={profile.id}
              style={[styles.voiceChip, selectedVoiceId === profile.id && styles.voiceChipSelected]}
              onPress={() => setSelectedVoiceId(profile.id)}
              accessibilityLabel={t('messageCreate.a11yVoiceProfile', { name: profile.name })}
              accessibilityRole="radio"
              accessibilityState={{ selected: selectedVoiceId === profile.id }}
            >
              <Text style={styles.voiceChipAvatar}>{profile.name.charAt(0)}</Text>
              <Text
                style={[
                  styles.voiceChipName,
                  selectedVoiceId === profile.id && styles.voiceChipNameSelected,
                ]}
              >
                {profile.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* 탭 선택 */}
      <View style={styles.tabRow} accessibilityRole="tablist">
        <TouchableOpacity
          style={[styles.tab, tab === 'preset' && styles.tabActive]}
          onPress={() => setTab('preset')}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'preset' }}
          accessibilityLabel={t('messageCreate.presetTab')}
        >
          <Text style={[styles.tabText, tab === 'preset' && styles.tabTextActive]}>
            {t('messageCreate.presetTab')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'custom' && styles.tabActive]}
          onPress={() => setTab('custom')}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'custom' }}
          accessibilityLabel={t('messageCreate.customTab')}
        >
          <Text style={[styles.tabText, tab === 'custom' && styles.tabTextActive]}>
            {t('messageCreate.customTab')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 프리셋 */}
      {tab === 'preset' && (
        <>
          {/* 카테고리 선택 */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryRow}>
            {PRESET_CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.key}
                style={[
                  styles.categoryChip,
                  selectedCategory === cat.key && styles.categoryChipActive,
                ]}
                onPress={() => {
                  setSelectedCategory(cat.key);
                  setSelectedPreset(null);
                }}
                accessibilityLabel={t('messageCreate.a11yCategory', { label: getCategoryLabel(cat, t) })}
                accessibilityRole="radio"
                accessibilityState={{ selected: selectedCategory === cat.key }}
              >
                <Text style={styles.categoryEmoji}>{cat.emoji}</Text>
                <Text
                  style={[
                    styles.categoryLabel,
                    selectedCategory === cat.key && styles.categoryLabelActive,
                  ]}
                >
                  {getCategoryLabel(cat, t)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* 메시지 선택 */}
          {selectedCategory && (
            <View style={styles.presetList}>
              {PRESET_CATEGORIES.find((c) => c.key === selectedCategory)?.messages.map((msg, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.presetItem, selectedPreset === msg && styles.presetItemSelected]}
                  onPress={() => setSelectedPreset(msg)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: selectedPreset === msg }}
                  accessibilityLabel={msg}
                >
                  <Text
                    style={[styles.presetText, selectedPreset === msg && styles.presetTextSelected]}
                  >
                    {msg}
                  </Text>
                  {selectedPreset === msg && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </>
      )}

      {/* 커스텀 입력 */}
      {tab === 'custom' && (
        <View style={styles.customSection}>
          <TextInput
            style={styles.customInput}
            placeholder={t('messageCreate.customPlaceholder')}
            value={customText}
            onChangeText={(v) => v.length <= 200 && setCustomText(v)}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel={t('messageCreate.customPlaceholder')}
          />
          <Text style={styles.charCount}>{customText.length}/200</Text>
        </View>
      )}

      {/* 생성 버튼 */}
      <TouchableOpacity
        style={[
          styles.generateButton,
          (!messageText || !selectedVoiceId || ttsMutation.isPending) && styles.disabled,
        ]}
        onPress={handleGenerate}
        disabled={!messageText || !selectedVoiceId || ttsMutation.isPending}
        accessibilityLabel={ttsMutation.isPending ? t('messageCreate.generating') : t('messageCreate.generate')}
        accessibilityRole="button"
        accessibilityState={{ disabled: !messageText || !selectedVoiceId || ttsMutation.isPending, busy: ttsMutation.isPending }}
      >
        {ttsMutation.isPending ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#FFF" />
            <Text style={styles.generateText}>{t('messageCreate.generating')}</Text>
          </View>
        ) : (
          <Text style={styles.generateText}>{t('messageCreate.generate')}</Text>
        )}
      </TouchableOpacity>

      {/* 생성 결과 */}
      {generatedAudioId && (
        <View style={styles.resultCard}>
          <Text style={styles.resultTitle}>{t('messageCreate.resultTitle')}</Text>
          <Text style={styles.resultMessage}>"{messageText}"</Text>
          <View style={styles.resultActions}>
            <TouchableOpacity style={styles.previewButton} onPress={handlePreview} accessibilityRole="button" accessibilityLabel={currentSound ? t('messageCreate.stop') : t('messageCreate.preview')}>
              <Text style={styles.previewText}>
                {currentSound ? t('messageCreate.stop') : t('messageCreate.preview')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.useButton}
              onPress={() => router.push(`/alarm/create?message_id=${generatedAudioId}`)}
              accessibilityRole="button"
              accessibilityLabel={t('messageCreate.useForAlarm')}
            >
              <Text style={styles.useText}>{t('messageCreate.useForAlarm')}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.giftButton}
            accessibilityRole="button"
            accessibilityLabel={t('messageCreate.gift')}
            onPress={async () => {
              try {
                const friends = await getFriendList();
                if (!friends || friends.length === 0) {
                  Alert.alert(t('messageCreate.noFriendsTitle'), t('messageCreate.noFriends'));
                  return;
                }
                setGiftFriends(friends);
                setGiftNote('');
                setGiftModalVisible(true);
              } catch {
                Alert.alert(t('common.error'), t('messageCreate.friendListError'));
              }
            }}
          >
            <Text style={styles.giftText}>{t('messageCreate.gift')}</Text>
          </TouchableOpacity>
        </View>
      )}
      <Modal
        visible={giftModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setGiftModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('messageCreate.giftTitle')}</Text>
            <Text style={styles.modalSubtitle}>{t('messageCreate.giftWho')}</Text>
            <TextInput
              style={styles.giftNoteInput}
              placeholder={t('messageCreate.giftNotePlaceholder')}
              placeholderTextColor={colors.textTertiary}
              value={giftNote}
              onChangeText={(v) => v.length <= 200 && setGiftNote(v)}
              maxLength={200}
              accessibilityLabel={t('messageCreate.giftNotePlaceholder')}
            />
            <ScrollView style={styles.friendList}>
              {giftFriends.map((f) => (
                <TouchableOpacity
                  key={f.id}
                  style={styles.friendItem}
                  disabled={giftSending}
                  accessibilityLabel={t('messageCreate.a11ySendGiftTo', { name: f.friend_name || f.friend_email })}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: giftSending }}
                  onPress={async () => {
                    setGiftSending(true);
                    try {
                      await sendGift({
                        recipient_email: f.friend_email ?? '',
                        message_id: generatedAudioId!,
                        note: giftNote.trim() || undefined,
                      });
                      setGiftModalVisible(false);
                      toast.show(t('messageCreate.giftSent', { name: f.friend_name || f.friend_email }));
                    } catch (err: unknown) {
                      Alert.alert(
                        t('common.error'),
                        getApiErrorMessage(err, t('messageCreate.giftError')),
                      );
                    } finally {
                      setGiftSending(false);
                    }
                  }}
                >
                  <View style={styles.friendAvatar}>
                    <Text style={styles.friendAvatarText}>
                      {(f.friend_name || f.friend_email || '?')[0].toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.friendInfo}>
                    <Text style={styles.friendName}>{f.friend_name || t('common.noName')}</Text>
                    <Text style={styles.friendEmail}>{f.friend_email}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={styles.modalCancel}
              onPress={() => setGiftModalVisible(false)}
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
            >
              <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Toast message={toast.message} opacity={toast.opacity} />
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: Spacing.lg,
    paddingBottom: 120,
  },
  sectionTitle: {
    fontSize: FontSize.xl,
    fontFamily: FontFamily.bold,
    color: colors.text,
    marginBottom: Spacing.md,
  },
  emptyVoice: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  emptyVoiceText: {
    color: colors.primary,
    fontFamily: FontFamily.semibold,
  },
  voiceRow: {
    marginBottom: Spacing.lg,
  },
  voiceChip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginRight: Spacing.sm,
    borderWidth: 2,
    borderColor: 'transparent',
    minWidth: 80,
  },
  voiceChipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceVariant,
  },
  voiceChipAvatar: {
    fontSize: 24,
    fontFamily: FontFamily.bold,
    color: colors.primary,
    marginBottom: 4,
  },
  voiceChipName: {
    fontSize: FontSize.sm,
    color: colors.text,
    fontFamily: FontFamily.semibold,
  },
  voiceChipNameSelected: {
    color: colors.primary,
  },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.md,
    padding: 4,
    marginBottom: Spacing.lg,
  },
  tab: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  tabText: {
    fontSize: FontSize.md,
    color: colors.textSecondary,
    fontFamily: FontFamily.semibold,
  },
  tabTextActive: {
    color: '#FFF',
  },
  categoryRow: {
    marginBottom: Spacing.md,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginRight: Spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  categoryEmoji: {
    fontSize: 16,
    marginRight: 4,
  },
  categoryLabel: {
    fontSize: FontSize.sm,
    color: colors.text,
    fontFamily: FontFamily.semibold,
  },
  categoryLabelActive: {
    color: '#FFF',
  },
  presetList: {
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  presetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  presetItemSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceVariant,
  },
  presetText: {
    flex: 1,
    fontSize: FontSize.md,
    color: colors.text,
  },
  presetTextSelected: {
    color: colors.primary,
    fontFamily: FontFamily.semibold,
  },
  checkmark: {
    fontSize: FontSize.lg,
    color: colors.primary,
    fontFamily: FontFamily.bold,
  },
  customSection: {
    marginBottom: Spacing.lg,
  },
  customInput: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: FontSize.md,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 120,
  },
  charCount: {
    textAlign: 'right',
    fontSize: FontSize.xs,
    color: colors.textTertiary,
    marginTop: Spacing.xs,
  },
  generateButton: {
    backgroundColor: colors.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  disabled: {
    opacity: 0.5,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  generateText: {
    color: '#FFF',
    fontSize: FontSize.lg,
    fontFamily: FontFamily.bold,
  },
  resultCard: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: colors.success + '40',
  },
  resultTitle: {
    fontSize: FontSize.lg,
    fontFamily: FontFamily.bold,
    color: colors.success,
    marginBottom: Spacing.sm,
  },
  resultMessage: {
    fontSize: FontSize.md,
    color: colors.text,
    marginBottom: Spacing.md,
  },
  resultActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  previewButton: {
    flex: 1,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    padding: Spacing.sm,
    alignItems: 'center',
  },
  previewText: {
    color: colors.primary,
    fontFamily: FontFamily.semibold,
  },
  useButton: {
    flex: 1,
    borderRadius: BorderRadius.md,
    backgroundColor: colors.primary,
    padding: Spacing.sm,
    alignItems: 'center',
  },
  useText: {
    color: '#FFF',
    fontFamily: FontFamily.semibold,
  },
  giftButton: {
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: colors.accent,
    padding: Spacing.sm + 2,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  giftText: {
    color: colors.accent,
    fontFamily: FontFamily.semibold,
    fontSize: FontSize.md,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.background,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    padding: Spacing.lg,
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: FontSize.xl,
    fontFamily: FontFamily.bold,
    color: colors.text,
    marginBottom: Spacing.xs,
  },
  modalSubtitle: {
    fontSize: FontSize.md,
    color: colors.textSecondary,
    marginBottom: Spacing.md,
  },
  giftNoteInput: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: Spacing.md,
  },
  friendList: {
    maxHeight: 300,
  },
  friendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: colors.surface,
    marginBottom: Spacing.sm,
  },
  friendAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  friendAvatarText: {
    fontSize: FontSize.lg,
    fontFamily: FontFamily.bold,
    color: colors.primaryDark,
  },
  friendInfo: {
    marginLeft: Spacing.md,
    flex: 1,
  },
  friendName: {
    fontSize: FontSize.md,
    fontFamily: FontFamily.semibold,
    color: colors.text,
  },
  friendEmail: {
    fontSize: FontSize.sm,
    color: colors.textTertiary,
  },
  modalCancel: {
    alignItems: 'center',
    paddingVertical: Spacing.md,
    marginTop: Spacing.sm,
  },
  modalCancelText: {
    fontSize: FontSize.md,
    color: colors.textSecondary,
    fontFamily: FontFamily.semibold,
  },
});
