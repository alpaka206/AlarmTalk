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

/** 영구적으로 무효한 토큰을 뜻하는 FCM v1 에러 코드 — push_tokens 에서 제거 대상. */
const STALE_TOKEN_ERRORS = new Set(['UNREGISTERED', 'INVALID_ARGUMENT', 'NOT_FOUND']);

export async function getTokensForUser(db: Client, userId: string): Promise<string[]> {
  const result = await db.execute({
    sql: 'SELECT token FROM push_tokens WHERE user_id = ?',
    args: [userId],
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
        body: JSON.stringify({
          message: {
            token: msg.token,
            notification: { title: msg.title, body: msg.body },
            data: msg.data ?? {},
            android: {
              priority: 'HIGH',
              notification: { channel_id: msg.data?.channelId ?? 'alarms' },
            },
            apns: {
              headers: { 'apns-priority': '10' },
              payload: { aps: { sound: 'default' } },
            },
          },
        }),
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
