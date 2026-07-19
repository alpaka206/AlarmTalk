import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { loadPlanByKey } from '../lib/store-billing';
import { logRouteError } from '../lib/logger';

// MARK: - 관리자 전용 페이지 (/admin/*)
//
// 사용자 JWT 가 아니라 ADMIN_SECRET(HTTP Basic 비밀번호)로 보호한다. SQL 수기 입력 없이
// 웹 폼에서 공용 프로모 쿠폰을 발급/조회/활성토글 한다. ADMIN_SECRET 미설정 시 503.
//
// 접속: https://<host>/admin/promo  → 브라우저 Basic 인증창에 아이디(아무거나)+ADMIN_SECRET.

const admin = new Hono<AppEnv>();

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 배포→마이그레이션 사이 창에서 아직 없는 컬럼을 참조했는지 판별.
 * SELECT 는 "no such column: X", INSERT 컬럼 목록은 "table T has no column named X" 로 온다.
 */
function isMissingColumnError(err: unknown): boolean {
  return /no such column|has no column named/i.test(String(err));
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function refererOrigin(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

// Basic 인증. 아이디는 무시하고 비밀번호 == ADMIN_SECRET 만 검증한다.
admin.use('*', async (c, next) => {
  const secret = c.env.ADMIN_SECRET;
  if (!secret) {
    return c.json({ error: 'Admin console is not configured', error_code: 'ADMIN_UNCONFIGURED' }, 503);
  }
  const header = c.req.header('Authorization') || '';
  let ok = false;
  if (header.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6));
      const pass = decoded.slice(decoded.indexOf(':') + 1);
      ok = safeEqual(pass, secret);
    } catch {
      ok = false;
    }
  }
  if (!ok) {
    return new Response('Authentication required', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="AlarmTalk Admin", charset="UTF-8"',
        'content-type': 'text/plain; charset=utf-8',
      },
    });
  }
  return next();
});

// CSRF 방어: Basic 인증은 브라우저가 자격증명을 자동 첨부하므로, 악성 사이트의 cross-site
// 폼 POST 로 관리자 몰래 상태(프로모 발급/토글)를 바꾸는 걸 막는다. 상태 변경(POST)은
// Origin(없으면 Referer)이 이 콘솔 호스트와 정확히 일치할 때만 허용한다.
admin.use('*', async (c, next) => {
  if (c.req.method === 'POST') {
    const expected = new URL(c.req.url).origin;
    const source = c.req.header('Origin') ?? refererOrigin(c.req.header('Referer'));
    if (source !== expected) {
      return c.text('CSRF check failed', 403);
    }
  }
  return next();
});

const PAGE_STYLE = `
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; max-width: 960px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 20px; } h2 { font-size: 16px; margin-top: 28px; }
  form.create { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; align-items: end; }
  form.create label { display: flex; flex-direction: column; font-size: 13px; gap: 4px; }
  form.create input, form.create select { padding: 7px 8px; font-size: 14px; }
  form.create .full { grid-column: 1 / -1; }
  button { padding: 8px 14px; font-size: 14px; cursor: pointer; }
  table { border-collapse: collapse; width: 100%; margin-top: 12px; font-size: 13px; }
  th, td { border: 1px solid #8883; padding: 6px 8px; text-align: left; }
  code { background: #8882; padding: 1px 5px; border-radius: 4px; }
  .msg { padding: 10px 12px; border-radius: 6px; margin: 12px 0; }
  .msg.ok { background: #2ecc7133; } .msg.err { background: #e74c3c33; }
  .muted { opacity: 0.6; } .off { opacity: 0.45; }
`;

function renderMsg(c: { req: { query: (k: string) => string | undefined } }): string {
  const ok = c.req.query('ok');
  const err = c.req.query('err');
  if (ok) return `<div class="msg ok">${escapeHtml(ok)}</div>`;
  if (err) return `<div class="msg err">${escapeHtml(err)}</div>`;
  return '';
}

