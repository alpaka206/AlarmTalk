import {
  buildMemberDisplayName,
  filterFamilyAlarmRecipients,
  validateFamilyAlarmForm,
  type FamilyAlarmFormInput,
} from '../src/lib/familyAlarmForm';
import type { FamilyGroupMember } from '../src/services/api';
import type { TFunction } from 'i18next';

const t = ((key: string) => key) as TFunction;

function m(overrides: Partial<FamilyGroupMember> & { user_id: string }): FamilyGroupMember {
  return {
    id: `pgm-${overrides.user_id}`,
    role: 'member',
    joined_at: '2026-01-01T00:00:00.000Z',
    email: null,
    name: null,
    picture: null,
    allow_family_alarms: true,
    ...overrides,
  };
}

describe('filterFamilyAlarmRecipients', () => {
  it('자기 자신을 제외한다', () => {
    const members = [m({ user_id: 'self' }), m({ user_id: 'other' })];
    const result = filterFamilyAlarmRecipients(members, 'self');
    expect(result).toHaveLength(1);
    expect(result[0].user_id).toBe('other');
  });

  it('allow_family_alarms=false 는 제외한다', () => {
    const members = [
      m({ user_id: 'a', allow_family_alarms: true }),
      m({ user_id: 'b', allow_family_alarms: false }),
    ];
    const result = filterFamilyAlarmRecipients(members, 'self');
    expect(result.map((r) => r.user_id)).toEqual(['a']);
  });

  it('owner 를 member 보다 먼저 정렬한다', () => {
    const members = [
      m({ user_id: 'm1', role: 'member', joined_at: '2026-01-01T00:00:00.000Z' }),
      m({ user_id: 'o1', role: 'owner', joined_at: '2026-02-01T00:00:00.000Z' }),
    ];
    const result = filterFamilyAlarmRecipients(members, 'self');
    expect(result.map((r) => r.user_id)).toEqual(['o1', 'm1']);
  });

  it('같은 역할 내에서는 joined_at 오름차순', () => {
    const members = [
      m({ user_id: 'b', role: 'member', joined_at: '2026-03-01T00:00:00.000Z' }),
      m({ user_id: 'a', role: 'member', joined_at: '2026-01-01T00:00:00.000Z' }),
    ];
    const result = filterFamilyAlarmRecipients(members, 'self');
    expect(result.map((r) => r.user_id)).toEqual(['a', 'b']);
  });
});

describe('validateFamilyAlarmForm', () => {
  const base: FamilyAlarmFormInput = {
    recipientUserId: 'user-x',
    wakeAt: '07:30',
    messageText: '안녕',
    repeatDays: [],
  };

  it('정상 입력 → payload 반환', () => {
    const result = validateFamilyAlarmForm({ ...base, repeatDays: [1, 3, 5] }, t);
    if (!result.ok) throw new Error('expected ok');
    expect(result.payload).toEqual({
      recipient_user_id: 'user-x',
      wake_at: '07:30',
      message_text: '안녕',
      repeat_days: [1, 3, 5],
    });
  });

  it('공백 문자 포함 메시지는 trim 됨', () => {
    const result = validateFamilyAlarmForm({ ...base, messageText: '  hi  ' }, t);
    if (!result.ok) throw new Error('expected ok');
    expect(result.payload.message_text).toBe('hi');
  });

  it('repeatDays 중복·범위 밖 제거 + 정렬', () => {
    const result = validateFamilyAlarmForm({ ...base, repeatDays: [5, 1, 1, 7, -1, 3] }, t);
    if (!result.ok) throw new Error('expected ok');
    expect(result.payload.repeat_days).toEqual([1, 3, 5]);
  });

  it('빈 repeatDays 는 payload 에서 생략', () => {
    const result = validateFamilyAlarmForm(base, t);
    if (!result.ok) throw new Error('expected ok');
    expect(result.payload.repeat_days).toBeUndefined();
  });

  it('recipientUserId 없으면 에러', () => {
    const result = validateFamilyAlarmForm({ ...base, recipientUserId: null }, t);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('familyAlarmForm.recipientRequired');
  });

  it('wakeAt 포맷 오류면 에러', () => {
    const result = validateFamilyAlarmForm({ ...base, wakeAt: '7:30' }, t);
    expect(result.ok).toBe(false);
  });

  it('messageText 공백만이면 에러', () => {
    const result = validateFamilyAlarmForm({ ...base, messageText: '   ' }, t);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('familyAlarmForm.messageRequired');
  });

  it('messageText 500자 초과 에러', () => {
    const result = validateFamilyAlarmForm({ ...base, messageText: 'a'.repeat(501) }, t);
    expect(result.ok).toBe(false);
  });

  it('voiceProfileId 전달 시 payload 에 포함', () => {
    const result = validateFamilyAlarmForm({ ...base, voiceProfileId: 'vp-1' }, t);
    if (!result.ok) throw new Error('expected ok');
    expect(result.payload.voice_profile_id).toBe('vp-1');
  });
});

describe('buildMemberDisplayName', () => {
  it('name 이 있으면 name 사용', () => {
    expect(buildMemberDisplayName(m({ user_id: 'a', name: 'Alice' }), t)).toBe('Alice');
  });
  it('name 없고 email 있으면 email', () => {
    expect(buildMemberDisplayName(m({ user_id: 'a', email: 'a@b.com' }), t)).toBe('a@b.com');
  });
  it('둘 다 없으면 i18n noName 키', () => {
    expect(buildMemberDisplayName(m({ user_id: 'a' }), t)).toBe('familyAlarmForm.noName');
  });
  it('name 이 빈 문자열이면 email fallback', () => {
    expect(buildMemberDisplayName(m({ user_id: 'a', name: '   ', email: 'x@y.com' }), t)).toBe(
      'x@y.com',
    );
  });
});
