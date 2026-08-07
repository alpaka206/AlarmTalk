import type { Client } from '@libsql/client/web';
import type { Env } from '../types';
import { logStructured } from './logger';
import { getGoogleAccessToken, parseServiceAccountJson } from './google-oauth';

export type PushLocale = 'ko' | 'en';

const pushTexts: Record<PushLocale, { alarmBody: (time: string) => string }> = {
  ko: {
    alarmBody: (time) => `${time} 알람이 울립니다`,
  },
  en: {
    alarmBody: (time) => `Alarm at ${time}`,
  },
};

function getTexts(locale: PushLocale) {
  return pushTexts[locale] ?? pushTexts.ko;
}

export interface FcmMessage {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface FcmSendResult {
  token: string;
  success: boolean;
  /** FCM 에러 코드. UNREGISTERED / INVALID_ARGUMENT 면 토큰을 정리해야 한다. */
  error?: string;
}

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/**
 * FCM v1 메시지 본문 구성. title/body 가 모두 비면 data-only 로 보낸다(가족 알람 신호처럼 클라가
 * 직접 pull 후 알림을 그릴 때). data-only 는 notification 블록을 빼(시스템 트레이 중복 알림 방지),
 * onMessageReceived 가 백그라운드에서도 호출돼 즉시 pull→로컬 스케줄이 되게 한다.
 * title/body 가 있으면 기존 notification 방식 그대로.
 */
function buildFcmMessage(msg: FcmMessage): Record<string, unknown> {
  const hasNotification = Boolean(msg.title || msg.body);
  const message: Record<string, unknown> = {
    token: msg.token,
    data: msg.data ?? {},
    android: {
      priority: 'HIGH',
      ...(hasNotification ? { notification: { channel_id: msg.data?.channelId ?? 'alarms' } } : {}),
    },
  };
  if (hasNotification) {
    message.notification = { title: msg.title, body: msg.body };
  }
  return message;
}

/** 영구적으로 무효한 토큰을 뜻하는 FCM v1 에러 코드 — push_tokens 에서 제거 대상. */
const STALE_TOKEN_ERRORS = new Set(['UNREGISTERED', 'INVALID_ARGUMENT', 'NOT_FOUND']);

export async function getTokensForUser(db: Client, userId: string): Promise<string[]> {
  // push_tokens.user_id 는 users.id(PK, FK REFERENCES users(id))로 저장한다. 하지만 호출부는 users.id
  // (가족 push=recipient.id) 또는 로그인 ID(예약 알람 push=alarm.target_user_id/user_id)를 넘긴다.
  // 로그인 ID 는 계정 종류별로 google_id/email-계정=users.id 로 다르므로(auth.ts loginSub),
  // users 로 조인해 두 식별자(id/google_id) 모두 매칭한다(각각 유니크라 최대 1명 매칭).
  const result = await db.execute({
    sql: `SELECT pt.token FROM push_tokens pt
          JOIN users u ON u.id = pt.user_id
          WHERE u.id = ? OR u.google_id = ?`,
    args: [userId, userId],
  });
  return result.rows.map((r) => String(r.token));
}

function extractFcmErrorCode(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: { status?: string; details?: Array<{ errorCode?: string }> };
    };
    const detailCode = parsed.error?.details?.find((d) => d.errorCode)?.errorCode;
    return detailCode ?? parsed.error?.status ?? 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

/**
 * FCM HTTP v1 실전송. FIREBASE_PROJECT_ID 와 FIREBASE_SERVICE_ACCOUNT_JSON
 * (client_email/private_key 포함) 이 모두 설정돼 있어야 하며, 없으면 dev 편의를
 * 위해 MOCK_SEND 로 로그만 남긴다 (성공으로 처리하지 않고 success:false).
 */
export async function sendPushNotifications(
  messages: FcmMessage[],
  env: Pick<Env, 'FIREBASE_PROJECT_ID' | 'FIREBASE_SERVICE_ACCOUNT_JSON'>,
): Promise<FcmSendResult[]> {
  const account = parseServiceAccountJson(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const projectId = env.FIREBASE_PROJECT_ID;

  if (!account || !projectId) {
    for (const msg of messages) {
      logStructured('warn', {
        at: 'fcm.sendPush',
        action: 'MOCK_SEND_UNCONFIGURED',
        token: msg.token.slice(0, 8) + '...',
        title: msg.title,
      });
    }
    return messages.map((m) => ({ token: m.token, success: false, error: 'FCM_UNCONFIGURED' }));
  }

  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken(account, FCM_SCOPE);
  } catch (err) {
    logStructured('error', { at: 'fcm.sendPush', action: 'OAUTH_FAILED', error: String(err) });
    return messages.map((m) => ({ token: m.token, success: false, error: 'OAUTH_FAILED' }));
  }

  const endpoint = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  const results: FcmSendResult[] = [];

  for (const msg of messages) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: buildFcmMessage(msg) }),
      });

      if (res.ok) {
        results.push({ token: msg.token, success: true });
        continue;
      }

      const errorCode = extractFcmErrorCode(await res.text());
      logStructured('warn', {
        at: 'fcm.sendPush',
        action: 'SEND_FAILED',
        status: res.status,
        error: errorCode,
        token: msg.token.slice(0, 8) + '...',
      });
      results.push({ token: msg.token, success: false, error: errorCode });
    } catch (err) {
      results.push({ token: msg.token, success: false, error: String(err).slice(0, 200) });
    }
  }

  return results;
}

