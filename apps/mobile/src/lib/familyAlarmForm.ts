import type { TFunction } from 'i18next';
import type { FamilyGroupMember, FamilyAlarmCreatePayload } from '../services/api';

export interface FamilyAlarmFormInput {
  recipientUserId: string | null;
  wakeAt: string;
  messageText: string;
  repeatDays: number[];
  voiceProfileId?: string | null;
}

export type ValidationResult =
  | { ok: true; payload: FamilyAlarmCreatePayload }
  | { ok: false; error: string };

export function filterFamilyAlarmRecipients(
  members: FamilyGroupMember[],
  selfUserId: string,
): FamilyGroupMember[] {
  return members
    .filter((m) => m.user_id !== selfUserId && m.allow_family_alarms)
    .slice()
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === 'owner' ? -1 : 1;
      return a.joined_at.localeCompare(b.joined_at);
    });
}

export function validateFamilyAlarmForm(input: FamilyAlarmFormInput, t: TFunction): ValidationResult {
  if (!input.recipientUserId) {
    return { ok: false, error: t('familyAlarmForm.recipientRequired') };
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.wakeAt)) {
    return { ok: false, error: t('familyAlarmForm.invalidTimeFormat') };
  }
  const text = input.messageText.trim();
  if (text.length === 0) {
    return { ok: false, error: t('familyAlarmForm.messageRequired') };
  }
  if (text.length > 500) {
    return { ok: false, error: t('familyAlarmForm.messageTooLong') };
  }

  const payload: FamilyAlarmCreatePayload = {
    recipient_user_id: input.recipientUserId,
    wake_at: input.wakeAt,
    message_text: text,
  };
  const days = Array.isArray(input.repeatDays)
    ? Array.from(new Set(input.repeatDays.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)))
        .sort((a, b) => a - b)
    : [];
  if (days.length > 0) payload.repeat_days = days;
  if (input.voiceProfileId) payload.voice_profile_id = input.voiceProfileId;

  return { ok: true, payload };
}

export function buildMemberDisplayName(m: FamilyGroupMember, t: TFunction): string {
  if (m.name && m.name.trim().length > 0) return m.name;
  if (m.email) return m.email;
  return t('familyAlarmForm.noName');
}
