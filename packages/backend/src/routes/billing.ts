import { Hono } from 'hono';
import type { AppEnv } from '../types';
import billingQuery from './billing-query';
import billingMutation from './billing-mutation';
import billingApple from './billing-apple';
import billingGoogle from './billing-google';

const billing = new Hono<AppEnv>();
billing.route('/', billingQuery);
billing.route('/', billingMutation);
billing.route('/', billingApple);
billing.route('/', billingGoogle);

export default billing;
