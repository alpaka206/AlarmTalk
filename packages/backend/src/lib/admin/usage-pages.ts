/**
 * 관리자 콘솔 **사용 지표** 화면 — `docs/spec/admin-console.md` 「사용 지표」. 동적 글자는 예외 없이 `escapeHtml` 을 지난다.
 * 숫자의 뜻(가입 전 없음·iOS 울림 하향·해제 ≠ 기상)은 칸 아래에 글로 적는다 — 그림만 보고 오해하지 않게.
 */
import { ENTITLEMENT_SOURCES } from '@alarmtalk/shared';
import type { Percentiles, UsageFilter, UsageMetrics } from './usage-metrics';
import { emptyState, escapeHtml, fmtDateTime, fmtNum, hbarList, page } from './ui';

const SOURCE_LABELS: Record<string, string> = {
  paid: '결제',
  trial: '무료 체험',
  admin: '관리자 지급',
  promo: '기간 한정 개인 플랜',
  free: '무료',
};

const SCOPE_LABELS: Record<string, string> = {
  selected_voice: '고른 목소리',
  all_voices: '기본 목소리 전체',
  bucket: '테마 클립',
  clip: '문구 클립 하나',
  '': '범위 없음',
};

const OFFER_LABELS: Record<string, string> = {
  free_trial: '무료 체험 시작',
  intro: '첫 구독 할인',
  none: '정가 결제',
  unknown: '스토어가 말하지 않음',
};

const ALARM_LABELS: Record<string, string> = {
  alarm_rang: '관측한 울림',
  alarm_dismissed: '해제',
  alarm_snoozed: '다시 알림',
  alarm_updated: '고침(끄기 포함)',
  alarm_deleted: '지움',
};

const PLATFORM_LABELS: Record<string, string> = { android: '안드로이드', ios: 'iOS', '': '플랫폼 모름' };

function pct(part: number, whole: number): string {
  if (whole <= 0) return '-';
  return `${Math.round((part / whole) * 1000) / 10}%`;
}

function seconds(ms: number | null): string {
  if (ms === null) return '-';
  return ms < 1000 ? `${fmtNum(ms)}ms` : `${(Math.round(ms / 100) / 10).toLocaleString('ko-KR')}초`;
}

function bytes(n: number | null): string {
  if (n === null) return '-';
  if (n < 1024) return `${fmtNum(Math.round(n))}B`;
  if (n < 1024 * 1024) return `${(Math.round(n / 102.4) / 10).toLocaleString('ko-KR')}KB`;
  return `${(Math.round(n / (1024 * 102.4)) / 10).toLocaleString('ko-KR')}MB`;
}

function pctl(p: Percentiles): string {
  return p.count === 0 ? '-' : `${seconds(p.p50)} · ${seconds(p.p90)}`;
}

