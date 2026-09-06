import type { DbExecutor } from './transactions';

/**
 * **구매-계정 바인딩** — 이 purchaseToken 이 정말 이 계정의 결제인가.
 *
 * 계약(Android `PlayBillingManager` 와 공유): 클라는 구매할 때
 * `setObfuscatedAccountId(sha256hex(로그인 사용자 id))` 를 실어 보낸다. 그래서 Play 응답의
 * `externalAccountIdentifiers.obfuscatedExternalAccountId` 를 우리 쪽 id 해시와 대조하면
 * "이 결제의 주인" 을 알 수 있다.
 *
 * ⚠ **이 대조가 사는 곳은 여기 하나다.** 예전에는 confirm(`billing-google.ts`)만 하고
 * RTDN 의 linked 갈래(`billing-google-rtdn.ts`)는 하지 않아, 옛 토큰의 주인을 **검증 없이
 * 물려받았다**. `linkedPurchaseToken` 은 업/다운그레이드뿐 아니라 **해지했지만 만료 전인
 * 구독의 재가입**에도 실려 오는데, 그건 같은 구글 계정이면 되고 **같은 AlarmTalk 계정이라는
 * 보장이 없다** — 돈 낸 사람이 영구 409 로 막히고 안 낸 계정이 이용권을 받았다.
 * 검증 규칙이 경로마다 갈리면 **가장 느슨한 경로가 실질 규칙**이 된다.
 */

/** Workers 런타임(crypto.subtle) SHA-256 → 소문자 hex 64자. 계정 바인딩 대조용. */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 식별자가 후보 id 중 하나의 해시와 같은가.
 *
 * 후보를 여럿 받는 이유: 클라는 **구매 시점 세션의 로그인 id(JWT sub)** 를 해시해 넣는데,
 * `userId` 는 이후 `users.id` 로 정규화됐다. 구 토큰으로 결제한 사용자를 위해 둘 다 본다.
 */
export async function purchaseAccountMatches(
  obfuscatedId: string,
  candidateIds: (string | null | undefined)[],
): Promise<boolean> {
  const unique = Array.from(new Set(candidateIds.filter((id): id is string => Boolean(id))));
  if (unique.length === 0) return false;
  const hashes = await Promise.all(unique.map((id) => sha256Hex(id)));
  return hashes.includes(obfuscatedId.trim().toLowerCase());
}

/**
 * 이 결제가 `userPk` 의 것인가 — **서버 단독 경로(RTDN)** 용.
 *
 * ⚠ **식별자가 없으면 `false`(fail-closed).** confirm 은 호출자가 로그인해 있어서
 * "식별자 없는 최초 클레임" 을 403 으로 **되돌려 줄 수** 있지만, RTDN 은 알려 줄 사람이
 * 없다. 여기서 관대하게 통과시키면 틀린 주인에게 영구 바인딩되고 되돌릴 길이 없다 —
 * 흘려보내면 클라 confirm 이 제 계정으로 올바르게 바인딩한다.
 */
export async function purchaseBelongsToUser(
  db: DbExecutor,
  obfuscatedId: string | null | undefined,
  userPk: string,
): Promise<boolean> {
  if (!obfuscatedId) return false;
  // 로그인 id(google_id = JWT sub 후보)도 함께 본다 — confirm 과 같은 후보 집합이다.
  const res = await db.execute({
    sql: `SELECT google_id FROM users WHERE id = ? LIMIT 1`,
    args: [userPk],
  });
  const loginId = res.rows.length > 0 ? ((res.rows[0]!.google_id as string | null) ?? null) : null;
  return purchaseAccountMatches(obfuscatedId, [userPk, loginId]);
}
