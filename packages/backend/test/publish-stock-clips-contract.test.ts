// `scripts/publish-stock-clips.ts` 가 **하드코딩한 값**이 서버와 갈라지지 않게 고정한다.
//
// 그 스크립트는 미리 구워 둔 클립을 R2·DB 에 올리면서 **서버가 계산할 것과 같은 키**를
// 만들어야 한다(`computeTtsCacheKey` 의 provider·modelId·outputFormat). 하나라도 어긋나면
// 키가 달라져 `findMissingStockTargets` 가 그 자리를 '없다' 로 세고, cron 이 같은 클립을
// 다시 굽는다 — 미리 굽기로 없앤 배포 직후 공백과 삭제 경합이 통째로 되살아난다.
//
// 스크립트는 top-level `await main()` 이라 import 할 수 없어서, **의존하는 값**을 여기서
// 서버 쪽 단일 출처와 대조한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createSynthesisAttempts } from '../src/lib/voice-provider';
import { TTS_MODEL_ID } from '../src/lib/tts-model';
import { computeTtsCacheKey, generatedTtsObjectKey } from '../src/lib/audio-cache';
import { SYSTEM_VOICE_LIBRARY_USER_ID } from '../src/lib/stock-clips';

/** `scripts/publish-stock-clips.ts` 상단 상수와 **같은 값**이어야 한다. 모델은 서버 상수를 import 한다. */
const SCRIPT_PROVIDER = 'elevenlabs';
const SCRIPT_MODEL_ID = TTS_MODEL_ID;
const SCRIPT_OUTPUT_FORMAT = 'mp3';

describe('publish-stock-clips 가 의존하는 서버 계약', () => {
  it('provider·modelId·outputFormat 이 실제 합성 경로와 같다', () => {
    const attempts = createSynthesisAttempts({
      env: { ELEVENLABS_API_KEY: 'test-key' } as never,
      profile: { elevenlabs_voice_id: 'voice-1' } as never,
      text: '테스트',
      language: 'ko',
    });
    expect(attempts).toHaveLength(1);
    const attempt = attempts[0]!;
    // 이 셋이 캐시 키에 그대로 들어간다 — 스크립트가 다른 값을 쓰면 키가 갈라진다.
    expect(attempt.provider).toBe(SCRIPT_PROVIDER);
    expect(attempt.modelId).toBe(SCRIPT_MODEL_ID);
    expect(attempt.outputFormat).toBe(SCRIPT_OUTPUT_FORMAT);
    expect(attempt.modelId).toBe('eleven_v4_turbo');
  });

  it('스톡 스크립트는 모델 id 를 직접 적지 않는다 — 서버 상수(`TTS_MODEL_ID`)를 가져다 쓴다', () => {
    // 예전에는 두 스크립트가 `'eleven_v3'` 를 박아 두어, 서버 모델을 바꾸면 시청본·게시 키가 옛 모델로 남았다.
    for (const script of ['publish-stock-clips.ts', 'prerender-stock-preview.ts']) {
      const source = readFileSync(join(__dirname, '..', 'scripts', script), 'utf-8');
      expect(source, script).not.toMatch(/['"]eleven_[a-z0-9_]+['"]/);
      expect(source, script).toMatch(/TTS_MODEL_ID/);
      expect(source, script).toMatch(/TTS_VOICE_SETTINGS/);
    }
  });

  it('시스템 스톡의 오브젝트 키는 시스템 라이브러리 계정 아래에 놓인다', () => {
    const key = generatedTtsObjectKey(SYSTEM_VOICE_LIBRARY_USER_ID, 'a'.repeat(64), 'mp3');
    // 보관 스윕(`audio-retention`)과 파기 경로가 이 접두사로 오브젝트를 찾는다.
    expect(key).toBe(`generated-tts/${SYSTEM_VOICE_LIBRARY_USER_ID}/${'a'.repeat(64)}.mp3`);
  });
});
