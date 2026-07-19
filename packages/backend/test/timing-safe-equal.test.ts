import { describe, it, expect } from 'vitest';
import { timingSafeEqualStr } from '../src/lib/timing-safe-equal';

describe('timingSafeEqualStr', () => {
  it('같은 문자열이면 true', () => {
    expect(timingSafeEqualStr('secret-token-123', 'secret-token-123')).toBe(true);
  });

  it('한 글자만 달라도 false', () => {
    expect(timingSafeEqualStr('secret-token-123', 'secret-token-124')).toBe(false);
  });

  it('길이가 다르면 false', () => {
    expect(timingSafeEqualStr('short', 'longer-string')).toBe(false);
  });

  it('빈 문자열끼리는 true, 한쪽만 비면 false', () => {
    expect(timingSafeEqualStr('', '')).toBe(true);
    expect(timingSafeEqualStr('', 'x')).toBe(false);
  });

  it('유니코드(멀티바이트)도 정확히 비교', () => {
    expect(timingSafeEqualStr('토큰', '토큰')).toBe(true);
    expect(timingSafeEqualStr('토큰', '토큥')).toBe(false);
  });
});
