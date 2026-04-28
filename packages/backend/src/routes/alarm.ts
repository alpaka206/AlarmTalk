import { Hono } from 'hono';
import type { AppEnv } from '../types';
import alarmQuery from './alarm-query';
import alarmMutation from './alarm-mutation';

const alarm = new Hono<AppEnv>();

alarm.route('/', alarmQuery);
alarm.route('/', alarmMutation);

export default alarm;
