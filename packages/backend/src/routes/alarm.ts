import { Hono } from 'hono';
import type { AppEnv } from '../types';
import alarmMutation from './alarm-mutation';

const alarm = new Hono<AppEnv>();

alarm.route('/', alarmMutation);

export default alarm;
