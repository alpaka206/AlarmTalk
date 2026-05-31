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
  it('INV-XXXX-XXXX-XXXX 형식의 문자열을 반환한다', () => {
    const code = generateInviteCode();
    expect(code).toHaveLength(INVITE_CODE_LENGTH);
    expect(
      /^INV-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test(
        code,
      ),
    ).toBe(true);
  });

  it('연속 호출 시 서로 다른 코드를 주로 생성한다 (통계적 고유성)', () => {
    const set = new Set<string>();
    for (let i = 0; i < 200; i++) set.add(generateInviteCode());
    // 12자리 영숫자 코드라 200건 중 대부분은 유니크해야 한다.
    expect(set.size).toBeGreaterThanOrEqual(150);
  });

  it('시각적으로 헷갈리는 문자는 생성하지 않는다', () => {
    for (let i = 0; i < 100; i++) {
      const body = generateInviteCode().replace(/^INV-/, '').replace(/-/g, '');
      expect(body).not.toMatch(/[0O1IL]/);
    }
  });
});

describe('isValidInviteCodeFormat', () => {
  it('INV-XXXX-XXXX-XXXX와 레거시 6자리 숫자를 true로 본다', () => {
    expect(isValidInviteCodeFormat('INV-ABCD-1234-EFGH')).toBe(true);
    expect(isValidInviteCodeFormat('invabcd1234efgh')).toBe(true);
    expect(isValidInviteCodeFormat('INV-123456')).toBe(true);
    expect(isValidInviteCodeFormat('inv123456')).toBe(true);
    expect(isValidInviteCodeFormat('123456')).toBe(true);
    expect(isValidInviteCodeFormat('000001')).toBe(true);
  });

  it('길이가 다르거나 문자가 섞이면 false', () => {
    expect(isValidInviteCodeFormat('INV-ABC-1234-EFGH')).toBe(false);
    expect(isValidInviteCodeFormat('INV-ABCDE-1234-EFGH')).toBe(false);
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
    expect(normalizeInviteCode(' invabcd1234efgh ')).toBe('INV-ABCD-1234-EFGH');
    expect(normalizeInviteCode('inv-abcd-1234-efgh')).toBe('INV-ABCD-1234-EFGH');
    expect(normalizeInviteCode(' inv123456 ')).toBe('INV-123456');
    expect(normalizeInviteCode('inv-123456')).toBe('INV-123456');
    expect(normalizeInviteCode('123456')).toBe('123456');
  });
});

describe('buildInviteDeepLink / buildInviteWebUrl', () => {
  it('딥링크는 voicealarm 스킴 + /invite/{code}', () => {
    expect(buildInviteDeepLink('INV-ABCD-1234-EFGH')).toBe(
      'voicealarm://invite/INV-ABCD-1234-EFGH',
    );
  });
  it('웹 URL 은 alarm-talk.com 호스트 + /invite/{code}', () => {
    expect(buildInviteWebUrl('INV-ABCD-1234-EFGH')).toBe(
      'https://alarm-talk.com/invite/INV-ABCD-1234-EFGH',
    );
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
