import { parseDeepLink, createDeepLink } from '../src/lib/deepLink';

jest.mock('expo-linking', () => ({
  parse: (url: string) => {
    const match = url.match(/^([a-z]+):\/\/(.*)$/);
    if (!match) return { scheme: null, path: url, queryParams: {} };
    const scheme = match[1];
    const rest = match[2];
    const [path, query] = rest!.split('?');
    const queryParams: Record<string, string> = {};
    if (query) {
      for (const pair of query.split('&')) {
        const [k, v] = pair.split('=');
        queryParams[k!] = decodeURIComponent(v!);
      }
    }
    return { scheme, path, queryParams };
  },
}));

describe('parseDeepLink', () => {
  it('returns null for non-voicealarm scheme', () => {
    expect(parseDeepLink('https://example.com/alarm')).toBeNull();
  });

  it('returns null for empty path', () => {
    expect(parseDeepLink('voicealarm://')).toBeNull();
  });

  it('parses code deep link with code param', () => {
    const result = parseDeepLink('voicealarm://code/VA-1234-5678-ABCD');
    expect(result).toEqual({
      pathname: '/code-register',
      params: { code: 'VA-1234-5678-ABCD' },
      requiresAuth: true,
    });
  });

  it('parses code deep link without code param', () => {
    const result = parseDeepLink('voicealarm://code');
    expect(result).toEqual({
      pathname: '/code-register',
      params: undefined,
      requiresAuth: true,
    });
  });

  it('parses alarm/create', () => {
    const result = parseDeepLink('voicealarm://alarm/create');
    expect(result).toEqual({
      pathname: '/alarm/create',
      requiresAuth: true,
    });
  });

  it('parses alarm with id', () => {
    const result = parseDeepLink('voicealarm://alarm/abc123');
    expect(result).toEqual({
      pathname: '/alarm/edit',
      params: { id: 'abc123' },
      requiresAuth: true,
    });
  });

  it('parses alarm without id', () => {
    const result = parseDeepLink('voicealarm://alarm');
    expect(result).toEqual({
      pathname: '/(tabs)/alarms',
      requiresAuth: true,
    });
  });

  it('parses voice/record', () => {
    const result = parseDeepLink('voicealarm://voice/record');
    expect(result).toEqual({
      pathname: '/voice/record',
      requiresAuth: true,
    });
  });

  it('parses voice/upload', () => {
    const result = parseDeepLink('voicealarm://voice/upload');
    expect(result).toEqual({
      pathname: '/voice/upload',
      requiresAuth: true,
    });
  });

  it('parses voice with id', () => {
    const result = parseDeepLink('voicealarm://voice/v1');
    expect(result).toEqual({
      pathname: '/voice/[id]',
      params: { id: 'v1' },
      requiresAuth: true,
    });
  });

  it('parses voice without id', () => {
    const result = parseDeepLink('voicealarm://voice');
    expect(result).toEqual({
      pathname: '/(tabs)/voices',
      requiresAuth: true,
    });
  });

  it('parses note/create', () => {
    const result = parseDeepLink('voicealarm://note/create');
    expect(result).toEqual({
      pathname: '/note/create',
      requiresAuth: true,
    });
  });

  it('parses note with id', () => {
    const result = parseDeepLink('voicealarm://note/n1');
    expect(result).toEqual({
      pathname: '/note/[id]',
      params: { id: 'n1' },
      requiresAuth: true,
    });
  });

  it('parses note without id', () => {
    const result = parseDeepLink('voicealarm://note');
    expect(result).toEqual({
      pathname: '/(tabs)/compose',
      requiresAuth: true,
    });
  });

  it('parses message/create', () => {
    const result = parseDeepLink('voicealarm://message/create');
    expect(result).toEqual({
      pathname: '/message/create',
      requiresAuth: true,
    });
  });

  it('parses message with id', () => {
    const result = parseDeepLink('voicealarm://message/m1');
    expect(result).toEqual({
      pathname: '/message/[id]',
      params: { id: 'm1' },
      requiresAuth: true,
    });
  });

  it('parses message without id', () => {
    const result = parseDeepLink('voicealarm://message');
    expect(result).toEqual({
      pathname: '/(tabs)/compose',
      requiresAuth: true,
    });
  });

  it('parses simple routes (people, settings, character, library, player)', () => {
    for (const route of ['people', 'settings', 'character', 'library', 'player']) {
      const result = parseDeepLink(`voicealarm://${route}`);
      expect(result).toEqual({
        pathname: `/${route}`,
        requiresAuth: true,
      });
    }
  });

  it('parses onboarding as public route', () => {
    const result = parseDeepLink('voicealarm://onboarding');
    expect(result).toEqual({
      pathname: '/onboarding',
      requiresAuth: false,
    });
  });

  it('treats unknown routes as authenticated', () => {
    const result = parseDeepLink('voicealarm://unknown/path');
    expect(result).toEqual({
      pathname: '/unknown/path',
      requiresAuth: true,
    });
  });
});

describe('createDeepLink', () => {
  it('creates link without params', () => {
    expect(createDeepLink('alarm/create')).toBe('voicealarm://alarm/create');
  });

  it('creates link with params', () => {
    const url = createDeepLink('code', { code: 'VA-1234' });
    expect(url).toBe('voicealarm://code?code=VA-1234');
  });

  it('encodes param values', () => {
    const url = createDeepLink('test', { q: 'hello world' });
    expect(url).toBe('voicealarm://test?q=hello%20world');
  });
});
