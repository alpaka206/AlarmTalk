import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import {
  hashPassword,
  verifyPassword,
  applyPepper,
  DUMMY_BCRYPT_HASH,
} from '../src/lib/password';

describe('password hashing', () => {
  it('같은 비밀번호라도 해시가 매번 달라야 한다 (salt 무작위)', async () => {
    const pepper = 'test-pepper';
    const a = await hashPassword('correct-horse', pepper);
    const b = await hashPassword('correct-horse', pepper);
    expect(a).not.toBe(b);
  });

  it('올바른 비밀번호와 페퍼로 검증 성공', async () => {
    const pepper = 'test-pepper';
    const hash = await hashPassword('correct-horse', pepper);
    expect(await verifyPassword('correct-horse', hash, pepper)).toBe(true);
  });

  it('잘못된 비밀번호는 검증 실패', async () => {
    const pepper = 'test-pepper';
    const hash = await hashPassword('correct-horse', pepper);
    expect(await verifyPassword('wrong', hash, pepper)).toBe(false);
  });

  it('다른 페퍼로는 검증 실패 (pepper가 해시에 영향)', async () => {
    const hash = await hashPassword('correct-horse', 'pepper-a');
    expect(await verifyPassword('correct-horse', hash, 'pepper-b')).toBe(false);
  });

  it('빈 해시는 검증 실패', async () => {
    expect(await verifyPassword('anything', '', 'pepper')).toBe(false);
  });

  it('applyPepper 는 페퍼를 비밀번호 뒤에 붙인다', () => {
    expect(applyPepper('pw', 'sauce')).toBe('pw::sauce');
  });

  it('pre-hash 도입 이전 방식(bcrypt(password::pepper))으로 저장된 해시도 검증된다 (레거시 폴백)', async () => {
    const pepper = 'test-pepper';
    // 옛 hashPassword 가 만들던 해시: SHA-256 pre-hash 없이 password::pepper 를 직접 bcrypt.
    const legacyHash = await bcrypt.hash(applyPepper('correct-horse', pepper), 10);
    expect(await verifyPassword('correct-horse', legacyHash, pepper)).toBe(true);
    expect(await verifyPassword('wrong', legacyHash, pepper)).toBe(false);
  });

  it('DUMMY_BCRYPT_HASH 는 유효한 bcrypt 해시이며 어떤 평문과도 일치하지 않는다', async () => {
    // 타이밍 오라클 방지를 위해 사용자 부재 시 비교하는 더미 해시.
    expect(DUMMY_BCRYPT_HASH).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(await verifyPassword('superSecret1', DUMMY_BCRYPT_HASH, 'pepper-test')).toBe(false);
    expect(await verifyPassword('', DUMMY_BCRYPT_HASH, '')).toBe(false);
  });
});
