// **cron 은 시스템 스톡을 굽지 않는다** — 주석·스펙·런북이 전부 그렇게 적고 있고,
// 코드가 그걸 지켜야 한다.
//
// 2026-09-08 감사에서 `migrations.ts` 의 #110·#111 주석이 "cron 이 틱마다 빠진 시스템
// 스톡을 채운다(`scheduled.stock_seed`)" 고 적고 있었다. 그 드레인은 2026-09-03 리뷰
// 15차에 껐고, 그 자리를 채우는 것은 사람이 돌리는 `npm run publish:stock` 뿐이다.
// 주석만 고치면 다음에 드레인을 되살릴 때 같은 거짓말이 되살아나므로 코드 쪽에 그물을 둔다.
//
// 되살릴 거라면 순서가 있다: 먼저 게시가 렌더 산출물을 **덮어쓰도록** 고치고
// (`docs/spec/voice-and-message.md` §5-3), 그 다음 이 테스트와 #110·#111 주석,
// `docs/qa/dev-test-handoff.md` §0-A 를 **같이** 고친다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

const ROOT = join(__dirname, '../../..');
const INDEX = readFileSync(join(__dirname, '../src/index.ts'), 'utf-8');

/** cron 진입점(`scheduled`)의 본문만 본다 — HTTP 관리자 수동 도구는 대상이 아니다. */
function scheduledBody(): string {
  const start = INDEX.indexOf('async function scheduled(');
  expect(start).toBeGreaterThan(-1);
  const end = INDEX.indexOf('\nexport default {', start);
  expect(end).toBeGreaterThan(start);
  return INDEX.slice(start, end);
}

describe('cron 은 시스템 스톡을 굽지 않는다', () => {
  it('scheduled 가 시스템 스톡 시딩을 부르지 않는다', () => {
    const body = scheduledBody();
    // 클론 사전렌더 드레인은 그대로 산다 — 큐가 지목한 목소리만 굽고, 미리 구울 수 없다.
    expect(body).toContain('runPrerenderBatch');
    for (const banned of ['findMissingStockTargets', 'generateStockClip', 'deleteAllStockClips']) {
      expect(body).not.toContain(banned);
    }
  });

  it('없는 이름(`scheduled.stock_seed`)을 아무도 근거로 대지 않는다', () => {
    const sources = [
      join(__dirname, '../src/index.ts'),
      join(__dirname, '../src/lib/migrations.ts'),
      join(ROOT, 'docs/spec/voice-and-message.md'),
      join(ROOT, 'docs/qa/dev-test-handoff.md'),
    ];
    // ⚠ 그 이름을 **부르는 것** 자체는 막지 않는다 — "예전에는 그렇게 적혀 있었다" 는
    //   경고가 그 이름을 인용해야 다음 사람이 같은 거짓말을 알아본다. 잡을 것은 그 이름을
    //   **지금도 도는 것처럼** 대는 줄이다. 그래서 같은 줄에 '없'·'껐'·'예전' 같은 부정
    //   표지가 있으면 통과시킨다.
    const RETRACTED = /없|껐|예전|옛|아니/;
    for (const source of sources) {
      const offenders = readFileSync(source, 'utf-8')
        .split('\n')
        .filter((line) => line.includes('stock_seed') && !RETRACTED.test(line));
      expect(offenders, `${source} 에 없는 심볼을 근거로 대는 줄이 있다`).toEqual([]);
    }
  });
});
