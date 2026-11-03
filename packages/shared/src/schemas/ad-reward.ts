/**
 * 광고 시청 승인 세션의 요청 계약(`docs/spec/ad-rewards.md` §3). 백엔드 `routes/ad-reward-sessions.ts` 가 이 스키마로
 * 검증한다. 앱은 광고를 띄우기 전에 세션을 만들고(`POST /ad-rewards/sessions`), 표시 직전에 시작을 승인받고
 * (`…/:id/start`), 광고 화면이 끝나면 어떻게 끝났는지 알린다(`…/:id/close`). **보상의 증명은 이 요청들이 아니라 서명된
 * SSV 콜백이다** — 앱이 '끝까지 봤어요' 라고 보내도 적립하지 않는다.
 */
import { z } from 'zod';

export const AD_REWARD_PLATFORMS = ['android', 'ios'] as const;
export type AdRewardPlatform = (typeof AD_REWARD_PLATFORMS)[number];

/** AdMob 광고 단위 id(`ca-app-pub-…/…`) — 형식만 묶고, 허용 여부는 서버 설정(`ADMOB_REWARDED_AD_UNITS`)이 본다. */
const AD_UNIT_RE = /^[A-Za-z0-9_\-/~.]{1,128}$/;

export const AdRewardSessionCreateSchema = z.object({
  platform: z.enum(AD_REWARD_PLATFORMS),
  ad_unit: z.string().regex(AD_UNIT_RE),
});
export type AdRewardSessionCreate = z.infer<typeof AdRewardSessionCreateSchema>;

/**
 * 광고 화면이 어떻게 끝났나 — 앱의 **주장**이다. 서버는 이것으로 보상을 주거나 빼앗지 않고, 예약·잠금을 풀지와 어느
 * 상태로 기다릴지만 정한다.
 * - `earned`: SDK 가 보상 신호를 줬다 → 정산 대기(`pending`).
 * - `dismissed`: 보상 신호 없이 닫혔다 → 중도 닫힘(`closed`). 늦은 콜백이 오면 그래도 정산한다.
 * - `no_fill`·`load_failed`: 광고를 못 불러왔다 — 시작 승인 전이라야 맞다.
 * - `show_failed`: 불러왔지만 띄우지 못했다.
 * - `cancelled`: 사용자가 띄우기 전에 그만뒀다(동의 양식을 닫는 등).
 */
export const AD_REWARD_CLOSE_OUTCOMES = [
  'earned',
  'dismissed',
  'no_fill',
  'load_failed',
  'show_failed',
  'cancelled',
] as const;
export type AdRewardCloseOutcome = (typeof AD_REWARD_CLOSE_OUTCOMES)[number];

export const AdRewardSessionCloseSchema = z.object({
  outcome: z.enum(AD_REWARD_CLOSE_OUTCOMES),
});
export type AdRewardSessionClose = z.infer<typeof AdRewardSessionCloseSchema>;
