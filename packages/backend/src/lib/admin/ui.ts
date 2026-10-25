/**
 * 관리자 콘솔의 **화면 껍데기** — 토큰·레이아웃·차트·동작. `docs/spec/admin-console.md` 「화면」.
 *
 * 서버가 HTML 을 그대로 그린다(빌드 단계·프레임워크 없음). 스크립트는 응답마다 새 nonce 를 붙인 인라인 하나뿐이고
 * CSP 가 그 밖의 스크립트를 막는다.
 *
 * 디자인 기준
 * - 색: 랜딩·앱과 같은 브랜드 값(라이트 #175fb0, 다크는 앱 primary #a6d2ff 와 딥네이비 바닥). 액센트는 하나다.
 *   상태색(정상·주의·문제)은 상태 표시에만 쓰고 언제나 글자와 함께 둔다.
 * - 모서리: 패널 18 · 컨트롤 12 · 배지 캡슐 — 앱 토큰(`WakerPanelShape`·`WakerTileShape`·`WakerPillShape`)과 같은 값.
 * - 동작: 누르는 순간(pointer-down) 0.97 로 줄고, 다이얼로그는 누른 버튼 쪽에서 열려 같은 길로 닫힌다(닫힘이 더
 *   빠르다). 전환은 CSS transition 이라 도중에 되돌려도 지금 값에서 돌아간다. 모션 줄이기·투명도 줄이기를 따른다.
 * - 화면에 보이는 글자에 줄표(—)를 쓰지 않는다(오너가 AI 티로 본다).
 */

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const NUMBER = new Intl.NumberFormat('ko-KR');
export function fmtNum(n: number): string {
  return NUMBER.format(n);
}

/** DB 시각 → Date. `2026-10-22 01:10:26` 처럼 시간대가 없는 값은 UTC 다(SQLite `datetime('now')`). */
export function parseDbTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const v = value.trim();
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v) ? `${v.replace(' ', 'T')}Z` : v;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DATE_TIME = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const DATE_ONLY = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' });
const DAY_SHORT = new Intl.DateTimeFormat('ko-KR', { timeZone: 'UTC', month: 'numeric', day: 'numeric' });

export function fmtDateTime(value: string | null | undefined): string {
  const d = parseDbTime(value);
  return d ? DATE_TIME.format(d) : '기록 없음';
}

export function fmtDate(value: string | null | undefined): string {
  const d = parseDbTime(value);
  return d ? DATE_ONLY.format(d) : '기록 없음';
}

/** 한국 날짜 문자열(YYYY-MM-DD) → "10. 3." */
export function fmtDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : DAY_SHORT.format(d);
}

