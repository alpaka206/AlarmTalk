import { describe, it, expect } from 'vitest';
import { createClient } from '@libsql/client';
import { runMigrations } from '../src/lib/migrations';

// #89/#90 은 되돌릴 수 없는 정리라, "정말 사라졌는가" 를 스키마로 직접 확인한다.
// 러너가 DROP 실패를 삼키던 시절에는 마이그레이션이 성공으로 찍혀도 컬럼이 남을 수 있었다.
describe('#89·#90 — 사장 인덱스·컬럼이 실제로 사라진다', () => {
  it('컬럼이 스키마에서 사라지고, 이름이 비슷한 살아 있는 컬럼은 남는다', async () => {
    const db = createClient({ url: ':memory:' });
    await runMigrations(db);

    const columnsOf = async (table: string) => {
      const res = await db.execute(`PRAGMA table_info(${table})`);
      return res.rows.map((row) => String(row.name));
    };

    expect(await columnsOf('voice_profile_change_ledger')).not.toContain('voice_profile_id');
    const libraryColumns = await columnsOf('message_library');
    expect(libraryColumns).not.toContain('is_favorite');
    expect(libraryColumns).not.toContain('received_at');
    const assetColumns = await columnsOf('generated_audio_assets');
    for (const dropped of ['category', 'size_bytes', 'original_text', 'delivery_tags_json']) {
      expect(assetColumns).not.toContain(dropped);
    }
    expect(await columnsOf('promo_code_redemptions')).not.toContain('subscription_id');

    // 같은 이름의 messages.delivery_tags_json 은 실제로 읽는 컬럼이라 살아 있어야 한다.
    expect(await columnsOf('messages')).toContain('delivery_tags_json');
    // 읽는 컬럼들도 그대로인지 한 번 더.
    expect(assetColumns).toEqual(expect.arrayContaining(['audio_object_key', 'mime_type', 'text']));
  });

  it('중복·무용 인덱스가 사라지고 빠져 있던 인덱스가 생긴다', async () => {
    const db = createClient({ url: ':memory:' });
    await runMigrations(db);
    const res = await db.execute(`SELECT name FROM sqlite_master WHERE type = 'index'`);
    const names = res.rows.map((row) => String(row.name));

    for (const dropped of [
      'idx_users_email',
      'idx_plans_key',
      'idx_voucher_codes_hash',
      'idx_plan_group_members_group',
      'idx_promo_redemptions_code',
      'idx_voucher_redemptions_voucher',
      'idx_voice_profiles_user',
      'idx_voice_profile_relationships_user',
      'idx_push_tokens_user',
      'idx_messages_stock',
      'idx_voice_profiles_is_draft',
      'idx_alarms_bucket',
      'idx_voice_profile_change_ledger_profile',
    ]) {
      expect(names).not.toContain(dropped);
    }
    expect(names).toContain('idx_store_transactions_subscription');
  });
});
