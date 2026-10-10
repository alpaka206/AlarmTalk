// 계정 설정의 날씨 지역(`dynamic_prompt_settings.weather.region`) — `lib/dynamic-prompt-settings.ts`.
// 규칙: `docs/spec/voice-and-message.md` 5-1 「날씨 지역은 목록에서만 고른다」.
//
//  - 알맞은 region → 옛 앱이 읽는 country/city 를 **한국어 글자로 덮는다**.
//  - 모르는 region → **그 칸만 버린다** — PATCH 전체를 400 으로 거절하지 않는다(운세가 같은 payload 다).
//  - region 없이 옛 글자만 → 되짚어 region 을 채운다. 읽을 때도 같은 함수(쓰지는 않는다).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();
vi.mock('../src/lib/db', () => ({ getDB: () => mockDB.client }));

import userRoutes from '../src/routes/user';
import {
  dynamicPromptSettingsFromRow,
  dynamicPromptSettingsState,
  EMPTY_DYNAMIC_PROMPT_SETTINGS,
  validateDynamicPromptSettings,
} from '../src/lib/dynamic-prompt-settings';

const FORTUNE = { gender: '여성', birth_date: '1995-05-20', birth_time: '07:30' };

function patch(settings: unknown) {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware('user-1'));
  app.route('/user', userRoutes);
  return app.request(jsonReq('PATCH', '/user/me', { dynamic_prompt_settings: settings }));
}

function storedSettings() {
  const update = mockDB.calls.find((c) => c.sql.includes('dynamic_prompt_settings_json = ?'));
  return JSON.parse(String(update!.args[0]));
}

beforeEach(() => mockDB.reset());

describe('PATCH /user/me — 날씨 지역', () => {
  it('모르는 region 이어도 200 이고 운세는 저장된다 — 그 칸만 버린다', async () => {
    mockDB.pushResult([], 1);

    const res = await patch({ weather: { region: 'kr-atlantis', country: null, city: null }, fortune: FORTUNE });

    expect(res.status).toBe(200);
    const stored = storedSettings();
    expect(stored.fortune).toEqual(FORTUNE);
    expect(stored.weather).toEqual({ region: null, country: null, city: null });
    expect((await res.json()).dynamic_prompt_settings).toEqual(stored);
  });

  it('모르는 region + 되짚히는 옛 글자면 글자로 되짚는다', async () => {
    mockDB.pushResult([], 1);
    await patch({ weather: { region: 'jp-nowhere', country: '대한민국', city: '제주' }, fortune: FORTUNE });
    expect(storedSettings().weather).toEqual({ region: 'kr-jeju', country: '대한민국', city: '제주' });
  });

  it('알맞은 region 이면 country/city 를 옛 앱용 한국어 글자로 덮는다(보낸 글자가 번역 이름이어도)', async () => {
    mockDB.pushResult([], 1);

    const res = await patch({ weather: { region: 'jp-aichi', country: 'Japan', city: 'Aichi' }, fortune: FORTUNE });

    expect(res.status).toBe(200);
    expect(storedSettings().weather).toEqual({ region: 'jp-aichi', country: '일본', city: '아이치' });
  });

  it('region 없이 옛 글자만 보내는 옛 앱 — 글자는 그대로, region 은 되짚어 채운다(수원 → 경기)', async () => {
    mockDB.pushResult([], 1);
    await patch({ weather: { country: '대한민국', city: '수원' }, fortune: FORTUNE });
    expect(storedSettings().weather).toEqual({ region: 'kr-gyeonggi', country: '대한민국', city: '수원' });
  });

  it('되짚지 못하는 옛 글자는 region null 로 그대로 둔다(엄격한 옛 경로에 맡긴다)', async () => {
    mockDB.pushResult([], 1);
    await patch({ weather: { country: '대한민국', city: '속초' }, fortune: FORTUNE });
    expect(storedSettings().weather).toEqual({ region: null, country: '대한민국', city: '속초' });
  });

  it('region 이 문자열이 아니거나 너무 길어도 400 이 아니다', async () => {
    for (const region of [123, { a: 1 }, 'kr-'.repeat(100)]) {
      mockDB.reset();
      mockDB.pushResult([], 1);
      const res = await patch({ weather: { region, country: null, city: '서울' }, fortune: FORTUNE });
      expect(res.status).toBe(200);
      expect(storedSettings().weather.region).toBe('kr-seoul');
    }
  });

  it('운세가 틀리면 예전처럼 400 이다 — 날씨 규칙이 운세 검증을 느슨하게 만들지 않는다', async () => {
    const res = await patch({ weather: { region: 'kr-seoul' }, fortune: { birth_time: '25:99' } });
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_DYNAMIC_PROMPT_SETTINGS');
  });
});

describe('읽을 때도 같은 정리 — 저장된 옛 행에 region 을 붙여 내려준다', () => {
  const read = (json: unknown) =>
    dynamicPromptSettingsFromRow({ dynamic_prompt_settings_json: JSON.stringify(json) });

  it('옛 행(글자만) → region 을 되짚어 붙이고 글자는 그대로', () => {
    expect(read({ weather: { country: '大韓民国', city: '東京' } }).weather).toEqual({
      region: 'jp-tokyo',
      country: '大韓民国',
      city: '東京',
    });
    expect(read({ weather: { country: 'South Korea', city: 'Busan' } }).weather.region).toBe('kr-busan');
  });

  it('region 이 적힌 행 → 그 지역의 한국어 글자', () => {
    expect(read({ weather: { region: 'us-new-york', country: 'x', city: 'y' } }).weather).toEqual({
      region: 'us-new-york',
      country: '미국',
      city: '뉴욕',
    });
  });

  it('없는 행·깨진 JSON → 빈 설정(region 칸 포함)', () => {
    expect(dynamicPromptSettingsFromRow({ dynamic_prompt_settings_json: null })).toEqual(EMPTY_DYNAMIC_PROMPT_SETTINGS);
    expect(dynamicPromptSettingsFromRow({ dynamic_prompt_settings_json: '{bad' })).toEqual(EMPTY_DYNAMIC_PROMPT_SETTINGS);
    expect(EMPTY_DYNAMIC_PROMPT_SETTINGS.weather).toEqual({ region: null, country: null, city: null });
  });

  it('region 만 있어도 weather_ready 다(도시 글자가 채워진다)', () => {
    const settings = validateDynamicPromptSettings({ weather: { region: 'kr-sejong' } })!;
    expect(settings.weather.city).toBe('세종');
    expect(dynamicPromptSettingsState(settings).weather_ready).toBe(true);
  });
});
