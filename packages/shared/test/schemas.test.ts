import { describe, expect, it } from 'vitest';
import { RegisterRequestSchema, LoginRequestSchema } from '../src/index.js';

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
