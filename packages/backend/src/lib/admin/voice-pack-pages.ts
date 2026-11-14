import {
  packWithdrawn,
  parseAllowedRegions,
  parsePackInstant,
  publishBlockers,
  rightsWindowOpen,
  voicePackExpectedVariants,
  withdrawnPlaybackUntil,
  VOICE_PACK_PREVIEW_CATEGORY,
  type VoicePackClipRow,
  type VoicePackEventRow,
  type VoicePackRow,
} from '../voice-packs';
import { badge, emptyState, escapeHtml, page, type Tone } from './ui';

// 관리자 콘솔 — 추가 음성팩 검수·게시(`docs/spec/voice-packs.md` §4·§6). 스크립트 없이 서버가 그린다.
// 가져오기는 스크립트(`scripts/import-voice-pack.ts`)가 한다 — 화면은 검수·권리·전이·기록이다.

const KST = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const KST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });

function fmtInstant(value: string | null): string {
  const d = parsePackInstant(value);
  return d ? KST.format(d) : '없음';
}

/** 배타 끝(그날이 끝나는 순간)을 화면의 한국 날짜로 — 그 전날이 '끝나는 날' 이다. */
function endDateInput(value: string | null): string {
  const d = parsePackInstant(value);
  return d ? KST_DATE.format(new Date(d.getTime() - 1)) : '';
}

function startDateInput(value: string | null): string {
  const d = parsePackInstant(value);
  return d ? KST_DATE.format(d) : '';
}

const STATUS_LABEL: Record<string, [string, Tone]> = {
  draft: ['작성 중', 'neutral'],
  review: ['검수 중', 'warn'],
  published: ['게시 중', 'good'],
  suspended: ['게시 중단', 'bad'],
};

const RIGHTS_LABEL: Record<string, string> = {
  pending: '확인 전',
  verified: '확인됨',
  expired: '만료',
  revoked: '해지',
};

const TERMS_LABEL: Record<string, string> = {
  stop_on_suspend: '중단하면 곧바로 대체',
  until_rights_end: '권리 기간 끝까지 기존 알람 재생',
  until_date: '지정한 날까지 기존 알람 재생',
};

const ACTION_LABEL: Record<string, string> = {
  create: '만들기',
  update_meta: '공개 정보 수정',
  add_clip: '클립 추가',
  replace_clip: '클립 교체',
  delete_clip: '클립 삭제',
  update_rights: '권리 수정',
  submit: '검수 요청',
  reject: '반려',
  publish: '게시',
  suspend: '게시 중단',
  republish: '다시 게시',
  revise: 'draft 로 되돌림',
};

function statusBadge(row: VoicePackRow, now: Date): string {
  const [label, tone] = STATUS_LABEL[row.status] ?? [row.status, 'neutral'];
  if (row.status === 'published' && !rightsWindowOpen(row, now)) return badge('권리 끝남', 'bad');
  return badge(label, tone);
}

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(n / 1024))}KB`;
}

export function renderVoicePackList(
  nonce: string,
  rows: Array<{ pack: VoicePackRow; clipCount: number; totalBytes: number }>,
  now: Date,
): string {
  const table = rows.length
    ? `<div class="table-wrap"><table>
<thead><tr><th scope="col">팩</th><th scope="col">언어</th><th scope="col">상태</th><th scope="col">권리</th><th scope="col">클립</th><th scope="col">개정</th></tr></thead>
<tbody>${rows
        .map(
          ({ pack, clipCount, totalBytes }) => `<tr>
  <td><a href="/admin/voice-packs/${encodeURIComponent(pack.id)}">${escapeHtml(pack.speaker_name)}</a><div class="cell-sub" translate="no">${escapeHtml(pack.id)}</div></td>
  <td>${escapeHtml(pack.language)}</td>
  <td>${statusBadge(pack, now)}</td>
  <td>${escapeHtml(RIGHTS_LABEL[pack.rights_status] ?? pack.rights_status)}</td>
  <td class="tnum">${clipCount}개 · ${escapeHtml(fmtBytes(totalBytes))}</td>
  <td class="tnum">${Number(pack.content_revision)}</td>
</tr>`,
        )
        .join('')}</tbody></table></div>`
    : emptyState(
        '아직 팩이 없어요',
        '첫 팩은 권리 계약과 음원을 기다리는 중이에요. 받으면 가져오기 스크립트로 올리고 여기서 검수해요.',
      );
  const body = `
