import { describe, expect, it } from 'vitest';
import { RegisterRequestSchema, LoginRequestSchema, DisplayNameSchema } from '../src/index.js';

describe('RegisterRequestSchema', () => {
  it('accepts a well-formed registration', () => {
    const r = RegisterRequestSchema.parse({
      email: 'kim@example.com',
      password: 's3curepass!',
      name: '김규원',
      email_verification_code: '123456',
    });
    expect(r.email).toBe('kim@example.com');
  });
  it('rejects password shorter than 8 chars', () => {
    expect(() =>
      RegisterRequestSchema.parse({
        email: 'kim@example.com',
        password: 'short',
        name: 'kim',
      }),
    ).toThrow();
  });
  it('rejects password without a digit', () => {
    expect(() =>
      RegisterRequestSchema.parse({
        email: 'kim@example.com',
        password: 'onlyletters',
        name: 'kim',
        email_verification_code: '123456',
      }),
    ).toThrow();
  });
  it('rejects password without a letter', () => {
    expect(() =>
      RegisterRequestSchema.parse({
        email: 'kim@example.com',
        password: '12345678',
        name: 'kim',
        email_verification_code: '123456',
      }),
    ).toThrow();
  });
  it('rejects malformed email', () => {
    expect(() =>
      RegisterRequestSchema.parse({
        email: 'not-an-email',
        password: 's3curepass!',
        name: 'kim',
      }),
    ).toThrow();
  });
});

describe('LoginRequestSchema', () => {
  it('accepts a login payload', () => {
    const l = LoginRequestSchema.parse({
      email: 'kim@example.com',
      password: 'any-non-empty',
    });
    expect(l.password).toBe('any-non-empty');
  });
  it('rejects empty password', () => {
    expect(() => LoginRequestSchema.parse({ email: 'kim@example.com', password: '' })).toThrow();
  });
});

describe('DisplayNameSchema', () => {
  // 앱의 sanitizeDisplayName 과 같은 규칙이다. 두 쪽이 어긋나면 앱을 우회한 요청만
  // 다른 규칙을 받게 되므로, 가장 느슨한 쪽이 실질 규칙이 된다.
  it('보이지 않는 문자를 걷어낸다', () => {
    // 제로폭 공백이 낀 이름은 눈에 같아 보이는데 시스템에는 다른 값이다.
    expect(DisplayNameSchema.parse('홍\u200B길\uFEFF동')).toBe('홍길동');
    // 양방향 제어문자는 화면에 보이는 글자 순서를 뒤집는다 — 이름 스푸핑의 고전 수법.
    expect(DisplayNameSchema.parse('a\u202Eb\u202Cc')).toBe('abc');
  });

  it('줄바꿈은 지우지 않고 공백으로 바꾼다', () => {
    // 지우면 "김규원" 이 되어 원래 없던 한 단어가 만들어진다.
    expect(DisplayNameSchema.parse('김\n규원')).toBe('김 규원');
    expect(DisplayNameSchema.parse('김   규원')).toBe('김 규원');
  });

  it('정당한 문장부호는 남긴다', () => {
    // "O'Brien" 을 막는 건 주입 방어가 아니라 이름을 못 쓰게 하는 것이다.
    expect(DisplayNameSchema.parse("O'Brien; Jr.")).toBe("O'Brien; Jr.");
  });

  it('공백만인 이름과 30자 초과를 거부한다', () => {
    expect(DisplayNameSchema.safeParse('   ').success).toBe(false);
    expect(DisplayNameSchema.safeParse('\u200B\u200B').success).toBe(false);
    expect(DisplayNameSchema.safeParse('가'.repeat(30)).success).toBe(true);
    expect(DisplayNameSchema.safeParse('가'.repeat(31)).success).toBe(false);
  });

  it('가입 스키마도 같은 규칙을 쓴다', () => {
    // 예전엔 가입만 max(64)에 trim 도 없어 공백뿐인 이름이 통과했다.
    const base = {
      email: 'kim@example.com',
      password: 's3curepass!',
      email_verification_code: '123456',
    };
    expect(RegisterRequestSchema.safeParse({ ...base, name: '  ' }).success).toBe(false);
    expect(RegisterRequestSchema.safeParse({ ...base, name: '가'.repeat(31) }).success).toBe(false);
    expect(RegisterRequestSchema.parse({ ...base, name: '  김규원 ' }).name).toBe('김규원');
  });
});
