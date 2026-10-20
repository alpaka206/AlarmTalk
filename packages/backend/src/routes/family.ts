import { Hono } from 'hono';
import type { AppEnv } from '../types';

const family = new Hono<AppEnv>();

// 옛 앱 호환 — minSupported 가 현재 빌드를 넘으면 지운다. 커플·가족 그룹은 없앴다. 옛 앱 둘은 시작·탭 진입·
// `plan_changed` 마다 이 답을 받아야 권한 스냅샷을 끝낸다(실패하면 안드로이드는 스낵바·재조정 건너뜀, iOS 는
// 스냅샷 미완으로 알람 재조정을 건너뛴다). 그룹 없는 계정이 받던 답 그대로이고, DB 를 읽지 않는다.
family.get('/groups/current', (c) => c.json({ group: null, role: null, members: [] }));

export default family;
