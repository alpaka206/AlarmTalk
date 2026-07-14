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
 * onMessageReceived 가 백그라운드에서도 호출돼 즉시 pull→로컬 스케줄이 되게 한다. iOS 는
 * content-available 로 백그라운드 깨움만 요청. title/body 가 있으면 기존 notification 방식 그대로.
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
    apns: {
      headers: { 'apns-priority': hasNotification ? '10' : '5' },
      payload: hasNotification ? { aps: { sound: 'default' } } : { aps: { 'content-available': 1 } },
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
  // (가족 push=recipient.id) 또는 로그인 ID/google_id(예약 알람 push=alarm.target_user_id/user_id)를
  // 넘긴다 — Google 등 users.id != google_id 인 계정에서 후자가 안 맞으면 토큰을 못 찾는다. users 로
  // 조인해 두 식별자 모두 매칭한다(id/google_id 는 각각 유니크라 최대 1명 매칭).
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
  for (const result of stale) {
    try {
      await db.execute({
        sql: 'DELETE FROM push_tokens WHERE token = ?',
        args: [result.token],
      });
      logStructured('info', {
        at: 'fcm.pruneStaleTokens',
        token: result.token.slice(0, 8) + '...',
        error: result.error,
      });
    } catch (err) {
      logStructured('error', { at: 'fcm.pruneStaleTokens', error: String(err) });
    }
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
