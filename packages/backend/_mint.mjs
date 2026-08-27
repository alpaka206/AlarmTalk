import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
const env = Object.fromEntries(readFileSync('.dev.vars.dev','utf8').split('\n')
  .filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const b64 = (o)=>Buffer.from(typeof o==='string'?o:JSON.stringify(o)).toString('base64url');
const [sub, email, name, epoch] = process.argv.slice(2);
const now = Math.floor(Date.now()/1000);
const head = b64({alg:'HS256',typ:'JWT'});
const body = b64({sub, email, name, epoch: Number(epoch||0), iss:'voice-alarm', aud:'voice-alarm-clients', iat: now, exp: now + 3600});
console.log(`${head}.${body}.${createHmac('sha256', env.JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`);
