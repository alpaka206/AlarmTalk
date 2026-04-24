import type { TFunction } from 'i18next';
import { ApiError } from '../src/services/api/core';
import { getApiErrorMessage, getErrorCode } from '../src/lib/apiErrors';

const identity = ((key: string) => key) as TFunction;

function mockT(overrides: Record<string, string>): TFunction {
  return ((key: string) => overrides[key] ?? key) as TFunction;
}

describe('getApiErrorMessage', () => {
  it('returns unknown for non-ApiError', () => {
    expect(getApiErrorMessage(new Error('oops'), identity)).toBe('apiError.unknown');
  });

  it('returns unknown for null/undefined', () => {
    expect(getApiErrorMessage(null, identity)).toBe('apiError.unknown');
    expect(getApiErrorMessage(undefined, identity)).toBe('apiError.unknown');
  });

  it('maps FREE_PLAN_LIMIT', () => {
    const t = mockT({ 'apiError.freePlanLimit': '무료 플랜은 최대 2개까지 가능해요.' });
    const err = new ApiError(403, { error: 'limit', error_code: 'FREE_PLAN_LIMIT' });
    expect(getApiErrorMessage(err, t)).toBe('무료 플랜은 최대 2개까지 가능해요.');
  });

  it('maps VOICE_LIMIT_REACHED', () => {
    const t = mockT({ 'apiError.voiceLimitReached': '음성 프로필 2개 제한' });
    const err = new ApiError(409, { error: 'limit', error_code: 'VOICE_LIMIT_REACHED' });
    expect(getApiErrorMessage(err, t)).toBe('음성 프로필 2개 제한');
  });

  it('maps CODE_ALREADY_USED', () => {
    const t = mockT({ 'apiError.codeAlreadyUsed': '이미 사용된 코드' });
    const err = new ApiError(409, { error: 'used', error_code: 'CODE_ALREADY_USED' });
    expect(getApiErrorMessage(err, t)).toBe('이미 사용된 코드');
  });

  it('maps CODE_EXPIRED', () => {
    const t = mockT({ 'apiError.codeExpired': '만료된 코드' });
    const err = new ApiError(409, { error: 'expired', error_code: 'CODE_EXPIRED' });
    expect(getApiErrorMessage(err, t)).toBe('만료된 코드');
  });

  it('maps SELF_REQUEST', () => {
    const t = mockT({ 'apiError.selfRequest': '자기 자신에게' });
    const err = new ApiError(400, { error: 'self', error_code: 'SELF_REQUEST' });
    expect(getApiErrorMessage(err, t)).toBe('자기 자신에게');
  });

  it('maps ALREADY_FRIENDS', () => {
    const t = mockT({ 'apiError.alreadyFriends': '이미 친구' });
    const err = new ApiError(409, { error: 'dup', error_code: 'ALREADY_FRIENDS' });
    expect(getApiErrorMessage(err, t)).toBe('이미 친구');
  });

  it('maps GROUP_FULL', () => {
    const t = mockT({ 'apiError.groupFull': '정원 초과' });
    const err = new ApiError(409, { error: 'full', error_code: 'GROUP_FULL' });
    expect(getApiErrorMessage(err, t)).toBe('정원 초과');
  });

  it('maps OWNER_CANNOT_LEAVE', () => {
    const t = mockT({ 'apiError.ownerCannotLeave': '소유자 탈퇴 불가' });
    const err = new ApiError(409, { error: 'owner', error_code: 'OWNER_CANNOT_LEAVE' });
    expect(getApiErrorMessage(err, t)).toBe('소유자 탈퇴 불가');
  });

  it('maps FAMILY_ALARM_DISABLED', () => {
    const t = mockT({ 'apiError.familyAlarmDisabled': '가족 알람 비활성' });
    const err = new ApiError(403, { error: 'disabled', error_code: 'FAMILY_ALARM_DISABLED' });
    expect(getApiErrorMessage(err, t)).toBe('가족 알람 비활성');
  });

  it('maps DAILY_TTS_LIMIT_EXCEEDED', () => {
    const t = mockT({ 'apiError.dailyTtsLimitExceeded': 'TTS 한도 초과' });
    const err = new ApiError(429, { error: 'limit', error_code: 'DAILY_TTS_LIMIT_EXCEEDED' });
    expect(getApiErrorMessage(err, t)).toBe('TTS 한도 초과');
  });

  it('maps VOICE_PROFILE_IN_USE', () => {
    const t = mockT({ 'apiError.voiceProfileInUse': '사용 중' });
    const err = new ApiError(409, { error: 'in use', error_code: 'VOICE_PROFILE_IN_USE' });
    expect(getApiErrorMessage(err, t)).toBe('사용 중');
  });

  it('maps NOT_FRIENDS', () => {
    const t = mockT({ 'apiError.notFriends': '친구만 가능' });
    const err = new ApiError(403, { error: 'not friends', error_code: 'NOT_FRIENDS' });
    expect(getApiErrorMessage(err, t)).toBe('친구만 가능');
  });

  it('maps NOT_SAME_GROUP', () => {
    const t = mockT({ 'apiError.notSameGroup': '같은 그룹만' });
    const err = new ApiError(403, { error: 'different group', error_code: 'NOT_SAME_GROUP' });
    expect(getApiErrorMessage(err, t)).toBe('같은 그룹만');
  });

  it('maps SELF_ALARM', () => {
    const t = mockT({ 'apiError.selfAlarm': '본인 알람 불가' });
    const err = new ApiError(400, { error: 'self', error_code: 'SELF_ALARM' });
    expect(getApiErrorMessage(err, t)).toBe('본인 알람 불가');
  });

  it('maps NO_VOICE_PROFILE', () => {
    const t = mockT({ 'apiError.noVoiceProfile': '음성 프로필 없음' });
    const err = new ApiError(400, { error: 'none', error_code: 'NO_VOICE_PROFILE' });
    expect(getApiErrorMessage(err, t)).toBe('음성 프로필 없음');
  });

  it('falls back to HTTP status for unknown error_code', () => {
    const t = mockT({ 'apiError.serverError': '서버 에러' });
    const err = new ApiError(500, { error: 'crash', error_code: 'UNKNOWN_CODE_XYZ' });
    expect(getApiErrorMessage(err, t)).toBe('서버 에러');
  });

  it('falls back to HTTP 429 status message', () => {
    const t = mockT({ 'apiError.tooManyRequests': '요청 과다' });
    const err = new ApiError(429, { error: 'rate limit' });
    expect(getApiErrorMessage(err, t)).toBe('요청 과다');
  });

  it('falls back to HTTP 401 status message', () => {
    const t = mockT({ 'apiError.unauthorized': '로그인 필요' });
    const err = new ApiError(401, null);
    expect(getApiErrorMessage(err, t)).toBe('로그인 필요');
  });

  it('falls back to HTTP 404 status message', () => {
    const t = mockT({ 'apiError.notFound': '없음' });
    const err = new ApiError(404, { error: 'not found' });
    expect(getApiErrorMessage(err, t)).toBe('없음');
  });

  it('falls back to HTTP 409 status message', () => {
    const t = mockT({ 'apiError.conflict': '충돌' });
    const err = new ApiError(409, { error: 'conflict' });
    expect(getApiErrorMessage(err, t)).toBe('충돌');
  });

  it('falls back to unknown for unmapped status without error_code', () => {
    expect(getApiErrorMessage(new ApiError(418, { error: 'teapot' }), identity)).toBe('apiError.unknown');
  });

  it('maps both INVALID_FORMAT and INVALID_CODE_FORMAT to same key', () => {
    const t = mockT({ 'apiError.invalidCodeFormat': '형식 오류' });
    const err1 = new ApiError(400, { error: 'bad', error_code: 'INVALID_FORMAT' });
    const err2 = new ApiError(400, { error: 'bad', error_code: 'INVALID_CODE_FORMAT' });
    expect(getApiErrorMessage(err1, t)).toBe('형식 오류');
    expect(getApiErrorMessage(err2, t)).toBe('형식 오류');
  });

  it('maps RECEIVER_NOT_FOUND to recipientNotFound', () => {
    const t = mockT({ 'apiError.recipientNotFound': '수신자 없음' });
    const err = new ApiError(404, { error: 'not found', error_code: 'RECEIVER_NOT_FOUND' });
    expect(getApiErrorMessage(err, t)).toBe('수신자 없음');
  });
});