/** "3분 전" 같은 상대 시각 — 표의 마지막 접속 칸. */
export function fmtAgo(value: string | null | undefined, nowMs: number): string {
  const d = parseDbTime(value);
  if (!d) return '기록 없음';
  const diff = Math.max(0, nowMs - d.getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 전`;
  const day = Math.floor(h / 24);
  if (day < 30) return `${day}일 전`;
  return fmtDate(value);
}

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

export function badge(label: string, tone: Tone = 'neutral'): string {
  return `<span class="badge badge-${tone}">${escapeHtml(label)}</span>`;
}

// ── 차트 ──────────────────────────────────────────────────────────────────────

function niceMax(max: number): number {
  if (max <= 4) return Math.max(1, max);
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 5, 10]) {
    if (step * pow >= max) return step * pow;
  }
  return 10 * pow;
}

/**
 * 날짜별 막대(단일 계열). 계열이 하나라 범례 상자를 두지 않는다 — 제목이 무엇인지 말한다.
 * 막대는 24px 이하·윗끝만 4px 둥글게·칸 사이 2px. 막대마다 호버·키보드(←/→) 툴팁이 있고, 같은 값을 표로도 연다.
 */
export function columnChart(opts: {
  id: string;
  title: string;
  points: Array<{ day: string; value: number }>;
  unit: string;
  note?: string;
}): string {
  const max = niceMax(Math.max(0, ...opts.points.map((p) => p.value)));
  const total = opts.points.reduce((s, p) => s + p.value, 0);
  const peak = opts.points.reduce((best, p) => (p.value > best.value ? p : best), { day: '', value: -1 });
  const cols = opts.points
    .map((p, i) => {
      const pct = max > 0 ? (p.value / max) * 100 : 0;
      return `<div class="col" data-i="${i}" data-label="${escapeHtml(fmtDay(p.day))}" data-value="${escapeHtml(
        `${fmtNum(p.value)}${opts.unit}`,
      )}"><span class="col-bar" style="--h:${pct.toFixed(2)}%;--i:${Math.min(i, 40)}"></span></div>`;
    })
    .join('');
  const first = opts.points[0]?.day ?? '';
  const last = opts.points[opts.points.length - 1]?.day ?? '';
  const rows = opts.points
    .slice()
    .reverse()
    .map((p) => `<tr><td>${escapeHtml(fmtDay(p.day))}</td><td class="num">${fmtNum(p.value)}${escapeHtml(opts.unit)}</td></tr>`)
    .join('');
  return `<section class="panel chart-panel" aria-labelledby="${opts.id}-title">
  <div class="panel-head">
    <h2 id="${opts.id}-title">${escapeHtml(opts.title)}</h2>
    <p class="panel-figure"><span class="figure-sm">${fmtNum(total)}</span><span class="muted">${escapeHtml(opts.unit)} · ${opts.points.length}일</span></p>
  </div>
  <div class="chart" tabindex="0" role="group" aria-label="${escapeHtml(
    `${opts.title}. ${opts.points.length}일 합계 ${fmtNum(total)}${opts.unit}${
      peak.value > 0 ? `, 가장 많은 날 ${fmtDay(peak.day)} ${fmtNum(peak.value)}${opts.unit}` : ''
    }. 좌우 화살표로 날짜별 값을 들을 수 있어요.`,
  )}">
    <div class="chart-grid" aria-hidden="true">
      <span class="tick" style="--y:100%"><i>${fmtNum(max)}</i></span>
      ${Number.isInteger(max / 2) ? `<span class="tick" style="--y:50%"><i>${fmtNum(max / 2)}</i></span>` : ''}
      <span class="tick tick-base" style="--y:0%"><i>0</i></span>
    </div>
    <div class="cols" style="--n:${opts.points.length}">${cols}</div>
  </div>
  <div class="chart-axis" aria-hidden="true"><span>${escapeHtml(fmtDay(first))}</span><span>${escapeHtml(fmtDay(last))}</span></div>
  ${opts.note ? `<p class="note">${escapeHtml(opts.note)}</p>` : ''}
  <details class="table-view"><summary>표로 보기</summary>
    <table><thead><tr><th scope="col">날짜</th><th scope="col" class="num">값</th></tr></thead><tbody>${rows}</tbody></table>
  </details>
</section>`;
}

/** 가로 막대 목록 — 분포(테마·빌드). 값은 막대 끝의 글자 토큰으로, 막대만 액센트를 입는다. */
export function hbarList(
  items: Array<{ label: string; value: number; sub?: string; extra?: string }>,
  unit: string,
): string {
  if (items.length === 0) return '';
  const max = Math.max(1, ...items.map((i) => i.value));
  return `<ul class="hbars">${items
    .map(
      (item) => `<li>
    <div class="hbar-label"><span class="hbar-name">${escapeHtml(item.label)}</span>${item.extra ?? ''}${
      item.sub ? `<span class="muted hbar-sub">${escapeHtml(item.sub)}</span>` : ''
    }</div>
    <div class="hbar-track"><span class="hbar-fill" style="--w:${((item.value / max) * 100).toFixed(2)}%"></span></div>
    <span class="hbar-value num">${fmtNum(item.value)}${escapeHtml(unit)}</span>
  </li>`,
    )
    .join('')}</ul>`;
}

/**
 * 누적 추이 선 — 큰 숫자 칸의 보조 그림(계열 하나라 범례 없음). 값은 옆 숫자와 '최근 n일 +k' 가 글자로 말하므로
 * 그림은 보조 기술에서 숨긴다. 선 2px·바닥 10% 물·끝점 8px(표면색 2px 고리).
 */
export function sparkline(values: number[]): string {
  if (values.length < 2) return '';
  const w = 300;
  const h = 84;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 6 - ((v - min) / span) * (h - 12)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [, ly] = pts[pts.length - 1]!;
  // 끝점은 HTML 로 얹는다 — 늘어나는 viewBox 안의 원은 타원이 된다.
  return `<div class="spark-wrap" aria-hidden="true">
  <svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" focusable="false">
    <polygon class="spark-area" points="0,${h} ${line} ${w},${h}"></polygon>
    <polyline class="spark-line" points="${line}"></polyline>
  </svg>
  <span class="spark-dot" style="top:${((ly / h) * 100).toFixed(2)}%"></span>
</div>`;
}

