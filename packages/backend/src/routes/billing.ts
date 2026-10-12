import { Hono } from 'hono';
import type { AppEnv } from '../types';
import billingQuery from './billing-query';
import billingMutation from './billing-mutation';
import billingGoogle from './billing-google';

const billing = new Hono<AppEnv>();
billing.route('/', billingQuery);
billing.route('/', billingMutation);
billing.route('/', billingGoogle);
// `POST /billing/promo/redeem`(프로모 코드)은 2026-10-12 에 없앴다 — `routes/code.ts` 머리말.

export default billing;
