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
    // ⚠ 여기 `mime_type` 이 있었는데 **#108 이 지웠다** — 캐시 히트마다 SELECT 해 놓고
    //   반환 객체에 넣지 않는 컬럼이었다. 아래 「#108」 블록이 사라짐을 확인한다.
    expect(assetColumns).toEqual(expect.arrayContaining(['audio_object_key', 'text']));
  });

  // #108 도 되돌릴 수 없는 정리라 같은 방식으로 확인한다.
  // 「지운다」와 「지운 줄 알았다」를 가르는 건 이 스키마 확인뿐이다.
  it('#108 — 아무도 읽지 않던 컬럼·인덱스가 사라진다', async () => {
    const db = createClient({ url: ':memory:' });
    await runMigrations(db);

    const assetColumns = (await db.execute('PRAGMA table_info(generated_audio_assets)')).rows.map(
      (row) => String(row.name),
    );
    // SELECT 는 했지만 반환 객체에 넣지 않던 컬럼. audio_format 으로 재구성 가능하다.
    expect(assetColumns).not.toContain('mime_type');
    // 같은 테이블에서 실제로 읽는 컬럼은 남아 있어야 한다.
    expect(assetColumns).toEqual(expect.arrayContaining(['audio_object_key', 'audio_format', 'text']));

    const indexes = (
      await db.execute(`SELECT name FROM sqlite_master WHERE type = 'index'`)
    ).rows.map((row) => String(row.name));
    // LRU 인덱스: ORDER BY 선행항이 표현식이라 애초에 안 걸렸다.
    expect(indexes).not.toContain('idx_voice_profiles_lru');
    // status 가 선행 술어인 쿼리가 0건이었다.
    expect(indexes).not.toContain('idx_voucher_codes_status');
    // 실제로 거르는 술어(issuer_user_id · issuer_subscription_id)의 인덱스는 남아야 한다.
    expect(indexes).toEqual(
      expect.arrayContaining(['idx_voucher_codes_issuer', 'idx_voucher_codes_issuer_subscription']),
    );
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
