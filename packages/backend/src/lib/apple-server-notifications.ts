// **App Store Server Notifications V2** — 서명 검증·범위 대조·수신 기록.
//
// 처리(누구의 무엇을 다시 묻는가)는 라우트(`routes/billing-apple-notifications.ts`)가 하고, 여기는 "이 알림을
// 믿어도 되는가" 와 "이미 처리했는가" 만 답한다. 규칙 전문은 `docs/spec/billing-lifecycle.md` 「애플 서버 알림 V2」.
import type { Client } from '@libsql/client';
import type { AppleTransactionInfo } from './apple-storekit';
import {
  AppleJwsVerificationError,
  verifyAppleSignedJws,
  type AppleJwsVerifyOptions,
} from './apple-jws';
import { UUID_RE } from './validate';

/** 애플이 문서화한 V2 `responseBodyV2DecodedPayload` 중 우리가 읽는 필드. */
export interface AppleNotificationPayload {
  notificationType: string;
  subtype?: string;
  notificationUUID: string;
  version?: string;
  signedDate?: number;
  data?: {
    bundleId?: string;
    environment?: string;
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
  };
  /** `RENEWAL_EXTENSION`/`SUMMARY` 처럼 `data` 대신 실려 오는 요약. 범위 대조(번들·환경)에만 쓴다. */
  summary?: { bundleId?: string; environment?: string };
}

export interface VerifiedAppleNotification {
  uuid: string;
  type: string;
  subtype: string | null;
  environment: 'Production' | 'Sandbox';
  signedDate: number | null;
  /** 알림에 실린 트랜잭션(서명 검증 완료). 없을 수 있다(TEST·요약 알림). */
  transaction: AppleTransactionInfo | null;
}

export type AppleNotificationRejection = 'invalid' | 'bundle_mismatch' | 'environment_mismatch';

export type AppleNotificationDecodeResult =
  | { ok: true; notification: VerifiedAppleNotification }
  | { ok: false; reason: AppleNotificationRejection; detail: string };

/**
 * 이 워커가 받는 애플 환경 — **운영은 `Production`, 그 밖(dev·테스트)은 `Sandbox` 하나씩.**
 *
 * App Store Connect 에는 서버 알림 URL 이 환경마다 하나(운영·샌드박스)라, 운영 URL 은 운영 워커에, 샌드박스 URL 은
 * dev 워커에 둔다. 다른 환경의 알림이 들어오면 URL 설정이 틀린 것이라 거절해 드러낸다(경보 코드). `Xcode`·
 * `LocalTesting` 같은 로컬 환경은 어느 워커도 받지 않는다.
 * ⚠ 운영 앱의 TestFlight·심사 구매(샌드박스)는 이 경로로 오지 않는다 — 그 구독은 지금처럼 확정·재조회가 맡는다.
 */
export function expectedAppleEnvironment(
  workerEnvironment: string | undefined,
): 'Production' | 'Sandbox' {
  return workerEnvironment === 'production' ? 'Production' : 'Sandbox';
}

const NOTIFICATION_NAME_RE = /^[A-Z_]{1,64}$/;

function reject(reason: AppleNotificationRejection, detail: string): AppleNotificationDecodeResult {
  return { ok: false, reason, detail };
}

/**
 * `signedPayload` 를 검증해 읽는다. 서명·체인이 틀렸거나 형식이 어긋나면 `invalid`, 애플이 서명했지만 우리 앱·
 * 우리 환경이 아니면 `bundle_mismatch`·`environment_mismatch`. 안에 실린 `signedTransactionInfo` 도 같은 검증을
 * 따로 거친다 — 바깥 서명이 덮는 문자열이지만, 읽는 값의 출처를 하나의 판정으로 맞춘다.
 */
