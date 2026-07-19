/**
 * 상수시간 문자열 비교 — 타이밍 오라클로 시크릿(토큰/시크릿 헤더)을 추정하는 것을 막는다.
 * 길이가 다르면 즉시 false(길이 자체는 비밀이 아니라고 가정).
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i]! ^ bb[i]!;
  return diff === 0;
}
