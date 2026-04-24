import * as fs from 'fs';
import * as path from 'path';

const APP_DIR = path.resolve(__dirname, '..', 'app');
const SRC_DIR = path.resolve(__dirname, '..', 'src');

function readAllSources(dir: string): Array<{ file: string; content: string }> {
  const results: Array<{ file: string; content: string }> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...readAllSources(full));
    } else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
      results.push({ file: full, content: fs.readFileSync(full, 'utf-8') });
    }
  }
  return results;
}

function rel(absPath: string): string {
  return path.relative(path.resolve(__dirname, '..'), absPath).replace(/\\/g, '/');
}

function discoverRoutes(dir: string, prefix = ''): string[] {
  const routes: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.name === '_layout.tsx' || entry.name.startsWith('_')) continue;
    if (entry.isDirectory()) {
      if (entry.name.startsWith('(') && entry.name.endsWith(')')) {
        routes.push(...discoverRoutes(full, prefix));
      } else {
        routes.push(...discoverRoutes(full, `${prefix}/${entry.name}`));
      }
    } else if (entry.name.endsWith('.tsx')) {
      const base = entry.name.replace('.tsx', '');
      if (base === 'index') {
        routes.push(prefix || '/');
      } else {
        routes.push(`${prefix}/${base}`);
      }
    }
  }
  return routes;
}

const allSources = [...readAllSources(APP_DIR), ...readAllSources(SRC_DIR)];
const validRoutes = discoverRoutes(APP_DIR);

