import { createClient } from '@libsql/client';
import fs from 'node:fs';
const env = Object.fromEntries(
  fs.readFileSync('/Users/devrel/Desktop/AlarmTalk/packages/backend/.dev.vars.prod','utf8')
    .split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')];}));
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
const sql = process.argv[2];
const args = process.argv.slice(3);
const r = await db.execute({ sql, args });
console.log(JSON.stringify(r.rows, (k,v)=> typeof v === 'bigint' ? String(v) : v, 1));