describe('getErrorCode', () => {
  it('returns errorCode from ApiError', () => {
    const err = new ApiError(400, { error: 'bad', error_code: 'FREE_PLAN_LIMIT' });
    expect(getErrorCode(err)).toBe('FREE_PLAN_LIMIT');
  });

  it('returns null for ApiError without error_code', () => {
    const err = new ApiError(400, { error: 'bad' });
    expect(getErrorCode(err)).toBeNull();
  });

  it('returns null for non-ApiError', () => {
    expect(getErrorCode(new Error('oops'))).toBeNull();
    expect(getErrorCode(null)).toBeNull();
    expect(getErrorCode('string')).toBeNull();
  });
});

describe('ApiError.errorCode extraction', () => {
  it('extracts error_code from responseData', () => {
    const err = new ApiError(400, { error: 'bad', error_code: 'CODE_EXPIRED' });
    expect(err.errorCode).toBe('CODE_EXPIRED');
  });

  it('sets null when responseData is null', () => {
    const err = new ApiError(500, null);
    expect(err.errorCode).toBeNull();
  });

  it('sets null when responseData has no error_code', () => {
    const err = new ApiError(400, { error: 'bad request' });
    expect(err.errorCode).toBeNull();
  });

  it('sets null when error_code is not a string', () => {
    const err = new ApiError(400, { error: 'bad', error_code: 123 });
    expect(err.errorCode).toBeNull();
  });

  it('sets null when responseData is a string', () => {
    const err = new ApiError(400, 'plain text error');
    expect(err.errorCode).toBeNull();
  });
});
