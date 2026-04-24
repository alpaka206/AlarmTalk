import type { TFunction } from 'i18next';

export interface FamilyAlarmLabelInput {
  is_family_alarm?: boolean;
  is_received_family_alarm?: boolean;
  sender_user_id?: string | null;
  sender_name?: string | null;
  sender_email?: string | null;
}

export interface FamilyAlarmLabel {
  visible: boolean;
  text: string;
}

export function isReceivedFamilyAlarm(
  alarm: FamilyAlarmLabelInput,
  selfUserId?: string | null,
): boolean {
  if (alarm.is_received_family_alarm === true) return true;
  if (alarm.is_received_family_alarm === false) return false;
  if (!alarm.is_family_alarm) return false;
  if (!alarm.sender_user_id) return false;
  if (!selfUserId) return false;
  return alarm.sender_user_id !== selfUserId;
}

export function buildFamilyAlarmLabel(
  alarm: FamilyAlarmLabelInput,
  selfUserId: string | null | undefined,
  t: TFunction,
): FamilyAlarmLabel {
  if (!isReceivedFamilyAlarm(alarm, selfUserId)) {
    return { visible: false, text: '' };
  }
  const name = (alarm.sender_name ?? '').trim();
  const email = (alarm.sender_email ?? '').trim();
  const label = name.length > 0 ? name : email.length > 0 ? email : t('familyAlarmLabel.family');
  return { visible: true, text: t('familyAlarmLabel.receivedAlarm', { name: label }) };
}
