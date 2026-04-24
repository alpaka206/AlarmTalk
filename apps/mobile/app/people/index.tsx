import { useState, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  Alert,
  RefreshControl,
  Share,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getFriendList,
  getPendingRequests,
  sendFriendRequest,
  acceptFriendRequest,
  deleteFriend,
  getFamilyGroupCurrent,
  createFamilyInvite,
  getFamilyInvites,
  revokeFamilyInvite,
} from '../../src/services/api';
import type { FamilyInvite } from '../../src/services/api';
import type { Friend, PendingFriendRequest } from '../../src/types';
import { getApiErrorMessage } from '../../src/types';
import { useTheme } from '../../src/hooks/useTheme';
import { createPeopleStyles } from '../../src/styles/peopleStyles';
import { useAppStore } from '../../src/stores/useAppStore';
import { useNetworkStatus } from '../../src/hooks/useNetworkStatus';
import { useToast } from '../../src/hooks/useToast';
import { Toast } from '../../src/components/Toast';
import { FamilyMemberRow } from '../../src/components/FamilyMemberRow';
import { CoupleView } from '../../src/components/CoupleView';
import { PeopleSkeletonCard } from '../../src/components/PeopleSkeletonCard';
import { formatLastSeen } from '../../src/lib/formatLastSeen';

type Segment = 'members' | 'friends' | 'requests';

