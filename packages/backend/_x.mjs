import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.dev.vars.dev','utf8').split('\n')
  .filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
for (const sql of process.argv.slice(2)) console.log('rows=' + ((await db.execute(sql)).rowsAffected ?? 0));
