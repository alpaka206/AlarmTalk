import type { TFunction } from 'i18next';
import type { ActivityItem } from '../src/services/api';
import { activityEmoji, activityTypeLabel, activityDescription } from '../src/lib/activityHelpers';

const TEMPLATES: Record<string, string> = {
  'home.activityTypeAlarm': 'Alarm',
  'home.activityTypeMessage': 'Message',
  'home.activityTypeGift': 'Gift',
  'home.activityTypeVoice': 'Voice',
  'home.activityAlarm': 'Alarm {{time}}',
  'home.activityMessage': '"{{text}}"',
  'home.activityGift': 'Gift ({{status}})',
  'home.activityGiftNote': '"{{note}}" ({{status}})',
  'home.activityVoice': 'Voice "{{name}}"',
};

const t: TFunction = ((key: string, opts?: Record<string, unknown>) => {
  const tpl = TEMPLATES[key] ?? key;
  if (!opts) return tpl;
  let result = tpl;
  for (const [k, v] of Object.entries(opts)) {
    result = result.replace(`{{${k}}}`, String(v));
  }
  return result;
}) as TFunction;

describe('activityEmoji', () => {
  it('returns correct emoji for each type', () => {
    expect(activityEmoji('alarm')).toBe('⏰');
    expect(activityEmoji('message')).toBe('💬');
    expect(activityEmoji('gift')).toBe('🎁');
    expect(activityEmoji('voice')).toBe('🎙️');
  });
});

describe('activityTypeLabel', () => {
  it('returns translated label for alarm', () => {
    expect(activityTypeLabel('alarm', t)).toBe('Alarm');
  });
  it('returns translated label for message', () => {
    expect(activityTypeLabel('message', t)).toBe('Message');
  });
  it('returns translated label for gift', () => {
    expect(activityTypeLabel('gift', t)).toBe('Gift');
  });
  it('returns translated label for voice', () => {
    expect(activityTypeLabel('voice', t)).toBe('Voice');
  });
});

describe('activityDescription', () => {
  it('formats alarm with time', () => {
    const item: ActivityItem = { id: '1', type: 'alarm', detail: { time: '08:30' }, created_at: '' };
    expect(activityDescription(item, t)).toBe('Alarm 08:30');
  });

  it('formats message with text', () => {
    const item: ActivityItem = { id: '1', type: 'message', detail: { text: 'hello world' }, created_at: '' };
    expect(activityDescription(item, t)).toBe('"hello world"');
  });

  it('formats gift without note', () => {
    const item: ActivityItem = { id: '1', type: 'gift', detail: { note: null, status: 'pending' }, created_at: '' };
    expect(activityDescription(item, t)).toBe('Gift (pending)');
  });

  it('formats gift with note', () => {
    const item: ActivityItem = { id: '1', type: 'gift', detail: { note: 'congrats', status: 'accepted' }, created_at: '' };
    expect(activityDescription(item, t)).toBe('"congrats" (accepted)');
  });

  it('formats voice with name', () => {
    const item: ActivityItem = { id: '1', type: 'voice', detail: { name: 'Mom', status: 'ready' }, created_at: '' };
    expect(activityDescription(item, t)).toBe('Voice "Mom"');
  });
});