<header class="page-head reveal">
  <div><h1>음성팩</h1><p class="muted">권리를 확인한 무료 고정 목소리. 앱에는 게시 중이고 권리 기간 안인 팩만 보여요.</p></div>
</header>
<section class="panel reveal" style="--d:1" aria-labelledby="p-list">
  <div class="panel-head"><h2 id="p-list">팩 목록</h2></div>
  ${table}
  <p class="note">올리기: <code translate="no">npx tsx scripts/import-voice-pack.ts &lt;폴더&gt;</code> (ADMIN_BASE_URL·ADMIN_SECRET 환경변수). 계약서 원문은 올리지 않고 위치만 적어요.</p>
</section>`;
  return page({ title: '음성팩', active: 'packs', nonce, body });
}

export function renderVoicePackDetail(
  nonce: string,
  pack: VoicePackRow,
  clips: VoicePackClipRow[],
  events: VoicePackEventRow[],
  now: Date,
  flash: { tone: 'good' | 'bad'; text: string } | null,
): string {
  const base = `/admin/voice-packs/${encodeURIComponent(pack.id)}`;
  const blockers = publishBlockers(pack, clips, now);
  const expected = voicePackExpectedVariants();
  const regions = parseAllowedRegions(pack.rights_allowed_regions);
  const isDraft = pack.status === 'draft';

  const clipRows = clips
    .map(
      (c) => `<tr>
  <td>${escapeHtml(c.category === VOICE_PACK_PREVIEW_CATEGORY ? '미리듣기' : c.category)} <span class="tnum">${Number(c.variant)}</span></td>
  <td>${escapeHtml(c.text)}</td>
  <td><audio controls preload="none" src="${base}/clips/${encodeURIComponent(c.id)}/audio"></audio></td>
  <td class="tnum">${escapeHtml(fmtBytes(Number(c.size_bytes)))}<div class="cell-sub" translate="no">${escapeHtml(c.sha256.slice(0, 12))}</div></td>
  <td>${
    isDraft
      ? `<form method="post" action="${base}/clips/${encodeURIComponent(c.id)}/delete" class="inline">
      <label class="check"><input type="checkbox" name="confirm" value="1" required> 삭제 확인</label>
      <button class="btn btn-danger btn-sm" type="submit">삭제</button></form>`
      : ''
  }</td>
</tr>`,
    )
    .join('');
  const clipTable = clips.length
    ? `<div class="table-wrap"><table>
<thead><tr><th scope="col">테마</th><th scope="col">문구</th><th scope="col">듣기</th><th scope="col">크기</th><th scope="col"><span class="sr-only">동작</span></th></tr></thead>
<tbody>${clipRows}</tbody></table></div>`
    : emptyState('클립이 없어요', '가져오기 스크립트로 draft 팩에 올려요.');
  const structure = Object.entries(expected)
    .map(([cat, n]) => `${escapeHtml(cat)} ${n}개`)
    .join(' · ');

  const transitions: Array<{ action: string; label: string; from: string; tone: string; confirm: boolean }> = [
    { action: 'submit', label: '검수 요청', from: 'draft', tone: 'btn-secondary', confirm: false },
    { action: 'reject', label: '반려', from: 'review', tone: 'btn-secondary', confirm: false },
    { action: 'publish', label: '게시', from: 'review', tone: 'btn-primary', confirm: true },
    { action: 'suspend', label: '게시 중단', from: 'published', tone: 'btn-danger', confirm: true },
    { action: 'republish', label: '다시 게시', from: 'suspended', tone: 'btn-primary', confirm: true },
    { action: 'revise', label: '고치려고 draft 로', from: 'suspended', tone: 'btn-secondary', confirm: false },
  ];
  const available = transitions.filter((t) => t.from === pack.status);
  const transitionForms = available.length
    ? available
        .map(
          (t) => `<form method="post" action="${base}/transition" class="stack">
  <input type="hidden" name="action" value="${t.action}">
  <div class="field"><label class="field-label" for="note-${t.action}">메모 (선택)</label>
  <input class="input" id="note-${t.action}" name="note" maxlength="300"></div>
  ${t.confirm ? `<label class="check"><input type="checkbox" name="confirm" value="1" required> ${escapeHtml(t.label)} 확인</label>` : ''}
  <div><button class="btn ${t.tone}" type="submit">${escapeHtml(t.label)}</button></div>
