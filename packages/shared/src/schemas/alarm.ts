/**
 * 알람 도메인 계약 — 날짜 지정 알람(한 번)의 날짜 형식과 직접 입력 상한.
 *
 * 규칙 전문: `docs/spec/alarm-lifecycle.md` §4 「날짜 지정 알람(한 번)」, 직접 입력 상한은
 * `docs/spec/voice-and-message.md` §8.
 */
import { z } from 'zod';

/**
 * **직접 입력 문구의 글자 상한**(사용자에게 들리는 말 기준). 서버 `POST /tts` 가 이 값으로 거절하고(`TEXT_TOO_LONG`),
 * 두 앱의 입력창도 같은 값을 쓴다. 프리셋은 이 상한에서 면제다(`routes/tts.ts` 의 주석).
 */
export const MANUAL_TTS_TEXT_MAX_LENGTH = 200;

const TARGET_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 날짜 지정 알람의 `target_date` 가 **실제로 있는 날짜**의 `YYYY-MM-DD` 인가. 2026-02-30 같은 값은 거절한다.
 * 지난 날짜는 거절하지 않는다 — 서버 행은 기기의 사본이라 끝난 날짜 알람의 끄기·켜기도 올라온다.
 */
export function isAlarmTargetDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = TARGET_DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1) return false;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= lastDay;
}

/** `target_date` 필드 — 생략(그대로) · null(날짜 없음) · 실제 날짜. */
export const AlarmTargetDateSchema = z
  .string()
  .refine(isAlarmTargetDate, { message: 'target_date must be a real YYYY-MM-DD date' })
  .nullable()
  .optional();
