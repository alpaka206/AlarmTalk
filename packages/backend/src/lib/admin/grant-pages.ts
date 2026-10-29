import { PLAN_GRANT_MAX_DAYS, PLAN_GRANT_REASON_LABELS, PLAN_GRANT_REASONS, type PlanGrantReason } from '../plan-grants';
import { liveSubscriptions, type UserDetail } from './user-detail';
import { badge, emptyState, escapeHtml, fmtDate, fmtDateTime, page } from './ui';

// 관리자 콘솔 — 사용자 상세와 **플러스 기간 지급**(`docs/spec/admin-console.md` 「사용자 상세와 기간 지급」).
// 스크립트 없이 서버가 그린다: 상세 → (입력) → 확인 화면 → 지급. 확인 화면이 멱등 키를 싣는다.

const KST_DATE_TIME = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function fmtInstant(date: Date | string | null): string {
  if (!date) return '없음';
  const d = typeof date === 'string' ? new Date(date) : date;
  return Number.isNaN(d.getTime()) ? '기록 없음' : KST_DATE_TIME.format(d);
}

function grantState(g: UserDetail['grants'][number], now: Date): string {
  if (g.revokedAt) return badge('회수함', 'neutral');
  const start = Date.parse(g.startsAt);
  const end = Date.parse(g.endsAt);
  if (now.getTime() < start) return badge('예정', 'neutral');
  if (now.getTime() < end) return badge('지급 중', 'good');
  return badge('끝남', 'neutral');
}

function entitlementSummary(detail: UserDetail, now: Date): string {
  const lines: string[] = [];
  for (const s of liveSubscriptions(detail, now)) {
    lines.push(
      `${s.provider === 'apple' ? 'App Store' : s.provider === 'google' ? 'Google Play' : '스토어'} 구독 · ${escapeHtml(
        fmtDateTime(s.expiresAt),
      )}까지${s.cancelAtPeriodEnd ? ' (해지 예약)' : ''}`,
    );
  }
  if (detail.grantEndsAt) lines.push(`관리자 지급 · ${escapeHtml(fmtInstant(detail.grantEndsAt))}까지`);
  return lines.length ? lines.join('<br>') : '<span class="muted">유료 권한 없음</span>';
}

export function renderUserDetail(
  nonce: string,
  detail: UserDetail,
  now: Date,
  flash: { tone: 'good' | 'bad'; text: string } | null,
): string {
  const blocked = detail.deletionStatus !== 'active' || detail.isSystem;
  const grantRows = detail.grants
    .map(
      (g) => `<tr>
  <td class="tnum">${escapeHtml(fmtInstant(g.startsAt))}</td>
  <td class="tnum">${escapeHtml(fmtInstant(g.endsAt))}</td>
  <td>${escapeHtml(PLAN_GRANT_REASON_LABELS[g.reason] ?? g.reason)}${g.note ? `<div class="cell-sub">${escapeHtml(g.note)}</div>` : ''}</td>
  <td>${grantState(g, now)}${g.revokedAt ? `<div class="cell-sub">${escapeHtml(fmtInstant(g.revokedAt))}</div>` : ''}</td>
  <td>${
    !g.revokedAt && Date.parse(g.endsAt) > now.getTime()
      ? `<form method="post" action="/admin/grants/${encodeURIComponent(g.id)}/revoke" class="inline">
      <input type="hidden" name="user" value="${escapeHtml(detail.id)}">
      <label class="check"><input type="checkbox" name="confirm" value="1" required> 회수 확인</label>
      <button class="btn btn-danger btn-sm" type="submit">회수</button></form>`
      : ''
  }</td>
</tr>`,
    )
    .join('');
  const history = detail.grants.length
    ? `<div class="table-wrap"><table>
<thead><tr><th scope="col">시작</th><th scope="col">끝</th><th scope="col">사유</th><th scope="col">상태</th><th scope="col"><span class="sr-only">동작</span></th></tr></thead>
<tbody>${grantRows}</tbody></table></div>`
    : emptyState('지급 기록이 없어요', '이 계정에 플러스를 준 적이 없어요.');
  const reasonOptions = PLAN_GRANT_REASONS.map(
    (r) => `<option value="${r}">${escapeHtml(PLAN_GRANT_REASON_LABELS[r])}</option>`,
  ).join('');
  const form = blocked
    ? `<p class="note">${detail.isSystem ? '시스템 계정에는 줄 수 없어요.' : '탈퇴 대기 계정에는 줄 수 없어요.'}</p>`
    : `<form method="post" action="/admin/users/${encodeURIComponent(detail.id)}/grants/preview" class="stack">
  <fieldset>
    <legend>기간 (지금부터)</legend>
    <div class="seg" role="radiogroup">
      <input type="radio" name="length" id="len-7d" value="7d" checked><label for="len-7d">7일</label>
      <input type="radio" name="length" id="len-1m" value="1m"><label for="len-1m">1개월</label>
      <input type="radio" name="length" id="len-until" value="until"><label for="len-until">끝나는 날 지정</label>
    </div>
  </fieldset>
  <div class="field">
    <label class="field-label" for="until">끝나는 날 (한국 날짜, 그날 끝까지)</label>
    <input class="input" type="date" id="until" name="until">
    <p class="field-help">'끝나는 날 지정' 을 고를 때만 써요. 한 번에 ${PLAN_GRANT_MAX_DAYS}일까지 줄 수 있어요.</p>
  </div>
  <div class="field">
    <label class="field-label" for="reason">사유</label>
    <select class="input" id="reason" name="reason" required>${reasonOptions}</select>
  </div>
  <div class="field">
    <label class="field-label" for="note">메모 (선택, 200자)</label>
    <input class="input" id="note" name="note" maxlength="200" placeholder="예: 결제 오류 문의 보정">
  </div>
  <div><button class="btn btn-primary" type="submit">확인 화면으로</button></div>
</form>`;
  const body = `
<header class="page-head reveal">
  <div><h1 translate="no">${escapeHtml(detail.email || '이메일 없음')}</h1><p class="muted">가입 ${escapeHtml(fmtDate(detail.createdAt))}</p></div>
  <a class="btn btn-secondary btn-sm" href="/admin/users">사용자 목록</a>
</header>
${flash ? `<p class="note" role="status">${badge(flash.tone === 'good' ? '완료' : '안 됨', flash.tone)} ${escapeHtml(flash.text)}</p>` : ''}
<div class="grid-2">
  <section class="panel reveal" style="--d:1" aria-labelledby="d-state">
    <div class="panel-head"><h2 id="d-state">지금 권한</h2></div>
    <dl class="kv">
      <div><dt>유료 근거</dt><dd>${entitlementSummary(detail, now)}</dd></div>
      <div><dt>저장된 등급</dt><dd>${detail.rawPlan === 'plus' ? '플러스' : '무료'}</dd></div>
      <div><dt>이번 달 직접 입력</dt><dd class="num">${detail.manualUsedThisMonth}회 사용</dd></div>
      <div><dt>목소리 삭제 예정</dt><dd>${detail.retentionDeleteAfter ? escapeHtml(fmtDateTime(detail.retentionDeleteAfter)) : '<span class="muted">없음</span>'}</dd></div>
    </dl>
  </section>
  <section class="panel reveal" style="--d:2" aria-labelledby="d-grant">
    <div class="panel-head"><h2 id="d-grant">플러스 지급</h2></div>
    ${form}
    <p class="note">스토어 구독·영수증·청구일은 바뀌지 않아요. 겹친 기간은 더하지 않고 이어서 봐요. 월 직접 입력 횟수를 새로 채우지 않아요.</p>
  </section>
</div>
<section class="panel reveal section-gap" style="--d:3" aria-labelledby="d-history">
  <div class="panel-head"><h2 id="d-history">지급 기록</h2></div>
  ${history}
</section>`;
  return page({ title: '사용자 상세', active: 'users', nonce, body });
}

