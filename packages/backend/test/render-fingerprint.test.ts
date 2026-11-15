import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { computeTtsCacheKey, STOCK_TTS_CACHE_SCOPE } from '../src/lib/audio-cache';
import {
  BASELINE_RENDER_EXTRAS,
  canonicalJson,
  currentRenderExtras,
  currentRenderRevision,
  manualResultLogicalKey,
  renderExtrasCacheKeyPart,
  renderFingerprint,
  renderRevision,
  serverRenderSettings,
  stockPublishRenderSettings,
  type RenderSettings,
} from '../src/lib/render-fingerprint';
import { ELEVENLABS_TTS_OUTPUT_FORMAT } from '../src/lib/elevenlabs';
import { TTS_FINAL_AUDIO_FORMAT, TTS_LOUDNESS_BOOST_DB, TTS_VOICE_SETTINGS } from '../src/lib/tts-model';

// 렌더 지문(`docs/spec/tts-render-and-budget.md` §1) — 설정이 바뀌면 지문이 바뀌고, 지금 설정은 캐시 키를 바꾸지 않는다.

const BASE_KEY_INPUT = {
  provider: 'elevenlabs',
  providerVoiceId: 'el-voice-1',
  voiceProfileId: 'vp-1',
  modelId: 'eleven_v4_turbo',
  language: 'ko',
  languageCode: 'ko',
  text: '일어날 시간이야',
  outputFormat: 'mp3',
  scope: 'manual:user-1',
  loudnessBoostDb: 4,
};

describe('캐시 키 — 지문을 들여도 쌓인 캐시를 버리지 않는다', () => {
  it('지금 설정의 키는 지문 이전 공식과 한 글자도 같다', async () => {
    // 지문 이전(2026-10-26 전) 공식을 그대로 다시 쓴다 — 부가 설정 칸이 없던 JSON.
    const legacy = createHash('sha256')
      .update(
        JSON.stringify({
          provider: BASE_KEY_INPUT.provider,
          providerVoiceId: BASE_KEY_INPUT.providerVoiceId,
          voiceProfileId: BASE_KEY_INPUT.voiceProfileId,
          modelId: BASE_KEY_INPUT.modelId,
          language: BASE_KEY_INPUT.language,
          languageCode: BASE_KEY_INPUT.languageCode,
          text: BASE_KEY_INPUT.text,
          outputFormat: BASE_KEY_INPUT.outputFormat,
          scope: BASE_KEY_INPUT.scope,
          loudnessBoostDb: BASE_KEY_INPUT.loudnessBoostDb,
        }),
      )
      .digest('hex');
    expect(await computeTtsCacheKey(BASE_KEY_INPUT)).toBe(legacy);
    expect(await computeTtsCacheKey({ ...BASE_KEY_INPUT, scope: STOCK_TTS_CACHE_SCOPE })).not.toBe(legacy);
  });

  it('지금 코드의 부가 설정은 기준값이다 — 기준값이면 키 조각이 없다', async () => {
    expect(canonicalJson(currentRenderExtras())).toBe(canonicalJson(BASELINE_RENDER_EXTRAS));
    expect(await renderExtrasCacheKeyPart(currentRenderExtras())).toBeUndefined();
  });

  it('기준값은 2026-10-26 값 그대로다 — 고치면 모든 키가 한꺼번에 갈린다', () => {
    expect(BASELINE_RENDER_EXTRAS).toEqual({
      voiceSettings: { stability: 0.5, similarity_boost: 0.8 },
      textNormalizationVersion: 1,
      postprocessVersion: 1,
      finalFormat: 'mp3_44100_128',
    });
  });

  it('합성 옵션·글자 규칙·후처리·최종 형식을 바꾸면 키가 갈린다(예전에는 합성 옵션이 키에 없었다)', async () => {
    const base = await computeTtsCacheKey(BASE_KEY_INPUT);
    const variants = [
      { ...BASELINE_RENDER_EXTRAS, voiceSettings: { stability: 0.4, similarity_boost: 0.8 } },
      { ...BASELINE_RENDER_EXTRAS, textNormalizationVersion: 2 },
      { ...BASELINE_RENDER_EXTRAS, postprocessVersion: 2 },
      { ...BASELINE_RENDER_EXTRAS, finalFormat: 'mp3_44100_192' },
    ];
    const keys = await Promise.all(variants.map((renderExtras) => computeTtsCacheKey({ ...BASE_KEY_INPUT, renderExtras })));
    for (const key of keys) expect(key).not.toBe(base);
    expect(new Set(keys).size).toBe(keys.length);
    // 기준값을 명시해도 예전 키 그대로다.
    expect(await computeTtsCacheKey({ ...BASE_KEY_INPUT, renderExtras: BASELINE_RENDER_EXTRAS })).toBe(base);
  });

  it('최종 형식은 굽지 않는 갈래의 제공자 형식과 같다', () => {
    expect(TTS_FINAL_AUDIO_FORMAT).toBe(ELEVENLABS_TTS_OUTPUT_FORMAT);
    expect(currentRenderExtras().voiceSettings).toEqual(TTS_VOICE_SETTINGS);
  });
});

