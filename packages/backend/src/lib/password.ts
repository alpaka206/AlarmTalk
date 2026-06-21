import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 10;

/**
 * 존재하지 않는 사용자로 로그인 시도 시, 실제 비밀번호 검증과 동일한 비용의
 * bcrypt 비교를 수행해 타이밍으로 계정 존재 여부가 새지 않게 하기 위한 고정 더미
 * 해시. 어떤 평문과도 일치하지 않는다(BCRYPT_ROUNDS 와 동일한 cost=10).
 */
export const DUMMY_BCRYPT_HASH =
  '$2a$10$CwTycUXWue0Thq9StjUM0uJ8DvY8Rc0G2qY9C2bq8N3w1qS8m9b2K';

export function applyPepper(password: string, pepper: string): string {
  return `${password}::${pepper ?? ''}`;
}

export async function hashPassword(password: string, pepper: string): Promise<string> {
  return bcrypt.hash(applyPepper(password, pepper), BCRYPT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string,
  pepper: string,
): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(applyPepper(password, pepper), hash);
}