export interface GrantDraft {
  endsAt: Date;
  lengthLabel: string;
  reason: PlanGrantReason;
  note: string;
  requestKey: string;
}

export function renderGrantConfirm(nonce: string, detail: UserDetail, draft: GrantDraft, now: Date): string {
  const live = liveSubscriptions(detail, now);
  const overlap: string[] = [];
  if (live.length > 0) overlap.push('이미 스토어 구독이 있어요. 구독이 끝나도 지급 기간까지 플러스예요. 구독료는 환급되지 않아요.');
  if (detail.grantEndsAt) {
    overlap.push(
      detail.grantEndsAt.getTime() >= draft.endsAt.getTime()
        ? `이미 ${fmtInstant(detail.grantEndsAt)}까지 지급 중이에요. 이번 지급은 그 안에 들어가 기간이 늘지 않아요.`
        : `이미 ${fmtInstant(detail.grantEndsAt)}까지 지급 중이에요. 이번 지급으로 끝이 늘어나요.`,
    );
  }
  const body = `
<header class="page-head reveal">
  <div><h1>플러스 지급 확인</h1><p class="muted" translate="no">${escapeHtml(detail.email || detail.id)}</p></div>
</header>
<section class="panel reveal" style="--d:1" aria-labelledby="c-sum">
  <div class="panel-head"><h2 id="c-sum">이렇게 지급해요</h2></div>
  <dl class="kv">
    <div><dt>기간</dt><dd>${escapeHtml(draft.lengthLabel)}</dd></div>
    <div><dt>시작</dt><dd>지금 (${escapeHtml(fmtInstant(now))})</dd></div>
    <div><dt>끝</dt><dd><b>${escapeHtml(fmtInstant(draft.endsAt))}</b> (이 시각부터 다른 권한이 없으면 무료)</dd></div>
    <div><dt>사유</dt><dd>${escapeHtml(PLAN_GRANT_REASON_LABELS[draft.reason])}${draft.note ? ` · ${escapeHtml(draft.note)}` : ''}</dd></div>
    <div><dt>지금 유료 근거</dt><dd>${entitlementSummary(detail, now)}</dd></div>
  </dl>
  ${overlap.map((t) => `<p class="note">${badge('겹침', 'warn')} ${escapeHtml(t)}</p>`).join('')}
  <form method="post" action="/admin/users/${encodeURIComponent(detail.id)}/grants" class="inline" style="margin-top:16px">
    <input type="hidden" name="request_key" value="${escapeHtml(draft.requestKey)}">
    <input type="hidden" name="ends_at" value="${escapeHtml(draft.endsAt.toISOString())}">
    <input type="hidden" name="reason" value="${escapeHtml(draft.reason)}">
    <input type="hidden" name="note" value="${escapeHtml(draft.note)}">
    <button class="btn btn-primary" type="submit">지급하기</button>
    <a class="btn btn-ghost" href="/admin/users/${encodeURIComponent(detail.id)}">취소</a>
  </form>
</section>`;
  return page({ title: '지급 확인', active: 'users', nonce, body });
}
