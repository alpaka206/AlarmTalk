import { describe, it, expect } from 'vitest';
import { signAppJwt, verifyAppJwt, APP_JWT_ISSUER } from '../src/lib/jwt';

const SECRET = 'test-secret-at-least-32-chars-long!';

describe('appJwt', () => {
  it('서명한 토큰은 같은 시크릿으로 검증 성공', async () => {
    const token = await signAppJwt({ sub: 'u1', email: 'u@test.com', name: 'kim' }, SECRET);
    const payload = await verifyAppJwt(token, SECRET);
    expect(payload.sub).toBe('u1');
    expect(payload.email).toBe('u@test.com');
    expect(payload.iss).toBe(APP_JWT_ISSUER);
  });

  it('다른 시크릿으로 검증 시 실패', async () => {
    const token = await signAppJwt({ sub: 'u1', email: 'u@test.com' }, SECRET);
    await expect(verifyAppJwt(token, 'other-secret')).rejects.toThrow();
  });

  it('위조된 서명 거부', async () => {
    const token = await signAppJwt({ sub: 'u1', email: 'u@test.com' }, SECRET);
    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1]}.AAAAAAAAAAAAAAAAAAAA`;
    await expect(verifyAppJwt(tampered, SECRET)).rejects.toThrow();
  });

  it('만료 토큰 거부', async () => {
    const token = await signAppJwt({ sub: 'u1', email: 'u@test.com' }, SECRET, -60);
    await expect(verifyAppJwt(token, SECRET)).rejects.toThrow(/expired/i);
  });

  it('exp 에 정확히 도달한 토큰도 만료다', async () => {
    const token = await signAppJwt({ sub: 'u1', email: 'u@test.com' }, SECRET, 0);
    await expect(verifyAppJwt(token, SECRET)).rejects.toThrow(/expired/i);
  });

  it.each([undefined, null, '2999999999'])(
    '서명이 유효해도 잘못된 exp %s 는 거절한다',
    async (exp) => {
      const valid = await signAppJwt({ sub: 'u1', email: 'u@test.com' }, SECRET);
      const [header, encoded] = valid.split('.');
      const body = JSON.parse(Buffer.from(encoded!, 'base64url').toString()) as Record<
        string,
        unknown
      >;
      body.exp = exp;
      const input = `${header}.${Buffer.from(JSON.stringify(body)).toString('base64url')}`;
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));
      const token = `${input}.${Buffer.from(signature).toString('base64url')}`;
      await expect(verifyAppJwt(token, SECRET)).rejects.toThrow(/expiry/i);
    },
  );

  it('형식 잘못된 토큰 거부', async () => {
    await expect(verifyAppJwt('not-a-jwt', SECRET)).rejects.toThrow();
  });

  it('빈 시크릿으로 서명 거부', async () => {
    await expect(signAppJwt({ sub: 'u1', email: 'u@test.com' }, '')).rejects.toThrow();
  });

  it('epoch 클레임을 박아 넣고 검증 시 그대로 반환 (B5)', async () => {
    const token = await signAppJwt({ sub: 'u1', email: 'u@test.com', epoch: 3 }, SECRET);
    const payload = await verifyAppJwt(token, SECRET);
    expect(payload.epoch).toBe(3);
  });

  it('epoch 미지정 시 기본 0 으로 서명/검증', async () => {
    const token = await signAppJwt({ sub: 'u1', email: 'u@test.com' }, SECRET);
    const payload = await verifyAppJwt(token, SECRET);
    expect(payload.epoch).toBe(0);
  });
});
