// 카카오 연결 해제 웹훅(2026-11-14) — 사용자가 카카오 쪽에서 우리 앱과의 연결을 끊으면 카카오가 부른다(카카오계정 설정의
// '연결된 서비스 관리', 카카오계정 탈퇴, 관리자 처리 등). 계정에 하는 일은 `lib/kakao-unlink.ts`, 규칙은
// `docs/spec/session-and-auth.md` 「카카오 로그인」.
//
// 인증 미들웨어 밖이다 — 카카오 서버가 사용자 인증 없이 부르고, `Authorization: KakaoAK <대표 어드민 키>` 로만 보호한다
// (구글 RTDN 의 비밀 토큰, 애플 알림의 서명과 같은 자리). 로그인 경로의 엄격한 요청 한도(`/api/auth/*`) 밖에 두고, 공용 IP
// 버킷에서도 빠져 전용 버킷이 센다(`middleware/rateLimit.ts` 의 `kakaoWebhookRateLimitMiddleware`) — 카카오 서버 몇 대가 모든
// 사용자의 해제를 보내고, 막힌 해제는 다시 오지 않는다.
//
// 카카오 규칙: GET(쿼리)이나 POST(폼 본문)로 `app_id`·`user_id`(회원번호)·`referrer_type` 이 온다. **3초 안에 200** 으로
// 답해야 하고, 사용자가 없거나 오류가 나도 200 이다. 그래서 카카오가 보낸 것으로 확인된 요청에는 언제나 200 이고, 처리
// 실패는 경보로 올린다(다시 보내 주지 않으니 경보가 유일한 흔적이다). 카카오가 보낸 것이 아니면 401 이다.

import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { jsonError } from '../lib/api-error';
import { logRouteError, logStructured } from '../lib/logger';
import { timingSafeEqualStr } from '../lib/timing-safe-equal';
import { handleKakaoUnlink } from '../lib/kakao-unlink';
import { sendAccountDeletionRequestedPush } from '../lib/fcm';

const kakaoWebhook = new Hono<AppEnv>();

/** 회원번호 — 숫자만, JS 정수 한계를 넘을 수 있어 문자열로 다룬다(`lib/kakao-oauth.ts` 와 같다). */
const KAKAO_USER_ID = /^\d{1,20}$/;
/** 연결 해제 경로(`ACCOUNT_DELETE`·`UNLINK_FROM_APPS` 등) — 기록에만 쓴다. 모르는 값도 받아 둔다. */
const REFERRER_TYPE = /^[A-Z_]{1,40}$/;

async function readParams(c: Context<AppEnv>): Promise<Record<string, string>> {
  if (c.req.method === 'GET') return c.req.query();
  const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

kakaoWebhook.on(['GET', 'POST'], '/unlink', async (c) => {
  const adminKey = c.env.KAKAO_ADMIN_KEY?.trim();
  const appId = c.env.KAKAO_APP_ID?.trim();
  if (!adminKey || !appId) {
    // 카카오가 보낸 것인지 확인할 수단이 없다 — 아무것도 바꾸지 않는다. 카카오 규칙대로 200 으로 답하고, 놓친 해제는 경보로 남긴다.
    logRouteError(c, new Error('Kakao unlink webhook ignored: KAKAO_ADMIN_KEY or KAKAO_APP_ID is not configured'));
    return c.body(null, 200);
  }
  if (!timingSafeEqualStr(c.req.header('Authorization') ?? '', `KakaoAK ${adminKey}`)) {
    return jsonError(c, 401, 'KAKAO_WEBHOOK_UNAUTHORIZED', 'Unauthorized');
  }

  const params = await readParams(c);
  const kakaoId = params.user_id ?? '';
  const referrerType = REFERRER_TYPE.test(params.referrer_type ?? '') ? params.referrer_type : 'UNKNOWN';
  if (params.app_id !== appId || !KAKAO_USER_ID.test(kakaoId)) {
    // 우리 앱의 해제가 아니거나 형식이 틀렸다 — 바꿀 것이 없다(카카오에는 200).
    logStructured('warn', { at: 'auth.kakao.unlink_webhook', ignored: 'bad_params', referrer_type: referrerType });
    return c.body(null, 200);
  }

  // ⚠ **먼저 200 으로 답하고 처리는 응답 뒤에 잇는다**(코덱스 #994). 카카오는 3초 안의 200 을 요구하는데, DB 조회와 여러 번
  //   왕복하는 쓰기 트랜잭션을 기다리면 Turso 가 느린 날 그 시간을 넘긴다 — 그러면 카카오가 끊고, 요청에 묶인 처리도 함께 잘린다.
  //   `waitUntil` 에 맡기면 응답과 상관없이 끝까지 돈다(실패는 경보, '탈퇴 신청됨' 신호도 그 안에서).
  const work = (async () => {
    try {
      const result = await handleKakaoUnlink(getDB(c.env), kakaoId, new Date());
      // 회원번호는 적지 않는다(사람을 가리키는 값). 무엇을 했는지만 남긴다.
      logStructured('info', { at: 'auth.kakao.unlink_webhook', referrer_type: referrerType, outcome: result.outcome });
      if (result.pushTargets.length > 0) {
        // 다른 기기에 '탈퇴 신청됨' 신호(`POST /user/me/deletion` 과 같다). 놓쳐도 그 기기의 다음 요청이 403 으로 같은 정리를 한다.
        await sendAccountDeletionRequestedPush(c.env, result.pushTargets).catch(() => {});
      }
    } catch (err) {
      logRouteError(c, err);
    }
  })();
  let deferred = false;
  try {
    c.executionCtx.waitUntil(work);
    deferred = true;
  } catch {
    // executionCtx 가 없는 실행(테스트) — 여기서 끝까지 기다린다.
  }
  if (!deferred) await work;
  return c.body(null, 200);
});

export default kakaoWebhook;
