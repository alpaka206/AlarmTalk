import { Hono } from 'hono';
import type { AppEnv } from '../types';
import voiceProfile from './voice-profile';

const voice = new Hono<AppEnv>();

voice.route('/', voiceProfile);

export default voice;