export async function decodeAppleServerNotification(
  signedPayload: string,
  expected: { bundleId: string; environment: 'Production' | 'Sandbox' },
  verifyOptions: AppleJwsVerifyOptions = {},
): Promise<AppleNotificationDecodeResult> {
  let payload: AppleNotificationPayload;
  try {
    payload = await verifyAppleSignedJws<AppleNotificationPayload>(signedPayload, verifyOptions);
  } catch (error) {
    if (error instanceof AppleJwsVerificationError) return reject('invalid', error.message);
    throw error;
  }
  if (payload.version !== '2.0') return reject('invalid', 'unsupported notification version');
  if (typeof payload.notificationUUID !== 'string' || !UUID_RE.test(payload.notificationUUID)) {
    return reject('invalid', 'bad notificationUUID');
  }
  if (
    typeof payload.notificationType !== 'string' ||
    !NOTIFICATION_NAME_RE.test(payload.notificationType)
  ) {
    return reject('invalid', 'bad notificationType');
  }
  if (
    payload.subtype !== undefined &&
    (typeof payload.subtype !== 'string' || !NOTIFICATION_NAME_RE.test(payload.subtype))
  ) {
    return reject('invalid', 'bad subtype');
  }

  // 번들·환경은 `data`(대부분) 또는 `summary`(요약 알림)에 있다. 둘 다 없으면 범위를 대조할 수 없다 — 받지 않는다.
  const scope = payload.data ?? payload.summary;
  if (!scope || typeof scope.bundleId !== 'string' || typeof scope.environment !== 'string') {
    return reject('invalid', 'notification has no bundle/environment');
  }
  if (scope.bundleId !== expected.bundleId)
    return reject('bundle_mismatch', scope.bundleId.slice(0, 128));
  if (scope.environment !== expected.environment) {
    return reject('environment_mismatch', scope.environment.slice(0, 32));
  }

  let transaction: AppleTransactionInfo | null = null;
  const signedTransactionInfo = payload.data?.signedTransactionInfo;
  if (signedTransactionInfo !== undefined) {
    if (typeof signedTransactionInfo !== 'string')
      return reject('invalid', 'bad signedTransactionInfo');
    try {
      transaction = await verifyAppleSignedJws<AppleTransactionInfo>(
        signedTransactionInfo,
        verifyOptions,
      );
    } catch (error) {
      if (error instanceof AppleJwsVerificationError) {
        return reject('invalid', `signedTransactionInfo: ${error.message}`);
      }
      throw error;
    }
    if (transaction.bundleId !== expected.bundleId) {
      return reject('bundle_mismatch', 'transaction bundle id mismatch');
    }
    if (transaction.environment !== undefined && transaction.environment !== expected.environment) {
      return reject('environment_mismatch', 'transaction environment mismatch');
    }
    if (
      typeof transaction.originalTransactionId !== 'string' ||
      !/^[0-9A-Za-z_-]{1,64}$/.test(transaction.originalTransactionId) ||
      typeof transaction.transactionId !== 'string' ||
      transaction.transactionId.length > 64
    ) {
      return reject('invalid', 'bad transaction ids');
    }
  }

  return {
    ok: true,
    notification: {
      uuid: payload.notificationUUID.toLowerCase(),
      type: payload.notificationType,
      subtype: payload.subtype ?? null,
      environment: expected.environment,
      signedDate:
        typeof payload.signedDate === 'number' && Number.isFinite(payload.signedDate)
          ? payload.signedDate
          : null,
      transaction,
    },
  };
}

// MARK: - 수신 기록(`apple_server_notifications`, 마이그레이션 #136)

/** 수신 기록 보관 — 애플 재전송 창(최대 사흘)보다 넉넉하게, 운영 조사에 쓸 만큼만. `index.ts` 크론이 지운다. */
export const APPLE_NOTIFICATION_RETENTION_DAYS = 90;

/**
 * 이 알림을 **처리할 차례인가.** 처음 보는 uuid 면 `received` 로 적고 `true`. 이미 끝난(`processed`·`ignored`)
 * uuid 면 아무것도 바꾸지 않고 `false`(중복 — 200 으로 끝낸다). 실패했거나 도중에 끊긴(`failed`·`received`)
 * uuid 는 애플의 재전송이므로 횟수를 올리고 다시 처리한다.
 *
 * 한 문장(upsert)이라 원자적이다. 같은 uuid 가 동시에 두 번 들어와 둘 다 처리하는 일은 있을 수 있는데, 처리가
 * 스토어 재조회라 두 번 해도 결과가 같다(정합화의 스냅샷 비교가 늦은 쪽을 재시도로 돌린다).
 */
export async function claimAppleNotification(
  db: Pick<Client, 'execute'>,
  notification: VerifiedAppleNotification,
): Promise<boolean> {
  const result = await db.execute({
    sql: `INSERT INTO apple_server_notifications
            (notification_uuid, notification_type, subtype, environment, original_transaction_id, signed_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(notification_uuid) DO UPDATE SET
            attempts = apple_server_notifications.attempts + 1,
            status = 'received',
            last_error = NULL
          WHERE apple_server_notifications.status IN ('received', 'failed')`,
    args: [
      notification.uuid,
      notification.type,
      notification.subtype,
      notification.environment,
      notification.transaction?.originalTransactionId ?? null,
      notification.signedDate !== null ? new Date(notification.signedDate).toISOString() : null,
    ],
  });
  return result.rowsAffected > 0;
}

export async function finishAppleNotification(
  db: Pick<Client, 'execute'>,
  uuid: string,
  result: {
    status: 'processed' | 'ignored' | 'failed';
    outcome: string;
    userPk: string | null;
    error?: string;
  },
): Promise<void> {
  await db.execute({
    sql: `UPDATE apple_server_notifications
             SET status = ?, outcome = ?, user_id = COALESCE(?, user_id), last_error = ?,
                 processed_at = CASE WHEN ? = 'failed' THEN processed_at ELSE datetime('now') END
           WHERE notification_uuid = ?`,
    args: [
      result.status,
      result.outcome,
      result.userPk,
      result.error ? result.error.slice(0, 300) : null,
      result.status,
      uuid,
    ],
  });
}