</form>`,
        )
        .join('')
    : '<p class="note">지금 상태에서 할 수 있는 전이가 없어요.</p>';

  const withdrawn = packWithdrawn(pack, now)
    ? `<p class="note">${badge('게시 끝남', 'bad')} 기존 알람은 ${escapeHtml(fmtInstant(withdrawnPlaybackUntil(pack, now).toISOString()))}까지 이 팩으로 울고, 그 뒤 앱이 미나로 바꿔요.</p>`
    : '';

  const termsOptions = Object.entries(TERMS_LABEL)
    .map(([k, label]) => `<option value="${k}"${pack.existing_file_terms === k ? ' selected' : ''}>${escapeHtml(label)}</option>`)
    .join('');
  const rightsOptions = Object.entries(RIGHTS_LABEL)
    .map(([k, label]) => `<option value="${k}"${pack.rights_status === k ? ' selected' : ''}>${escapeHtml(label)}</option>`)
    .join('');

  const eventRows = events.length
    ? `<div class="table-wrap"><table>
<thead><tr><th scope="col">시각</th><th scope="col">무엇</th><th scope="col">상태</th><th scope="col">누가</th><th scope="col">메모</th></tr></thead>
<tbody>${events
        .map(
          (e) => `<tr>
  <td class="tnum">${escapeHtml(fmtInstant(e.created_at))}</td>
  <td>${escapeHtml(ACTION_LABEL[e.action] ?? e.action)}</td>
  <td>${escapeHtml(e.from_status ?? '')}${e.to_status && e.to_status !== e.from_status ? ` → ${escapeHtml(e.to_status)}` : ''}</td>
  <td translate="no">${escapeHtml(e.actor)}</td>
  <td>${escapeHtml(e.note)}</td>
</tr>`,
        )
        .join('')}</tbody></table></div>`
    : emptyState('기록이 없어요', '');

  const body = `
<header class="page-head reveal">
  <div><h1>${escapeHtml(pack.speaker_name)}</h1><p class="muted" translate="no">${escapeHtml(pack.id)} · ${escapeHtml(pack.language)} · 개정 ${Number(pack.content_revision)}</p></div>
  <a class="btn btn-secondary btn-sm" href="/admin/voice-packs">팩 목록</a>
</header>
${flash ? `<p class="note" role="status">${badge(flash.tone === 'good' ? '완료' : '안 됨', flash.tone)} ${escapeHtml(flash.text)}</p>` : ''}
${withdrawn}
<div class="grid-2">
  <section class="panel reveal" style="--d:1" aria-labelledby="v-public">
    <div class="panel-head"><h2 id="v-public">앱에 보이는 정보</h2></div>
    <dl class="kv">
      <div><dt>상태</dt><dd>${statusBadge(pack, now)}</dd></div>
      <div><dt>소개</dt><dd>${escapeHtml(pack.description) || '<span class="muted">없음</span>'}</dd></div>
      <div><dt>사용 범위</dt><dd>${escapeHtml(pack.usage_note) || '<span class="muted">없음</span>'}</dd></div>
      <div><dt>최소 빌드</dt><dd class="tnum">안드로이드 ${Number(pack.min_android_build)} · iOS ${Number(pack.min_ios_build)}</dd></div>
      <div><dt>voice id</dt><dd translate="no" class="tnum">${escapeHtml(pack.voice_id)}</dd></div>
      <div><dt>게시</dt><dd>${escapeHtml(fmtInstant(pack.published_at))}</dd></div>
      <div><dt>중단</dt><dd>${escapeHtml(fmtInstant(pack.suspended_at))}</dd></div>
    </dl>
    <p class="note">공개 정보는 draft 에서 가져오기 스크립트로 고쳐요.</p>
  </section>
  <section class="panel reveal" style="--d:2" aria-labelledby="v-gate">
    <div class="panel-head"><h2 id="v-gate">게시 조건과 전이</h2></div>
    ${
      blockers.length
        ? `<ul class="stack">${blockers.map((b) => `<li>${badge('남음', 'warn')} ${escapeHtml(b)}</li>`).join('')}</ul>`
        : `<p class="note">${badge('충족', 'good')} 게시 조건을 다 채웠어요.</p>`
    }
    <p class="note">필요한 구조: 미리듣기 1개 · ${structure} (기본 목소리와 같은 번호, 같은 조건)</p>
    ${transitionForms}
  </section>
