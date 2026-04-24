import * as Linking from 'expo-linking';

const SCHEME = 'voicealarm';

export interface DeepLinkRoute {
  pathname: string;
  params?: Record<string, string>;
  requiresAuth: boolean;
}

const PUBLIC_ROUTES = new Set(['/onboarding']);

const ROUTE_MAP: Record<string, (segments: string[]) => DeepLinkRoute | null> = {
  code: (segments) => {
    const code = segments[0];
    return {
      pathname: '/code-register',
      params: code ? { code } : undefined,
      requiresAuth: true,
    };
  },
  alarm: (segments) => {
    const id = segments[0];
    if (id === 'create') {
      return { pathname: '/alarm/create', requiresAuth: true };
    }
    if (id) {
      return { pathname: '/alarm/edit', params: { id }, requiresAuth: true };
    }
    return { pathname: '/(tabs)/alarms', requiresAuth: true };
  },
  voice: (segments) => {
    const id = segments[0];
    if (id === 'record') {
      return { pathname: '/voice/record', requiresAuth: true };
    }
    if (id === 'upload') {
      return { pathname: '/voice/upload', requiresAuth: true };
    }
    if (id) {
      return { pathname: '/voice/[id]', params: { id }, requiresAuth: true };
    }
    return { pathname: '/(tabs)/voices', requiresAuth: true };
  },
  note: (segments) => {
    const id = segments[0];
    if (id === 'create') {
      return { pathname: '/note/create', requiresAuth: true };
    }
    if (id) {
      return { pathname: '/note/[id]', params: { id }, requiresAuth: true };
    }
    return { pathname: '/(tabs)/compose', requiresAuth: true };
  },
  message: (segments) => {
    const id = segments[0];
    if (id === 'create') {
      return { pathname: '/message/create', requiresAuth: true };
    }
    if (id) {
      return { pathname: '/message/[id]', params: { id }, requiresAuth: true };
    }
    return { pathname: '/(tabs)/compose', requiresAuth: true };
  },
  people: () => ({ pathname: '/people', requiresAuth: true }),
  settings: () => ({ pathname: '/settings', requiresAuth: true }),
  character: () => ({ pathname: '/character', requiresAuth: true }),
  library: () => ({ pathname: '/library', requiresAuth: true }),
  player: () => ({ pathname: '/player', requiresAuth: true }),
};

export function parseDeepLink(url: string): DeepLinkRoute | null {
  const parsed = Linking.parse(url);

  if (parsed.scheme && parsed.scheme !== SCHEME) return null;

  const path = parsed.path;
  if (!path) return null;

  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  const root = segments[0];
  const resolver = ROUTE_MAP[root];

  if (resolver) {
    return resolver(segments.slice(1));
  }

  const isPublic = PUBLIC_ROUTES.has(`/${path}`);
  return {
    pathname: `/${path}`,
    requiresAuth: !isPublic,
  };
}

export function createDeepLink(path: string, params?: Record<string, string>): string {
  const query = params
    ? '?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
    : '';
  return `${SCHEME}://${path}${query}`;
}
