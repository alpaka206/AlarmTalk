import type { Client } from '@libsql/client/web';
import type { Env } from '../types';
import { logStructured } from './logger';

/**
 * 소셜/안내 알림 채널. **앱의 `alarm/NotificationChannels.kt` 값과 같아야 한다** —
 * 존재하지 않는 채널 id 를 주면 Android 8+ 에서 알림이 **아예 표시되지 않는다**(로그에는
 * 성공으로 남아 발견이 극히 어렵다). 결제 안내를 울림 채널로 보내면 알람 소리가 난다.
 */
const SOCIAL_CHANNEL_ID = 'voice_alarm_social_updates_v1';
import {
  apnsConfigFromEnv,
  isDeadApnsToken,
  sendApnsNotifications,
  type ApnsMessage,
  type ApnsSendResult,
} from './apns';
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

export interface PushTarget {
  token: string;
  platform: string;
}

/**
 * 사용자의 푸시 토큰을 **플랫폼과 함께** 가져온다.
 *
 * ⚠ iOS 는 FCM 이 아니라 **APNs 로 직접** 보낸다(`lib/apns.ts` 주석 참조). 그래서
 * 보내는 쪽이 플랫폼을 알아야 한다 — 섞어서 FCM 으로 보내면 iOS 토큰은 전부 조용히
 * 버려진다(FCM 은 등록되지 않은 토큰으로 보고 지운다).
 */
export async function getPushTargetsForUser(db: Client, userId: string): Promise<PushTarget[]> {
  const result = await db.execute({
    sql: `SELECT pt.token, pt.platform FROM push_tokens pt
          JOIN users u ON u.id = pt.user_id
          WHERE u.id = ? OR u.google_id = ?`,
    args: [userId, userId],
  });
  return result.rows.map((r) => ({ token: String(r.token), platform: String(r.platform) }));
}

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
 * **조용한 신호 푸시를 두 플랫폼에 보낸다.** 안드로이드는 FCM data-only, iOS 는 APNs
 * background push 로 나간다.
 *
 * ⚠ iOS 를 빼먹으면 **받은 알람이 제때 예약되지 않는다.** iOS 에는 안드로이드
 * WorkManager 같은 보장된 주기 실행이 없어서, 이 푸시가 실질적으로 유일한 즉시 경로다
 * (`BGAppRefreshTask` 는 iOS 가 실행 시점을 정하고 보장하지 않는다).
 *
 * ⚠ **알림 권한과 무관하다.** background push 는 권한 없이 배달되므로, 알림을 거절한
 * 사용자도 알람은 제때 울린다.
 *
 * ⚠ 갈래를 호출부마다 베끼지 말 것 — 네 곳에 흩어지면 하나를 빠뜨린다.
 */
export type SilentSignal = { userId: string; data: Record<string, string> };

/** 여러 사용자·신호를 플랫폼별 한 묶음으로 보내 OAuth/APNs 준비 왕복을 중복하지 않는다. */
async function sendSilentSignals(
  db: Client,
  env: SignalPushEnv,
  signals: readonly SilentSignal[],
): Promise<FcmSendResult[]> {
  const fcmMessages: FcmMessage[] = [];
  const apnsMessages: ApnsMessage[] = [];
  for (const signal of signals) {
    for (const target of await getPushTargetsForUser(db, signal.userId)) {
      if (target.platform === 'ios') {
        apnsMessages.push({
          token: target.token,
          title: '',
          body: '',
          data: signal.data,
          silent: true,
        });
      } else {
        fcmMessages.push({ token: target.token, title: '', body: '', data: signal.data });
      }
    }
  }

  let results: FcmSendResult[] = [];
  if (fcmMessages.length > 0) {
    results = await sendPushNotifications(fcmMessages, env);
    await pruneStaleTokens(db, results);
  }
  if (apnsMessages.length > 0) {
    const config = apnsConfigFromEnv(env);
    // 키가 없으면 조용히 건너뛴다 — 주기 동기화가 그물로 남아 있다.
    if (config) {
      await pruneDeadApnsTokens(db, await sendApnsNotifications(apnsMessages, config));
    }
  }
  return results;
}

async function sendSilentSignalPush(
  db: Client,
  env: SignalPushEnv,
  userIds: readonly string[],
  data: Record<string, string>,
): Promise<FcmSendResult[]> {
  return sendSilentSignals(
    db,
    env,
    Array.from(new Set(userIds)).map((userId) => ({ userId, data })),
  );
}

