// 애플 결제의 **계정 바인딩**. 구글은 `obfuscatedExternalAccountId` 로 처음부터 했는데
// 애플에는 없었다(2026-08-18 Codex #697 P1).
//
// 왜 필요한가: 애플은 **끝내지 않은 트랜잭션을 재전달**한다. 서버 확정에 실패한 채 같은
// 기기에서 다른 AlarmTalk 계정으로 로그인하면 그 트랜잭션이 새 세션의 토큰으로 다시
// 올라온다 — 대조할 값이 없으면 나중 계정이 구독·선물 바우처를 가져간다.
import { describe, it, expect } from 'vitest';

/// 라우트가 쓰는 판정과 **같은 식**이다(대소문자 무시 + 후보 여럿).
/// 라우트를 고치면 여기도 같이 고친다.
function matches(appAccountToken: string | undefined, candidates: (string | undefined)[]): boolean {
  const token = appAccountToken?.trim().toLowerCase();
  if (!token) return false;
  return candidates
    .map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : ''))
    .filter((v) => v.length > 0)
    .includes(token);
}

const OWNER = '3c059777-086f-4653-826e-bbbc92f85afd';
const OTHER = '66840fd2-51c4-475f-955c-9d8221f0ed6f';

describe('애플 결제 계정 바인딩', () => {
  it('구매자 본인은 통과한다', () => {
    expect(matches(OWNER, [undefined, OWNER, OWNER])).toBe(true);
  });

  it('다른 계정이 같은 트랜잭션을 올리면 막는다', () => {
    expect(matches(OWNER, [undefined, OTHER, OTHER])).toBe(false);
  });

  it('대소문자가 달라도 같은 계정으로 본다 — 애플이 UUID 를 대문자로 돌려준다', () => {
    expect(matches(OWNER.toUpperCase(), [OWNER])).toBe(true);
  });

  it('식별자가 없으면 통과시키지 않는다 — 최초 청구는 라우트가 거절한다', () => {
    expect(matches(undefined, [OWNER])).toBe(false);
    expect(matches('   ', [OWNER])).toBe(false);
  });

  it('후보가 비어 있어도 통과하지 않는다', () => {
    expect(matches(OWNER, [undefined, '', '  '])).toBe(false);
  });
});
