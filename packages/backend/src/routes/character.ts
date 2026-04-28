import { Hono } from 'hono';
import type { AppEnv } from '../types';
import characterQuery from './character-query';
import characterMutation from './character-mutation';

const character = new Hono<AppEnv>();
character.route('/', characterQuery);
character.route('/', characterMutation);

export default character;
export { loadOrCreateCharacter } from './character-helpers';