/** 신호 푸시가 두 스토어를 다 쓰므로 env 도 둘을 함께 받는다. */
type SignalPushEnv = Partial<
  Pick<
    Env,
    | 'FIREBASE_PROJECT_ID'
    | 'FIREBASE_SERVICE_ACCOUNT_JSON'
    | 'APNS_KEY_ID'
    | 'APNS_PRIVATE_KEY'
    | 'APPLE_TEAM_ID'
    | 'APPLE_BUNDLE_ID'
    | 'ENVIRONMENT'
  >
>;

/**
 * 가족 알람 생성 시 수신자에게 보내는 무음 신호. 클라는 즉시 원격 알람을 받아 로컬에 예약한다.
 * 알림 payload를 넣지 않아 중복 알림을 막고, 토큰이 없으면 아무 작업도 하지 않는다.
 */
export async function sendFamilyAlarmPush(
  db: Client,
  env: SignalPushEnv,
  recipientUserId: string,
  alarmId: string,
): Promise<FcmSendResult[]> {
  return sendSilentSignalPush(db, env, [recipientUserId], { type: 'family_alarm', alarmId });
}

/**
 * 목소리 공유 on/off 시 같은 플랜 그룹 멤버들에게 보내는 data-only 신호. 클라가 받으면
 * 공유 목소리 목록과 스톡 클립 매니페스트를 즉시 새로고침해, 상대가 토글을 켠 순간
 * 받은 쪽 목소리 탭에 바로 나타난다. 놓쳐도 다음 refreshSocial(탭 진입/앱 시작)이 폴백.
 */
export async function sendVoiceShareChangedPush(
  db: Client,
  env: SignalPushEnv,
  recipientUserIds: string[],
): Promise<void> {
  await sendSilentSignalPush(db, env, recipientUserIds, { type: 'voice_share_changed' });
}

/**
 * 구독 만료로 무료 강등이 확정될 때 그 사용자에게 보내는 data-only 신호. 클라가 받으면(백그라운드여도)
 * 구독/플랜을 재조회해 '진짜 무료'면 유료 목소리 알람을 기본 알람으로 변환한다. 과다발송해도 클라가
 * 재조회로 확인(유료면 무시)하므로 안전. 놓쳐도 다음 앱 시작·울림 시점 게이트가 폴백.
 */
// ⚠ **`sendVoiceAccessRevokedPush` 를 되살리지 말 것**(2026-08-07 삭제).
// 같은 `voice_access_revoked` 신호를 아래 `buildDowngradeSignals` 가 이미 보낸다.
// 부르는 곳 없이 선언만 남아 있어, 신호 경로가 둘인 것처럼 보였다.

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
 * 전송 실패는 삼키며, 폴백 pull 이 정확성을 보장한다.
 */
/**
 * 강등 신호를 만든다 — **수신자 단위로 접어서**.
 *
 * 받은 알람은 수신자당 한 번만 보낸다. 클라 핸들러(AlarmTalkMessagingService)는 payload 의
 * alarmId 를 쓰지 않고 원격 알람을 '전부' 다시 받으므로, 알람마다 보내면 토큰 조회와 FCM
 * 왕복만 알람 수만큼 늘어난다 — 한 스윕이 여러 알람을 강등하면 Workers 서브리퀘스트 상한에
 * 걸릴 수 있다(AGENTS.md). alarmId 는 형식 유지용으로 대표 하나만 싣는다.
 *
 * 플랫폼·토큰 조회는 공통 전송 함수가 맡는다. 여기서는 팬아웃 규칙만 순수하게 계산해
 * Android와 iOS가 반드시 같은 수신자·payload를 받게 한다.
 */
export function buildDowngradeSignals(
  targets: Array<{ alarmId: string; ownerUserId: string; isReceived: boolean }>,
  voiceAccessRevokedUserIds: string[] = [],
): SilentSignal[] {
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

  const signals: SilentSignal[] = [];
  for (const [userId, alarmId] of receivedRepresentative) {
    signals.push({ userId, data: { type: 'family_alarm', alarmId } });
  }
  for (const userId of voiceAccessOwners) {
    signals.push({ userId, data: { type: 'voice_access_revoked' } });
  }
  return signals;
}

