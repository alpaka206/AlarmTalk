/**
 * **아침 소식** — 관심 기업(최대 3)의 OpenDART 공시 + 정책브리핑 정책뉴스. 인증 필요(`/api/briefing`).
 *
 *  - `GET  /briefing/companies/search?q=&limit=` — 기업 찾기(상장사 캐시, 최대 20).
 *  - `GET  /briefing/interests` / `PUT /briefing/interests` — 내 관심 기업(통째 교체, 최대 3).
 *  - `GET  /briefing/today` — 오늘의 소식. 원천 일부가 실패해도 **200** 이고, 무엇을 확인하지 못했는지 `errors`·
 *    `companies[].status`·`complete`·`stale` 로 말한다. 요청 한도면 `Retry-After` 를 싣는다.
 *
 * ⚠ 주가·투자 판단·일반 뉴스 수집은 하지 않는다. 글을 보는 것은 무료이고, 목소리로 만드는 것은 직접 입력 문구와 같은
 *   경로·한도다(`lib/briefing/speech.ts` 가 글만 만든다). 규칙: `docs/spec/morning-briefing.md`.
 * ⚠ 소유권: 관심 목록은 **인증이 정한 사람 id** 로만 읽고 쓴다 — 요청에 사람 id 를 받지 않는다(IDOR 없음).
 */
import { Hono } from 'hono';
import {
  BRIEFING_SEARCH_LIMIT_MAX,
  BriefingCompanySearchQuerySchema,
  BriefingInterestsPutSchema,
} from '@alarmtalk/shared';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { jsonError } from '../lib/api-error';
import { cleanText } from '../lib/briefing/xml';
import {
  buildBriefingToday,
  corpCodeCacheIsEmpty,
  listInterests,
  opendartApiKey,
  policyNewsApiKey,
  refreshCorpCodes,
  replaceInterests,
  searchCorpCodes,
} from '../lib/briefing/store';
import { logRouteError, logStructured } from '../lib/logger';

const briefing = new Hono<AppEnv>();

/** 캐시가 비어 받기를 시작했을 때 앱에 기다리라고 하는 시간(초). */
const CORP_CODES_NOT_READY_RETRY_SECONDS = 60;

function callerId(c: { get: (key: 'userIdPK' | 'userId') => string | undefined }): string {
  return c.get('userIdPK') || c.get('userId') || '';
}

briefing.get('/companies/search', async (c) => {
  // 검색어는 외부 입력이다 — 제어·제로폭·양방향 제어문자를 걷어 낸 **뒤** 길이를 잰다.
  const parsed = BriefingCompanySearchQuerySchema.safeParse({ q: cleanText(c.req.query('q') ?? '') });
  if (!parsed.success) {
    return jsonError(c, 400, 'BRIEFING_INVALID_QUERY', 'Search query must be 1 to 30 characters');
  }
  const rawLimit = Number.parseInt(c.req.query('limit') ?? '', 10);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : BRIEFING_SEARCH_LIMIT_MAX, 1), BRIEFING_SEARCH_LIMIT_MAX);
  const db = getDB(c.env);

  const companies = await searchCorpCodes(db, parsed.data.q, limit);
  if (companies.length > 0) return c.json({ companies });

  // 결과가 없을 때만 캐시가 비었는지 본다 — '그런 기업 없음' 과 '아직 못 받음' 을 가른다.
  if (await corpCodeCacheIsEmpty(db)) {
    if (!opendartApiKey(c.env)) {
      return jsonError(c, 503, 'BRIEFING_NOT_CONFIGURED', 'Morning briefing sources are not configured');
    }
    // 처음이거나 비어 버렸다 — 잠금을 잡고 받기 시작한다(이미 누가 받는 중이거나 직전에 실패했으면 아무것도 안 한다).
    const refresh = refreshCorpCodes(db, c.env, new Date(), { dueEveryMs: 0 }).catch((err) =>
      logStructured('error', { at: 'briefing.corp_codes_on_demand', error: String(err) }),
    );
    try {
      c.executionCtx.waitUntil(refresh);
    } catch {
      // 실행 컨텍스트가 없는 환경(테스트) — 약속은 그대로 돈다.
    }
    c.header('Retry-After', String(CORP_CODES_NOT_READY_RETRY_SECONDS));
    return jsonError(c, 503, 'BRIEFING_CORP_CODES_NOT_READY', 'Company list is being prepared');
  }
  return c.json({ companies });
});

briefing.get('/interests', async (c) => {
  const interests = await listInterests(getDB(c.env), callerId(c));
  return c.json({ interests });
});

briefing.put('/interests', async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return jsonError(c, 400, 'INVALID_JSON', 'Invalid JSON body');
  }
  const parsed = BriefingInterestsPutSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(
      c,
      400,
      'BRIEFING_INVALID_INTERESTS',
      parsed.error.issues[0]?.message ?? 'Up to 3 distinct 8-digit corp codes',
    );
  }
  const db = getDB(c.env);
  const userId = callerId(c);
  const result = await replaceInterests(db, userId, parsed.data.corp_codes, new Date());
  if (!result.ok) {
    return jsonError(c, 400, 'BRIEFING_CORP_NOT_FOUND', 'Unknown company', { missing: result.missing });
  }
  return c.json({ interests: await listInterests(db, userId) });
});

briefing.get('/today', async (c) => {
  if (!opendartApiKey(c.env) && !policyNewsApiKey(c.env)) {
    return jsonError(c, 503, 'BRIEFING_NOT_CONFIGURED', 'Morning briefing sources are not configured');
  }
  try {
    const { body, retryAfterSeconds } = await buildBriefingToday(getDB(c.env), c.env, callerId(c), new Date());
    if (retryAfterSeconds) c.header('Retry-After', String(retryAfterSeconds));
    return c.json(body);
  } catch (err) {
    // DB 실패(표가 없는 배포 창 포함)는 500 — 앱은 다시 시도한다. 지어낸 빈 목록을 돌려주지 않는다.
    logRouteError(c, err);
    return jsonError(c, 500, 'INTERNAL_ERROR', 'Failed to load morning briefing');
  }
});

export default briefing;