admin.get('/promo', async (c) => {
  const db = getDB(c.env);
  const plansRes = await db.execute({
    sql: `SELECT key, name, plan_type FROM plans WHERE is_active = 1 ORDER BY price_krw`,
  });
  // deploy-backend.yml 이 배포 '후' 마이그레이션을 돌리므로, redemption_group(#72) 컬럼이
  // 아직 없는 창에서도 콘솔이 500 나지 않게 레거시 스키마로 폴백한다(promo-redemption.ts 와
  // 동일 패턴). NULL AS redemption_group 으로 렌더러는 그대로 쓴다.
  let codesRes;
  try {
    codesRes = await db.execute({
      sql: `SELECT p.id, p.code, p.duration_days, p.valid_from, p.valid_until,
                   p.max_redemptions, p.is_active, p.note, p.created_at, p.redemption_group,
                   pl.key AS plan_key, pl.name AS plan_name,
                   (SELECT COUNT(*) FROM promo_code_redemptions r WHERE r.promo_code_id = p.id) AS used
            FROM promo_codes p
            LEFT JOIN plans pl ON pl.id = p.plan_id
            ORDER BY p.created_at DESC`,
    });
  } catch (err) {
    if (!isMissingColumnError(err)) throw err;
    codesRes = await db.execute({
      sql: `SELECT p.id, p.code, p.duration_days, p.valid_from, p.valid_until,
                   p.max_redemptions, p.is_active, p.note, p.created_at, NULL AS redemption_group,
                   pl.key AS plan_key, pl.name AS plan_name,
                   (SELECT COUNT(*) FROM promo_code_redemptions r WHERE r.promo_code_id = p.id) AS used
            FROM promo_codes p
            LEFT JOIN plans pl ON pl.id = p.plan_id
            ORDER BY p.created_at DESC`,
    });
  }

  const planOptions = plansRes.rows
    .map(
      (r) =>
        `<option value="${escapeHtml(r.key)}">${escapeHtml(r.name)} (${escapeHtml(r.key)} · ${escapeHtml(r.plan_type)})</option>`,
    )
    .join('');

  const rows = codesRes.rows
    .map((r) => {
      const active = Number(r.is_active) === 1;
      const max = r.max_redemptions == null ? '∞' : escapeHtml(r.max_redemptions);
      const from = r.valid_from ? escapeHtml(r.valid_from) : '—';
      const until = r.valid_until ? escapeHtml(r.valid_until) : '—';
      const toggleLabel = active ? '비활성화' : '활성화';
      return `<tr class="${active ? '' : 'off'}">
        <td><code>${escapeHtml(r.code)}</code></td>
        <td>${escapeHtml(r.plan_name ?? r.plan_key ?? '?')}</td>
        <td>${escapeHtml(r.duration_days)}일</td>
        <td>${escapeHtml(r.used)} / ${max}</td>
        <td>${from}<br>~ ${until}</td>
        <td>${r.redemption_group ? `<code>${escapeHtml(r.redemption_group)}</code>` : '—'}</td>
        <td>${active ? '✅' : '⛔'}</td>
        <td class="muted">${escapeHtml(r.note ?? '')}</td>
        <td>
          <form method="post" action="/admin/promo/${escapeHtml(r.id)}/toggle" style="margin:0">
            <button type="submit">${toggleLabel}</button>
          </form>
        </td>
      </tr>`;
    })
    .join('');

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AlarmTalk 관리자 · 프로모 쿠폰</title><style>${PAGE_STYLE}</style></head><body>
<h1>프로모 쿠폰 관리</h1>
<p class="muted">코드를 발급하면 사용자가 <code>POST /api/billing/promo/redeem</code> 로 등록해 해당 플랜을 지정 기간만큼 받습니다. (결제 없이 부여되므로 유효창·사용상한을 신중히 설정하세요.)</p>
${renderMsg(c)}
<h2>새 코드 발급</h2>
<form class="create" method="post" action="/admin/promo">
  <label>코드 문자열
    <input name="code" placeholder="WELCOME_ALARMTALK" required maxlength="64" autocomplete="off">
  </label>
  <label>플랜
    <select name="plan_key" required>${planOptions}</select>
  </label>
  <label>이용 기간(일)
    <input name="duration_days" type="number" min="1" max="3650" value="30" required>
  </label>
  <label>총 사용 상한(빈칸=무제한)
    <input name="max_redemptions" type="number" min="1" placeholder="예: 100">
  </label>
  <label>등록 가능 시작(내 로컬 시각 · 빈칸=제한없음)
    <input name="valid_from_local" type="datetime-local">
  </label>
  <label>등록 가능 종료(내 로컬 시각 · 빈칸=제한없음)
    <input name="valid_until_local" type="datetime-local">
  </label>
  <input type="hidden" name="valid_from">
  <input type="hidden" name="valid_until">
  <label>리딤 그룹(빈칸=없음)
    <input name="redemption_group" placeholder="예: welcome" maxlength="64" autocomplete="off">
  </label>
  <label class="full">메모(관리용)
    <input name="note" placeholder="예: 6월 런칭 프로모" maxlength="200">
  </label>
  <div class="full"><button type="submit">발급</button></div>
</form>
<h2>발급된 코드</h2>
<table>
  <thead><tr><th>코드</th><th>플랜</th><th>기간</th><th>사용/상한</th><th>유효창</th><th>그룹</th><th>활성</th><th>메모</th><th></th></tr></thead>
  <tbody>${rows || '<tr><td colspan="9" class="muted">아직 발급된 코드가 없습니다.</td></tr>'}</tbody>
</table>
<script>
(function () {
  var form = document.querySelector('form.create');
  if (!form) return;
  // datetime-local 은 타임존 없는 로컬 벽시계값이라, 서버(datetime('now'), UTC)와 비교가
  // 어긋난다. 제출 직전 로컬값을 UTC ISO 로 변환해 hidden 필드에 실어 보낸다.
  form.addEventListener('submit', function () {
    [['valid_from_local', 'valid_from'], ['valid_until_local', 'valid_until']].forEach(function (p) {
      var src = form.elements[p[0]];
      var dst = form.elements[p[1]];
      dst.value = src && src.value ? new Date(src.value).toISOString() : '';
    });
  });
})();
</script>
</body></html>`;

  return c.html(html);
});

admin.post('/promo', async (c) => {
  const db = getDB(c.env);
  try {
    const form = await c.req.parseBody();
    const code = String(form.code ?? '').trim();
    const planKey = String(form.plan_key ?? '').trim();
    const durationDays = Number(String(form.duration_days ?? '').trim());
    const maxRaw = String(form.max_redemptions ?? '').trim();
    const maxRedemptions = maxRaw === '' ? null : Number(maxRaw);
    const validFrom = String(form.valid_from ?? '').trim() || null;
    const validUntil = String(form.valid_until ?? '').trim() || null;
    const note = String(form.note ?? '').trim() || null;
    // 리딤 그룹: 같은 그룹의 코드는 계정당 통틀어 1회만 사용 가능(예: 웰컴 3종).
    const redemptionGroup = String(form.redemption_group ?? '').trim() || null;

    if (!code) return c.redirect('/admin/promo?err=' + encodeURIComponent('코드를 입력하세요'), 303);
    if (!Number.isInteger(durationDays) || durationDays <= 0) {
      return c.redirect('/admin/promo?err=' + encodeURIComponent('이용 기간(일)이 올바르지 않습니다'), 303);
    }
    if (maxRedemptions !== null && (!Number.isInteger(maxRedemptions) || maxRedemptions <= 0)) {
      return c.redirect('/admin/promo?err=' + encodeURIComponent('총 사용 상한이 올바르지 않습니다'), 303);
    }

    const plan = await loadPlanByKey(db, planKey);
    if (!plan) {
      return c.redirect('/admin/promo?err=' + encodeURIComponent('존재하지 않는 플랜입니다'), 303);
    }

    // 중복 코드(대소문자 무시) 사전 확인 — UNIQUE 위반을 친화적 메시지로.
    const existing = await db.execute({
      sql: `SELECT 1 FROM promo_codes WHERE code = ? COLLATE NOCASE LIMIT 1`,
      args: [code],
    });
    if (existing.rows.length > 0) {
      return c.redirect('/admin/promo?err=' + encodeURIComponent('이미 존재하는 코드입니다'), 303);
    }

    try {
      await db.execute({
        sql: `INSERT INTO promo_codes
                (id, code, plan_id, duration_days, valid_from, valid_until, max_redemptions, is_active, note, redemption_group)
              VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        args: [
          crypto.randomUUID(),
          code,
          plan.id,
          durationDays,
          validFrom,
          validUntil,
          maxRedemptions,
          note,
          redemptionGroup,
        ],
      });
    } catch (err) {
      // 배포→마이그레이션(#72) 창: redemption_group 컬럼이 아직 없다. 그룹 없는 발급은
      // 레거시 스키마로 그대로 진행하고, 그룹 지정 발급만 마이그레이션 이후로 안내한다.
      if (!isMissingColumnError(err)) throw err;
      if (redemptionGroup) {
        return c.redirect(
          '/admin/promo?err=' +
            encodeURIComponent('리딤 그룹은 DB 마이그레이션(#72) 적용 후 사용할 수 있습니다'),
          303,
        );
      }
      await db.execute({
        sql: `INSERT INTO promo_codes
                (id, code, plan_id, duration_days, valid_from, valid_until, max_redemptions, is_active, note)
              VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        args: [crypto.randomUUID(), code, plan.id, durationDays, validFrom, validUntil, maxRedemptions, note],
      });
    }
    return c.redirect('/admin/promo?ok=' + encodeURIComponent('코드 발급 완료: ' + code), 303);
  } catch (err) {
    logRouteError(c, err);
    return c.redirect('/admin/promo?err=' + encodeURIComponent('발급 중 오류가 발생했습니다'), 303);
  }
});

admin.post('/promo/:id/toggle', async (c) => {
  const db = getDB(c.env);
  const id = c.req.param('id');
  try {
    await db.execute({
      sql: `UPDATE promo_codes
            SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END,
                updated_at = datetime('now')
            WHERE id = ?`,
      args: [id],
    });
    return c.redirect('/admin/promo?ok=' + encodeURIComponent('상태를 변경했습니다'), 303);
  } catch (err) {
    logRouteError(c, err);
    return c.redirect('/admin/promo?err=' + encodeURIComponent('상태 변경 중 오류가 발생했습니다'), 303);
  }
});

export default admin;
