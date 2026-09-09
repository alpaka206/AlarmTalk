// **한 줄 `\n` 이스케이프 PEM 도 읽혀야 한다.**
//
// `.dev.vars` 와 wrangler secret 은 줄 단위로 파싱돼 여러 줄 값을 담을 수 없고,
// `scripts/sync-worker-secrets.ts` 는 여러 줄 PEM 을 **아예 거절**하며 한 줄 이스케이프
// 형태를 요구한다. 즉 실제 워커에 올라가는 형태는 언제나 이쪽이다.
//
// 2026-09-08 감사 전에는 `pemToPkcs8` 이 **세 벌** 있었고 `apple-revoke.ts` 한 벌만
// 이스케이프를 풀었다. 그래서 실제 저장된 키를 넣으면 APNs 와 애플 결제 검증은 `atob` 에서
// 던지고 연결 해제만 살아 있었다 — 푸시와 결제 검증이 **조용히 죽는** 상태다.
// 기존 테스트 9개가 못 잡은 이유는 전부 진짜 개행 PEM 을 썼기 때문이다.
import { describe, it, expect } from 'vitest';

import { pemToPkcs8 } from '../src/lib/pem';

// 값은 아무거나 좋다 — 길이 8의 base64(`AAECAwQFBgc=`)면 바이트로 풀린다.
const BODY = 'AAECAwQFBgc=';
const MULTILINE = `-----BEGIN PRIVATE KEY-----\n${BODY}\n-----END PRIVATE KEY-----\n`;
const ESCAPED = MULTILINE.replace(/\n/g, '\\n');

describe('pemToPkcs8', () => {
  it('진짜 개행 PEM 을 푼다', () => {
    expect(Array.from(pemToPkcs8(MULTILINE))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('한 줄 이스케이프 PEM 도 **같은 값**으로 푼다 — 워커에 올라가는 형태다', () => {
    expect(ESCAPED).not.toContain('\n');
    expect(Array.from(pemToPkcs8(ESCAPED))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('이스케이프를 안 풀면 던진다 — 이 테스트가 지키는 것이 그 회귀다', () => {
    const withoutUnescape = (pem: string) =>
      atob(
        pem
          .replace(/-----BEGIN [^-]+-----/g, '')
          .replace(/-----END [^-]+-----/g, '')
          .replace(/\s+/g, ''),
      );
    expect(() => withoutUnescape(ESCAPED)).toThrow();
  });
});
