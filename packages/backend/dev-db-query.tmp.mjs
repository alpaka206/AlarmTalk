// dev Turso DB 조회용 임시 스크립트: node dev-db-query.mjs "<SQL>"
import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';

const vars = Object.fromEntries(
  readFileSync('C:/Users/gyuwo/Desktop/AlarmTalk/packages/backend/.dev.vars.dev', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);

const db = createClient({ url: vars.TURSO_DATABASE_URL, authToken: vars.TURSO_AUTH_TOKEN });
const res = await db.execute(process.argv[2]);
console.log(JSON.stringify(res.rows, null, 1));