/** 무효 토큰(UNREGISTERED 등)을 push_tokens 에서 제거한다. */
export async function pruneStaleTokens(db: Client, results: FcmSendResult[]): Promise<void> {
  const stale = results.filter((r) => !r.success && r.error && STALE_TOKEN_ERRORS.has(r.error));
  if (stale.length === 0) return;

  // ⚠ **한 번에 지운다.** 예전에는 토큰마다 DELETE 를 돌렸는데, 가족 그룹 전체에 푸시를
  // 보내고 여러 기기가 한꺼번에 UNREGISTERED 로 돌아오면 그 수만큼 왕복이 생겼다.
  // 플레이스홀더는 개수만큼 만들고 값은 예외 없이 `args` 로 넘긴다(SQL 규약).
  const tokens = stale.map((r) => r.token);
  const placeholders = tokens.map(() => '?').join(', ');
  try {
    await db.execute({
      sql: `DELETE FROM push_tokens WHERE token IN (${placeholders})`,
      args: tokens,
    });
    logStructured('info', {
      at: 'fcm.pruneStaleTokens',
      removed: tokens.length,
      // 토큰 전문은 남기지 않는다 — 앞 8자만으로도 어느 기기였는지 대조는 된다.
      samples: tokens.slice(0, 5).map((t) => t.slice(0, 8) + '...'),
    });
  } catch (err) {
    logStructured('error', { at: 'fcm.pruneStaleTokens', error: String(err) });
  }
}

/**
 * 가족 알람 생성 시 수신자에게 보내는 data-only 신호. 클라(onMessageReceived)가 받으면 즉시 원격
 * 알람을 pull 해 로컬 스케줄+알림(notifyReceivedAlarm)을 그린다 — 여기서 notification 을 넣지 않아
 * 중복 알림을 막는다. 앱이 완전 종료돼 신호를 놓쳐도 15분 주기 pull 이 폴백. 토큰 없으면 no-op.
 * userId 는 수신자의 users.id(PK) — push_tokens.user_id(=FK users(id))와 정합.
 */
export async function sendFamilyAlarmPush(
  db: Client,
  env: Pick<Env, 'FIREBASE_PROJECT_ID' | 'FIREBASE_SERVICE_ACCOUNT_JSON'>,
  recipientUserId: string,
  alarmId: string,
): Promise<FcmSendResult[]> {
  const tokens = await getTokensForUser(db, recipientUserId);
  if (tokens.length === 0) return [];

  const messages: FcmMessage[] = tokens.map((token) => ({
    token,
    title: '',
    body: '',
    data: { type: 'family_alarm', alarmId },
  }));

  const results = await sendPushNotifications(messages, env);
  await pruneStaleTokens(db, results);
  return results;
}

/**
 * 목소리 공유 on/off 시 같은 플랜 그룹 멤버들에게 보내는 data-only 신호. 클라가 받으면
 * 공유 목소리 목록과 스톡 클립 매니페스트를 즉시 새로고침해, 상대가 토글을 켠 순간
 * 받은 쪽 목소리 탭에 바로 나타난다. 놓쳐도 다음 refreshSocial(탭 진입/앱 시작)이 폴백.
 */
export async function sendVoiceShareChangedPush(
  db: Client,
  env: Pick<Env, 'FIREBASE_PROJECT_ID' | 'FIREBASE_SERVICE_ACCOUNT_JSON'>,
  recipientUserIds: string[],
): Promise<void> {
  const messages: FcmMessage[] = [];
  for (const userId of recipientUserIds) {
    const tokens = await getTokensForUser(db, userId);
    for (const token of tokens) {
      messages.push({ token, title: '', body: '', data: { type: 'voice_share_changed' } });
    }
  }
  if (messages.length === 0) return;
  const results = await sendPushNotifications(messages, env);
  await pruneStaleTokens(db, results);
}

