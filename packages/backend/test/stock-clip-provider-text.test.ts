// **스톡 클립은 저장하는 글자 그대로 합성하고, 합성 갈래가 돌려준 바이트를 그대로 올린다**(2026-09-30, eleven_v4_turbo).
//
// v3 시절에는 제공자에게 보내는 글자 끝에 ` ...`(여운 꼬리)를 붙이고 mp3 끝에 무음 0.366초를 덧댔다 — v3 가
// 마지막 음절 직후 뚝 끊었기 때문이다. v4 Turbo 는 꼬리 없이도 말끝을 스스로 놓아(끝 무음 0.14~0.29초,
// 끝/평균 세기 0.44 이하 — 스펙 §10) 둘 다 뺐다. 되살리면 합성 글자·캐시 키가 시청본 지문
// (`scripts/prerender-stock-preview.ts`)·게시 스크립트(`scripts/publish-stock-clips.ts`)와 갈라진다.
// 음량은 합성 갈래(`createSynthesisAttempts`)가 이미 올려 돌려준다(2026-10-08) — 여기서 다시 손대지 않고, 그 값은
// 캐시 키에 든다.
import { describe, it, expect, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const stored: Uint8Array[] = [];
const synthesizedTexts: string[] = [];
const SYNTH_BYTES = new Uint8Array([0xff, 0xfb, 0x90, 0x44, 1, 2, 3]);

vi.mock('../src/lib/r2-storage', () => ({
  R2VoiceStorage: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.storeAtKey = vi.fn().mockImplementation(async (_key: string, input: { bytes: Uint8Array }) => {
      stored.push(input.bytes);
    });
    this.delete = vi.fn();
  }),
}));

vi.mock('../src/lib/voice-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/voice-provider')>()),
  createSynthesisAttempts: ({ profile, text }: { profile: { elevenlabs_voice_id: string }; text: string }) => {
    synthesizedTexts.push(text);
    return [
      {
        provider: 'elevenlabs',
        providerVoiceId: profile.elevenlabs_voice_id,
        modelId: 'eleven_v4_turbo',
        outputFormat: 'mp3',
        pitchSemitones: 0,
        loudnessBoostDb: TTS_LOUDNESS_BOOST_DB,
        synthesize: async () => ({
          bytes: SYNTH_BYTES,
          mimeType: 'audio/mpeg',
          outputFormat: 'mp3',
          provider: 'elevenlabs',
          providerVoiceId: profile.elevenlabs_voice_id,
          modelId: 'eleven_v4_turbo',
        }),
      },
    ];
  },
}));

import { generateStockClip } from '../src/lib/stock-clips';
import { computeTtsCacheKey } from '../src/lib/audio-cache';
import { TTS_LOUDNESS_BOOST_DB } from '../src/lib/tts-model';

describe('generateStockClip — 합성 글자와 바이트를 가공하지 않는다', () => {
  it('시스템 스톡 문구를 trim 한 글자 그대로 합성하고, 그 글자로 키를 만들며, 바이트를 그대로 올린다', async () => {
    const path = join(tmpdir(), `alarmtalk-provider-text-${crypto.randomUUID()}.db`);
    const db = createClient({ url: `file:${path}` });
    try {
      await db.executeMultiple(`
        CREATE TABLE voice_profiles (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT, elevenlabs_voice_id TEXT,
          status TEXT DEFAULT 'ready', is_system INTEGER DEFAULT 1, is_draft INTEGER DEFAULT 0,
          deleted_at TEXT
        );
        CREATE TABLE messages (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, voice_profile_id TEXT NOT NULL,
          text TEXT, synthesis_text TEXT, delivery_tags_json TEXT, category TEXT, language TEXT,
          variant INTEGER DEFAULT 0, is_preset INTEGER DEFAULT 0, audio_url TEXT, retired_at TEXT
        );
        CREATE TABLE voice_prerender_queue (
          voice_profile_id TEXT PRIMARY KEY, owner_user_id TEXT, status TEXT, claim_token TEXT
        );
        CREATE TABLE generated_audio_assets (
          id TEXT PRIMARY KEY, user_id TEXT, voice_profile_id TEXT, message_id TEXT,
          provider TEXT, provider_voice_id TEXT, model_id TEXT, language TEXT,
          request_hash TEXT UNIQUE, text TEXT, audio_url TEXT, audio_object_key TEXT,
          audio_format TEXT, created_at TEXT
        );
        CREATE TABLE pending_external_deletions (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, ref TEXT NOT NULL, created_at TEXT,
      UNIQUE(kind, ref)
        );
        INSERT INTO voice_profiles (id, user_id, name, elevenlabs_voice_id)
          VALUES ('sys-1', '70000000-0000-4000-9000-000000000001', '미나', 'el-mina');
      `);

      const clip = await generateStockClip(db, { VOICE_BUCKET: {}, ELEVENLABS_API_KEY: 'k' } as never, {
        voiceProfileId: 'sys-1',
        voiceName: '미나',
        elevenlabsVoiceId: 'el-mina',
        ownerUserId: '70000000-0000-4000-9000-000000000001',
        category: 'medication',
        baseText: '  약 먹을 시간이에요. 지금 바로 챙겨 먹어요?  ',
        language: 'ko',
        variantIndex: 0,
        toneAdapt: false,
      });

      const text = '약 먹을 시간이에요. 지금 바로 챙겨 먹어요?';
      // 여운 꼬리(` ...`) 없이 저장하는 글자 그대로 보낸다.
      expect(synthesizedTexts).toEqual([text]);
      // 끝 무음을 덧대지 않는다 — 받은 바이트 그대로다.
      expect(stored).toHaveLength(1);
      expect([...stored[0]!]).toEqual([...SYNTH_BYTES]);

      const row = (await db.execute('SELECT text, synthesis_text, audio_url FROM messages')).rows[0]!;
      expect(clip.text).toBe(text);
      expect(row.synthesis_text).toBe(text);
      const ledger = (await db.execute('SELECT request_hash, model_id FROM generated_audio_assets')).rows[0]!;
      expect(ledger.model_id).toBe('eleven_v4_turbo');
      // 키는 합성한 그 글자와 합성 갈래가 올린 음량으로 — 게시 스크립트가 같은 식으로 계산한다.
      const keyInput = {
        provider: 'elevenlabs',
        providerVoiceId: 'el-mina',
        voiceProfileId: 'sys-1',
        modelId: 'eleven_v4_turbo',
        language: 'ko',
        languageCode: 'ko',
        text,
        outputFormat: 'mp3',
        scope: 'stock',
      };
      expect(ledger.request_hash).toBe(
        await computeTtsCacheKey({ ...keyInput, loudnessBoostDb: TTS_LOUDNESS_BOOST_DB }),
      );
      expect(ledger.request_hash).not.toBe(await computeTtsCacheKey(keyInput));
    } finally {
      db.close();
      for (const suffix of ['', '-shm', '-wal']) rmSync(`${path}${suffix}`, { force: true });
    }
  });
});
