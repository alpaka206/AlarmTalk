import type { Context } from 'hono';
import type { AppEnv } from '../types';

/**
 * 호출자의 소유권 판정에 쓸 식별자 집합 — `[users.id, 토큰의 로그인 식별자]`.
 *
 * 미들웨어가 `userId` 를 users.id 로 정규화하므로 소유권 기준은 언제나 첫 값이다.
 * 두 번째 값(`userLoginId`)은 식별자 통일 전에 `user_id` 컬럼에 로그인 식별자
 * (구글 로그인이면 google_id)가 저장된 과거 행까지 읽어 주기 위한 보조 매칭이다.
 * 둘이 같으면(=대부분의 계정, 그리고 재로그인 이후) 한 값으로 줄어든다.
 *
 * 이 함수를 쓰지 않고 `[userIdPK, userId]` 를 직접 만들면, 정규화 이후 두 값이 같아
 * 이중 매칭이 조용히 사라진다 — 그래서 지점마다 손으로 만들지 말고 여기로 모은다.
 */
export function callerOwnerIds(c: Context<AppEnv>): [string, string] {
  const pk = c.get('userIdPK') || c.get('userId');
  const loginId = c.get('userLoginId') || pk;
  // 중복을 제거하지 않고 항상 두 값을 돌려준다 — 호출부의 SQL 이 `user_id IN (?, ?)` 처럼
  // 개수를 고정해 두고 있어서, 두 값이 같을 때 하나로 줄이면 바인딩 개수가 어긋난다.
  // 같은 값이 두 번 바인딩되는 건 무해하다(예전 [userPk, userId] 와 동일한 모양).
  return [pk, loginId];
}

/** IN 절 플레이스홀더 — 값 개수만큼 `?` 를 만든다(값은 반드시 args 로 바인딩). */
export function inPlaceholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}