export function emptyState(title: string, body: string, action?: string): string {
  return `<div class="empty"><p class="empty-title">${escapeHtml(title)}</p><p class="muted">${escapeHtml(body)}</p>${action ?? ''}</div>`;
}

// ── 레이아웃 ───────────────────────────────────────────────────────────────────

export type NavKey = 'overview' | 'users' | 'push';

const NAV: Array<{ key: NavKey; href: string; label: string }> = [
  { key: 'overview', href: '/admin', label: '개요' },
  { key: 'users', href: '/admin/users', label: '사용자' },
  { key: 'push', href: '/admin/push', label: '알림 보내기' },
];

export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** 콘솔 응답 헤더 — 캐시 금지·프레임 금지·nonce 스크립트만. */
export function securityHeaders(nonce: string): Record<string, string> {
  return {
    'Content-Security-Policy': [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      "style-src 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
    ].join('; '),
    'Cache-Control': 'no-store',
    // ⚠ `no-referrer` 로 두지 말 것 — 그러면 같은 출처 POST 의 Origin 이 "null" 이 되어 CSRF 검사가 막는다.
    'Referrer-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
  };
}

export function page(opts: {
  title: string;
  active: NavKey | null;
  nonce: string;
  body: string;
  /** 사이드바 없이(로그인). */
  bare?: boolean;
  /** 화면 전용 스크립트 — `window.__page = ({ $, $$ }) => { ... }` 꼴. 공통 스크립트가 마지막에 부른다. */
  script?: string;
}): string {
  const nav = NAV.map(
    (n) =>
      `<a href="${n.href}" class="nav-link"${n.key === opts.active ? ' aria-current="page"' : ''}>${escapeHtml(n.label)}</a>`,
  ).join('');
  const shell = opts.bare
    ? `<main id="main" class="bare">${opts.body}</main>`
    : `<div class="shell">
  <aside class="side">
    <a class="brand" href="/admin" translate="no"><span class="brand-mark" aria-hidden="true"></span><span>알람톡 <b>관리</b></span></a>
    <nav class="nav" aria-label="콘솔">${nav}</nav>
    <form method="post" action="/admin/logout" class="side-foot"><button type="submit" class="btn btn-ghost btn-sm">로그아웃</button></form>
  </aside>
  <main id="main" class="main">${opts.body}</main>
</div>`;
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="data:,">
<meta name="theme-color" content="#f6f7f9" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#090d16" media="(prefers-color-scheme: dark)">
<title>${escapeHtml(opts.title)} · 알람톡 관리</title>
<style>${STYLE}</style>
</head>
<body>
<a class="skip" href="#main">본문으로 건너뛰기</a>
${shell}
<div class="tooltip" role="tooltip" id="tip" aria-hidden="true"><strong class="tip-value"></strong><span class="tip-label"></span></div>
<div class="toast-region" aria-live="polite" aria-atomic="true" id="toasts"></div>
${opts.script ? `<script nonce="${opts.nonce}">${opts.script}</script>` : ''}
<script nonce="${opts.nonce}">${SCRIPT}</script>
</body>
</html>`;
}

// ── 스타일 ─────────────────────────────────────────────────────────────────────

const STYLE = `
:root{
  color-scheme:light dark;
  --bg:#f6f7f9;--surface:#fff;--surface-2:#f2f4f6;--surface-3:#e9ecf0;
  --line:#e5e8eb;--line-strong:#d1d6db;--grid:#eef0f3;
  --text:#191f28;--text-2:#4e5968;--muted:#6b7684;
  --accent:#175fb0;--accent-strong:#124e8c;--accent-soft:rgba(23,95,176,.1);--on-accent:#fff;
  --bar:#175fb0;--bar-hover:#0f467d;
  --good:#1d7048;--good-soft:rgba(29,112,72,.11);
  --warn:#8f5200;--warn-soft:rgba(176,107,0,.13);
  --bad:#b4321f;--bad-soft:rgba(180,50,31,.11);
  --scrim:rgba(9,13,22,.38);
  --material:rgba(255,255,255,.72);
  --shadow:0 1px 2px rgba(25,31,40,.04),0 10px 28px rgba(25,31,40,.06);
  --shadow-lift:0 1px 3px rgba(25,31,40,.06),0 24px 64px rgba(25,31,40,.14);
  --r-panel:18px;--r-control:12px;--r-pill:999px;
  --ease-out:cubic-bezier(.16,1,.3,1);--ease-ui:cubic-bezier(.4,0,.2,1);
  --font:"Pretendard Variable",Pretendard,-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#090d16;--surface:#111a2d;--surface-2:#16203a;--surface-3:#1f2a4a;
  --line:rgba(255,255,255,.08);--line-strong:rgba(255,255,255,.15);--grid:rgba(255,255,255,.06);
  --text:#f7f8fc;--text-2:#c9cfdb;--muted:#a7afc0;
  --accent:#a6d2ff;--accent-strong:#cfe6ff;--accent-soft:rgba(166,210,255,.13);--on-accent:#06243c;
  --bar:#7fb9f2;--bar-hover:#b9dcff;
  --good:#86d8ab;--good-soft:rgba(134,216,171,.13);
  --warn:#f3c675;--warn-soft:rgba(243,198,117,.14);
  --bad:#ffa294;--bad-soft:rgba(255,162,148,.14);
  --scrim:rgba(0,0,0,.55);
  --material:rgba(17,26,45,.72);
  --shadow:0 1px 0 rgba(255,255,255,.03) inset,0 10px 30px rgba(0,0,0,.25);
  --shadow-lift:0 1px 0 rgba(255,255,255,.05) inset,0 28px 70px rgba(0,0,0,.5);
}}
*{box-sizing:border-box}
/* display 를 준 요소(.btn 등)가 hidden 속성을 이기지 못하게. 진행 중 '보내기' 버튼이 남던 원인. */
[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
@media (pointer:fine){html{overscroll-behavior:none}}
body{margin:0;background:var(--bg);color:var(--text);font:400 14px/1.55 var(--font);letter-spacing:-.005em;
  -webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
a{color:inherit}
h1,h2,h3{margin:0;font-weight:650;text-wrap:balance}
h1{font-size:26px;line-height:1.2;letter-spacing:-.025em}
h2{font-size:15px;line-height:1.35;letter-spacing:-.01em}
p{margin:0}
.muted{color:var(--muted)}
.num,.tnum{font-variant-numeric:tabular-nums}
.tnum{white-space:nowrap}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.skip{position:absolute;left:12px;top:-60px;z-index:50;padding:10px 14px;border-radius:var(--r-control);background:var(--surface);
  box-shadow:var(--shadow);transition:transform .2s var(--ease-out)}
.skip:focus{transform:translateY(72px)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}

/* 레이아웃 */
.shell{display:grid;grid-template-columns:232px minmax(0,1fr);min-height:100dvh}
.side{position:sticky;top:0;height:100dvh;display:flex;flex-direction:column;gap:20px;padding:20px 14px;
  border-right:1px solid var(--line);background:var(--material);backdrop-filter:blur(20px) saturate(170%);
  -webkit-backdrop-filter:blur(20px) saturate(170%)}
.brand{display:flex;align-items:center;gap:10px;padding:6px 10px;text-decoration:none;font-size:15px;letter-spacing:-.01em}
.brand b{font-weight:650}
.brand-mark{width:22px;height:22px;border-radius:7px;background:linear-gradient(160deg,var(--accent),var(--accent-strong));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.35)}
.nav{display:flex;flex-direction:column;gap:2px}
.nav-link{display:flex;align-items:center;min-height:38px;padding:0 12px;border-radius:var(--r-control);text-decoration:none;
  color:var(--text-2);font-weight:500;transition:background-color .15s var(--ease-ui),color .15s var(--ease-ui),transform .12s var(--ease-out)}
.nav-link:hover{background:var(--surface-2);color:var(--text)}
.nav-link[aria-current=page]{background:var(--accent-soft);color:var(--accent-strong);font-weight:600}
@media (prefers-color-scheme:dark){.nav-link[aria-current=page]{color:var(--accent)}}
.side-foot{margin-top:auto}
.main{min-width:0;padding:32px clamp(16px,4vw,48px) 64px;max-width:1240px;width:100%}
.bare{min-height:100dvh;display:grid;place-items:center;padding:24px 16px}
@media (max-width:900px){
  .shell{grid-template-columns:minmax(0,1fr)}
  .side{position:sticky;z-index:20;height:auto;flex-direction:row;align-items:center;gap:8px;padding:10px 12px;
    border-right:0;border-bottom:1px solid var(--line);overflow-x:auto}
  .brand{padding:6px 4px}.brand span:last-child{display:none}
  .nav{flex-direction:row}.nav-link{white-space:nowrap;min-height:36px}
  .side-foot{margin:0 0 0 auto;flex:none}
  .side{scrollbar-width:none}
  .main{padding-top:20px}
}
@media (prefers-reduced-transparency:reduce){.side{background:var(--surface);backdrop-filter:none;-webkit-backdrop-filter:none}}

/* 머리 */
.page-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px 20px;margin-bottom:24px}
.page-head p{margin-top:6px}
.seg{display:inline-flex;padding:3px;gap:2px;border-radius:var(--r-control);background:var(--surface-2);border:1px solid var(--line)}
.seg a,.seg label{display:inline-flex;align-items:center;min-height:32px;padding:0 14px;border-radius:9px;text-decoration:none;
  color:var(--text-2);font-weight:500;cursor:pointer;transition:background-color .15s var(--ease-ui),color .15s var(--ease-ui),transform .12s var(--ease-out)}