describe('렌더 지문과 전역 세대', () => {
  const settings: RenderSettings = serverRenderSettings({
    provider: 'elevenlabs',
    providerVoiceId: 'el-voice-1',
    language: 'ko',
    pitchSemitones: 0,
    loudnessBoostDb: TTS_LOUDNESS_BOOST_DB,
  });

  it('결과에 영향을 주는 값이 하나라도 바뀌면 지문이 바뀐다', async () => {
    const base = await renderFingerprint(settings);
    const changes: Partial<RenderSettings>[] = [
      { provider: 'other' },
      { modelId: 'eleven_v5' },
      { providerVoiceId: 'el-voice-2' },
      { language: 'en' },
      { voiceSettings: { stability: 0.6, similarity_boost: 0.8 } },
      { textNormalizationVersion: 2 },
      { postprocessVersion: 2 },
      { pitchSemitones: -1.5 },
      { loudnessBoostDb: 5 },
      { finalFormat: 'mp3_44100_192' },
      { pipeline: 'provider_mp3' },
    ];
    const prints = await Promise.all(changes.map((change) => renderFingerprint({ ...settings, ...change })));
    for (const print of prints) expect(print).not.toBe(base);
    expect(new Set([base, ...prints]).size).toBe(prints.length + 1);
    expect(base).toMatch(/^rf1-[0-9a-f]{32}$/);
  });

  it('전역 세대는 목소리·언어·높이·굽는 길과 무관하다 — 서버 합성과 게시본이 같은 세대다', async () => {
    const revision = await renderRevision(settings);
    expect(await renderRevision({ ...settings, providerVoiceId: 'x', language: 'ja', pitchSemitones: 2 })).toBe(revision);
    expect(
      await renderRevision(stockPublishRenderSettings({ provider: 'elevenlabs', providerVoiceId: 'x', language: 'en' })),
    ).toBe(revision);
    expect(await currentRenderRevision()).toBe(revision);
    expect(await renderRevision({ ...settings, loudnessBoostDb: 5 })).not.toBe(revision);
    expect(await renderRevision({ ...settings, modelId: 'eleven_v5' })).not.toBe(revision);
  });

  it('높이도 음량도 없으면 제공자 MP3 그대로라 굽는 길이 다르다', () => {
    expect(settings.pipeline).toBe('pcm_44100>bake>mp3_128');
    expect(
      serverRenderSettings({ provider: 'elevenlabs', providerVoiceId: 'v', language: 'ko', pitchSemitones: 0, loudnessBoostDb: 0 })
        .pipeline,
    ).toBe('provider_mp3');
  });
});

describe('직접 입력의 논리 결과 키', () => {
  const parts = {
    userPk: 'user-1',
    voiceProfileId: 'vp-1',
    voiceGeneration: '',
    language: 'ko',
    translate: false,
    text: '일어날 시간이야',
  };

  it('사용자가 고른 것이 바뀔 때만 바뀐다 — 렌더 설정은 들어가지 않는다', async () => {
    const base = await manualResultLogicalKey(parts);
    expect(await manualResultLogicalKey({ ...parts })).toBe(base);
    const changed = await Promise.all([
      manualResultLogicalKey({ ...parts, userPk: 'user-2' }),
      manualResultLogicalKey({ ...parts, voiceProfileId: 'vp-2' }),
      // 제자리 교체(녹음을 갈았다) — 새 목소리라 새 결과다.
      manualResultLogicalKey({ ...parts, voiceGeneration: '2026-10-26 00:00:00' }),
      manualResultLogicalKey({ ...parts, language: 'en' }),
      manualResultLogicalKey({ ...parts, translate: true }),
      manualResultLogicalKey({ ...parts, text: '일어날 시간이야 ' }),
    ]);
    for (const key of changed) expect(key).not.toBe(base);
    expect(base).toMatch(/^lk1-[0-9a-f]{32}$/);
  });
});
