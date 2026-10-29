import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { UUID_RE } from '../lib/validate';
import { validateAlarmFields, normalizeTimezone, type AlarmMode, type VibrationPattern } from './alarm-helpers';
import { callerOwnerIds } from '../lib/caller-ids';
import { ownAlarmIdentity } from '../lib/alarm-identity';

/**
 * **옛 앱의 알람 올리기를 받는 자리 — 아무것도 저장하지 않는다**(2026-10-29 오너: "서버 사본은 필요 없다", 마이그레이션 #147).
 *
 * 알람의 원본은 언제나 기기였고 서버 행은 사본이었다(`docs/spec/alarm-lifecycle.md`). 그 사본을 읽던 곳(목소리 회수 대상,
 * 직접 입력 음원 보존 예외, 응원 보충 신호, 스톡 은퇴 갱신, 관리자 테마 표)을 같은 배포에서 모두 걷었다. 1.3 앱은 이
 * 경로를 부르지 않는다.
 *
 * ⚠ **라우트를 지우지 말 것.** 옛 앱(1.2.16)은 알람을 저장·켜고 끄고·지울 때마다 여기로 올린다. 404 를 주면 그 앱은
 *   올리기를 실패로 보고 계속 다시 보낸다. 그래서 형식만 보고(예전과 같은 400) **받은 그대로 되돌려 준다** — 그 앱이
 *   응답에서 반드시 읽는 것은 `alarm.id` 하나다(나머지는 전부 선택값으로 읽는다). 1.3 강제 업데이트(`app-version.ts` 의
 *   `minSupported`) 뒤에 이 파일째 지운다.
 */
const alarmMutation = new Hono<AppEnv>();

type AlarmWriteBody = {
  client_alarm_id?: string;
  time?: string;
  /** 옛 앱의 가족 알람 보내기가 싣던 값 — 아래 가드만 본다. */
  target_user_id?: unknown;
  mode?: string;
  vibration_pattern?: string;
  wake_mode?: string;
  timezone?: string | null;
  is_active?: boolean;
  repeat_days?: number[];
  voice_profile_id?: string | null;
  target_date?: string | null;
} & Record<string, unknown>;

alarmMutation.post('/', async (c) => {
  const userPk = c.get('userIdPK') || c.get('userId');
  const body = await c.req.json<AlarmWriteBody>();

  if (!body.time) {
    return c.json({ error: 'time is required', error_code: 'REQUIRED_FIELDS_MISSING' }, 400);
  }
  if (body.client_alarm_id != null && (typeof body.client_alarm_id !== 'string' || !UUID_RE.test(body.client_alarm_id))) {
    return c.json({ error: 'Invalid client alarm ID', error_code: 'INVALID_ALARM_ID' }, 400);
  }
  const fieldError = validateAlarmFields(body);
  if (fieldError) return c.json(fieldError, 400);

  // 남에게 보내는 알람은 없다(가족 알람은 2026-10-20 에 지웠다). 다른 계정을 가리키면 예전 답(403 `NOT_CONNECTED`)으로 끊는다.
  const requestedTargetUserId = typeof body.target_user_id === 'string' ? body.target_user_id.trim() : '';
  if (requestedTargetUserId && !callerOwnerIds(c).includes(requestedTargetUserId)) {
    return c.json({ error: 'Alarms can only be set for your own account.', error_code: 'NOT_CONNECTED' }, 403);
  }

  // 같은 기기 id 면 같은 서버 id 다(예전 사본의 id 규칙 그대로) — 옛 앱이 다시 보내도 id 가 갈라지지 않는다.
  const alarmId = body.client_alarm_id ? await ownAlarmIdentity(userPk, body.client_alarm_id) : crypto.randomUUID();
  const { target_user_id: _ignoredTargetUserId, ...echoedBody } = body;
  return c.json(
    {
      alarm: {
        ...echoedBody,
        id: alarmId,
        is_active: body.is_active ?? true,
        ...(body.client_alarm_id ? { creation_replayed: false } : {}),
        mode: (body.mode as AlarmMode | undefined) ?? 'sound-only',
        vibration_pattern: (body.vibration_pattern as VibrationPattern | undefined) ?? 'default',
        timezone: normalizeTimezone(body.timezone),
        voice_profile_id: body.voice_profile_id ?? null,
        target_date: body.target_date ?? null,
      },
    },
    201,
  );
});

alarmMutation.patch('/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid alarm ID format', error_code: 'INVALID_ALARM_ID' }, 400);
  }
  const body = await c.req.json<AlarmWriteBody>();
  const fieldError = validateAlarmFields(body);
  if (fieldError) return c.json(fieldError, 400);

  const { target_user_id: _ignoredTargetUserId, ...echoedBody } = body;
  return c.json({ success: true, alarm: { ...echoedBody, id } });
});

alarmMutation.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid alarm ID format', error_code: 'INVALID_ALARM_ID' }, 400);
  }
  return c.json({ success: true });
});

export default alarmMutation;