.seg a[aria-current=true],.seg input:checked+label{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.seg input{position:absolute;opacity:0;pointer-events:none}
.seg input:focus-visible+label{outline:2px solid var(--accent);outline-offset:1px}

/* 패널 */
.grid{display:grid;gap:16px}
.grid-hero{grid-template-columns:minmax(0,1.3fr) repeat(2,minmax(0,1fr))}
.grid-hero .hero{grid-row:span 2;display:flex;flex-direction:column;justify-content:space-between}
.grid>.reveal>.panel{height:100%}
.grid-2{grid-template-columns:repeat(2,minmax(0,1fr))}
@media (max-width:1080px){.grid-hero{grid-template-columns:repeat(2,minmax(0,1fr))}.grid-hero .hero{grid-column:1/-1;grid-row:auto}}
@media (max-width:720px){.grid-2{grid-template-columns:minmax(0,1fr)}.grid-hero{gap:12px}.grid-hero .tile{padding:16px}.tile-value{font-size:28px}}
.stack{display:flex;flex-direction:column;gap:16px}
.section-gap{margin-top:16px}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-panel);padding:20px;box-shadow:var(--shadow);min-width:0}
.panel-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px 16px;margin-bottom:14px}
.panel-figure{display:flex;align-items:baseline;gap:6px}
.figure-sm{font-size:18px;font-weight:650;letter-spacing:-.02em}
.note{margin-top:12px;color:var(--muted);font-size:12.5px}
.reveal{animation:rise .42s var(--ease-out) both;animation-delay:calc(min(var(--d,0),6) * 28ms)}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