export default function PeopleScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createPeopleStyles(colors), [colors]);
  const toast = useToast();
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const plan = useAppStore((s) => s.plan);
  const isConnected = useNetworkStatus();
  const isFamilyPlan = plan === 'family';
  const [activeSegment, setActiveSegment] = useState<Segment>(isFamilyPlan ? 'members' : 'friends');
  const [email, setEmail] = useState('');

  const {
    data: friends,
    isLoading: friendsLoading,
    refetch: refetchFriends,
    isRefetching: friendsRefetching,
  } = useQuery({
    queryKey: ['friends'],
    queryFn: getFriendList,
    enabled: isAuthenticated && isConnected,
  });

  const {
    data: pending,
    isLoading: pendingLoading,
    refetch: refetchPending,
  } = useQuery({
    queryKey: ['pending-requests'],
    queryFn: getPendingRequests,
    enabled: isAuthenticated && isConnected,
  });

  const {
    data: familyData,
    isLoading: familyLoading,
    refetch: refetchFamily,
    isRefetching: familyRefetching,
  } = useQuery({
    queryKey: ['family-group'],
    queryFn: getFamilyGroupCurrent,
    enabled: isAuthenticated && isConnected && isFamilyPlan,
  });

  const { data: invites } = useQuery({
    queryKey: ['family-invites'],
    queryFn: getFamilyInvites,
    enabled: isAuthenticated && isConnected && isFamilyPlan && familyData?.role === 'owner',
  });

  const sendMutation = useMutation({
    mutationFn: sendFriendRequest,
    onSuccess: () => {
      setEmail('');
      toast.show(t('friends.sendSuccess'));
      queryClient.invalidateQueries({ queryKey: ['friends'] });
      queryClient.invalidateQueries({ queryKey: ['pending-requests'] });
    },
    onError: (err: unknown) => {
      toast.show(getApiErrorMessage(err, t('friends.sendError')));
    },
  });

  const acceptMutation = useMutation({
    mutationFn: acceptFriendRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends'] });
      queryClient.invalidateQueries({ queryKey: ['pending-requests'] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: deleteFriend,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends'] });
    },
  });

  const createInviteMutation = useMutation({
    mutationFn: createFamilyInvite,
    onSuccess: async (invite) => {
      queryClient.invalidateQueries({ queryKey: ['family-invites'] });
      await Clipboard.setStringAsync(invite.code);
      toast.show(t('people.codeCopied'));
    },
    onError: (err: unknown) => {
      toast.show(getApiErrorMessage(err, t('common.error')));
    },
  });

  const revokeMutation = useMutation({
    mutationFn: revokeFamilyInvite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['family-invites'] });
    },
  });

  const handleSend = () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    sendMutation.mutate(trimmed);
  };

  const handleRemove = (friend: Friend) => {
    Alert.alert(
      t('friends.deleteTitle'),
      t('friends.deleteConfirm', { name: friend.friend_name || friend.friend_email }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => removeMutation.mutate(friend.id) },
      ],
    );
  };

  const handleShareInvite = async (invite: FamilyInvite) => {
    try {
      await Share.share({
        message: t('people.shareMessage', { code: invite.code }),
      });
    } catch {
      await Clipboard.setStringAsync(invite.code);
      toast.show(t('people.codeCopied'));
    }
  };

  const pendingInvites = (invites ?? []).filter((i) => i.status === 'pending');
  const isOwner = familyData?.role === 'owner';

  const onRefresh = async () => {
    const tasks: Promise<unknown>[] = [refetchFriends(), refetchPending()];
    if (isFamilyPlan) {
      tasks.push(refetchFamily());
      if (isOwner) tasks.push(queryClient.invalidateQueries({ queryKey: ['family-invites'] }));
    }
    await Promise.all(tasks);
  };

  const segments = useMemo<{ key: Segment; label: string; badge?: number }[]>(() => {
    const items: { key: Segment; label: string; badge?: number }[] = [];
    if (isFamilyPlan) {
      items.push({ key: 'members', label: t('people.members') });
    }
    items.push({ key: 'friends', label: t('people.friends') });
    items.push({
      key: 'requests',
      label: t('people.requests'),
      badge: pending?.length,
    });
    return items;
  }, [isFamilyPlan, pending?.length, t]);

  const members = familyData?.members ?? [];
  const isCouple = isFamilyPlan && members.length === 2;

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>👤</Text>
          <Text style={styles.emptyText}>{t('friends.loginRequired')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const renderFriend = ({ item }: { item: Friend }) => (
    <TouchableOpacity
      style={styles.personCard}
      onPress={() => router.push(`/friend/${item.id}`)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={item.friend_name || item.friend_email}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {(item.friend_name || item.friend_email || '?').charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={styles.personInfo}>
        <Text style={styles.personName}>{item.friend_name || t('common.noName')}</Text>
        <Text style={styles.personEmail}>{item.friend_email}</Text>
        <Text style={styles.lastSeen}>{formatLastSeen(item.friend_last_active_at, t)}</Text>
      </View>
      <TouchableOpacity
        onPress={() => handleRemove(item)}
        hitSlop={8}
        style={styles.removeBtn}
        accessibilityLabel={t('common.delete')}
      >
        <Text style={styles.removeBtnText}>✕</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const renderRequest = ({ item }: { item: PendingFriendRequest }) => (
    <View style={styles.personCard}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {(item.requester_name || item.requester_email || '?').charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={styles.personInfo}>
        <Text style={styles.personName}>{item.requester_name || t('common.noName')}</Text>
        <Text style={styles.personEmail}>{item.requester_email}</Text>
      </View>
      <TouchableOpacity
        style={styles.acceptBtn}
        onPress={() => acceptMutation.mutate(item.id)}
        accessibilityLabel={t('common.accept')}
      >
        <Text style={styles.acceptBtnText}>{t('common.accept')}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderMember = ({ item }: { item: import('../../src/services/api').FamilyGroupMember }) => (
    <FamilyMemberRow member={item} isCouple={isCouple} />
  );

  const renderInviteSection = () => {
    if (!isOwner) return null;
    return (
      <View style={styles.inviteSection}>
        <Text style={styles.inviteSectionTitle}>{t('people.inviteCode')}</Text>
        <TouchableOpacity
          style={[styles.inviteGenerateBtn, createInviteMutation.isPending && styles.addBtnDisabled]}
          onPress={() => createInviteMutation.mutate()}
          disabled={createInviteMutation.isPending}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('people.generateInvite')}
        >
          <Text style={styles.familyAlarmBtnText}>
            {createInviteMutation.isPending ? t('people.generating') : t('people.generateInvite')}
          </Text>
        </TouchableOpacity>

        {pendingInvites.length > 0 && (
          <View style={styles.inviteList}>
            <Text style={styles.inviteListTitle}>{t('people.pendingInvites')}</Text>
            {pendingInvites.map((inv) => (
              <View key={inv.id} style={styles.inviteCard}>
                <Text style={styles.inviteCode}>{inv.code}</Text>
                <Text style={styles.inviteExpiry}>
                  {t('people.expiresAt', { time: new Date(inv.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}
                </Text>
                <View style={styles.inviteActions}>
                  <TouchableOpacity
                    style={styles.inviteShareBtn}
                    onPress={() => handleShareInvite(inv)}
                    accessibilityLabel={t('people.shareInvite')}
                  >
                    <Text style={styles.inviteShareBtnText}>{t('people.shareInvite')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.inviteRevokeBtn}
                    onPress={() => revokeMutation.mutate(inv.code)}
                    accessibilityLabel={t('people.revokeInvite')}
                  >
                    <Text style={styles.inviteRevokeBtnText}>{t('people.revokeInvite')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderMembersContent = () => {
    if (familyLoading) {
      return <PeopleSkeletonCard count={3} />;
    }
    if (!familyData?.group) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>👨‍👩‍👧</Text>
          <Text style={styles.emptyText}>{t('people.noGroup')}</Text>
          <Text style={styles.emptyHint}>{t('people.noGroupHint')}</Text>
        </View>
      );
    }

    if (isCouple) {
      return (
        <View style={styles.coupleContainer}>
          <CoupleView
            members={members}
            onSendAlarm={() => router.push('/family-alarm/create')}
          />
          {renderInviteSection()}
        </View>
      );
    }

    const sortedMembers = [...members].sort((a, b) =>
      a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0,
    );

    return (
      <FlatList
        data={sortedMembers}
        keyExtractor={(item) => item.id}
        renderItem={renderMember}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        initialNumToRender={10}
        maxToRenderPerBatch={5}
        windowSize={5}
        removeClippedSubviews
        refreshControl={
          <RefreshControl refreshing={familyRefetching} onRefresh={onRefresh} />
        }
        ListFooterComponent={
          <View>
            <TouchableOpacity
              style={styles.familyAlarmBtn}
              onPress={() => router.push('/family-alarm/create')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('people.sendFamilyAlarm')}
            >
              <Text style={styles.familyAlarmBtnText}>⏰ {t('people.sendFamilyAlarm')}</Text>
            </TouchableOpacity>
            {renderInviteSection()}
          </View>
        }
      />
    );
  };

  const renderFriendsContent = () => {
    if (friendsLoading) {
      return <PeopleSkeletonCard count={4} />;
    }
    if (!friends?.length) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>👤</Text>
          <Text style={styles.emptyText}>{t('friends.emptyFriends')}</Text>
          <Text style={styles.emptyHint}>{t('friends.emptyFriendsHint')}</Text>
        </View>
      );
    }
    return (
      <FlatList
        data={friends}
        keyExtractor={(item) => item.id}
        renderItem={renderFriend}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        initialNumToRender={10}
        maxToRenderPerBatch={5}
        windowSize={5}
        removeClippedSubviews
        refreshControl={
          <RefreshControl refreshing={friendsRefetching} onRefresh={onRefresh} />
        }
      />
    );
  };

  const renderRequestsContent = () => {
    if (pendingLoading) {
      return <PeopleSkeletonCard count={2} />;
    }
    if (!pending?.length) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>📬</Text>
          <Text style={styles.emptyText}>{t('friends.emptyPending')}</Text>
        </View>
      );
    }
    return (
      <FlatList
        data={pending}
        keyExtractor={(item) => item.id}
        renderItem={renderRequest}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        initialNumToRender={10}
        maxToRenderPerBatch={5}
        windowSize={5}
        removeClippedSubviews
      />
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('people.title')}</Text>
      </View>

      {activeSegment === 'friends' && (
        <View style={styles.addRow}>
          <TextInput
            style={styles.addInput}
            placeholder={t('friends.addPlaceholder')}
            placeholderTextColor={colors.textTertiary}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />
          <TouchableOpacity
            style={[styles.addBtn, !email.trim() && styles.addBtnDisabled]}
            onPress={handleSend}
            disabled={!email.trim() || sendMutation.isPending}
            accessibilityRole="button"
            accessibilityLabel={t('common.add')}
          >
            <Text style={styles.addBtnText}>{t('common.add')}</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.segmentRow}>
        {segments.map((seg) => (
          <TouchableOpacity
            key={seg.key}
            style={[styles.segment, activeSegment === seg.key && styles.segmentActive]}
            onPress={() => setActiveSegment(seg.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeSegment === seg.key }}
            accessibilityLabel={seg.label}
          >
            <Text style={[styles.segmentText, activeSegment === seg.key && styles.segmentTextActive]} numberOfLines={1}>
              {seg.label}
              {seg.badge != null && seg.badge > 0 ? ` (${seg.badge})` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeSegment === 'members' && renderMembersContent()}
      {activeSegment === 'friends' && renderFriendsContent()}
      {activeSegment === 'requests' && renderRequestsContent()}

      <Toast message={toast.message} opacity={toast.opacity} />
    </SafeAreaView>
  );
}

