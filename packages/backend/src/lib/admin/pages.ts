/**
 * 관리자 콘솔 화면들 — 개요 · 사용자 · 알림 보내기 · 로그인. `docs/spec/admin-console.md` 「화면」.
 * 동적 글자는 예외 없이 `escapeHtml` 을 지난다.
 */
import { appVersionPolicy } from '../app-version';
import { USAGE_EVENT_MIN_PRIVACY_VERSION } from '../consent';
import type { Overview, PushJobRow, RangeDays, UserRow } from './metrics';
import { AD_HOURS_KST, AD_OPT_OUT_FOOTER, AD_TITLE_PREFIX, PUSH_BODY_MAX, PUSH_TITLE_MAX } from './push-jobs';
import {
  badge,
  columnChart,
  emptyState,
  escapeHtml,
  fmtAgo,
  fmtDate,
  fmtDateTime,
  fmtNum,
  hbarList,
  page,
  sparkline,
} from './ui';

const THEME_LABELS: Record<string, string> = {
  weather: '날씨',
  fortune: '운세',
  cheer: '응원',
  love: '응원',
  medication: '약',
  greeting: '기본 인사말',
  '': '테마 없음',
};

const EVENT_LABELS: Record<string, string> = {
  alarm_created: '알람 만듦',
  alarm_updated: '알람 고침',
  alarm_deleted: '알람 지움',
  alarm_rang: '알람 울림',
  alarm_dismissed: '알람 끔',
  alarm_snoozed: '다시 알림',
  manual_message_attached: '직접 입력 문구 붙임',
  manual_message_released: '직접 입력 문구 정리',
  voice_created: '목소리 등록',
  voice_deleted: '목소리 삭제',
};

const COUNTRY_LABELS: Record<string, string> = { KR: '한국', JP: '일본', US: '미국' };

const PLATFORM_LABELS = { android: '안드로이드', ios: 'iOS' } as const;

// ── 로그인 ─────────────────────────────────────────────────────────────────────

export function renderLogin(nonce: string, error: string | null): string {
  return page({
    title: '로그인',
    active: null,
    nonce,
    bare: true,
    body: `<div class="login reveal">
  <span class="brand" translate="no"><span class="brand-mark" aria-hidden="true"></span><span>알람톡 <b>관리</b></span></span>
  <h1>관리자 로그인</h1>
  <p class="muted" style="margin-top:6px">관리자 비밀번호로 들어와요. 12시간 동안 유지돼요.</p>
  <form method="post" action="/admin/login">
    <div class="field">
      <label class="field-label" for="password">비밀번호</label>
      <input class="input" id="password" name="password" type="password" required autocomplete="current-password" autofocus${
        error ? ' aria-invalid="true" aria-describedby="login-error"' : ''
      }>
      ${error ? `<p class="form-error" id="login-error" role="alert">${escapeHtml(error)}</p>` : ''}
    </div>
    <button class="btn btn-primary" type="submit">로그인</button>
  </form>
</div>`,
  });
}

// ── 개요 ──────────────────────────────────────────────────────────────────────

function rangeSwitch(range: RangeDays): string {
  return `<nav class="seg" aria-label="기간">${([7, 30, 90] as const)
    .map((d) => `<a href="/admin?range=${d}"${d === range ? ' aria-current="true"' : ''}>${d}일</a>`)
    .join('')}</nav>`;
}

function versionRows(o: Overview): string {
  const blocks = (['android', 'ios'] as const).map((platform) => {
    const policy = appVersionPolicy(platform);
    const items = o.versions
      .filter((v) => v.platform === platform)
      .map((v) => {
        const extra =
          v.version < policy.minSupported
            ? badge('업데이트 차단 대상', 'bad')
            : v.version < policy.latest
              ? badge('업데이트 권장', 'warn')
              : badge('최신', 'good');
        return { label: `빌드 ${v.version}`, value: v.users, extra };
      });
    const body = items.length
      ? hbarList(items, '명')
      : `<p class="muted">최근 30일 동안 기록된 ${PLATFORM_LABELS[platform]} 기기가 없어요.</p>`;
    return `<div class="stack" style="gap:12px">
      <div class="inline" style="justify-content:space-between"><h3 style="font-size:14px">${PLATFORM_LABELS[platform]}</h3>
      <span class="muted" style="font-size:12.5px">최신 ${policy.latest} · 최소 ${policy.minSupported}</span></div>
      ${body}
    </div>`;
  });
  return blocks.join('<hr style="border:0;border-top:1px solid var(--line);margin:18px 0">');
}

/** 날짜별 가입을 누적으로 — 기간 첫날 앞까지의 가입자 수에서 시작한다. */
function cumulative(o: Overview): number[] {
  let running = o.users.total - o.signupsByDay.reduce((sum, p) => sum + p.value, 0);
  return o.signupsByDay.map((p) => (running += p.value));
}

