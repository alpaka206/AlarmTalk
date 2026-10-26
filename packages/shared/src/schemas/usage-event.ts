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
export const USAGE_EVENT_V1_TYPES = [
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

/**
 * 2026-10-26 계측 2판(`docs/spec/usage-events.md` §7)에 더한 종류. ⚠ 서버는 처리방침이 이 범위를 고지한 판
 * (`USAGE_EVENT_DETAIL_MIN_PRIVACY_VERSION`) 이상에 동의한 뒤의 사건만 저장하고, 그 전 것은 200 으로 받고 버린다.
 */
export const USAGE_EVENT_V2_TYPES = [
  // 첫 경험
  /** 샘플(목소리 미리듣기) 재생을 **실제로 시작**했다 — 화면 노출이 아니다. */
  'sample_started',
  /** 샘플 재생이 끝까지 갔다. 중간에 멈추면 적지 않는다. */
  'sample_completed',
  /** 첫 경험 단계 하나를 지났다(`step`). */
  'onboarding_step',
  /** 로그인 결과(`outcome`·`method`). ⚠ 계정이 생긴 **뒤**에만 적힌다 — 가입 전 수집은 하지 않는다(§7.4). */
  'auth_result',
  // 목소리 선택
  /** 알람에 쓸 목소리를 골랐다(`is_first`·`prepared`·`pack_id`). 문구 원문은 싣지 않는다. */
  'voice_selected',
  // 음성 준비 — **작업 소유자(워커·프리페처)가 한 번만** 적는다
  'voice_preparation_started',
  'voice_preparation_ready',
  'voice_preparation_failed',
  // 알람 저장 — 기존 `alarm_created` 는 '행이 생겼다' 이고 저장 시도가 아니다
  /** 저장을 눌렀다. */
  'alarm_save_attempt',
  /** 저장이 요청 전에 막혔다(`reason`). */
  'alarm_save_blocked',
  /** OS 예약과 오디오 파일이 **둘 다** 갖춰졌다. */
  'alarm_ready',
  // 직접 입력
  /** 이미 만든 결과를 다시 썼다(`reuse_location` = local|server). 차감 없음. */
  'manual_result_reused',
  /** 새 제작 결과(`outcome`·`charged_source`·`usage_month`·`result_id`·`request_id`). */
  'generation_outcome',
  // 광고 보상
  'reward_offer',
  'reward_view_started',
  'reward_pending',
  'reward_granted',
  'reward_spent',
  // 콘텐츠 — 스키마만(해당 기능 PR 이 심는다)
  'content_selected',
  'dated_alarm_saved',
  'pack_selected',
  // 소식 — 스키마만. 관심기업·기사 원문을 싣지 않는다
  'briefing_opened',
  'source_opened',
  'briefing_audio_requested',
  // 결제
  'paywall_viewed',
  'store_purchase_verified',
  'entitlement_changed',
] as const;

export const USAGE_EVENT_TYPES = [...USAGE_EVENT_V1_TYPES, ...USAGE_EVENT_V2_TYPES] as const;

export type UsageEventType = (typeof USAGE_EVENT_TYPES)[number];

/** 한 번에 보낼 수 있는 이벤트 수. 큐가 밀려도 요청 하나가 지나치게 커지지 않게 막는다. */
export const USAGE_EVENT_BATCH_MAX = 100;

/** 자유 문자열 상한. 짧은 부가 값(예: 스누즈 회차)만 담는다. */
export const USAGE_EVENT_DETAIL_MAX = 120;

const IdSchema = z.string().uuid();

/**
 * 스키마 판. 없으면 1(2026-09-07 계약 — 식별자 + `detail`). 2판부터 공통 필드와 [UsageEventPropsSchema] 를 싣는다.
 * ⚠ 옛 앱·옛 큐가 남긴 1판 기록도 계속 받는다.
 */
export const USAGE_EVENT_SCHEMA_VERSION = 2;

/**
 * 짧은 **코드**(사유·단계·방법·팩 id 같은 것). 자유 문장이 아니다 — 영문 소문자·숫자·`_`·`.`·`-` 만 받는다.
 * 문구 원문·이름·이메일이 이 칸으로 새지 않게 모양으로 막는다.
 */
const CodeSchema = z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,63}$/);
/** 앱 버전·기능 버전. `1.3.0`·`40`·`prep-2` 같은 꼴. */
const VersionSchema = z.string().regex(/^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/);
const CountSchema = z.number().int().min(0).max(100_000);

/** 권한 출처 — 서버가 받는 순간 계정 상태로 찍는다(`usage_events.entitlement_source`). 앱은 보내지 않는다. */
export const ENTITLEMENT_SOURCES = ['paid', 'trial', 'admin', 'promo', 'free'] as const;
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];

/** 직접 입력 제작이 무엇으로 정산됐나 — 기본 제공분 / 광고 보상 / 차감 없음(유료 월 한도 안·재사용·실패). */
export const CHARGED_SOURCES = ['base', 'ad', 'none'] as const;

/** 준비 범위 — 고른 목소리 하나 / 기본 목소리 전체 / 테마 클립 묶음 / 문구 클립 하나. */
export const PREPARATION_SCOPES = ['selected_voice', 'all_voices', 'bucket', 'clip'] as const;

/** 준비를 시작할 때 기기에 이미 있던 정도. */
export const PREPARATION_CACHE_STATES = ['cold', 'partial', 'warm'] as const;

