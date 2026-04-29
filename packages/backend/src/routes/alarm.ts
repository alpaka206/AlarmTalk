import { Hono } from 'hono';
import type { AppEnv } from '../types';
import alarmQuery from './alarm-query';
import alarmMutation from './alarm-mutation';
import alarmSource from './alarm-source';

const alarm = new Hono<AppEnv>();

alarm.route('/', alarmQuery);
alarm.route('/', alarmMutation);
alarm.route('/', alarmSource);

export default alarm;
