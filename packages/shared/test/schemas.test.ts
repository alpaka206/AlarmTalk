import { describe, expect, it } from 'vitest';
import {
  UserPlanSchema,
  UserSchema,
  VoiceProfileSchema,
  VoiceProfileStatusSchema,
  RegisterRequestSchema,
  LoginRequestSchema,
  AuthResponseSchema,
} from '../src/index.js';

describe('UserPlanSchema', () => {
  it('accepts known plans', () => {
    expect(UserPlanSchema.parse('free')).toBe('free');
    expect(UserPlanSchema.parse('plus')).toBe('plus');
    expect(UserPlanSchema.parse('family')).toBe('family');
  });
  it('rejects unknown plans', () => {
    expect(() => UserPlanSchema.parse('enterprise')).toThrow();
  });
});

describe('UserSchema', () => {
  it('parses a well-formed user', () => {
    const u = UserSchema.parse({
      id: 'u_1',
      email: 'kim@example.com',
      name: '김규원',
      plan: 'plus',
      createdAt: '2026-04-17T00:00:00.000Z',
    });
    expect(u.plan).toBe('plus');
  });
  it('rejects malformed email', () => {
    expect(() =>
      UserSchema.parse({
        id: 'u_1',
        email: 'not-an-email',
        name: 'kim',
        plan: 'free',
        createdAt: '2026-04-17T00:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('RegisterRequestSchema', () => {
  it('accepts a well-formed registration', () => {
    const r = RegisterRequestSchema.parse({
      email: 'kim@example.com',
      password: 's3curepass!',
      name: '김규원',
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

describe('AuthResponseSchema', () => {
  it('accepts a valid auth response', () => {
    const a = AuthResponseSchema.parse({
      token: 'eyJ.payload.sig',
      user: {
        id: 'u_1',
        email: 'kim@example.com',
        name: '김규원',
        plan: 'free',
      },
    });
    expect(a.token).toContain('eyJ');
  });
});

describe('VoiceProfileSchema', () => {
  it('parses a valid profile', () => {
    const p = VoiceProfileSchema.parse({
      id: 'vp_1',
      userId: 'u_1',
      name: '엄마 목소리',
      status: 'ready',
      sampleCount: 3,
    });
    expect(VoiceProfileStatusSchema.parse(p.status)).toBe('ready');
  });
  it('rejects negative sample count', () => {
    expect(() =>
      VoiceProfileSchema.parse({
        id: 'vp_1',
        userId: 'u_1',
        name: '엄마 목소리',
        status: 'ready',
        sampleCount: -1,
      }),
    ).toThrow();
  });
});