function option(value: string, label: string, current: string): string {
  return `<option value="${escapeHtml(value)}"${value === current ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function filterForm(m: UsageMetrics): string {
  const f = m.filter;
  const versions = m.versions.map((v) => v.version).filter((v, i, all) => all.indexOf(v) === i);
  if (f.appVersion && !versions.includes(f.appVersion)) versions.unshift(f.appVersion);
  return `<form method="get" action="/admin/usage" class="inline" aria-label="거르기" style="flex-wrap:wrap;gap:8px">
  <label class="sr-only" for="f-range">기간</label>
  <select class="input" id="f-range" name="range" style="width:auto">${[7, 30, 90]
    .map((d) => option(String(d), `최근 ${d}일`, String(f.range)))
    .join('')}</select>
  <label class="sr-only" for="f-platform">플랫폼</label>
  <select class="input" id="f-platform" name="platform" style="width:auto">${option('', '모든 플랫폼', f.platform ?? '')}${option(
    'android',
    '안드로이드',
    f.platform ?? '',
  )}${option('ios', 'iOS', f.platform ?? '')}</select>
  <label class="sr-only" for="f-version">앱 버전</label>
  <select class="input" id="f-version" name="version" style="width:auto">${option('', '모든 버전', f.appVersion ?? '')}${versions
    .map((v) => option(v, `버전 ${v}`, f.appVersion ?? ''))
    .join('')}</select>
  <label class="sr-only" for="f-source">권한 출처</label>
  <select class="input" id="f-source" name="source" style="width:auto">${option('', '모든 권한', f.source ?? '')}${ENTITLEMENT_SOURCES.map(
    (s) => option(s, SOURCE_LABELS[s] ?? s, f.source ?? ''),
  ).join('')}</select>
  <button class="btn btn-secondary" type="submit">보기</button>
</form>`;
}

function table(head: string[], body: string[][], numericFrom = 1): string {
  return `<div class="table-wrap"><table><thead><tr>${head
    .map((h, i) => `<th scope="col"${i >= numericFrom ? ' class="num"' : ''}>${escapeHtml(h)}</th>`)
    .join('')}</tr></thead><tbody>${body
    .map((cells) => `<tr>${cells.map((c, i) => `<td${i >= numericFrom ? ' class="num"' : ''}>${escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

function funnelPanel(m: UsageMetrics): string {
  const body = m.funnel.map((s) => [
    s.label,
    `${fmtNum(s.users)}명`,
    s.fromPrevious === null || s.previousUsers === null ? '-' : `${fmtNum(s.fromPrevious)} / ${fmtNum(s.previousUsers)}명`,
    s.fromPrevious === null || s.previousUsers === null ? '-' : pct(s.fromPrevious, s.previousUsers),
  ]);
  const auth = m.auth.length
    ? `<h3 style="font-size:13px;margin:18px 0 10px;color:var(--text-2)">로그인 결과</h3>${table(
        ['수단 · 결과', '횟수'],
        m.auth.map((a) => [`${a.method} · ${a.outcome}`, `${fmtNum(a.count)}회`]),
      )}`
    : '';
  return `<section class="panel reveal" style="--d:1" aria-labelledby="u-funnel">
  <div class="panel-head"><h2 id="u-funnel">첫 경험</h2></div>
  ${table(['단계', '한 사람', '앞 단계도 한 사람 중', '전환'], body)}
  ${auth}
  <p class="note">로그인하고 처리방침에 동의한 계정의 기록만 모여요. 가입 전에는 아무것도 모으지 않아서, 첫 칸은 앱을 처음 연 사람이 아니에요. 전환은 같은 기간에 앞 단계도 한 사람 중 이 단계까지 온 비율이에요.</p>
</section>`;
}

function preparationPanel(m: UsageMetrics): string {
  const rows = m.preparation.map((p) => [
    SCOPE_LABELS[p.scope] ?? p.scope,
    fmtNum(p.started),
    fmtNum(p.ready),
    fmtNum(p.failed),
    pctl(p.duration),
    bytes(p.avgBytes),
  ]);
  const failures = m.preparationFailures.length
    ? `<h3 style="font-size:13px;margin:18px 0 10px;color:var(--text-2)">준비 실패 코드</h3>${hbarList(
        m.preparationFailures.map((x) => ({ label: x.code, value: x.count })),
        '회',
      )}`
    : '';
  const cache = m.preparationCache.length
    ? `<h3 style="font-size:13px;margin:18px 0 10px;color:var(--text-2)">시작할 때 기기에 있던 정도</h3>${table(
        ['범위 · 캐시', '횟수'],
        m.preparationCache.map((x) => [`${SCOPE_LABELS[x.scope] ?? x.scope} · ${x.cache}`, `${fmtNum(x.count)}회`]),
      )}`
    : '';
  return `<section class="panel reveal" style="--d:2" aria-labelledby="u-prep">
  <div class="panel-head"><h2 id="u-prep">음성 준비</h2><span class="muted" style="font-size:12.5px">끝나지 않은 시작 ${fmtNum(
    m.preparationUnfinished,
  )}회</span></div>
  ${rows.length ? table(['범위', '시작', '완료', '실패', '준비시간 중앙 · 90%', '평균 크기'], rows) : emptyState('준비 기록이 없어요', '이 기간에 목소리를 받은 기록이 없어요.')}
  ${failures}${cache}
  <p class="note">준비시간은 받는 작업이 단조 시계로 잰 시간이고, 이미 기기에 다 있던 시도는 빼요. 준비 시작부터 알람 저장까지의 차이에는 사용자가 고르는 시간이 섞여서 다운로드 대기시간으로 쓰지 않아요. 앱을 다시 켜면 새 시도라, 끝나지 않은 시작은 실패로 세지 않아요.</p>
</section>`;
}

function savePanel(m: UsageMetrics): string {
  return `<section class="panel reveal" style="--d:3" aria-labelledby="u-save">
  <div class="panel-head"><h2 id="u-save">알람 저장</h2></div>
  <dl class="kv">
    <div><dt>저장 시도</dt><dd>${fmtNum(m.save.attempts)}회</dd></div>
    <div><dt>요청 전에 막힘</dt><dd>${fmtNum(m.save.blocked)}회 <span class="muted">· ${pct(m.save.blocked, m.save.attempts)}</span></dd></div>
    <div><dt>예약과 파일까지 준비됨</dt><dd>${fmtNum(m.save.ready)}회 <span class="muted">· ${pct(m.save.ready, m.save.attempts)}</span></dd></div>
  </dl>
  ${
    m.saveBlockReasons.length
      ? `<h3 style="font-size:13px;margin:18px 0 10px;color:var(--text-2)">막힌 사유</h3>${hbarList(
          m.saveBlockReasons.map((x) => ({ label: x.reason, value: x.count })),
          '회',
        )}`
      : ''
  }
  <p class="note">'준비됨' 은 OS 예약과 오디오 파일이 둘 다 갖춰진 순간이에요. 알람 행이 생긴 것(알람 만듦)과는 달라요.</p>
</section>`;
}

function manualPanel(m: UsageMetrics): string {
  const x = m.manual;
  return `<section class="panel reveal" style="--d:4" aria-labelledby="u-manual">
  <div class="panel-head"><h2 id="u-manual">직접 입력</h2></div>
  <dl class="kv">
    <div><dt>새로 만듦</dt><dd>${fmtNum(x.created)}회${x.avgChars === null ? '' : ` <span class="muted">· 평균 ${fmtNum(x.avgChars)}자</span>`}</dd></div>
    <div><dt>만들기 실패</dt><dd>${fmtNum(x.failed)}회</dd></div>
    <div><dt>다시 씀(기기)</dt><dd>${fmtNum(x.reusedLocal)}회</dd></div>
    <div><dt>다시 씀(서버)</dt><dd>${fmtNum(x.reusedServer)}회</dd></div>
    <div><dt>광고 보상 사용</dt><dd>${fmtNum(x.rewardSpent)}회</dd></div>
  </dl>
  ${
    x.charged.length
      ? `<h3 style="font-size:13px;margin:18px 0 10px;color:var(--text-2)">서버가 처리한 것의 정산</h3>${hbarList(
          x.charged.map((c) => ({
            label: c.source === 'base' ? '기본 제공분' : c.source === 'ad' ? '광고 보상' : c.source === 'none' ? '차감 없음' : c.source,
            value: c.count,
          })),
          '회',
        )}`
      : ''
  }
  <p class="note">기기에서 다시 쓴 것은 차감하지 않고, 서버에서 다시 받은 것은 새로 만든 것처럼 1회로 세요. 문구 원문은 기록하지 않고 글자 수만 남겨요.</p>
</section>`;
}

function adsPanel(m: UsageMetrics): string {
  const a = m.ads;
  return `<section class="panel reveal" style="--d:5" aria-labelledby="u-ads">
  <div class="panel-head"><h2 id="u-ads">광고 보상</h2></div>
  <dl class="kv">
    <div><dt>제안</dt><dd>${fmtNum(a.offered)}회</dd></div>
    <div><dt>시청 시작</dt><dd>${fmtNum(a.viewStarted)}회</dd></div>
    <div><dt>지급 대기</dt><dd>${fmtNum(a.pending)}회</dd></div>
    <div><dt>지급</dt><dd>${fmtNum(a.granted)}회 <span class="muted">· 대기 중앙 · 90% ${escapeHtml(pctl(a.grantDelay))}</span></dd></div>
    <div><dt>30분 넘게 지급 없음</dt><dd>${fmtNum(a.missing)}회</dd></div>
    <div><dt>사용</dt><dd>${fmtNum(a.spent)}회</dd></div>
  </dl>
  <p class="note">지급은 AdMob 서버 확인(SSV)이 적립된 뒤에만 적혀요. 운영 스위치가 꺼져 있으면 모두 0이에요. 순수익과 제작 비용은 여기서 알 수 없어요.</p>
</section>`;
}

function billingPanel(m: UsageMetrics): string {
  const b = m.billing;
  const sources = m.usersBySource.length
    ? hbarList(
        m.usersBySource.map((s) => ({ label: SOURCE_LABELS[s.source] ?? s.source, value: s.users })),
        '명',
      )
    : '<p class="muted">권한 출처가 찍힌 기록이 아직 없어요.</p>';
  const purchases = b.purchases.length
    ? table(
        ['스토어 조건 · 결과', '횟수', '사람'],
        b.purchases.map((p) => [`${OFFER_LABELS[p.offer] ?? p.offer} · ${p.outcome}`, `${fmtNum(p.count)}회`, `${fmtNum(p.users)}명`]),
      )
    : '<p class="muted">구매 확인 기록이 없어요.</p>';
  const views = b.paywallViews.length
    ? table(
        ['연 자리', '횟수', '사람'],
        b.paywallViews.map((p) => [p.surface, `${fmtNum(p.count)}회`, `${fmtNum(p.users)}명`]),
      )
    : '<p class="muted">결제 화면 기록이 없어요.</p>';
  const changes = b.changes.length
    ? table(
        ['앞 → 뒤', '횟수'],
        b.changes.map((c) => [`${c.from} → ${c.to}`, `${fmtNum(c.count)}회`]),
      )
    : '<p class="muted">권한이 바뀐 기록이 없어요.</p>';
  return `<section class="panel reveal" style="--d:6" aria-labelledby="u-billing">
  <div class="panel-head"><h2 id="u-billing">결제와 권한</h2></div>
  <h3 style="font-size:13px;margin:0 0 10px;color:var(--text-2)">권한 출처별 사람</h3>
  ${sources}
  <h3 style="font-size:13px;margin:18px 0 10px;color:var(--text-2)">결제 화면</h3>
  ${views}
  <h3 style="font-size:13px;margin:18px 0 10px;color:var(--text-2)">스토어 구매 확인</h3>
  ${purchases}
  <h3 style="font-size:13px;margin:18px 0 10px;color:var(--text-2)">권한 변경</h3>
  ${changes}
  <p class="note">권한 출처는 서버가 기록을 받는 순간의 계정 상태예요. 한 사람은 기간 안 마지막 기록의 출처 하나로만 세어 겹치지 않아요. 서버는 아직 무료 체험 구간을 따로 알지 못해 체험 중인 구독도 결제로 세요. 체험과 결제는 스토어 구매 확인의 조건으로 구분해요.</p>
</section>`;
}

function alarmsPanel(m: UsageMetrics): string {
  const byPlatform = new Map<string, Map<string, number>>();
  for (const a of m.alarms) {
    const map = byPlatform.get(a.platform) ?? new Map<string, number>();
    map.set(a.type, a.count);
    byPlatform.set(a.platform, map);
  }
  const types = Object.keys(ALARM_LABELS);
  const platforms = [...byPlatform.keys()].sort();
  const body = types.map((t) => [
    ALARM_LABELS[t] ?? t,
    ...platforms.map((p) => {
      const count = byPlatform.get(p)?.get(t);
      return count === undefined ? (p === 'ios' && t === 'alarm_rang' ? '관측 없음' : '0') : fmtNum(count);
    }),
  ]);
  return `<section class="panel reveal" style="--d:7" aria-labelledby="u-alarms">
  <div class="panel-head"><h2 id="u-alarms">알람 상호작용</h2></div>
  ${platforms.length ? table(['종류', ...platforms.map((p) => PLATFORM_LABELS[p] ?? p)], body) : emptyState('기록이 없어요', '이 기간에 관측한 알람 상호작용이 없어요.')}
  <p class="note">iOS 는 아무도 누르지 않은 울림을 적지 못해서 울림 수가 실제보다 적어요. 관측이 없다고 울리지 않은 것은 아니에요. 해제는 기상 성공이 아니에요. 화면을 벗어나 꺼진 경우도 해제로 적혀요.</p>
</section>`;
}

export function renderUsage(nonce: string, m: UsageMetrics): string {
  const f: UsageFilter = m.filter;
  const scope = [
    `최근 ${f.range}일`,
    f.platform ? (PLATFORM_LABELS[f.platform] ?? f.platform) : '',
    f.appVersion ? `버전 ${f.appVersion}` : '',
    f.source ? (SOURCE_LABELS[f.source] ?? f.source) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const body = `
<header class="page-head reveal">
  <div><h1>사용 지표</h1><p class="muted">${escapeHtml(fmtDateTime(m.generatedAt))} 기준 · ${escapeHtml(scope)}</p></div>
  ${filterForm(m)}
</header>
<div class="grid grid-2 section-gap">${funnelPanel(m)}${savePanel(m)}</div>
<div class="section-gap">${preparationPanel(m)}</div>
<div class="grid grid-2 section-gap">${manualPanel(m)}${adsPanel(m)}</div>
<div class="grid grid-2 section-gap">${billingPanel(m)}${alarmsPanel(m)}</div>
<p class="note">플랫폼·앱 버전·권한 출처로 거르면 그 칸이 있는 새 기록만 남아요. 옛 앱이 보낸 기록에는 앱 버전과 권한 출처가 없어요.</p>`;
  return page({ title: '사용 지표', active: 'usage', nonce, body });
}
