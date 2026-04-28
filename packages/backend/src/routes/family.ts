import { Hono } from 'hono';
import type { AppEnv } from '../types';
import familyInvite from './family-invite';
import familyGroup from './family-group';
import familyAlarm from './family-alarm';

const family = new Hono<AppEnv>();

family.route('/', familyInvite);
family.route('/', familyGroup);
family.route('/', familyAlarm);

export default family;