/**
 * 구독 만료로 무료 강등이 확정될 때 그 사용자에게 보내는 data-only 신호. 클라가 받으면(백그라운드여도)
 * 구독/플랜을 재조회해 '진짜 무료'면 유료 목소리 알람을 기본 알람으로 변환한다. 과다발송해도 클라가
 * 재조회로 확인(유료면 무시)하므로 안전. 놓쳐도 다음 앱 시작·울림 시점 게이트가 폴백.
 */
/**
 * 목소리 접근권이 서버에서 사라졌음을 알리는 data-only 신호.
 *
 * 받은 알람은 원격 pull 로 갱신되지만 **본인 소유 알람은 그 pull 대상이 아니다**
 * (RemoteAlarmPullSyncService 는 받은 알람만 훑는다). 그래서 본인 알람은 목소리 목록을
 * 다시 받아 접근권을 잃은 것을 로컬에서 강등해야 한다 — 클라의 VoiceAccessSyncWorker 가
 * 그 일을 한다. 플랜 만료와 달리 동의 철회는 users.plan 이 그대로라 plan_changed 경로의
 * '진짜 무료' 게이트에 걸리지 않으므로, 별도 신호가 필요하다.
 */
export async function sendVoiceAccessRevokedPush(
  db: Client,
  env: Pick<Env, 'FIREBASE_PROJECT_ID' | 'FIREBASE_SERVICE_ACCOUNT_JSON'>,
  userId: string,
): Promise<FcmSendResult[]> {
  const tokens = await getTokensForUser(db, userId);
  if (tokens.length === 0) return [];
  const messages: FcmMessage[] = tokens.map((token) => ({
    token,
    title: '',
    body: '',
    data: { type: 'voice_access_revoked' },
  }));
  const results = await sendPushNotifications(messages, env);
  await pruneStaleTokens(db, results);
  return results;
}

/**
 * 서버가 강등한 알람을 그 기기가 **즉시 다시 받아 가게** 하는 신호.
 *
 * plan_changed 로는 안 된다 — 클라의 PlanChangeSyncWorker 는 이용권을 다시 받아 '진짜 무료'일
 * 때만 로컬 강등을 돌리고, 원격 알람 pull 은 하지 않는다. 그래서 아직 유료인 수신자는 서버가
 * 알람을 바꿔도 주기/앱시작 폴백까지 캐시된 녹음으로 계속 울린다. 알람을 다시 받아오게 하는
 * 신호는 family_alarm 이므로 그걸 보낸다(수신자 앱은 기존 행을 업데이트만 하고 알림은 띄우지
 * 않는다 — notifyReceivedAlarm 은 신규 임포트 전용).
 *
 * 반드시 **쓰기 트랜잭션 커밋 후에** 부를 것. 롤백될 수 있는 변경을 미리 알리면 안 된다.
 * 한 건 실패가 나머지를 막지 않도록 개별적으로 삼킨다(폴백 pull 이 정확성을 보장한다).
 */
/**
 * 강등 알림 메시지를 만든다 — **수신자 단위로 접어서**.
 *
 * 받은 알람은 수신자당 한 번만 보낸다. 클라 핸들러(AlarmTalkMessagingService)는 payload 의
 * alarmId 를 쓰지 않고 원격 알람을 '전부' 다시 받으므로, 알람마다 보내면 토큰 조회와 FCM
 * 왕복만 알람 수만큼 늘어난다 — 한 스윕이 여러 알람을 강등하면 Workers 서브리퀘스트 상한에
 * 걸릴 수 있다(AGENTS.md). alarmId 는 형식 유지용으로 대표 하나만 싣는다.
 *
 * 토큰 조회를 인자로 받아 순수하게 유지한다 — 팬아웃 규칙을 DB 없이 단언할 수 있게.
 */
