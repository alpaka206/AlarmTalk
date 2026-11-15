// 카카오 연결 해제 웹훅이 계정에 하는 일(2026-11-14). 라우트는 `routes/kakao-webhook.ts`, 규칙은
// `docs/spec/session-and-auth.md` 「카카오 로그인」.
//
// 카카오는 우리 서비스 **밖에서** 연결이 끊기면 이 웹훅을 부른다(카카오계정 설정의 '연결된 서비스 관리', 카카오계정 탈퇴,
// 관리자 처리 등). 우리가 연결 끊기 API 로 직접 끊은 경우(탈퇴 파기)에는 오지 않는다.
//
// ⚠ **회원번호(`kakao_id`)를 지우지 않는다.** 지우면 같은 사람이 카카오로 다시 로그인할 때 회원번호로 찾지 못하고,
//   인증된 이메일이 없던 계정은 같은 합성 주소(`<회원번호>@kakao.local`)로 새 계정을 만들려다 이메일 고유 제약에 막힌다.
//   카카오 쪽 연결이 끊겨도 우리 계정과 회원번호의 짝은 그대로 둔다 — 다시 로그인하면 카카오가 동의를 다시 받고 같은
//   계정으로 돌아온다.
//
// 카카오 가이드는 "카카오 로그인만으로 이용 가능했던 회원이라면 회원 탈퇴 처리를 검토" 하라고 한다. 그래서 **카카오로만
// 가입한 계정**(비밀번호·구글·애플이 없다)은 사용자가 직접 신청한 것과 같은 **탈퇴 유예**로 둔다 — 30일 뒤 파기, 그 안에
// 다시 로그인하면 철회된다(`cancelPendingDeletionOnSignIn`). 다른 로그인 수단이 있는 계정은 아무것도 바꾸지 않는다 — 그
// 수단으로 계속 쓸 수 있다.

import type { Client } from '@libsql/client';
import { requestAccountDeletion } from './account-deletion';
import type { DeletedPushTarget } from './fcm';

export type KakaoUnlinkOutcome =
  /** 그 회원번호의 계정이 없다(가입을 마치지 않았거나 이미 파기됐다). */
  | 'not_found'
  /** 비밀번호·구글·애플 중 하나가 있다 — 그 수단으로 계속 쓰므로 바꾸지 않는다. */
  | 'other_login'
  /** 이미 탈퇴 유예다 — 기한을 다시 미루지 않는다. */
  | 'already_pending'
  /** 카카오로만 가입한 계정을 탈퇴 유예로 두었다. */
  | 'deletion_requested'
  /** 읽은 뒤 쓰기 전에 상태가 바뀌었다(다른 로그인 수단이 붙었거나 유예가 됐다) — 바꾸지 않았다. */
  | 'changed';

export interface KakaoUnlinkResult {
  outcome: KakaoUnlinkOutcome;
  /** 유예로 둘 때 지운 푸시 등록 — 호출부가 커밋 뒤 '탈퇴 신청됨' 신호를 보낸다. */
  pushTargets: DeletedPushTarget[];
}

export async function handleKakaoUnlink(db: Client, kakaoId: string, now: Date): Promise<KakaoUnlinkResult> {
  const found = await db.execute({
    sql: `SELECT id, password_hash, google_id, apple_id, deletion_status FROM users WHERE kakao_id = ? LIMIT 1`,
    args: [kakaoId],
  });
  const row = found.rows[0];
  if (!row) return { outcome: 'not_found', pushTargets: [] };
  const hasOtherLogin = [row.password_hash, row.google_id, row.apple_id].some(
    (value) => value != null && String(value).length > 0,
  );
  if (hasOtherLogin) return { outcome: 'other_login', pushTargets: [] };
  if (row.deletion_status === 'pending_deletion') return { outcome: 'already_pending', pushTargets: [] };
  // 위 판단을 쓰기 문장 안에서 한 번 더 한다 — 그 사이 다른 로그인 수단이 붙었으면 바꾸지 않는다(코덱스 #994).
  const request = await requestAccountDeletion(db, String(row.id), now, { onlyIfKakaoOnlyActive: true });
  return request.requested
    ? { outcome: 'deletion_requested', pushTargets: request.pushTargets }
    : { outcome: 'changed', pushTargets: [] };
}
