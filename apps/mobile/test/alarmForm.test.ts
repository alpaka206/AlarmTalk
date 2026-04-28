import {
  buildCreatePayload,
  parseRepeatDays,
  validateAlarmForm,
  type AlarmFormInput,
} from '../src/lib/alarmForm';

const t = ((key: string) => key) as import('i18next').TFunction;

const baseInput: AlarmFormInput = {
  messageId: '10000000-0000-4000-8000-000000000001',
  time: '07:00',
  repeatDays: [],
  mode: 'tts',
};

describe('buildCreatePayload', () => {
  it('기본 TTS 모드 — voice_profile_id/speaker_id 제외', () => {
    const payload = buildCreatePayload(baseInput);
    expect(payload).toEqual({
      message_id: baseInput.messageId,
      time: '07:00',
      repeat_days: [],
      mode: 'tts',
    });
  });

  it('sound-only + voice_profile_id 포함', () => {
    const payload = buildCreatePayload({
      ...baseInput,
      mode: 'sound-only',
      voiceProfileId: '40000000-0000-4000-8000-000000000001',
      speakerId: '50000000-0000-4000-8000-000000000001',
    });
    expect(payload.mode).toBe('sound-only');
    expect(payload.voice_profile_id).toBe('40000000-0000-4000-8000-000000000001');
    expect(payload.speaker_id).toBe('50000000-0000-4000-8000-000000000001');
  });

  it('snoozeMinutes 가 숫자면 포함', () => {
    const payload = buildCreatePayload({ ...baseInput, snoozeMinutes: 10 });
    expect(payload.snooze_minutes).toBe(10);
  });

  it('targetUserId 지정 시 포함', () => {
    const payload = buildCreatePayload({
      ...baseInput,
      targetUserId: '20000000-0000-4000-8000-000000000001',
    });
    expect(payload.target_user_id).toBe('20000000-0000-4000-8000-000000000001');
  });

  it('repeat_days 가 배열이 아닐 때도 빈 배열로 안전하게 처리', () => {
    // @ts-expect-error — intentional 잘못된 입력
    const payload = buildCreatePayload({ ...baseInput, repeatDays: null });
    expect(payload.repeat_days).toEqual([]);
  });
});

describe('validateAlarmForm', () => {
  it('메시지 미선택이면 에러', () => {
    const res = validateAlarmForm({ ...baseInput, messageId: null }, t);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('alarmValidation.messageRequired');
  });

  it('잘못된 시간 형식이면 에러', () => {
    const res = validateAlarmForm({ ...baseInput, time: '7am' }, t);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('alarmValidation.invalidTime');
  });

  it('mode 가 허용값 밖이면 에러', () => {
    // @ts-expect-error — intentional 잘못된 모드
    const res = validateAlarmForm({ ...baseInput, mode: 'video' }, t);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('alarmValidation.invalidMode');
  });

  it('sound-only + voice_profile_id 누락이면 에러', () => {
    const res = validateAlarmForm({ ...baseInput, mode: 'sound-only' }, t);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('alarmValidation.voiceProfileRequired');
  });

  it('정상 TTS → ok + payload', () => {
    const res = validateAlarmForm(baseInput, t);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.payload.mode).toBe('tts');
  });

  it('정상 sound-only + voice_profile_id → ok', () => {
    const res = validateAlarmForm({
      ...baseInput,
      mode: 'sound-only',
      voiceProfileId: '40000000-0000-4000-8000-000000000001',
    }, t);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.payload.mode).toBe('sound-only');
      expect(res.payload.voice_profile_id).toBe('40000000-0000-4000-8000-000000000001');
    }
  });
});

describe('parseRepeatDays', () => {
  it('배열을 그대로 반환', () => {
    expect(parseRepeatDays([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('JSON 문자열을 파싱', () => {
    expect(parseRepeatDays('[0,6]')).toEqual([0, 6]);
  });

  it('빈 문자열은 빈 배열', () => {
    expect(parseRepeatDays('')).toEqual([]);
  });

  it('잘못된 JSON 은 빈 배열', () => {
    expect(parseRepeatDays('{not-json')).toEqual([]);
  });

  it('null / undefined 는 빈 배열', () => {
    expect(parseRepeatDays(null)).toEqual([]);
    expect(parseRepeatDays(undefined)).toEqual([]);
  });

  it('배열 안 정수가 아닌 값은 필터링', () => {
    expect(parseRepeatDays([1, '2', 3.5, null, 4])).toEqual([1, 4]);
  });
});