/* 숫자 */
.hero .label,.tile .label{color:var(--text-2);font-weight:500}
.spark{display:block;width:100%;height:84px;margin-top:18px;overflow:visible}
.spark-line{fill:none;stroke:var(--bar);stroke-width:2;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
.spark-area{fill:var(--bar);opacity:.1}
.spark-wrap{position:relative;margin-top:18px}
.spark-wrap .spark{margin-top:0}
.spark-dot{position:absolute;right:-5px;width:10px;height:10px;margin-top:-5px;border-radius:50%;background:var(--bar);box-shadow:0 0 0 2px var(--surface)}
.hero-value{display:block;margin-top:8px;font-size:clamp(48px,7vw,84px);line-height:1;font-weight:700;letter-spacing:-.035em}
.tile-value{display:block;margin-top:8px;font-size:32px;line-height:1.05;font-weight:680;letter-spacing:-.03em}
.meta{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:14px;color:var(--text-2);font-size:13px}
.meta b{color:var(--text);font-weight:600}
.tile-foot{margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}

.badge{display:inline-flex;align-items:center;gap:6px;min-height:22px;padding:0 9px;border-radius:var(--r-pill);font-size:12px;font-weight:600;
  white-space:nowrap;background:var(--surface-2);color:var(--text-2)}
.badge::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.badge-neutral::before{display:none}
.badge-good{background:var(--good-soft);color:var(--good)}
.badge-warn{background:var(--warn-soft);color:var(--warn)}
.badge-bad{background:var(--bad-soft);color:var(--bad)}

/* 막대 차트 */
.chart{position:relative;height:180px;margin-left:34px;border-radius:6px}
.chart-grid{position:absolute;inset:0;pointer-events:none}
.tick{position:absolute;left:0;right:0;bottom:var(--y);border-top:1px solid var(--grid)}
.tick-base{border-top-color:var(--line-strong)}
.tick i{position:absolute;right:calc(100% + 8px);top:-8px;font-style:normal;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
.cols{position:absolute;inset:0;display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));gap:2px;align-items:end}
.col{height:100%;display:flex;align-items:flex-end;justify-content:center;cursor:default}
.col-bar{display:block;width:100%;max-width:24px;height:var(--h);min-height:0;border-radius:4px 4px 0 0;background:var(--bar);
  transform-origin:bottom;animation:grow .5s var(--ease-out) both;animation-delay:calc(min(var(--i),40) * 6ms + 120ms);
  transition:background-color .12s var(--ease-ui)}
