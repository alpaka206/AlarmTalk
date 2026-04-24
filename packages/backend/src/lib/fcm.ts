import type { Client } from '@libsql/client/web';

export interface FcmMessage {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface FcmSendResult {
  token: string;
  success: boolean;
  error?: string;
}

export async function getTokensForUser(db: Client, userId: string): Promise<string[]> {
  const result = await db.execute({
    sql: 'SELECT token FROM push_tokens WHERE user_id = ?',
    args: [userId],
  });
  return result.rows.map((r) => String(r.token));
}

export async function sendPushNotifications(
  messages: FcmMessage[],
): Promise<FcmSendResult[]> {
  // Structure-only: log instead of calling FCM HTTP v1 API.
  // Real implementation would POST to https://fcm.googleapis.com/v1/projects/{project}/messages:send
  const results: FcmSendResult[] = [];

  for (const msg of messages) {
    console.warn(
      JSON.stringify({
        level: 'info',
        at: 'fcm.sendPush',
        action: 'MOCK_SEND',
        token: msg.token.slice(0, 8) + '...',
        title: msg.title,
        body: msg.body,
      }),
    );
    results.push({ token: msg.token, success: true });
  }

  return results;
}

export async function sendAlarmPush(
  db: Client,
  userId: string,
  alarmId: string,
  alarmTime: string,
): Promise<FcmSendResult[]> {
  const tokens = await getTokensForUser(db, userId);
  if (tokens.length === 0) return [];

  const messages: FcmMessage[] = tokens.map((token) => ({
    token,
    title: 'VoiceAlarm',
    body: `${alarmTime} 알람이 울립니다`,
    data: { type: 'alarm', alarmId, channelId: 'alarms' },
  }));

  return sendPushNotifications(messages);
}

export async function sendNotePush(
  db: Client,
  userId: string,
  noteId: string,
  senderName: string,
): Promise<FcmSendResult[]> {
  const tokens = await getTokensForUser(db, userId);
  if (tokens.length === 0) return [];

  const messages: FcmMessage[] = tokens.map((token) => ({
    token,
    title: `💌 ${senderName}`,
    body: '새 쪽지가 도착했어요',
    data: { type: 'note', noteId, channelId: 'notes' },
  }));

  return sendPushNotifications(messages);
}
