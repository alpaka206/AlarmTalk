import { describe, it, expect } from 'vitest';
import {
  generateInviteCode,
  isValidInviteCodeFormat,
  normalizeInviteCode,
  buildInviteDeepLink,
  buildInviteWebUrl,
  computeInviteExpiresAt,
  INVITE_CODE_LENGTH,
  INVITE_TTL_MINUTES,
} from '../src/lib/invites';

describe('generateInviteCode', () => {
  it('INV-6자리 숫자 문자열을 반환한다', () => {
    const code = generateInviteCode();
    expect(code).toHaveLength(INVITE_CODE_LENGTH);
    expect(/^INV-[0-9]{6}$/.test(code)).toBe(true);
  });

  it('연속 호출 시 서로 다른 코드를 주로 생성한다 (통계적 고유성)', () => {
    const set = new Set<string>();
    for (let i = 0; i < 200; i++) set.add(generateInviteCode());
    // 200건 중 최소 150건 이상은 유니크해야 한다 (6자리 = 100만 경우의 수)
    expect(set.size).toBeGreaterThanOrEqual(150);
  });

  it('leading zero 를 허용한다 — 문자열로 유지', () => {
    let sawLeadingZero = false;
    for (let i = 0; i < 500; i++) {
      if (generateInviteCode().slice(4).startsWith('0')) {
        sawLeadingZero = true;
        break;
      }
    }
    expect(sawLeadingZero).toBe(true);
  });
});

describe('isValidInviteCodeFormat', () => {
  it('INV-6자리 숫자와 레거시 6자리 숫자를 true로 본다', () => {
    expect(isValidInviteCodeFormat('INV-123456')).toBe(true);
    expect(isValidInviteCodeFormat('inv123456')).toBe(true);
    expect(isValidInviteCodeFormat('123456')).toBe(true);
    expect(isValidInviteCodeFormat('000001')).toBe(true);
  });

  it('길이가 다르거나 문자가 섞이면 false', () => {
    expect(isValidInviteCodeFormat('INV-12345')).toBe(false);
    expect(isValidInviteCodeFormat('INV-12345A')).toBe(false);
    expect(isValidInviteCodeFormat('12345')).toBe(false);
    expect(isValidInviteCodeFormat('1234567')).toBe(false);
    expect(isValidInviteCodeFormat('12345a')).toBe(false);
    expect(isValidInviteCodeFormat('')).toBe(false);
  });
});

describe('normalizeInviteCode', () => {
  it('태그형 코드를 서버 저장 형식으로 정규화한다', () => {
    expect(normalizeInviteCode(' inv123456 ')).toBe('INV-123456');
    expect(normalizeInviteCode('inv-123456')).toBe('INV-123456');
    expect(normalizeInviteCode('123456')).toBe('123456');
  });
});

describe('buildInviteDeepLink / buildInviteWebUrl', () => {
  it('딥링크는 voicealarm 스킴 + /invite/{code}', () => {
    expect(buildInviteDeepLink('INV-123456')).toBe('voicealarm://invite/INV-123456');
  });
  it('웹 URL 은 voicealarm.pages.dev 호스트 + /invite/{code}', () => {
    expect(buildInviteWebUrl('INV-123456')).toBe('https://voicealarm.pages.dev/invite/INV-123456');
  });
});

describe('computeInviteExpiresAt', () => {
  it('기본 TTL 이 10분이다', () => {
    const now = new Date('2026-04-21T00:00:00Z');
    const iso = computeInviteExpiresAt(now);
    const exp = new Date(iso);
    expect(exp.getTime() - now.getTime()).toBe(INVITE_TTL_MINUTES * 60 * 1000);
  });
});