</div>
<section class="panel reveal section-gap" style="--d:3" aria-labelledby="v-rights">
  <div class="panel-head"><h2 id="v-rights">권리 (내부 전용)</h2></div>
  <p class="note">이 칸의 값은 앱 API 로 내려가지 않아요. 계약서 원문은 올리지 말고 위치만 적어요.</p>
  <form method="post" action="${base}/rights" class="stack">
    <div class="field"><label class="field-label" for="rights_status">권리 상태</label>
      <select class="input" id="rights_status" name="rights_status">${rightsOptions}</select></div>
    <div class="field"><label class="field-label" for="evidence_ref">증빙 위치</label>
      <input class="input" id="evidence_ref" name="evidence_ref" maxlength="300" value="${escapeHtml(pack.rights_evidence_ref)}" placeholder="예: 공유 드라이브 계약/음성팩/첫팩.pdf"></div>
    <div class="grid-2">
      <div class="field"><label class="field-label" for="valid_from">권리 시작 (한국 날짜)</label>
        <input class="input" type="date" id="valid_from" name="valid_from" value="${escapeHtml(startDateInput(pack.rights_valid_from))}"></div>
      <div class="field"><label class="field-label" for="valid_until">권리 끝 (그날 끝까지)</label>
        <input class="input" type="date" id="valid_until" name="valid_until" value="${escapeHtml(endDateInput(pack.rights_valid_until))}"></div>
    </div>
    <div class="field"><label class="field-label" for="allowed_text">허용 문구</label>
      <textarea class="textarea" id="allowed_text" name="allowed_text" maxlength="1000">${escapeHtml(pack.rights_allowed_text)}</textarea></div>
    <div class="field"><label class="field-label" for="allowed_regions">허용 지역</label>
      <input class="input" id="allowed_regions" name="allowed_regions" value="${escapeHtml(regions.join(', '))}" placeholder="KR, JP 또는 *">
      <p class="field-help">나라 코드를 쉼표로. * 는 전 세계예요.</p></div>
    <div class="grid-2">
      <div class="field"><label class="field-label" for="file_terms">기존 파일 이용 조건</label>
        <select class="input" id="file_terms" name="file_terms">${termsOptions}</select></div>
      <div class="field"><label class="field-label" for="playback_until">기존 알람 재생 기한 (지정한 날일 때)</label>
        <input class="input" type="date" id="playback_until" name="playback_until" value="${escapeHtml(endDateInput(pack.existing_playback_until))}"></div>
    </div>
    <div class="field"><label class="field-label" for="rights_note">메모 (선택)</label>
      <input class="input" id="rights_note" name="note" maxlength="300"></div>
    <div><button class="btn btn-primary" type="submit">권리 저장</button></div>
  </form>
</section>
<section class="panel reveal section-gap" style="--d:4" aria-labelledby="v-clips">
  <div class="panel-head"><h2 id="v-clips">클립 ${clips.length}개</h2></div>
  ${clipTable}
</section>
<section class="panel reveal section-gap" style="--d:5" aria-labelledby="v-events">
  <div class="panel-head"><h2 id="v-events">기록</h2></div>
  ${eventRows}
</section>`;
  return page({ title: '음성팩 상세', active: 'packs', nonce, body });
}