export function renderOverview(nonce: string, o: Overview, nowMs: number): string {
  const trackedNote = o.active.tracked > 0 ? '콘솔 배포 뒤 서버에 접속한 기기 기준' : '아직 기록 전이에요';
  const reconsentTone = o.consent.reconsentNeeded > 0 ? 'warn' : 'good';
  const weatherRows = o.weather.length
    ? `<dl class="kv">${o.weather
        .map((w) => {
          const tone = w.unresolved > 0 ? 'warn' : 'good';
          return `<div><dt>${escapeHtml(COUNTRY_LABELS[w.country] ?? w.country)} <span class="muted" style="font-size:12px">· ${fmtNum(
            w.rows,
          )}칸 · ${escapeHtml(fmtAgo(w.lastComputedAt, nowMs))} 계산</span></dt><dd>${
            w.unresolved > 0 ? badge(`미해결 ${fmtNum(w.unresolved)}칸`, tone) : badge('정상', tone)
          }</dd></div>`;
        })
        .join('')}</dl>`
    : emptyState('날씨 칸이 없어요', '미리 계산한 오늘 이후 날씨가 없어요. 기상 원천이나 cron 을 확인해 주세요.');

  const themes = hbarList(
    o.alarmThemes.map((t) => ({
      label: THEME_LABELS[t.theme] ?? t.theme,
      value: t.active,
      sub: `전체 ${fmtNum(t.total)}개 중 켜짐`,
    })),
    '개',
  );

  const pushes = o.recentPushes.length
    ? `<div class="table-wrap"><table><thead><tr><th scope="col">보낸 시각</th><th scope="col">제목</th><th scope="col" class="num">성공</th><th scope="col">상태</th></tr></thead><tbody>${o.recentPushes
        .map(
          (p) => `<tr><td class="tnum">${escapeHtml(fmtDateTime(p.createdAt))}</td><td><span class="cell-main">${escapeHtml(
            p.title,
          )}</span>${p.isTest ? ` ${badge('시험', 'neutral')}` : ''}${p.kind === 'ad' ? ` ${badge('광고', 'neutral')}` : ''}</td><td class="num">${fmtNum(
            p.sent,
          )}${p.failed ? ` <span class="muted">/ 실패 ${fmtNum(p.failed)}</span>` : ''}</td><td>${jobStatusBadge(p.status)}</td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : emptyState('아직 보낸 알림이 없어요', '알림 보내기에서 시험 발송부터 해 보세요.', '<a class="btn btn-secondary btn-sm" href="/admin/push">알림 보내기</a>');

  const body = `
<header class="page-head reveal">
  <div><h1>개요</h1><p class="muted">${escapeHtml(fmtDateTime(o.generatedAt))} 기준</p></div>
  ${rangeSwitch(o.range)}
</header>

<div class="grid grid-hero">
  <section class="panel hero reveal" style="--d:1" aria-labelledby="k-users">
    <h2 id="k-users" class="label">전체 가입자</h2>
    <div><span class="hero-value">${fmtNum(o.users.total)}</span>${sparkline(cumulative(o))}</div>
    <p class="meta"><span>오늘 <b>+${fmtNum(o.users.today)}</b></span><span>최근 ${o.range}일 <b>+${fmtNum(
      o.users.inRange,
    )}</b></span><span>탈퇴 대기 <b>${fmtNum(o.users.pendingDeletion)}</b></span></p>
  </section>
  <section class="panel tile reveal" style="--d:2" aria-labelledby="k-active">
    <h2 id="k-active" class="label">앱 접속 (7일)</h2>
    <span class="tile-value">${fmtNum(o.active.d7)}<span class="muted" style="font-size:16px;font-weight:500"> 명</span></span>
    <p class="meta"><span>오늘 <b>${fmtNum(o.active.d1)}</b></span><span>30일 <b>${fmtNum(o.active.d30)}</b></span></p>
    <p class="tile-foot muted" style="font-size:12px">${escapeHtml(trackedNote)}</p>
  </section>
  <section class="panel tile reveal" style="--d:3" aria-labelledby="k-alarms">
    <h2 id="k-alarms" class="label">켜진 알람</h2>
    <span class="tile-value">${fmtNum(o.alarms.active)}<span class="muted" style="font-size:16px;font-weight:500"> 개</span></span>
    <p class="meta"><span><b>${fmtNum(o.alarms.usersWithActive)}</b>명이 사용 중</span><span>전체 <b>${fmtNum(o.alarms.total)}</b></span></p>
  </section>
  <section class="panel tile reveal" style="--d:4" aria-labelledby="k-plus">
    <h2 id="k-plus" class="label">플러스 이용</h2>
    <span class="tile-value">${fmtNum(o.plus.users)}<span class="muted" style="font-size:16px;font-weight:500"> 명</span></span>
    <p class="meta"><span>활성 구독 <b>${fmtNum(o.plus.activeSubscriptions)}</b></span></p>
  </section>
  <section class="panel tile reveal" style="--d:5" aria-labelledby="k-consent">
    <h2 id="k-consent" class="label">재동의 필요</h2>
    <span class="tile-value">${fmtNum(o.consent.reconsentNeeded)}<span class="muted" style="font-size:16px;font-weight:500"> 명</span></span>
    <div class="tile-foot">${
      o.consent.reconsentNeeded > 0
        ? `${badge('서버가 요청을 막는 중', reconsentTone)}<a class="btn btn-secondary btn-sm" href="/admin/push?preset=reconsent">안내 보내기</a>`
        : badge('모두 동의 완료', reconsentTone)
    }</div>
  </section>
</div>

<div class="grid grid-2 section-gap">
  <div class="reveal" style="--d:6">${columnChart({ id: 'signups', title: '날짜별 가입', points: o.signupsByDay, unit: '명' })}</div>
  <div class="reveal" style="--d:7">${columnChart({
    id: 'rings',
    title: '날짜별 알람 울림',
    points: o.ringsByDay,
    unit: '회',
    note: `처리방침 ${USAGE_EVENT_MIN_PRIVACY_VERSION}판 이상에 동의한 사람의 기록만 모여요. 앱이 열릴 때 한꺼번에 올라와서 오늘 값은 늦게 찰 수 있어요.`,
  })}</div>
</div>

<div class="grid grid-2 section-gap">
  <section class="panel reveal" style="--d:8" aria-labelledby="s-build">
    <div class="panel-head"><h2 id="s-build">앱 빌드 (최근 30일 접속)</h2></div>
    ${o.active.tracked === 0 ? emptyState('아직 기록된 빌드가 없어요', '이 콘솔이 배포된 뒤 앱이 서버에 접속하면 빌드가 쌓여요.') : versionRows(o)}
  </section>
  <section class="panel reveal" style="--d:9" aria-labelledby="s-reach">
    <div class="panel-head"><h2 id="s-reach">알림을 받을 수 있는 사람</h2><span class="figure-sm">${fmtNum(o.devices.any)}<span class="muted" style="font-size:13px;font-weight:500"> 명</span></span></div>
    <dl class="kv">
      <div><dt>안드로이드</dt><dd>${fmtNum(o.devices.android)}명</dd></div>
      <div><dt>iOS</dt><dd>${fmtNum(o.devices.ios)}명</dd></div>
      <div><dt>광고성 정보 수신 동의</dt><dd>${fmtNum(o.consent.marketingAgreed)}명</dd></div>
    </dl>
    <p class="note">알림 권한을 허용하고 로그인한 기기 기준이에요. 탈퇴 대기 중인 사람은 빼요.</p>
  </section>
</div>

<div class="grid grid-2 section-gap">
  <section class="panel reveal" style="--d:10" aria-labelledby="s-theme">
    <div class="panel-head"><h2 id="s-theme">켜진 알람의 문구 테마</h2></div>
    ${themes || emptyState('알람이 없어요', '아직 서버에 올라온 알람이 없어요.')}
    <p class="note">'테마 없음' 은 직접 입력·직접 녹음·알람음만 쓰는 알람이에요.</p>
  </section>
  <section class="panel reveal" style="--d:11" aria-labelledby="s-month">
    <div class="panel-head"><h2 id="s-month">이번 달</h2></div>
    <dl class="kv">
      <div><dt>등록된 내 목소리</dt><dd>${fmtNum(o.voices.custom)}개 <span class="muted">· ${fmtNum(o.voices.owners)}명</span></dd></div>
      <div><dt>직접 입력 음성 생성</dt><dd>${fmtNum(o.manualTtsUsed)}회</dd></div>
      <div><dt>광고 보상 적립</dt><dd>${fmtNum(o.adRewards.granted)}회 <span class="muted">· 사용 ${fmtNum(o.adRewards.used)}</span></dd></div>
    </dl>
    ${
      o.eventTotals.length
        ? `<h3 style="font-size:13px;margin:18px 0 10px;color:var(--text-2)">최근 ${o.range}일 사용 기록</h3>${hbarList(
            o.eventTotals.map((e) => ({ label: EVENT_LABELS[e.type] ?? e.type, value: e.count })),
            '회',
          )}`
        : ''
    }
  </section>
</div>

<div class="grid grid-2 section-gap">
  <section class="panel reveal" style="--d:12" aria-labelledby="s-weather">
    <div class="panel-head"><h2 id="s-weather">날씨 데이터</h2><span class="muted" style="font-size:12.5px">오늘 이후 미리 계산한 칸</span></div>
    ${weatherRows}
  </section>
  <section class="panel reveal" style="--d:13" aria-labelledby="s-store">
    <div class="panel-head"><h2 id="s-store">스토어 다운로드</h2></div>
    ${emptyState(
      '스토어 연동 전이에요',
      '다운로드 수는 Play 콘솔 통계 보고서와 App Store Connect 분석 보고서에만 있어요. 두 곳의 읽기 권한을 연결하면 여기에 하루 한 번 채워요.',
    )}
  </section>
</div>

<section class="panel section-gap reveal" style="--d:14" aria-labelledby="s-push">
  <div class="panel-head"><h2 id="s-push">최근 알림</h2><a class="btn btn-ghost btn-sm" href="/admin/push">전체 기록</a></div>
  ${pushes}
</section>`;
  return page({ title: '개요', active: 'overview', nonce, body });
}

