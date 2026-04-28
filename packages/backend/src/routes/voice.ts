import { Hono } from 'hono';
import type { AppEnv } from '../types';
import voiceUpload from './voice-upload';
import voiceProfile from './voice-profile';

const voice = new Hono<AppEnv>();

voice.route('/', voiceUpload);
voice.route('/', voiceProfile);

export default voice;
