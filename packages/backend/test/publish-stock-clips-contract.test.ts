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

import { createSynthesisAttempts } from '../src/lib/voice-provider';
import { computeTtsCacheKey, generatedTtsObjectKey } from '../src/lib/audio-cache';
import { SYSTEM_VOICE_LIBRARY_USER_ID, withClosingBreath } from '../src/lib/stock-clips';

/** `scripts/publish-stock-clips.ts` 상단 상수와 **같은 값**이어야 한다. */
const SCRIPT_PROVIDER = 'elevenlabs';
const SCRIPT_MODEL_ID = 'eleven_v3';
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
  });

  it('여운 꼬리를 붙인 글자로 키를 만든다 — 원본으로 만들면 키가 갈라진다', async () => {
    const base = '[warmly] 좋은 아침이에요.';
    expect(withClosingBreath(base)).toBe(`${base} ...`);
    // 이미 말끝이 흐려져 있으면 덧붙이지 않는다(두 번 붙으면 또 다른 키가 된다).
    expect(withClosingBreath('아직 졸리죠...')).toBe('아직 졸리죠...');

    const keyOfRaw = await computeTtsCacheKey({
      provider: SCRIPT_PROVIDER,
      providerVoiceId: 'voice-1',
      voiceProfileId: 'profile-1',
      modelId: SCRIPT_MODEL_ID,
      language: 'ko',
      languageCode: 'ko',
      text: base,
      outputFormat: SCRIPT_OUTPUT_FORMAT,
    });
    const keyOfProviderText = await computeTtsCacheKey({
      provider: SCRIPT_PROVIDER,
      providerVoiceId: 'voice-1',
      voiceProfileId: 'profile-1',
      modelId: SCRIPT_MODEL_ID,
      language: 'ko',
      languageCode: 'ko',
      text: withClosingBreath(base),
      outputFormat: SCRIPT_OUTPUT_FORMAT,
    });
    // 둘이 달라야 한다 — 같으면 이 테스트가 지키려는 구분 자체가 없다는 뜻이다.
    expect(keyOfProviderText).not.toBe(keyOfRaw);
  });

  it('시스템 스톡의 오브젝트 키는 시스템 라이브러리 계정 아래에 놓인다', () => {
    const key = generatedTtsObjectKey(SYSTEM_VOICE_LIBRARY_USER_ID, 'a'.repeat(64), 'mp3');
    // 보관 스윕(`audio-retention`)과 파기 경로가 이 접두사로 오브젝트를 찾는다.
    expect(key).toBe(`generated-tts/${SYSTEM_VOICE_LIBRARY_USER_ID}/${'a'.repeat(64)}.mp3`);
  });
});
