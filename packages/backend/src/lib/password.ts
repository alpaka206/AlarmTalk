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

// bcrypt(bcryptjs)는 입력의 첫 72바이트만 사용하고 그 이상은 무시한다. password 뒤에
// pepper 를 붙이는 구조라, 비밀번호가 길면(특히 한글·이모지는 1자당 3~4바이트) 72바이트
// 경계를 넘는 뒷부분과 pepper 가 통째로 잘려 해시에 반영되지 않는다(정책상 128자를 받아도
// 사실상 앞부분만 유효, pepper 방어도 무력화). 이를 막기 위해 password+pepper 를 먼저
// SHA-256 으로 압축(hex 64자 → 64바이트, 72바이트 미만·null 바이트 없음)한 뒤 bcrypt 에
// 넣는다. 이렇게 하면 임의 길이 입력의 엔트로피가 온전히 반영되고 pepper 도 항상 적용된다.
async function prehashPassword(password: string, pepper: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(applyPepper(password, pepper)),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashPassword(password: string, pepper: string): Promise<string> {
  return bcrypt.hash(await prehashPassword(password, pepper), BCRYPT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string,
  pepper: string,
): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(await prehashPassword(password, pepper), hash);
}
