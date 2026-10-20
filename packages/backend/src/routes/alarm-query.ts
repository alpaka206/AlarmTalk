import { Hono } from 'hono';
import type { AppEnv } from '../types';

const alarmQuery = new Hono<AppEnv>();

// 옛 앱 호환 — minSupported 가 현재 빌드를 넘으면 지운다. 받은 가족 알람을 가져오던 원격 pull 이었다(가족
// 알람은 2026-10-20 에 없앴다). 옛 앱 둘은 주기·앱 시작·알람 저장마다 이 요청을 보내고 실패하면 재시도·
// 경고를 띄운다. 그 pull 은 받은 알람만 가져오므로 내 알람을 실을 이유도 없다 — 늘 빈 커서 페이지를 준다.
// `has_more` 가 있어야 옛 앱이 옛 offset 계약으로 넘어가지 않는다.
// ⚠ 인증·동의 미들웨어 뒤에 그대로 둔다 — 옛 안드로이드는 탈퇴 신청을 이 요청이 받는
//   403 `ACCOUNT_PENDING_DELETION` 으로만 안다(`authMiddleware`).
alarmQuery.get('/', (c) => c.json({ alarms: [], has_more: false, next_cursor: null }));

// 옛 앱 호환 — minSupported 가 현재 빌드를 넘으면 지운다. 받은 알람의 그만받기·목소리 철회 목록이었다.
// 옛 iOS 는 세 키를 다 요구한다.
alarmQuery.get('/declined', (c) =>
  c.json({ alarm_ids: [], revoked_alarm_ids: [], has_more: false }),
);

export default alarmQuery;