.col.is-on .col-bar{background:var(--bar-hover)}
@keyframes grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
.chart-axis{display:flex;justify-content:space-between;margin:8px 0 0 34px;font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.table-view{margin-top:12px}
.table-view summary{cursor:pointer;color:var(--text-2);font-size:13px;width:max-content;border-radius:6px}
.table-view table{margin-top:8px;max-height:260px;display:block;overflow:auto}

/* 가로 막대 */
.hbars{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
.hbars li{display:grid;grid-template-columns:minmax(0,15em) minmax(0,1fr) auto;align-items:center;gap:12px}
.hbar-label{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;min-width:0}
.hbar-name{font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hbar-sub{font-size:12px;width:100%}
.hbar-track{height:10px;border-radius:var(--r-pill);background:var(--surface-2);overflow:hidden}
.hbar-fill{display:block;height:100%;width:var(--w);border-radius:inherit;background:var(--bar);transform-origin:left;animation:growx .6s var(--ease-out) both}
@keyframes growx{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.hbar-value{font-weight:600;min-width:3.5em;text-align:right}
@media (max-width:560px){.hbars li{grid-template-columns:minmax(0,1fr) auto}.hbar-track{grid-column:1/-1;grid-row:2}}

/* 목록 */
.kv{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0;margin:0}
.kv>div{display:contents}
.kv dt,.kv dd{margin:0;padding:11px 0;border-bottom:1px solid var(--line)}
.kv>div:last-child dt,.kv>div:last-child dd{border-bottom:0}
.kv dt{color:var(--text-2)}
.kv dd{text-align:right;font-weight:600;font-variant-numeric:tabular-nums}

/* 표 */
.table-wrap{position:relative;overflow-x:auto;margin:0 -20px;padding:0 20px;overscroll-behavior-x:contain}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{font-weight:600;color:var(--muted);font-size:12px;text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:12px;border-bottom:1px solid var(--line);vertical-align:top}
tbody tr:last-child td{border-bottom:0}
tbody tr{transition:background-color .12s var(--ease-ui)}
tbody tr:hover{background:var(--surface-2)}
th.num,td.num{text-align:right}
.cell-main{font-weight:550;overflow-wrap:anywhere}
.cell-sub{color:var(--muted);font-size:12px;overflow-wrap:anywhere}

/* 폼 */
.field{display:flex;flex-direction:column;gap:6px;min-width:0}
.field-label{font-weight:600;font-size:13px;display:flex;justify-content:space-between;gap:8px}
.field-help{color:var(--muted);font-size:12.5px}
.input,.textarea{width:100%;min-height:42px;padding:10px 12px;border-radius:var(--r-control);border:1px solid var(--line-strong);
  background:var(--surface);color:var(--text);font:inherit;transition:border-color .15s var(--ease-ui),box-shadow .15s var(--ease-ui)}
.textarea{min-height:112px;resize:vertical;line-height:1.55}
.input:hover,.textarea:hover{border-color:var(--muted)}
.input:focus,.textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.input-num{width:7.5em}
.check{display:flex;align-items:flex-start;gap:10px;padding:8px 0;cursor:pointer}
.check input{width:18px;height:18px;margin:1px 0 0;accent-color:var(--accent);flex:none}
.inline{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}
fieldset{border:0;margin:0;padding:0;min-width:0}
legend{padding:0;font-weight:600;font-size:13px;margin-bottom:8px}
.form-error{color:var(--bad);font-size:13px}
.form-error:empty{display:none}

/* 버튼 */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:42px;padding:0 18px;border-radius:var(--r-control);
  border:1px solid transparent;font:600 14px/1 var(--font);cursor:pointer;text-decoration:none;white-space:nowrap;
  transition:background-color .15s var(--ease-ui),border-color .15s var(--ease-ui),color .15s var(--ease-ui),transform .12s var(--ease-out),opacity .15s var(--ease-ui)}
.btn-primary{background:var(--accent);color:var(--on-accent)}
.btn-primary:hover{background:var(--accent-strong)}
.btn-secondary{background:var(--surface);color:var(--text);border-color:var(--line-strong)}
.btn-secondary:hover{background:var(--surface-2)}
.btn-ghost{background:transparent;color:var(--text-2)}
.btn-ghost:hover{background:var(--surface-2);color:var(--text)}
.btn-danger{background:var(--bad-soft);color:var(--bad)}
.btn-sm{min-height:34px;padding:0 12px;font-size:13px}
.btn[aria-busy=true]{opacity:.7;cursor:progress}
.btn:active,.nav-link:active,.seg a:active,.seg label:active,.is-pressed{transform:scale(.97);transition-duration:60ms}

/* 미리보기 */
.notif{display:grid;grid-template-columns:38px minmax(0,1fr);gap:12px;padding:14px;border-radius:var(--r-panel);
  background:var(--surface-2);border:1px solid var(--line)}
.notif-icon{width:38px;height:38px;border-radius:10px;background:linear-gradient(160deg,var(--accent),var(--accent-strong))}
.notif-app{display:flex;justify-content:space-between;color:var(--muted);font-size:12px}
.notif-title{font-weight:650;margin-top:2px;overflow-wrap:anywhere}
.notif-body{color:var(--text-2);white-space:pre-line;overflow-wrap:anywhere;margin-top:2px}
.count{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;padding:14px 16px;border-radius:var(--r-control);background:var(--accent-soft);
  transition:opacity .2s var(--ease-ui)}
.count[data-loading=true]{opacity:.55}
.count-main{font-size:22px;font-weight:700;letter-spacing:-.02em;color:var(--text)}
.sticky{position:sticky;top:24px}
@media (max-width:900px){.sticky{position:static}}

.empty{padding:28px 8px;text-align:center}
.empty-title{font-weight:650;margin-bottom:4px}
.empty .btn{margin-top:14px}

/* 툴팁 */
.tooltip{position:fixed;left:0;top:0;z-index:60;pointer-events:none;display:flex;flex-direction:column;gap:1px;padding:8px 11px;
  border-radius:10px;background:var(--text);color:var(--bg);font-size:12px;box-shadow:var(--shadow-lift);opacity:0;
  transform:translate(var(--tx,0),var(--ty,0)) scale(.96);transition:opacity .12s var(--ease-ui),transform .12s var(--ease-out)}
.tooltip.is-on{opacity:1;transform:translate(var(--tx,0),var(--ty,0)) scale(1)}
.tip-value{font-size:14px;font-variant-numeric:tabular-nums}
.tip-label{opacity:.75}

/* 다이얼로그 */
dialog.sheet{border:0;padding:0;background:transparent;color:inherit;max-width:min(460px,calc(100vw - 32px));width:100%;overflow:visible}
dialog.sheet::backdrop{background:var(--scrim);opacity:0;transition:opacity .22s var(--ease-ui)}
dialog.sheet[data-state=open]::backdrop{opacity:1}
.sheet-card{background:var(--surface);border:1px solid var(--line);border-radius:22px;padding:24px;box-shadow:var(--shadow-lift);
  opacity:0;transform:scale(.94);filter:blur(4px);transform-origin:var(--ox,50%) var(--oy,50%);
  transition:opacity .16s var(--ease-ui),transform .16s var(--ease-ui),filter .16s var(--ease-ui);overscroll-behavior:contain}
dialog.sheet[data-state=open] .sheet-card{opacity:1;transform:none;filter:none;
  transition:opacity .28s var(--ease-out),transform .34s var(--ease-out),filter .28s var(--ease-out)}
.sheet-card h2{font-size:18px}
.sheet-card p{margin-top:8px;color:var(--text-2)}
.sheet-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:22px}
.progress{height:8px;border-radius:var(--r-pill);background:var(--surface-2);overflow:hidden;margin-top:18px}
.progress span{display:block;height:100%;width:100%;background:var(--accent);transform:scaleX(var(--p,0));transform-origin:left;
  transition:transform .35s var(--ease-out)}

/* 토스트 */
.toast-region{position:fixed;left:50%;bottom:max(20px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:70;
  display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;width:min(440px,calc(100vw - 32px))}
.toast{pointer-events:auto;padding:12px 16px;border-radius:14px;background:var(--text);color:var(--bg);box-shadow:var(--shadow-lift);
  font-weight:500;opacity:0;transform:translateY(12px) scale(.98);transition:opacity .18s var(--ease-ui),transform .26s var(--ease-out)}
.toast.is-on{opacity:1;transform:none}
.toast.is-off{opacity:0;transform:translateY(6px);transition-duration:.14s}

/* 로그인 */
.login{width:min(380px,100%)}
.login .brand{padding:0;margin-bottom:28px}
.login h1{font-size:24px}
.login form{display:flex;flex-direction:column;gap:14px;margin-top:22px}

@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation:none!important}
  .sheet-card,dialog.sheet[data-state=open] .sheet-card{transform:none;filter:none}
  .tooltip,.tooltip.is-on{transform:translate(var(--tx,0),var(--ty,0))}
  .btn:active,.nav-link:active,.seg a:active,.seg label:active,.is-pressed{transform:none}
  .progress span{transition:none}
}
@media (prefers-contrast:more){:root{--line:var(--line-strong)}.panel{box-shadow:none}}
`;

// ── 스크립트 ───────────────────────────────────────────────────────────────────

const SCRIPT = `
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // 누르는 순간 반응한다. 클릭(손을 뗄 때)을 기다리지 않는다. :active 가 터치에서 늦게 붙는 브라우저를 위해 직접 건다.
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.btn, .nav-link, .seg a, .seg label');
    if (!el) return;
    el.classList.add('is-pressed');
    const off = () => { el.classList.remove('is-pressed'); window.removeEventListener('pointerup', off); window.removeEventListener('pointercancel', off); };
    window.addEventListener('pointerup', off);
    window.addEventListener('pointercancel', off);
  });

  // 토스트: 상태·완료·오류. 읽을 시간을 주고 스스로 사라진다.
  window.toast = (text) => {
    const region = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    region.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-on'));
    setTimeout(() => { el.classList.add('is-off'); setTimeout(() => el.remove(), 200); }, 3600);
  };

  // 막대 툴팁: 마우스와 키보드(←/→)가 같은 내용을 보여 준다. 글자는 textContent 로만 넣는다.
  const tip = $('#tip');
  const showTip = (col) => {
    // 칸(col)은 차트 높이 전체라, 위치는 막대 끝에서 잡는다.
    const r = (col.querySelector('.col-bar') || col).getBoundingClientRect();
    tip.querySelector('.tip-value').textContent = col.dataset.value || '';
    tip.querySelector('.tip-label').textContent = col.dataset.label || '';
    tip.style.setProperty('--tx', Math.round(r.left + r.width / 2) + 'px');
    tip.style.setProperty('--ty', Math.round(r.top) + 'px');
    tip.style.translate = '-50% calc(-100% - 10px)';
    tip.classList.add('is-on');
    tip.setAttribute('aria-hidden', 'false');
  };
  const hideTip = () => { tip.classList.remove('is-on'); tip.setAttribute('aria-hidden', 'true'); };
  $$('.chart').forEach((chart) => {
    const cols = $$('.col', chart);
    let on = -1;
    const pick = (i) => {
      if (on >= 0 && cols[on]) cols[on].classList.remove('is-on');
      on = i;
      if (i < 0) { hideTip(); return; }
      cols[i].classList.add('is-on');
      showTip(cols[i]);
    };
    chart.addEventListener('pointermove', (e) => {
      const r = chart.getBoundingClientRect();
      const i = Math.min(cols.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * cols.length)));
      if (i !== on) pick(i);
    });
    chart.addEventListener('pointerleave', () => pick(-1));
    chart.addEventListener('blur', () => pick(-1));
    chart.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault();
      const last = cols.length - 1;
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? last : on < 0 ? last : Math.min(last, Math.max(0, on + (e.key === 'ArrowLeft' ? -1 : 1)));
      pick(next);
    });
  });
  window.addEventListener('scroll', hideTip, { passive: true });

  // 다이얼로그: 누른 버튼 쪽에서 열리고 같은 길로 닫힌다. 상태 속성만 바꾸므로 도중에 되돌려도 지금 값에서 돈다.
  window.openSheet = (dialog, origin) => {
    const card = dialog.querySelector('.sheet-card');
    if (!dialog.open) dialog.showModal();
    if (origin) {
      const o = origin.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      card.style.setProperty('--ox', Math.round(o.left + o.width / 2 - c.left) + 'px');
      card.style.setProperty('--oy', Math.round(o.top + o.height / 2 - c.top) + 'px');
    }
    requestAnimationFrame(() => { dialog.dataset.state = 'open'; });
  };
  window.closeSheet = (dialog) => {
    dialog.dataset.state = 'closed';
    const card = dialog.querySelector('.sheet-card');
    const done = () => { if (dialog.dataset.state === 'closed' && dialog.open) dialog.close(); };
    card.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 220);
  };
  $$('dialog.sheet').forEach((d) => {
    d.addEventListener('cancel', (e) => { e.preventDefault(); if (d.dataset.busy !== 'true') window.closeSheet(d); });
    d.addEventListener('click', (e) => { if (e.target === d && d.dataset.busy !== 'true') window.closeSheet(d); });
  });

  if (window.__page) window.__page({ $, $$ });
})();
`;
