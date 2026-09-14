/**
 * **PEM 개인키를 PKCS#8 바이트로.** 애플 쪽 세 경로가 같은 변환을 쓴다 —
 * APNs(`apns.ts`), App Store Server API(`apple-storekit.ts`), Sign in with Apple 연결
 * 해제(`apple-revoke.ts`).
 *
 * ⚠ **리터럴 `\n` 을 먼저 진짜 개행으로 바꾼다.** `.dev.vars` 와 wrangler secret 은
 * **줄 단위**로 파싱돼 여러 줄 값을 담을 수 없다(`scripts/sync-worker-secrets.ts` 가 여러
 * 줄 PEM 을 아예 거절한다). 그래서 PEM 은 한 줄에 `\n` 이스케이프로 넣는데, 이걸 안 풀면
 * 뒤의 공백 제거가 **백슬래시만 지우고 `n` 을 base64 본문에 남긴다** — `n` 도 base64
 * 문자라 조용히 망가진 키가 되거나 `atob` 이 통째로 던진다.
 *
 * ⚠ **여기 말고 다른 곳에 다시 쓰지 말 것**(2026-09-08 확인). 예전에는 이 함수가 세 벌
 * 있었고 **`apple-revoke.ts` 한 벌만** 이스케이프를 풀고 있었다. 그래서 실제 저장된 키로
 * 돌려 보면 APNs 와 결제 검증은 `atob` 에서 던지고 연결 해제만 살아 있었다 — 푸시와 애플
 * 결제 검증이 **조용히 죽는** 상태다. 진짜 개행 PEM 에는 무해하므로 두 형태 다 통과한다.
 */
export function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