// ── 사용자 ────────────────────────────────────────────────────────────────────

export function renderUsers(nonce: string, query: string, users: UserRow[], nowMs: number): string {
  const rows = users
    .map((u) => {
      const builds = [
        u.android != null ? `안드로이드 ${u.android}` : '',
        u.ios != null ? `iOS ${u.ios}` : '',
      ].filter(Boolean);
      const states = [
        u.deletionStatus === 'pending_deletion' ? badge('탈퇴 대기', 'bad') : '',
        u.reconsentNeeded ? badge('재동의 필요', 'warn') : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `<tr>
  <td class="tnum">${escapeHtml(fmtDate(u.createdAt))}</td>
  <td><div class="cell-main" translate="no">${escapeHtml(u.email || '이메일 없음')}</div><div class="cell-sub">${escapeHtml(
    u.name || '이름 없음',
  )}</div></td>
  <td class="tnum">${builds.length ? builds.map((b) => escapeHtml(b)).join('<br>') : '<span class="muted">기록 없음</span>'}</td>
  <td class="tnum">${escapeHtml(fmtAgo(u.lastSeenAt, nowMs))}</td>
  <td class="num">${fmtNum(u.devices)}</td>
  <td class="num">${fmtNum(u.activeAlarms)}</td>
  <td>${u.plan === 'plus' ? badge('플러스', 'neutral') : '<span class="muted">무료</span>'}</td>
  <td>${states || '<span class="muted">정상</span>'}</td>
  <td>${
    u.email && u.devices > 0
      ? `<a class="btn btn-ghost btn-sm" href="/admin/push?test=${encodeURIComponent(u.email)}">시험 발송</a>`
      : ''
  }</td>
</tr>`;
    })
    .join('');
  const table = users.length
    ? `<div class="table-wrap"><table>
  <thead><tr><th scope="col">가입일</th><th scope="col">계정</th><th scope="col">앱 빌드</th><th scope="col">마지막 접속</th>
  <th scope="col" class="num">알림 기기</th><th scope="col" class="num">켜진 알람</th><th scope="col">플랜</th><th scope="col">상태</th><th scope="col"><span class="sr-only">동작</span></th></tr></thead>
  <tbody>${rows}</tbody></table></div>`
    : emptyState(
        query ? '찾는 사용자가 없어요' : '아직 가입자가 없어요',
        query ? '이메일 일부만 적어도 찾아요. 계정 id 는 전체를 적어 주세요.' : '',
      );
  const body = `
<header class="page-head reveal">
  <div><h1>사용자</h1><p class="muted">${query ? `‘${escapeHtml(query)}’ 검색 결과 ${fmtNum(users.length)}명` : '최근 가입한 50명'}</p></div>
  <form method="get" action="/admin/users" class="inline" role="search">
    <label class="sr-only" for="q">이메일, 이름 또는 계정 id</label>
    <input class="input" id="q" name="q" type="search" value="${escapeHtml(query)}" placeholder="이메일, 이름, 계정 id…"
      autocomplete="off" spellcheck="false" style="width:min(320px,70vw)">
    <button class="btn btn-secondary" type="submit">찾기</button>
  </form>
</header>
<section class="panel reveal" style="--d:1" aria-label="사용자 목록">${table}</section>
<p class="note">앱 빌드와 마지막 접속은 콘솔 배포 뒤 서버에 접속한 기기만 보여요.</p>`;
  return page({ title: '사용자', active: 'users', nonce, body });
}

// ── 알림 보내기 ────────────────────────────────────────────────────────────────

export function jobStatusBadge(status: string): string {
  if (status === 'done') return badge('완료', 'good');
  if (status === 'canceled') return badge('중단', 'neutral');
  return badge('보내는 중', 'warn');
}

const RECONSENT_PRESET = {
  title: '앱을 열어 동의를 마쳐 주세요',
  body: '개인정보 처리방침이 바뀌어 다시 동의가 필요해요. 알람은 그대로 울리지만, 동의 전에는 날씨 같은 정보를 새로 받아 오지 못해요.',
};

export function renderPush(
  nonce: string,
  opts: { jobs: PushJobRow[]; testEmail: string; preset: string | null },
): string {
  const preset = opts.preset === 'reconsent' ? RECONSENT_PRESET : null;
  const history = opts.jobs.length
    ? `<div class="table-wrap"><table>
<thead><tr><th scope="col">보낸 시각</th><th scope="col">알림</th><th scope="col" class="num">성공</th><th scope="col" class="num">실패</th><th scope="col">상태</th><th scope="col"><span class="sr-only">동작</span></th></tr></thead>
<tbody>${opts.jobs
        .map(
          (j) => `<tr data-job="${escapeHtml(j.id)}">
  <td class="tnum">${escapeHtml(fmtDateTime(j.createdAt))}</td>
  <td><div class="cell-main">${escapeHtml(j.title)} ${j.isTest ? badge('시험', 'neutral') : ''} ${
    j.kind === 'ad' ? badge('광고', 'neutral') : ''
  }</div><div class="cell-sub">${escapeHtml(j.body.length > 80 ? `${j.body.slice(0, 80)}…` : j.body)}</div></td>
  <td class="num">${fmtNum(j.sent)}${j.isTest ? '' : `<span class="muted"> / 약 ${fmtNum(j.estimatedTotal)}</span>`}</td>
  <td class="num">${fmtNum(j.failed)}</td>
  <td>${jobStatusBadge(j.status)}</td>
  <td>${!j.isTest && j.status === 'sending' ? `<button class="btn btn-secondary btn-sm" type="button" data-resume="${escapeHtml(j.id)}">이어 보내기</button>` : ''}</td>
</tr>`,
        )
        .join('')}</tbody></table></div>`
    : emptyState('보낸 알림이 없어요', '위에서 문구를 쓰고 시험 발송부터 해 보세요.');

  const body = `
<header class="page-head reveal"><div><h1>알림 보내기</h1><p class="muted">고른 사람의 기기에 푸시 알림을 보내요. 전체 발송 전에 같은 문구로 시험 발송을 먼저 해야 해요.</p></div></header>

<form id="push-form" class="grid grid-2" novalidate autocomplete="off">
  <div class="stack">
    <section class="panel reveal" style="--d:1" aria-labelledby="f-copy">
      <div class="panel-head"><h2 id="f-copy">문구</h2></div>
      <div class="stack">
        <fieldset>
          <legend>종류</legend>
          <div class="seg" role="radiogroup">
            <input type="radio" name="kind" id="kind-notice" value="notice" checked><label for="kind-notice">서비스 안내</label>
            <input type="radio" name="kind" id="kind-ad" value="ad"><label for="kind-ad">광고</label>
          </div>
          <p class="field-help" id="kind-help" style="margin-top:8px">업데이트·재동의·장애 같은 안내예요. 수신 동의와 시간 제한 없이 보낼 수 있어요.</p>
        </fieldset>
        <div class="field">
          <label class="field-label" for="title"><span>제목</span><span class="muted num" id="title-count">0/${PUSH_TITLE_MAX}</span></label>
          <input class="input" id="title" name="title" maxlength="${PUSH_TITLE_MAX}" required value="${escapeHtml(preset?.title ?? '')}" placeholder="예: 새 버전이 나왔어요…">
        </div>
        <div class="field">
          <label class="field-label" for="body"><span>본문</span><span class="muted num" id="body-count">0/${PUSH_BODY_MAX}</span></label>
          <textarea class="textarea" id="body" name="body" maxlength="${PUSH_BODY_MAX}" required placeholder="예: 스토어에서 업데이트하면 날씨 알람이 다시 정확해져요…">${escapeHtml(
            preset?.body ?? '',
          )}</textarea>
        </div>
      </div>
    </section>

    <section class="panel reveal" style="--d:2" aria-labelledby="f-aud">
      <div class="panel-head"><h2 id="f-aud">받는 사람</h2></div>
      <div class="stack">
        <fieldset>
          <legend>플랫폼</legend>
          <div class="seg" role="radiogroup">
            <input type="radio" name="platform" id="pf-all" value="all" checked><label for="pf-all">전체</label>
            <input type="radio" name="platform" id="pf-android" value="android"><label for="pf-android">안드로이드</label>
            <input type="radio" name="platform" id="pf-ios" value="ios"><label for="pf-ios">iOS</label>
          </div>
        </fieldset>
        <fieldset>
          <legend>앱 빌드</legend>
          <div class="stack" style="gap:10px">
            <label class="inline" data-for-platform="android"><span style="min-width:6.5em">안드로이드</span>
              <input class="input input-num num" type="number" inputmode="numeric" min="1" name="androidBelow" placeholder="예: ${appVersionPolicy('android').latest}">
              <span class="muted">미만만</span></label>
            <label class="inline" data-for-platform="ios"><span style="min-width:6.5em">iOS</span>
              <input class="input input-num num" type="number" inputmode="numeric" min="1" name="iosBelow" placeholder="예: ${appVersionPolicy('ios').latest}">
              <span class="muted">미만만</span></label>
            <label class="check"><input type="checkbox" name="includeUnknownVersion"><span>빌드 기록이 없는 기기도 넣기<br><span class="field-help">콘솔 배포 뒤 아직 앱을 열지 않은 기기예요.</span></span></label>
          </div>
        </fieldset>
        <fieldset>
          <legend>조건</legend>
          <label class="check"><input type="checkbox" name="reconsentOnly"${preset ? ' checked' : ''}><span>재동의가 필요한 사람만<br><span class="field-help">필수 동의가 모자라 서버가 요청을 막고 있는 사람이에요.</span></span></label>
          <label class="check"><input type="checkbox" name="activeAlarmOnly"><span>켜진 알람이 있는 사람만</span></label>
          <label class="check" id="marketing-row"><input type="checkbox" name="marketingOnly"><span>광고성 정보 수신 동의자만<br><span class="field-help">광고를 고르면 언제나 이 조건이 붙어요.</span></span></label>
        </fieldset>
      </div>
    </section>
  </div>

  <div>
    <div class="stack sticky">
      <section class="panel reveal" style="--d:3" aria-labelledby="f-preview">
        <div class="panel-head"><h2 id="f-preview">미리보기</h2></div>
        <div class="notif" aria-live="off">
          <span class="notif-icon" aria-hidden="true"></span>
          <div style="min-width:0">
            <div class="notif-app"><span translate="no">알람톡</span><span>지금</span></div>
            <div class="notif-title" id="pv-title">제목</div>
            <div class="notif-body" id="pv-body">본문</div>
          </div>
        </div>
        <div class="count section-gap" id="count" aria-live="polite" data-loading="true">
          <span class="count-main" id="count-main">세는 중…</span><span class="muted" id="count-sub"></span>
        </div>
      </section>

      <section class="panel reveal" style="--d:4" aria-labelledby="f-send">
        <div class="panel-head"><h2 id="f-send">보내기</h2></div>
        <div class="stack">
          <div class="field">
            <label class="field-label" for="test-email">시험 발송 받을 계정</label>
            <div class="inline" style="flex-wrap:nowrap">
              <input class="input" id="test-email" name="testEmail" type="email" inputmode="email" autocomplete="off" spellcheck="false"
                value="${escapeHtml(opts.testEmail)}" placeholder="name@example.com…">
              <button class="btn btn-secondary" type="button" id="btn-test">시험 발송</button>
            </div>
            <p class="field-help" id="test-state" aria-live="polite">같은 제목·본문으로 시험 발송을 하면 60분 동안 전체 발송을 열어 둬요.</p>
          </div>
          <p class="form-error" id="form-error" role="alert"></p>
          <button class="btn btn-primary" type="button" id="btn-send">전체 발송</button>
        </div>
      </section>
    </div>
  </div>
</form>

<section class="panel section-gap reveal" style="--d:5" aria-labelledby="s-history">
  <div class="panel-head"><h2 id="s-history">발송 기록</h2></div>
  ${history}
</section>

<dialog class="sheet" id="confirm" aria-labelledby="confirm-title">
  <div class="sheet-card">
    <h2 id="confirm-title">보낼까요?</h2>
    <p id="confirm-text"></p>
    <div class="progress" id="progress" hidden><span></span></div>
    <p id="progress-text" class="num" aria-live="polite" hidden></p>
    <div class="sheet-actions" id="confirm-actions">
      <button class="btn btn-ghost" type="button" id="btn-cancel">취소</button>
      <button class="btn btn-primary" type="button" id="btn-go">보내기</button>
    </div>
  </div>
</dialog>`;

  const script = `window.__page = ({ $, $$ }) => {
  const form = $('#push-form');
  const AD_PREFIX = ${JSON.stringify(AD_TITLE_PREFIX)};
  const AD_FOOTER = ${JSON.stringify(AD_OPT_OUT_FOOTER)};
  const AD_HOURS = ${JSON.stringify(AD_HOURS_KST)};
  const KIND_HELP = {
    notice: '업데이트·재동의·장애 같은 안내예요. 수신 동의와 시간 제한 없이 보낼 수 있어요.',
    ad: '광고성 정보 수신에 동의한 사람에게만, 오전 ' + AD_HOURS[0] + '시부터 오후 ' + (AD_HOURS[1] - 12) + '시 전까지 보내요. 제목에 (광고), 본문 끝에 수신 거부 방법이 붙어요.',
  };
  let passedTest = null;
  // 대상 수는 **그 수를 센 조건**과 한 짝이다. 조건이 바뀌면 곧바로 버리고, 다시 센 답이 지금 조건과 같을 때만
  // 전체 발송을 연다. 앞 숫자로 확인 창을 띄우고 새 조건으로 보내는 일이 없게.
  let preview = null;
  let sendSnapshot = null;

  const values = () => {
    const fd = new FormData(form);
    const o = Object.fromEntries(fd.entries());
    ['includeUnknownVersion', 'reconsentOnly', 'activeAlarmOnly', 'marketingOnly'].forEach((k) => { o[k] = fd.has(k); });
    return o;
  };
  const AUDIENCE_KEYS = ['kind', 'platform', 'androidBelow', 'iosBelow', 'includeUnknownVersion', 'reconsentOnly', 'activeAlarmOnly', 'marketingOnly'];
  const audienceKey = (v) => JSON.stringify(AUDIENCE_KEYS.map((k) => v[k] ?? null));
  const copyKey = (v) => [v.kind, String(v.title || '').trim(), String(v.body || '').trim()].join('\\u0000');

  const post = async (url, data) => {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data || {}) });
    let json = {};
    try { json = await res.json(); } catch {}
    if (!res.ok) throw new Error(json.error || '요청이 실패했어요. 잠시 뒤 다시 시도해 주세요.');
    return json;
  };

  const syncCopy = () => {
    const v = values();
    const ad = v.kind === 'ad';
    $('#title-count').textContent = [...String(v.title)].length + '/${PUSH_TITLE_MAX}';
    $('#body-count').textContent = [...String(v.body)].length + '/${PUSH_BODY_MAX}';
    $('#pv-title').textContent = (ad ? AD_PREFIX : '') + (String(v.title).trim() || '제목');
    $('#pv-body').textContent = (String(v.body).trim() || '본문') + (ad ? '\\n' + AD_FOOTER : '');
    $('#kind-help').textContent = KIND_HELP[ad ? 'ad' : 'notice'];
    const mk = form.elements.marketingOnly;
    mk.checked = ad ? true : mk.checked;
    mk.disabled = ad;
    $$('[data-for-platform]').forEach((el) => { el.hidden = v.platform !== 'all' && el.dataset.forPlatform !== v.platform; });
    $('#test-state').textContent = passedTest === copyKey(v)
      ? '이 문구로 시험 발송을 마쳤어요. 전체 발송을 할 수 있어요.'
      : '같은 제목·본문으로 시험 발송을 하면 60분 동안 전체 발송을 열어 둬요.';
  };

  // 대상 수: 바꿀 때마다 다시 센다. 앞 요청은 끊고, 세는 동안 앞 숫자를 흐리게 남긴다(자리가 튀지 않게).
  let ctrl = null;
  const recount = async () => {
    if (ctrl) ctrl.abort();
    ctrl = new AbortController();
    const box = $('#count');
    box.dataset.loading = 'true';
    preview = null;
    const asked = values();
    try {
      const res = await fetch('/admin/push/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(asked), signal: ctrl.signal });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || '');
      const counted = j.android + j.ios;
      if (j.capped) {
        // 상한까지만 센 숫자는 확인에 쓸 수 없다. 실제 발송은 상한 없이 끝까지 간다.
        $('#count-main').textContent = '너무 많아요';
        $('#count-sub').textContent = '기기가 ' + counted.toLocaleString('ko-KR') + '대를 넘어 다 세지 못했어요. 조건을 좁혀 주세요.';
        box.dataset.loading = 'false';
        return;
      }
      if (audienceKey(asked) === audienceKey(values())) preview = { key: audienceKey(asked), total: counted };
      $('#count-main').textContent = j.users.toLocaleString('ko-KR') + '명';
      $('#count-sub').textContent = '기기 ' + counted.toLocaleString('ko-KR') + '대 · 안드로이드 ' + j.android.toLocaleString('ko-KR') + ' · iOS ' + j.ios.toLocaleString('ko-KR');
      box.dataset.loading = 'false';
    } catch (e) {
      if (e.name === 'AbortError') return;
      $('#count-main').textContent = '세지 못했어요';
      $('#count-sub').textContent = '조건을 바꾸면 다시 세요.';
      box.dataset.loading = 'false';
    }
  };

  form.addEventListener('input', (e) => {
    syncCopy();
    if (!['title', 'body', 'testEmail'].includes(e.target.name)) recount();
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  syncCopy();
  recount();

  const busy = (btn, on) => { btn.setAttribute('aria-busy', on ? 'true' : 'false'); };
  const err = (t) => { $('#form-error').textContent = t || ''; };

  $('#btn-test').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn.getAttribute('aria-busy') === 'true') return;
    err('');
    const v = values();
    busy(btn, true);
    btn.textContent = '보내는 중…';
    try {
      const r = await post('/admin/push/test', v);
      passedTest = r.sent > 0 ? copyKey(v) : null;
      syncCopy();
      window.toast(r.sent > 0 ? '시험 발송을 보냈어요. 기기 ' + r.devices + '대 중 ' + r.sent + '대 성공' : '시험 발송이 기기에 닿지 않았어요. 기기의 알림 설정을 확인해 주세요.');
    } catch (x) {
      err(x.message);
    } finally {
      busy(btn, false);
      btn.textContent = '시험 발송';
    }
  });

  const dlg = $('#confirm');
  const bar = $('#progress');
  const ptxt = $('#progress-text');
  let running = null;
  const setProgress = (s) => {
    const total = Math.max(s.estimatedTotal, s.sent + s.failed, 1);
    bar.hidden = false;
    ptxt.hidden = false;
    bar.style.setProperty('--p', Math.min(1, (s.sent + s.failed) / total));
    ptxt.textContent = (s.sent + s.failed).toLocaleString('ko-KR') + ' / 약 ' + total.toLocaleString('ko-KR') + '대 · 성공 ' + s.sent.toLocaleString('ko-KR') + ' · 실패 ' + s.failed.toLocaleString('ko-KR');
  };
  const finish = (title, text) => {
    running = null;
    dlg.dataset.busy = 'false';
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    $('#btn-go').hidden = true;
    $('#btn-cancel').textContent = '닫기';
    window.removeEventListener('beforeunload', guard);
  };
  const guard = (e) => { e.preventDefault(); e.returnValue = ''; };

  const walk = async (id) => {
    running = id;
    dlg.dataset.busy = 'true';
    window.addEventListener('beforeunload', guard);
    $('#btn-go').hidden = true;
    $('#btn-cancel').textContent = '중단';
    $('#confirm-title').textContent = '보내는 중…';
    $('#confirm-text').textContent = '창을 닫지 마세요. 닫으면 발송 기록의 이어 보내기로 계속할 수 있어요.';
    try {
      for (;;) {
        if (running !== id) return;
        const s = await post('/admin/push/jobs/' + encodeURIComponent(id) + '/step');
        setProgress(s);
        if (s.status === 'done') { finish('다 보냈어요', '성공 ' + s.sent.toLocaleString('ko-KR') + '대, 실패 ' + s.failed.toLocaleString('ko-KR') + '대예요. 실패는 대개 앱을 지운 기기예요.'); return; }
        if (s.status === 'canceled') { finish('발송을 멈췄어요', '그때까지 ' + s.sent.toLocaleString('ko-KR') + '대에 보냈어요.'); return; }
        if (s.paused === 'outside_ad_hours') { finish('광고 가능 시간이 끝났어요', '오전 ' + AD_HOURS[0] + '시가 지나면 발송 기록에서 이어 보낼 수 있어요.'); return; }
        if (s.paused === 'busy') await new Promise((r) => setTimeout(r, 800));
      }
    } catch (x) {
      finish('발송이 멈췄어요', x.message + ' 발송 기록에서 이어 보낼 수 있어요.');
    }
  };

  $('#btn-send').addEventListener('click', (e) => {
    err('');
    const v = values();
    if (!String(v.title).trim() || !String(v.body).trim()) { err('제목과 본문을 모두 적어 주세요.'); return; }
    if (passedTest !== copyKey(v)) { err('이 문구로 시험 발송을 먼저 해 주세요. 받은 알림을 눈으로 확인한 뒤에 보낼 수 있어요.'); return; }
    if (!preview || preview.key !== audienceKey(v)) { err('받는 사람 수를 아직 세지 못했어요. 숫자가 나온 뒤에 보내 주세요.'); return; }
    if (preview.total === 0) { err('조건에 맞는 기기가 없어요. 받는 사람 조건을 바꿔 보세요.'); return; }
    // 확인 창에 보인 숫자와 그 숫자를 센 조건을 그대로 묶어 보낸다.
    sendSnapshot = { ...v, estimatedTotal: preview.total };
    $('#confirm-title').textContent = '보낼까요?';
    $('#confirm-text').textContent = $('#count-main').textContent + '(' + $('#count-sub').textContent + ')에게 보내요. 보낸 알림은 되돌릴 수 없어요.';
    bar.hidden = true; ptxt.hidden = true;
    $('#btn-go').hidden = false;
    $('#btn-cancel').textContent = '취소';
    window.openSheet(dlg, e.currentTarget);
  });

  $('#btn-go').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn.getAttribute('aria-busy') === 'true') return;
    if (!sendSnapshot) return;
    busy(btn, true);
    // 기록을 만드는 동안에는 창을 닫지 못한다. 닫힌 뒤에 응답이 오면 진행도 중단 버튼도 안 보이는 채로 보내진다.
    dlg.dataset.busy = 'true';
    const cancelBtn = $('#btn-cancel');
    cancelBtn.disabled = true;
    try {
      const snapshot = sendSnapshot;
      sendSnapshot = null;
      const r = await post('/admin/push/jobs', snapshot);
      cancelBtn.disabled = false;
      await walk(r.id);
    } catch (x) {
      finish('보내지 못했어요', x.message);
    } finally {
      cancelBtn.disabled = false;
      busy(btn, false);
    }
  });

  $('#btn-cancel').addEventListener('click', async () => {
    if (dlg.dataset.busy === 'true' && !running) return;
    if (dlg.dataset.busy === 'true' && running) {
      const id = running;
      running = null;
      try { const s = await post('/admin/push/jobs/' + encodeURIComponent(id) + '/cancel'); setProgress(s); } catch {}
      finish('발송을 멈췄어요', '멈춘 자리까지만 보냈어요.');
      return;
    }
    window.closeSheet(dlg);
    if ($('#btn-go').hidden) location.reload();
  });

  $$('[data-resume]').forEach((btn) => btn.addEventListener('click', (e) => {
    $('#confirm-text').textContent = '';
    bar.hidden = true; ptxt.hidden = true;
    window.openSheet(dlg, e.currentTarget);
    walk(btn.dataset.resume);
  }));
};`;
  return page({ title: '알림 보내기', active: 'push', nonce, body, script });
}
