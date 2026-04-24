import type { TFunction } from 'i18next';
import { ApiError } from '../services/api/core';

const ERROR_CODE_I18N: Record<string, string> = {
  FREE_PLAN_LIMIT: 'apiError.freePlanLimit',
  NOT_FRIENDS: 'apiError.notFriends',
  ALREADY_FRIENDS: 'apiError.alreadyFriends',
  ALREADY_PENDING: 'apiError.alreadyPending',
  ALREADY_MEMBER: 'apiError.alreadyMember',
  VOICE_LIMIT_REACHED: 'apiError.voiceLimitReached',
  DAILY_TTS_LIMIT_EXCEEDED: 'apiError.dailyTtsLimitExceeded',
  CODE_NOT_FOUND: 'apiError.codeNotFound',
  CODE_ALREADY_USED: 'apiError.codeAlreadyUsed',
  CODE_EXPIRED: 'apiError.codeExpired',
  CODE_REVOKED: 'apiError.codeRevoked',
  INVALID_FORMAT: 'apiError.invalidCodeFormat',
  INVALID_CODE_FORMAT: 'apiError.invalidCodeFormat',
  SELF_ISSUED: 'apiError.selfIssued',
  SELF_REQUEST: 'apiError.selfRequest',
  SELF_GIFT: 'apiError.selfGift',
  SELF_NOTE: 'apiError.selfNote',
  SELF_ALARM: 'apiError.selfAlarm',
  SELF_ACCEPT: 'apiError.selfAccept',
  SELF_TRANSFER: 'apiError.selfTransfer',
  SELF_REMOVE: 'apiError.selfRemove',
  GROUP_FULL: 'apiError.groupFull',
  GROUP_NOT_FOUND: 'apiError.groupNotFound',
  NOT_SAME_GROUP: 'apiError.notSameGroup',
  NOT_MEMBER: 'apiError.notMember',
  OWNER_ONLY: 'apiError.ownerOnly',
  OWNER_CANNOT_LEAVE: 'apiError.ownerCannotLeave',
  CANNOT_REMOVE_OWNER: 'apiError.cannotRemoveOwner',
  FAMILY_ALARM_DISABLED: 'apiError.familyAlarmDisabled',
  VOICE_PROFILE_IN_USE: 'apiError.voiceProfileInUse',
  VOICE_PROFILE_NOT_FOUND: 'apiError.voiceProfileNotFound',
  MESSAGE_IN_USE: 'apiError.messageInUse',
  MESSAGE_NOT_FOUND: 'apiError.messageNotFound',
  NOTE_NOT_FOUND: 'apiError.noteNotFound',
  ALARM_NOT_FOUND: 'apiError.alarmNotFound',
  RECIPIENT_NOT_FOUND: 'apiError.recipientNotFound',
  RECEIVER_NOT_FOUND: 'apiError.recipientNotFound',
  USER_NOT_FOUND: 'apiError.userNotFound',
  NO_VOICE_PROFILE: 'apiError.noVoiceProfile',
  FORBIDDEN: 'apiError.forbidden',
};

const STATUS_I18N: Record<number, string> = {
  401: 'apiError.unauthorized',
  403: 'apiError.forbidden',
  404: 'apiError.notFound',
  409: 'apiError.conflict',
  429: 'apiError.tooManyRequests',
  500: 'apiError.serverError',
};

export function getApiErrorMessage(error: unknown, t: TFunction, fallback?: string): string {
  if (!(error instanceof ApiError)) {
    return fallback ?? t('apiError.unknown');
  }

  if (error.errorCode) {
    const key = ERROR_CODE_I18N[error.errorCode];
    if (key) {
      const translated = t(key);
      if (translated !== key) return translated;
    }
  }

  const statusKey = STATUS_I18N[error.status];
  if (statusKey) {
    const translated = t(statusKey);
    if (translated !== statusKey) return translated;
  }

  return fallback ?? t('apiError.unknown');
}

export function getErrorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.errorCode : null;
}
