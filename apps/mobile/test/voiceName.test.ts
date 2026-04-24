import { sanitizeVoiceName } from '../src/lib/voiceName';
import type { TFunction } from 'i18next';

const t = ((key: string) => key) as TFunction;

describe('sanitizeVoiceName', () => {
  it('앞뒤 공백을 제거한다', () => {
    expect(sanitizeVoiceName('  엄마  ', t)).toEqual({ ok: true, value: '엄마' });
  });

  it('빈 문자열은 거절한다', () => {
    const r = sanitizeVoiceName('   ', t);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('voiceName.nameRequired');
  });

  it('51자 이상이면 거절한다', () => {
    const r = sanitizeVoiceName('가'.repeat(51), t);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('voiceName.nameTooLong');
  });

  it('50자 정확히는 허용', () => {
    const r = sanitizeVoiceName('가'.repeat(50), t);
    expect(r.ok).toBe(true);
  });

  it('일반 한글 이름 허용', () => {
    expect(sanitizeVoiceName('아빠 목소리', t).ok).toBe(true);
  });
});