export async function buildDowngradeNotifications(
  getTokens: (userId: string) => Promise<string[]>,
  targets: Array<{ alarmId: string; ownerUserId: string; isReceived: boolean }>,
  voiceAccessRevokedUserIds: string[] = [],
): Promise<FcmMessage[]> {
  const receivedRepresentative = new Map<string, string>();
  for (const target of targets) {
    if (!target.isReceived) continue;
    if (!receivedRepresentative.has(target.ownerUserId)) {
      receivedRepresentative.set(target.ownerUserId, target.alarmId);
    }
  }
  // 본인 소유 알람은 pull 대상이 아니라 목소리 접근권 재확인이 필요하다. 알람 행을 못 찾은
  // 계정도 포함한다(서버에 아직 동기화되지 않은 로컬 알람 때문에).
  const voiceAccessOwners = new Set([
    ...targets.filter((t) => !t.isReceived).map((t) => t.ownerUserId),
    ...voiceAccessRevokedUserIds.filter(Boolean),
  ]);

  const messages: FcmMessage[] = [];
  for (const [userId, alarmId] of receivedRepresentative) {
    for (const token of await getTokens(userId)) {
      messages.push({ token, title: '', body: '', data: { type: 'family_alarm', alarmId } });
    }
  }
  for (const userId of voiceAccessOwners) {
    for (const token of await getTokens(userId)) {
      messages.push({ token, title: '', body: '', data: { type: 'voice_access_revoked' } });
    }
  }
  return messages;
}

export async function notifyDowngradedAlarms(
  db: Client,
  env: Partial<Pick<Env, 'FIREBASE_PROJECT_ID' | 'FIREBASE_SERVICE_ACCOUNT_JSON'>> | undefined,
  targets: Array<{ alarmId: string; ownerUserId: string; isReceived: boolean }>,
  /**
   * 목소리 접근권을 잃은 계정들 — 서버에서 찾은 알람 행과 **무관하게** 알려야 한다.
   * 아직 서버로 동기화되지 않은 로컬 알람은 targets 에 안 잡히는데, 발사는 로컬이고
   * 울림 시점 동의 게이트도 없어 그 기기는 지워진 녹음으로 계속 울린다.
   */
  voiceAccessRevokedUserIds: string[] = [],
): Promise<void> {
  if (!env?.FIREBASE_PROJECT_ID || !env?.FIREBASE_SERVICE_ACCOUNT_JSON) return;
  if (targets.length === 0 && voiceAccessRevokedUserIds.length === 0) return;
  // 메시지를 모아 **한 번에** 보낸다 — sendPushNotifications 는 호출마다 OAuth 토큰을 새로
  // 받으므로, 대상마다 나눠 부르면 그만큼 왕복이 늘어난다.
  const messages = await buildDowngradeNotifications(
    (userId) => getTokensForUser(db, userId),
    targets,
    voiceAccessRevokedUserIds,
  );
  if (messages.length === 0) return;
  try {
    const results = await sendPushNotifications(messages, {
      FIREBASE_PROJECT_ID: env.FIREBASE_PROJECT_ID,
      FIREBASE_SERVICE_ACCOUNT_JSON: env.FIREBASE_SERVICE_ACCOUNT_JSON,
    });
    await pruneStaleTokens(db, results);
  } catch (err) {
    // 삼켜도 되는 이유: 즉시성만 잃는다. 정확성은 하루 주기 재확인과 앱 시작 재조회가 맡는다.
    logStructured('error', {
      at: 'fcm.downgraded_alarm_push',
      action: 'DOWNGRADED_ALARM_PUSH_FAILED',
      error: String(err),
    });
  }
}

export async function sendPlanChangedPush(
  db: Client,
  env: Pick<Env, 'FIREBASE_PROJECT_ID' | 'FIREBASE_SERVICE_ACCOUNT_JSON'>,
  userIds: string[],
): Promise<void> {
  const messages: FcmMessage[] = [];
  for (const userId of Array.from(new Set(userIds))) {
    const tokens = await getTokensForUser(db, userId);
    for (const token of tokens) {
      messages.push({ token, title: '', body: '', data: { type: 'plan_changed' } });
    }
  }
  if (messages.length === 0) return;
  const results = await sendPushNotifications(messages, env);
  await pruneStaleTokens(db, results);
}

export async function sendAlarmPush(
  db: Client,
  env: Pick<Env, 'FIREBASE_PROJECT_ID' | 'FIREBASE_SERVICE_ACCOUNT_JSON'>,
  userId: string,
  alarmId: string,
  alarmTime: string,
  locale: PushLocale = 'ko',
): Promise<FcmSendResult[]> {
  const tokens = await getTokensForUser(db, userId);
  if (tokens.length === 0) return [];

  const texts = getTexts(locale);
  const messages: FcmMessage[] = tokens.map((token) => ({
    token,
    title: 'AlarmTalk',
    body: texts.alarmBody(alarmTime),
    data: { type: 'alarm', alarmId, channelId: 'alarms' },
  }));

  const results = await sendPushNotifications(messages, env);
  await pruneStaleTokens(db, results);
  return results;
}
