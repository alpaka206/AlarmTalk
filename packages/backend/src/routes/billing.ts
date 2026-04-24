import { Hono } from 'hono';
import type { AppEnv } from '../types';
import billingQuery from './billing-query';
import billingMutation from './billing-mutation';

const billing = new Hono<AppEnv>();
billing.route('/', billingQuery);
billing.route('/', billingMutation);

export default billing;
