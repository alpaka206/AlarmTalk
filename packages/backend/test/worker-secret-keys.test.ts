import { describe, expect, it } from 'vitest';
import { DEV_ONLY_SECRET_KEYS, WORKER_SECRET_KEYS, selectWorkerSecrets } from '../scripts/worker-secret-keys';

// 시크릿 동기화(`scripts/sync-worker-secrets.ts`)가 **무엇을 올리는가** — 목록에 있는 키만, 빈 값은 건너뛴다. dev 전용 키는
// production 파일에 값이 있으면 동기화 자체를 거절한다(운영 요청을 dev 의 숫자로 막지 않게).
describe('selectWorkerSecrets', () => {
  it('목록에 없는 키는 올리지 않는다 — 지운 키가 .dev.vars 에 남아 있어도 조용히 빠진다', () => {
    expect(selectWorkerSecrets('production', { JWT_SECRET: 's', RETIRED_SWITCH: 'x', SENTRY_DSN: ' ' })).toEqual({
      JWT_SECRET: 's',
    });
  });

  it('dev 전용 키는 dev 에만 올리고, production 파일에 있으면 거절한다', () => {
    expect(DEV_ONLY_SECRET_KEYS as readonly string[]).toContain('TTS_DEV_MONTHLY_CHAR_BUDGET');
    for (const key of DEV_ONLY_SECRET_KEYS) {
      expect(WORKER_SECRET_KEYS as readonly string[]).not.toContain(key);
    }
    expect(selectWorkerSecrets('dev', { TTS_DEV_MONTHLY_CHAR_BUDGET: '1000' })).toEqual({
      TTS_DEV_MONTHLY_CHAR_BUDGET: '1000',
    });
    expect(() => selectWorkerSecrets('production', { TTS_DEV_MONTHLY_CHAR_BUDGET: '1000' })).toThrow(
      /TTS_DEV_MONTHLY_CHAR_BUDGET/,
    );
  });
});
