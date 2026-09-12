/**
 * 사용 기록(이벤트) 스키마.
 *
 * 앱이 "무슨 일이 일어났는지" 를 남겨 두었다가 **연결되면 모아서** 보낸다.
 * 백엔드 `routes/events.ts` 가 이 스키마로 검증한다.
 *
 * ⚠ **문구 원문·개인 텍스트를 싣지 않는다.** 이벤트는 **식별자만** 나른다 — 문구는 이미
 * `messages` 에 있고, 로그에 사본을 만들면 삭제(목소리 삭제·동의 철회) 때 지워야 할 곳이
 * 하나 더 늘어난다. 그래서 자유 문자열은 [UsageEventSchema.detail] 하나뿐이고 짧게 자른다.
 */
import { z } from 'zod';

/**
 * 남기는 사건의 종류.
 *
 * ⚠ **여기 없는 값은 서버가 거절한다.** 새 종류를 앱에서만 늘리면 그 이벤트는 통째로
 * 버려지므로, 서버를 먼저 올린 뒤 앱을 낸다.
 */
export const USAGE_EVENT_TYPES = [
  'alarm_created',
  'alarm_updated',
  'alarm_deleted',
  /** 실제로 울린 순간. ⚠ 울릴 때 보내지 않는다 — 로컬에 적고 나중에 보낸다. */
  'alarm_rang',
  'alarm_dismissed',
  'alarm_snoozed',
  /** 직접 입력 문구를 알람에 붙였다(= 그 오디오가 이 기기에서 '사용중'이 됐다). */
  'manual_message_attached',
  /** 그 문구를 쓰는 알람이 이 기기에서 모두 사라져 오디오를 지웠다(= '비사용중'). */
  'manual_message_released',
  'voice_created',
  'voice_deleted',
] as const;

export type UsageEventType = (typeof USAGE_EVENT_TYPES)[number];

/** 한 번에 보낼 수 있는 이벤트 수. 큐가 밀려도 요청 하나가 지나치게 커지지 않게 막는다. */
export const USAGE_EVENT_BATCH_MAX = 100;

/** 자유 문자열 상한. 짧은 부가 값(예: 스누즈 회차)만 담는다. */
export const USAGE_EVENT_DETAIL_MAX = 120;

const IdSchema = z.string().uuid();

export const UsageEventSchema = z.object({
  /**
   * **클라가 만드는 UUID.** 같은 id 를 다시 보내도 서버가 무시하므로(멱등),
   * 전송 성공을 확인하지 못한 배치를 마음 놓고 재전송할 수 있다.
   */
  id: IdSchema,
  type: z.enum(USAGE_EVENT_TYPES),
  /**
   * **기기에서 일어난 시각**(ISO-8601). 서버 도착 시각(`received_at`)과 따로 둔다 —
   * 오프라인으로 며칠 늦게 도착해도 '언제 일어났는지' 는 이 값이다.
   */
  occurred_at: z.string().datetime({ offset: true }),
  alarm_id: IdSchema.nullish(),
  voice_profile_id: IdSchema.nullish(),
  message_id: IdSchema.nullish(),
  detail: z.string().max(USAGE_EVENT_DETAIL_MAX).nullish(),
});
export type UsageEvent = z.infer<typeof UsageEventSchema>;

export const UsageEventBatchSchema = z.object({
  events: z.array(UsageEventSchema).min(1).max(USAGE_EVENT_BATCH_MAX),
});
export type UsageEventBatch = z.infer<typeof UsageEventBatchSchema>;
