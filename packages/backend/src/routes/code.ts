import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { jsonError } from '../lib/api-error';

const codeRoutes = new Hono<AppEnv>();

/**
 * 코드 등록 — **받는 코드가 없다.** 옛 앱 호환 — minSupported 가 현재 빌드를 넘으면 지운다.
 *
 * 옛 앱의 더보기 → 코드 등록이 아직 부른다. 라우트를 지우면 코드 없는 404 가 나가 시도마다 Sentry 이슈가
 * 되는데, `CODE_NOT_FOUND` 는 두 앱이 예상된 거절로 읽는다("잘못된 코드예요"). 그래서 본문을 읽지 않고 DB 도
 * 보지 않고 언제나 같은 답을 낸다.
 *
 * ⚠ **코드로 유료 기능을 여는 길을 되살리지 말 것**(App Store 심사 지침 3.1.1 — 인앱 결제가 아닌 수단으로 기능을
 * 열면 안 된다). 두 번 반려됐다: 1.2.11 은 프로모 코드(2026-10-12 폐지), 1.2.12 는 선물 코드(GIFT-, 2026-10-14
 * 폐지). 첫 번째 때 사례만 지우고 같은 종류를 남긴 것이 두 번째의 원인이었다. 마지막까지 남았던 초대 코드(커플·가족
 * 그룹 합류)는 2026-10-20 에 그 이용권과 함께 없앴다. 할인·무료 이용은 스토어 오퍼 코드(App Store 오퍼 코드·Play
 * 프로모션 코드)로 준다. 프로모 코드의 발급·사용 기록(`promo_codes`·`promo_code_redemptions`)은 이력이라 남긴다.
 * 상세: `docs/spec/plan-gates.md`.
 */
codeRoutes.post('/register', (c) => jsonError(c, 404, 'CODE_NOT_FOUND', 'Code not found'));

export default codeRoutes;