/**
 * 2판의 **정해진 칸.** 서버는 칸마다 열을 하나씩 두고(`usage_events` #142) 그대로 옮겨 적는다 — 큰 JSON 을
 * `detail` 에 끼워 넣지 않는다.
 *
 * ⚠ `.strict()` — 모르는 칸이 오면 거절한다(모르는 종류를 거절하는 것과 같은 이유: 앱이 서버보다 앞서 나가도
 * 조용히 버려지지 않게). 새 칸은 **서버를 먼저** 올린다.
 * ⚠ 문구 원문·관심기업·기사 원문·이메일을 넣을 칸은 없다 — 자유 문자열 칸은 `CodeSchema` 모양만 받는다.
 */
export const UsageEventPropsSchema = z
  .object({
    // 준비(voice_preparation_*)
    scope: z.enum(PREPARATION_SCOPES).optional(),
    /** 콘텐츠 언어(`ko`·`en`·`ja`·`ko-KR`). */
    language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional(),
    /** 받으려는 묶음의 판(매니페스트 revision 등). */
    revision: CodeSchema.optional(),
    cache_state: z.enum(PREPARATION_CACHE_STATES).optional(),
    target_count: CountSchema.optional(),
    completed_count: CountSchema.optional(),
    /** 실제로 받은(또는 이미 있던) 바이트. */
    bytes: z.number().int().min(0).max(10_000_000_000).optional(),
    /** **단조 시계**로 잰 경과(밀리초). 벽시계 차이가 아니다 — 시계를 돌려도 음수·거대값이 나오지 않는다. */
    duration_ms: z.number().int().min(0).max(7 * 24 * 3600_000).optional(),
    /** 제한된 실패 코드(서버 `error_code` 를 소문자로, 또는 앱의 고정 코드). */
    error_code: CodeSchema.optional(),
    // 결과·사유
    outcome: z.enum(['success', 'failure', 'cancelled']).optional(),
    /** 막힘·실패의 사유 코드(`alarm_save_blocked` 의 사유 등). */
    reason: CodeSchema.optional(),
    /** 로그인 수단(`google`·`apple`·`email`). */
    method: CodeSchema.optional(),
    /** 첫 경험 단계 이름. */
    step: CodeSchema.optional(),
    /** 고른 팩·테마·스톡 목소리 키. */
    pack_id: CodeSchema.optional(),
    /** 이 계정에서 처음 고른 것인가(최초/변경). */
    is_first: z.boolean().optional(),
    /** 고르는 순간 그 목소리가 이미 기기에 준비돼 있었나(준비 전/후). */
    prepared: z.boolean().optional(),
    // 직접 입력
    reuse_location: z.enum(['local', 'server']).optional(),
    charged_source: z.enum(CHARGED_SOURCES).optional(),
    /** 실제로 차감된 **원래 사용월**(KST `YYYY-MM`). 월 경계를 넘긴 재시도도 처음 달로 적힌다. */
    usage_month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    /** 만들어진 결과(문구) id — 요청 id 와 **내부에서만** 잇는다. */
    result_id: IdSchema.optional(),
    /** 앱이 '음성 만들기' 한 번마다 만든 `request_id`. */
    request_id: IdSchema.optional(),
    /** 요청 문자 수(원문 대신 길이만). */
    char_count: z.number().int().min(0).max(10_000).optional(),
    // 콘텐츠
    content_mode: z.enum(['fixed', 'varied']).optional(),
    // 결제·광고
    /** 이 화면·제안이 어디서 열렸나(`editor`·`voices`·`menu` 등). */
    surface: CodeSchema.optional(),
    /** 스토어 상품 id. */
    product_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/).optional(),
    /** 스토어가 말한 이번 구매의 조건 — 무료 체험 / 첫 구독 할인 / 없음 / 모름. */
    store_offer: z.enum(['free_trial', 'intro', 'none', 'unknown']).optional(),
    /** 권한 변경의 앞·뒤(앱이 본 플랜 — `free`·`plus`). */
    from_plan: CodeSchema.optional(),
    to_plan: CodeSchema.optional(),
  })
  .strict();
export type UsageEventProps = z.infer<typeof UsageEventPropsSchema>;

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
  // ── 2판 공통 필드. 1판(옛 앱·옛 큐)은 전부 비어 온다. `id` 가 지시서의 `event_id` 다. ──
  schema_version: z.number().int().min(1).max(USAGE_EVENT_SCHEMA_VERSION).nullish(),
  /** 앱이 적는 순간의 플랫폼. 비면 서버가 요청 헤더(`X-App-Platform`)로 채운다 — 같은 기기라 바뀌지 않는다. */
  platform: z.enum(['android', 'ios']).nullish(),
  /**
   * **적는 순간의** 앱 버전(안드로이드 versionCode·iOS 빌드 번호). 요청 헤더로 채우지 않는다 — 큐는 업데이트를
   * 건너 남으므로 보내는 앱의 버전이 그 사건의 버전이 아니다.
   */
  app_version: VersionSchema.nullish(),
  /** 그 기록을 만든 흐름의 판(예: 준비 파이프라인 `prep-1`). 흐름을 바꾸면 올려 집계를 가른다. */
  feature_version: VersionSchema.nullish(),
  /**
   * 한 번의 시도(준비 하나·저장 하나·제작 하나)를 묶는 UUID. 시작·완료·실패가 같은 값을 쓴다.
   * 앱을 다시 켜면 **새 시도**다 — 이전의 미완료 시작은 실패로 세지 않는다(§7.3).
   */
  attempt_id: IdSchema.nullish(),
  props: UsageEventPropsSchema.nullish(),
});
export type UsageEvent = z.infer<typeof UsageEventSchema>;

export const UsageEventBatchSchema = z.object({
  events: z.array(UsageEventSchema).min(1).max(USAGE_EVENT_BATCH_MAX),
});
export type UsageEventBatch = z.infer<typeof UsageEventBatchSchema>;
