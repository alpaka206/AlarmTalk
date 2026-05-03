import { describe, expect, it } from 'vitest';
import { migrations } from '../src/lib/migrations';

describe('generated audio cache migration', () => {
  it('adds deterministic generated audio cache storage', () => {
    const migration = migrations.find((m) => m.id === 24);
    expect(migration).toBeDefined();
    const sql = migration!.statements.join('\n');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS generated_audio_assets');
    expect(sql).toContain('request_hash TEXT NOT NULL');
    expect(sql).toContain('message_id TEXT NOT NULL');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_audio_assets_request');
    expect(sql).toContain('idx_generated_audio_assets_user');
    expect(sql).toContain('idx_generated_audio_assets_voice');
  });
});
