import { describe, it, expect } from 'vitest';
import {
  generateVoucherCode,
  generateVoucherCodePlain,
  hashVoucherCode,
  isValidVoucherCodeFormat,
} from '../src/lib/vouchers';

describe('generateVoucherCodePlain', () => {
  it('기본(invite) 호출은 INV-XXXX-XXXX-XXXX 포맷', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateVoucherCodePlain();
      expect(code).toMatch(/^INV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    }
  });

  it('시각적 혼동 문자 (0/O/1/I/L) 는 무작위 그룹에 포함되지 않는다 (prefix 자체 글자는 제외)', () => {
    for (let i = 0; i < 200; i++) {
      const groups = generateVoucherCodePlain().replace(/^INV-/, '');
      expect(groups).not.toMatch(/[01OIL]/);
    }
  });

  it('충분히 고유하다 (100회 생성 시 중복 없음)', () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) set.add(generateVoucherCodePlain());
    expect(set.size).toBe(100);
  });
});

describe('hashVoucherCode', () => {
  it('동일 입력 → 동일 hash (결정성)', async () => {
    const h1 = await hashVoucherCode('INV-ABCD-EFGH-JKMN');
    const h2 = await hashVoucherCode('INV-ABCD-EFGH-JKMN');
    expect(h1).toBe(h2);
  });

  it('다른 입력 → 다른 hash', async () => {
    const h1 = await hashVoucherCode('INV-ABCD-EFGH-JKMN');
    const h2 = await hashVoucherCode('INV-ABCD-EFGH-JKMP');
    expect(h1).not.toBe(h2);
  });

  it('SHA-256 hex 문자열 (64자)', async () => {
    const h = await hashVoucherCode('INV-ABCD-EFGH-JKMN');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('generateVoucherCode', () => {
  it('기본(invite) → INV- code + hash', async () => {
    const { code, hash } = await generateVoucherCode();
    expect(code).toMatch(/^INV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(hash).toBe(await hashVoucherCode(code));
  });
});

describe('isValidVoucherCodeFormat', () => {
  it('INV prefix 정상 포맷 → true', () => {
    expect(isValidVoucherCodeFormat('INV-ABCD-EFGH-JKMN')).toBe(true);
    expect(isValidVoucherCodeFormat('INV-2345-6789-ABCD')).toBe(true);
  });

  // ⚠ **선물 코드(GIFT-)는 2026-10-14 에 없앴다 — 되살리지 말 것**(App Store 심사 지침 3.1.1, 두 번째
  //   반려 — `routes/code.ts` 머리말). 형식이 맞는 선물 코드도 이제 '이용권 형식이 아니다' 다 — 그래야
  //   등록 라우트가 조회조차 하지 않고 `CODE_NOT_FOUND` 로 끝낸다.
  it('GIFT- 코드는 형식이 맞아도 false — 선물 코드는 폐지됐다', () => {
    expect(isValidVoucherCodeFormat('GIFT-ABCD-EFGH-JKMN')).toBe(false);
    expect(isValidVoucherCodeFormat('GIFT-2345-6789-ABCD')).toBe(false);
  });

  it('잘못된 포맷 → false', () => {
    expect(isValidVoucherCodeFormat('')).toBe(false);
    expect(isValidVoucherCodeFormat('ABCD-EFGH-JKMN')).toBe(false);
    expect(isValidVoucherCodeFormat('VA-ABCD-EFGH-JKMN')).toBe(false);
    expect(isValidVoucherCodeFormat('INV-ABC-EFGH-JKMN')).toBe(false);
    expect(isValidVoucherCodeFormat('INV-abcd-efgh-jkmn')).toBe(false);
    expect(isValidVoucherCodeFormat('INV-ABCD-EFGH')).toBe(false);
    expect(isValidVoucherCodeFormat('GIFT-ABC-EFGH-JKMN')).toBe(false);
  });
});