export async function notifyDowngradedAlarms(
  db: Client,
  env: SignalPushEnv | undefined,
  targets: Array<{ alarmId: string; ownerUserId: string; isReceived: boolean }>,
  /**
   * 목소리 접근권을 잃은 계정들 — 서버에서 찾은 알람 행과 **무관하게** 알려야 한다.
   * 아직 서버로 동기화되지 않은 로컬 알람은 targets 에 안 잡히는데, 발사는 로컬이고
   * 울림 시점 동의 게이트도 없어 그 기기는 지워진 녹음으로 계속 울린다.
   */
  voiceAccessRevokedUserIds: string[] = [],
): Promise<void> {
  if (!env) return;
  if (targets.length === 0 && voiceAccessRevokedUserIds.length === 0) return;
  // 신호를 모아 **플랫폼별 한 번에** 보낸다. iOS 토큰을 FCM에 섞으면 무효 토큰으로 오인해
  // 삭제하므로 모든 무음 신호가 쓰는 공통 라우터를 반드시 거친다.
  const signals = buildDowngradeSignals(targets, voiceAccessRevokedUserIds);
  if (signals.length === 0) return;
  try {
    await sendSilentSignals(db, env, signals);
  } catch (err) {
    // 삼켜도 되는 이유: 즉시성만 잃는다. 정확성은 하루 주기 재확인과 앱 시작 재조회가 맡는다.
    logStructured('error', {
      at: 'fcm.downgraded_alarm_push',
      action: 'DOWNGRADED_ALARM_PUSH_FAILED',
      error: String(err),
    });
  }
}

/**
 * **결제 실패로 플랜이 보류됐다**는 알림 — 소유자와 멤버에게 **다른 문구**로 보낸다.
 *
 * ⚠ `sendPlanChangedPush` 와 달리 **눈에 보이는 알림**이다(title/body 를 채운다).
 * 조용한 데이터 푸시로만 보내면 사용자는 어느 날 갑자기 목소리 알람이 잠긴 것을
 * 발견하고 앱이 고장 났다고 생각한다 — 카드를 고치면 되는 일인데 그걸 모른다.
 *
 * ⚠ **문구가 갈려야 한다.** 소유자는 자기 카드를 고칠 수 있지만, 멤버는 할 수 있는 게
 * 없다. 멤버에게 "결제 수단을 확인해 주세요" 를 보내면 자기 카드에 문제가 생긴 줄 알고
 * 엉뚱한 곳을 뒤진다.
 *
 * ⚠ 호출은 **DB 쓰기가 끝난 뒤**에(FCM 은 네트워크 I/O). 실패해도 흐름을 깨지 않는다 —
 * 정확성은 클라의 재조회가 보장하고 푸시는 즉시성만 담당한다.
 */
export async function sendPaymentFailedPush(
  db: Client,
  env: Pick<
    Env,
    | 'FIREBASE_PROJECT_ID'
    | 'FIREBASE_SERVICE_ACCOUNT_JSON'
    | 'APNS_KEY_ID'
    | 'APNS_PRIVATE_KEY'
    | 'APPLE_TEAM_ID'
    | 'APPLE_BUNDLE_ID'
    | 'ENVIRONMENT'
  >,
  params: { ownerUserPk: string; memberUserPks: string[] },
): Promise<void> {
  const fcmMessages: FcmMessage[] = [];
  const apnsMessages: ApnsMessage[] = [];

  const push = async (userId: string, title: string, body: string) => {
    for (const target of await getPushTargetsForUser(db, userId)) {
      if (target.platform === 'ios') {
        // iOS 는 APNs 로 직접 간다(`lib/apns.ts` 주석). FCM 에 섞어 보내면 조용히 버려진다.
        apnsMessages.push({ token: target.token, title, body, data: { type: 'plan_changed' } });
      } else {
        // ⚠ **두 통을 보낸다.** `notification` 블록이 붙은 메시지는 앱이 백그라운드일 때
        // `onMessageReceived` 를 호출하지 않는다 — 표시용 한 통만 보내면 알림은 뜨는데
        // `PlanChangeSyncWorker` 가 안 돌아 **무료로 내려간 목소리 알람이 그대로 울린다.**
        // (1) 표시용 — 결제 안내는 울림 채널이 아니라 소셜 채널로.
        fcmMessages.push({
          token: target.token,
          title,
          body,
          data: { type: 'billing_hold', channelId: SOCIAL_CHANNEL_ID },
        });
        // (2) 워커 기동용 data-only — title/body 가 없어야 onMessageReceived 가 온다.
        fcmMessages.push({
          token: target.token,
          title: '',
          body: '',
          data: { type: 'plan_changed' },
        });
      }
    }
  };

  await push(
    params.ownerUserPk,
    '결제가 확인되지 않았어요',
    '이용권이 잠시 멈췄어요. 결제 수단을 확인하면 바로 다시 쓸 수 있어요.',
  );
  // 소유자가 멤버 목록에 섞여 들어와도 두 번 보내지 않는다.
  for (const memberPk of Array.from(new Set(params.memberUserPks))) {
    if (memberPk === params.ownerUserPk) continue;
    await push(
      memberPk,
      '함께 쓰는 이용권이 멈췄어요',
      '이용권 주인의 결제가 확인되지 않아 공유 기능이 잠시 잠겼어요.',
    );
  }

  if (fcmMessages.length > 0) {
    await pruneStaleTokens(db, await sendPushNotifications(fcmMessages, env));
  }
  if (apnsMessages.length > 0) {
    const config = apnsConfigFromEnv(env);
    // ⚠ 키가 없으면 조용히 건너뛴다 — 푸시가 없다고 보류 처리가 깨지면 안 된다.
    if (config) {
      const results = await sendApnsNotifications(apnsMessages, config);
      await pruneDeadApnsTokens(db, results);
    }
  }
}