function extractPushTargets(): Array<{ file: string; target: string }> {
  const targets: Array<{ file: string; target: string }> = [];

  for (const { file, content } of allSources) {
    const stringPushRe = /router\.(push|replace)\(\s*'([^']+)'/g;
    let m: RegExpExecArray | null;
    while ((m = stringPushRe.exec(content))) {
      targets.push({ file: rel(file), target: m[2] });
    }

    const templatePushRe = /router\.(push|replace)\(\s*`([^`]+)`/g;
    while ((m = templatePushRe.exec(content))) {
      const template = m[2];
      const normalized = template.replace(/\$\{[^}]+\}/g, '__PARAM__');
      targets.push({ file: rel(file), target: normalized });
    }

    const objectPushRe = /router\.(push|replace)\(\s*\{\s*pathname:\s*'([^']+)'/g;
    while ((m = objectPushRe.exec(content))) {
      targets.push({ file: rel(file), target: m[2] });
    }
  }

  return targets;
}

function routeMatchesTarget(route: string, target: string): boolean {
  if (route === target) return true;

  const routeParts = route.split('/');
  const cleanTarget = target.split('?')[0];
  const targetParts = cleanTarget.split('/');

  if (routeParts.length !== targetParts.length) return false;

  return routeParts.every((rp, i) => {
    const tp = targetParts[i];
    if (rp.startsWith('[') && rp.endsWith(']')) return tp === '__PARAM__' || tp !== '';
    return rp === tp;
  });
}

const pushTargets = extractPushTargets();

describe('네비게이션 라우트 유효성', () => {
  it('앱에 최소 20개 이상의 라우트가 존재한다', () => {
    expect(validRoutes.length).toBeGreaterThanOrEqual(20);
  });

  it('라우트 파일 수가 회귀하지 않는다', () => {
    expect(validRoutes.length).toBeGreaterThanOrEqual(22);
  });

  it('모든 router.push/replace 대상이 실제 라우트 파일에 매핑된다', () => {
    const groupPrefixes = ['/(tabs)'];

    const broken: string[] = [];

    for (const { file, target } of pushTargets) {
      const isGroupNav = groupPrefixes.some((g) => target === g || target.startsWith(`${g}/`));
      if (isGroupNav) continue;

      const matched = validRoutes.some((r) => routeMatchesTarget(r, target));
      if (!matched) {
        broken.push(`${file}: router → ${target}`);
      }
    }

    expect(broken).toEqual([]);
  });

  it('주요 라우트 파일이 존재한다', () => {
    const required = [
      '/',
      '/alarms',
      '/voices',
      '/compose',
      '/alarm/create',
      '/alarm/edit',
      '/character',
      '/code-register',
      '/library',
      '/people',
      '/settings',
      '/onboarding',
      '/player',
      '/voice/record',
      '/voice/upload',
      '/voice/diarize',
      '/voice/picker',
      '/voice/[id]',
      '/message/create',
      '/message/[id]',
      '/note/create',
      '/note/[id]',
      '/friend/[id]',
      '/family-alarm/create',
      '/gift/received',
      '/dub/translate',
    ];

    for (const route of required) {
      expect({ route, exists: validRoutes.includes(route) }).toEqual({
        route,
        exists: true,
      });
    }
  });
});

describe('라우트 탐색 커버리지', () => {
  it('모든 비-탭 라우트가 적어도 하나의 네비게이션 출발점을 갖는다', () => {
    const tabRoutes = ['/', '/alarms', '/voices', '/compose'];
    const stackRoutes = validRoutes.filter((r) => !tabRoutes.includes(r));

    const unreachable: string[] = [];
    for (const route of stackRoutes) {
      const isTarget = pushTargets.some(({ target }) => routeMatchesTarget(route, target));
      if (!isTarget) {
        unreachable.push(route);
      }
    }

    const allowedUnreachable = ['/voice/picker', '/voice/diarize'];
    const actual = unreachable.filter((r) => !allowedUnreachable.includes(r));
    expect(actual).toEqual([]);
  });
});

describe('동적 라우트 파라미터', () => {
  it('[id] 동적 라우트에 대한 네비게이션이 파라미터를 전달한다', () => {
    const dynamicRoutes = validRoutes.filter((r) => r.includes('['));
    expect(dynamicRoutes.length).toBeGreaterThanOrEqual(4);

    for (const route of dynamicRoutes) {
      const hasNavigation = pushTargets.some(({ target }) => routeMatchesTarget(route, target));
      expect({ route, hasNavigation }).toEqual({ route, hasNavigation: true });
    }
  });
});

describe('Stack.Screen 등록', () => {
  const layoutContent = fs.readFileSync(path.join(APP_DIR, '_layout.tsx'), 'utf-8');

  it('root _layout.tsx에 Stack.Screen이 등록되어 있다', () => {
    expect(layoutContent).toContain('Stack.Screen');
  });

  it('주요 스택 화면이 _layout.tsx에 등록되어 있다', () => {
    const required = [
      'alarm/create',
      'alarm/edit',
      'character/index',
      'library/index',
      'settings/index',
      'people/index',
    ];

    for (const screen of required) {
      expect({
        screen,
        registered: layoutContent.includes(screen),
      }).toEqual({ screen, registered: true });
    }
  });
});

describe('deepLink → 라우트 매핑', () => {
  const deepLinkFile = allSources.find((f) => f.file.includes('deepLink'));

  it('deepLink 파서가 존재한다', () => {
    expect(deepLinkFile).toBeDefined();
  });

  it('딥 링크 대상 경로가 실제 라우트에 매핑된다', () => {
    if (!deepLinkFile) return;

    const routeRe = /path:\s*'([^']+)'/g;
    const deepLinkPaths: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = routeRe.exec(deepLinkFile.content))) {
      deepLinkPaths.push(m[1]);
    }

    const broken: string[] = [];
    for (const dlPath of deepLinkPaths) {
      const normalized = dlPath.replace(/\$\{[^}]+\}/g, '__PARAM__');
      const matched = validRoutes.some((r) => routeMatchesTarget(r, normalized));
      if (!matched && !dlPath.startsWith('/(tabs)')) {
        broken.push(dlPath);
      }
    }

    expect(broken).toEqual([]);
  });
});
