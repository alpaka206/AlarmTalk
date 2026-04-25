import { get, post, del } from './core';

// ===== Family Group API =====

export interface FamilyGroupMember {
  id: string;
  user_id: string;
  role: 'owner' | 'member';
  joined_at: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  allow_family_alarms: boolean;
}

export interface FamilyGroupCurrent {
  group: {
    id: string;
    owner_user_id: string;
    plan_id: string;
    max_members: number;
    created_at: string;
  } | null;
  role: 'owner' | 'member' | null;
  members: FamilyGroupMember[];
}

export async function getFamilyGroupCurrent() {
  return get<FamilyGroupCurrent>('/family/groups/current');
}

// ===== Family Alarm API =====

export interface FamilyAlarmCreatePayload {
  recipient_user_id: string;
  wake_at: string;
  message_text: string;
  repeat_days?: number[];
  voice_profile_id?: string;
}

export interface FamilyAlarmCreateResponse {
  alarm: {
    id: string;
    sender_user_id: string;
    recipient_user_id: string;
    wake_at: string;
    repeat_days: number[];
    mode: 'tts';
    voice_profile_id: string;
  };
  message: { id: string; text: string; category: string };
}

export async function createFamilyAlarmText(payload: FamilyAlarmCreatePayload) {
  return post<FamilyAlarmCreateResponse>('/family/alarms', payload);
}

// ===== Family Invites API =====

export interface FamilyInvite {
  id: string;
  plan_group_id: string;
  code: string;
  status: 'pending' | 'used' | 'expired' | 'revoked';
  created_at: string;
  expires_at: string;
  deep_link: string;
  web_url: string;
}

export async function createFamilyInvite() {
  const data = await post<{ invite: FamilyInvite }>('/family/invites', {});
  return data.invite;
}

export async function getFamilyInvites() {
  const data = await get<{ invites: FamilyInvite[] }>('/family/invites');
  return data.invites;
}

export async function revokeFamilyInvite(code: string) {
  return post<{ success: boolean }>(`/family/invites/${code}/revoke`, {});
}

// ===== Family Group Management API =====

export async function leaveFamilyGroup(groupId: string) {
  return post<{ success: boolean; left_group_id: string }>(
    `/family/groups/${groupId}/leave`,
    {},
  );
}

export async function transferFamilyOwnership(groupId: string, targetUserId: string) {
  return post<{
    success: boolean;
    group: { id: string; owner_user_id: string; previous_owner_user_id: string };
  }>(`/family/groups/${groupId}/transfer-ownership`, { target_user_id: targetUserId });
}

export async function removeFamilyMember(groupId: string, userId: string) {
  return del<{ success: boolean; removed_user_id: string }>(
    `/family/groups/${groupId}/members/${userId}`,
  );
}