/**
 * **목소리가 곧 영구 삭제된다고 알린다.** 유료 접근을 잃어 보관 유예가 걸린 순간 보낸다.
 *
 * ⚠ **이것만 눈에 보이는 푸시다.** 나머지 강등 신호(`family_alarm`·`voice_access_revoked`·
 * `plan_changed`)는 전부 **무음 데이터**라 앱을 열어야만 알 수 있다. 그런데 삭제는
 * 유예 3일이 지나면 **되돌릴 수 없고**, 그 사이 앱을 한 번도 안 여는 사람이 정확히
 * 잃는 쪽이다 — 그래서 여기만 표시용을 함께 보낸다.
 *
 * 문구에 **기한과 결과를 둘 다** 넣는다. "보관돼요" 만 쓰면 기다리면 되는 줄 안다.
 *
 * `sendPaymentFailedPush` 와 같은 두 통 규칙을 따른다(표시용 + 워커 기동용 data-only).
 */
export async function sendVoiceDeletionWarningPush(
  db: Client,
  env: Pick<
    Env,
    | 'FIREBASE_PROJECT_ID'
    | 'FIREBASE_SERVICE_ACCOUNT_JSON'
    | 'APNS_KEY_ID'
    | 'APNS_PRIVATE_KEY'
    | 'APPLE_TEAM_ID'
    | 'APPLE_BUNDLE_ID'
  > & { ENVIRONMENT?: string },
  params: { userPks: string[]; retentionDays: number },
): Promise<void> {
  const fcmMessages: FcmMessage[] = [];
  const apnsMessages: ApnsMessage[] = [];
  const title = '목소리가 곧 삭제돼요';
  const body =
    `이용권이 끝나 목소리를 ${params.retentionDays}일간만 보관해요. ` +
    '그 안에 다시 등록하면 그대로 쓸 수 있고, 지나면 영구 삭제돼요.';

  for (const userId of Array.from(new Set(params.userPks)).filter(Boolean)) {
    for (const target of await getPushTargetsForUser(db, userId)) {
      if (target.platform === 'ios') {
        apnsMessages.push({ token: target.token, title, body, data: { type: 'plan_changed' } });
      } else {
        fcmMessages.push({
          token: target.token,
          title,
          body,
          data: { type: 'voice_deletion_warning', channelId: SOCIAL_CHANNEL_ID },
        });
        // 워커 기동용 — title/body 가 비어야 onMessageReceived 가 온다.
        fcmMessages.push({
          token: target.token,
          title: '',
          body: '',
          data: { type: 'plan_changed' },
        });
      }
    }
  }

  if (fcmMessages.length > 0) {
    await pruneStaleTokens(db, await sendPushNotifications(fcmMessages, env));
  }
  if (apnsMessages.length > 0) {
    const config = apnsConfigFromEnv(env);
    // ⚠ 키가 없으면 조용히 건너뛴다 — 푸시가 없다고 삭제 예약이 깨지면 안 된다.
    if (config) {
      const results = await sendApnsNotifications(apnsMessages, config);
      await pruneDeadApnsTokens(db, results);
    }
  }
}

/**
 * APNs 가 "이 토큰은 죽었다" 고 한 것만 지운다.
 *
 * ⚠ 네트워크 오류로 지우면 그 기기는 재로그인 전까지 푸시를 영영 못 받는다.
 */
async function pruneDeadApnsTokens(db: Client, results: ApnsSendResult[]): Promise<void> {
  const dead = results.filter((r) => !r.success && isDeadApnsToken(r.reason)).map((r) => r.token);
  if (dead.length === 0) return;
  const placeholders = dead.map(() => '?').join(', ');
  try {
    await db.execute({
      sql: `DELETE FROM push_tokens WHERE token IN (${placeholders})`,
      args: dead,
    });
    logStructured('info', { at: 'push.apns.prune', removed: dead.length });
  } catch (err) {
    logStructured('error', { at: 'push.apns.prune', error: String(err) });
  }
}

export async function sendPlanChangedPush(
  db: Client,
  env: SignalPushEnv,
  userIds: string[],
): Promise<void> {
  await sendSilentSignalPush(db, env, userIds, { type: 'plan_changed' });
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
