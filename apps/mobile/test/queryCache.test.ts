import * as fs from 'fs';
import * as path from 'path';

const APP_DIR = path.resolve(__dirname, '..', 'app');
const SRC_DIR = path.resolve(__dirname, '..', 'src');
const LAYOUT_FILE = path.join(APP_DIR, '_layout.tsx');

function readTsx(dir: string): Array<{ file: string; content: string }> {
  const results: Array<{ file: string; content: string }> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...readTsx(full));
    } else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
      results.push({ file: full, content: fs.readFileSync(full, 'utf-8') });
    }
  }
  return results;
}

function rel(absPath: string): string {
  return path.relative(path.resolve(__dirname, '..'), absPath).replace(/\\/g, '/');
}

function extractQueryKeys(content: string): string[][] {
  const re = /queryKey:\s*\[([^\]]+)\]/g;
  const keys: string[][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const parts = m[1]!.split(',').map((s) => s.trim().replace(/['"]/g, ''));
    keys.push(parts);
  }
  return keys;
}

function extractInvalidateKeys(content: string): string[][] {
  const re = /invalidateQueries\(\s*\{\s*queryKey:\s*\[([^\]]+)\]/g;
  const keys: string[][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const parts = m[1]!.split(',').map((s) => s.trim().replace(/['"]/g, ''));
    keys.push(parts);
  }
  return keys;
}

const allFiles = [...readTsx(APP_DIR), ...readTsx(SRC_DIR)];
const layoutContent = fs.readFileSync(LAYOUT_FILE, 'utf-8');

describe('QueryClient defaults', () => {
  it('staleTime은 30초 (30_000ms)', () => {
    expect(layoutContent).toContain('staleTime: 30_000');
  });

  it('retry는 2회', () => {
    expect(layoutContent).toContain('retry: 2');
  });

  it('gcTime은 커스텀 설정 없음 (TanStack 기본값 5분 사용)', () => {
    expect(layoutContent).not.toMatch(/gcTime/);
    expect(layoutContent).not.toMatch(/cacheTime/);
  });

  it('QueryClientProvider가 앱을 감싸고 있다', () => {
    expect(layoutContent).toContain('QueryClientProvider');
    expect(layoutContent).toContain('client={queryClient}');
  });
});

describe('쿼리 키 일관성', () => {
  const queryFnToKeys = new Map<string, Array<{ key: string[]; file: string }>>();

  for (const { file, content } of allFiles) {
    const queryRe =
      /useQuery\(\s*\{[^}]*queryKey:\s*\[([^\]]+)\][^}]*queryFn:\s*(?:\(\)\s*=>?\s*)?([a-zA-Z]+)/gs;
    let m: RegExpExecArray | null;
    while ((m = queryRe.exec(content))) {
      const keyParts = m[1]!.split(',').map((s) => s.trim().replace(/['"]/g, ''));
      const fn = m[2]!;
      if (!queryFnToKeys.has(fn)) queryFnToKeys.set(fn, []);
      queryFnToKeys.get(fn)!.push({ key: keyParts, file: rel(file) });
    }
  }

  it('getUserProfile은 항상 동일한 쿼리 키를 사용한다', () => {
    const entries = queryFnToKeys.get('getUserProfile') ?? [];
    expect(entries.length).toBeGreaterThan(0);
    const baseKey = entries[0]!.key[0];
    for (const e of entries) {
      expect({ file: e.file, key: e.key[0] }).toEqual({ file: e.file, key: baseKey });
    }
  });

  it('getAlarms는 항상 동일한 쿼리 키를 사용한다', () => {
    const entries = queryFnToKeys.get('getAlarms') ?? [];
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.key).toEqual(['alarms']);
    }
  });

  it('getVoiceProfiles는 항상 동일한 쿼리 키를 사용한다', () => {
    const entries = queryFnToKeys.get('getVoiceProfiles') ?? [];
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.key).toEqual(['voiceProfiles']);
    }
  });

  it('getMessages는 항상 동일한 쿼리 키를 사용한다', () => {
    const entries = queryFnToKeys.get('getMessages') ?? [];
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.key).toEqual(['messages']);
    }
  });

  it('getFamilyVoiceProfiles는 항상 동일한 쿼리 키를 사용한다', () => {
    const entries = queryFnToKeys.get('getFamilyVoiceProfiles') ?? [];
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.key).toEqual(['familyVoiceProfiles']);
    }
  });

  it('getCharacterMe는 항상 동일한 쿼리 키를 사용한다', () => {
    const entries = queryFnToKeys.get('getCharacterMe') ?? [];
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.key).toEqual(['character-me']);
    }
  });

  it('getPendingRequests는 항상 동일한 쿼리 키를 사용한다', () => {
    const entries = queryFnToKeys.get('getPendingRequests') ?? [];
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.key).toEqual(['pending-requests']);
    }
  });

  it('getFriendList는 항상 동일한 쿼리 키를 사용한다', () => {
    const entries = queryFnToKeys.get('getFriendList') ?? [];
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.key).toEqual(['friends']);
    }
  });

  it('getFamilyGroupCurrent는 항상 동일한 쿼리 키를 사용한다', () => {
    const entries = queryFnToKeys.get('getFamilyGroupCurrent') ?? [];
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.key).toEqual(['family-group']);
    }
  });

  it('모든 쿼리 함수에 대해 첫 번째 키 세그먼트가 일관된다', () => {
    const violations: string[] = [];
    for (const [fn, entries] of queryFnToKeys) {
      const baseKey = entries[0]!.key[0];
      for (const e of entries.slice(1)) {
        if (e.key[0] !== baseKey) {
          violations.push(`${fn}: ${e.file} uses [${e.key[0]}] but expected [${baseKey}]`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('쿼리 enabled 가드', () => {
  const queriesWithoutGuard: string[] = [];

  for (const { file, content } of allFiles) {
    if (file.includes('test') || file.includes('__test')) continue;

    const useQueryBlocks = content.match(/useQuery\(\s*\{[\s\S]*?\}\s*\)/g) ?? [];
    for (const block of useQueryBlocks) {
      if (!block.includes('enabled')) {
        const fnMatch = block.match(/queryFn:\s*(?:\(\)\s*=>?\s*)?([a-zA-Z]+)/);
        const keyMatch = block.match(/queryKey:\s*\[([^\]]+)\]/);
        const fn: string = fnMatch?.[1] ?? 'unknown';
        const key: string = keyMatch?.[1] ?? 'unknown';
        queriesWithoutGuard.push(`${rel(file)}: ${fn} [${key}]`);
      }
    }
  }

  it('스택 화면을 제외한 모든 useQuery에 enabled 조건이 있다', () => {
    const stackScreensAllowed = [
      'dub/translate',
      'friend/[id]',
      'gift/received',
      'alarm/edit',
      'alarm/create',
      'message/create',
      'message/[id]',
      'note/create',
      'note/[id]',
      'voice/',
      'character/',
      'onboarding',
    ];
    const actual = queriesWithoutGuard.filter(
      (entry) => !stackScreensAllowed.some((s) => entry.includes(s)),
    );
    expect(actual).toEqual([]);
  });

  it('탭 화면 쿼리는 모두 isConnected 가드를 포함한다', () => {
    const tabFiles = allFiles.filter((f) => f.file.includes('(tabs)'));
    for (const { file, content } of tabFiles) {
      const blocks = content.match(/useQuery\(\s*\{[\s\S]*?\}\s*\)/g) ?? [];
      for (const block of blocks) {
        if (block.includes('enabled') && block.includes('isAuthenticated')) {
          expect({ file: rel(file), hasConnected: block.includes('isConnected') }).toEqual({
            file: rel(file),
            hasConnected: true,
          });
        }
      }
    }
  });
});

describe('뮤테이션 캐시 무효화', () => {
  it('알람 토글/삭제 뮤테이션은 alarms 쿼리를 무효화한다', () => {
    const alarmsTab = allFiles.find((f) => f.file.endsWith('alarms.tsx') && f.file.includes('(tabs)'));
    expect(alarmsTab).toBeDefined();
    const invalidateKeys = extractInvalidateKeys(alarmsTab!.content);
    const alarmsInvalidated = invalidateKeys.some((k) => k[0] === 'alarms');
    expect(alarmsInvalidated).toBe(true);
  });

  it('음성 삭제 뮤테이션은 voiceProfiles 쿼리를 무효화한다', () => {
    const voicesTab = allFiles.find((f) => f.file.endsWith('voices.tsx') && f.file.includes('(tabs)'));
    expect(voicesTab).toBeDefined();
    const invalidateKeys = extractInvalidateKeys(voicesTab!.content);
    const voicesInvalidated = invalidateKeys.some((k) => k[0] === 'voiceProfiles');
    expect(voicesInvalidated).toBe(true);
  });

  it('쪽지 읽음 뮤테이션은 notes-received를 무효화한다', () => {
    const compose = allFiles.find((f) => f.file.endsWith('compose.tsx'));
    expect(compose).toBeDefined();
    const invalidateKeys = extractInvalidateKeys(compose!.content);
    expect(invalidateKeys.some((k) => k[0] === 'notes-received')).toBe(true);
  });

  it('친구 요청 뮤테이션은 friends와 pending-requests를 모두 무효화한다', () => {
    const people = allFiles.find((f) => f.file.endsWith('index.tsx') && f.file.includes('people'));
    expect(people).toBeDefined();
    const invalidateKeys = extractInvalidateKeys(people!.content);
    const friendsInvalidated = invalidateKeys.some((k) => k[0] === 'friends');
    const pendingInvalidated = invalidateKeys.some((k) => k[0] === 'pending-requests');
    expect(friendsInvalidated).toBe(true);
    expect(pendingInvalidated).toBe(true);
  });

  it('라이브러리 삭제 뮤테이션은 library를 무효화한다', () => {
    const library = allFiles.find((f) => f.file.endsWith('index.tsx') && f.file.includes('library'));
    expect(library).toBeDefined();
    const invalidateKeys = extractInvalidateKeys(library!.content);
    expect(invalidateKeys.some((k) => k[0] === 'library')).toBe(true);
  });

  it('코드 등록은 userProfile을 무효화한다', () => {
    const codeRegister = allFiles.find((f) => f.file.includes('code-register'));
    expect(codeRegister).toBeDefined();
    const invalidateKeys = extractInvalidateKeys(codeRegister!.content);
    expect(invalidateKeys.some((k) => k[0] === 'userProfile')).toBe(true);
  });

  it('알람 생성은 alarms를 무효화한다', () => {
    const create = allFiles.find((f) => f.file.endsWith('create.tsx') && f.file.includes('alarm'));
    expect(create).toBeDefined();
    const invalidateKeys = extractInvalidateKeys(create!.content);
    expect(invalidateKeys.some((k) => k[0] === 'alarms')).toBe(true);
  });

  it('음성 녹음/업로드/분리 후 voiceProfiles를 무효화한다', () => {
    // Match only files under app/voice/ — `app/alarm/source-record.tsx` has
    // 'record' in its name but is the alarm raw-audio screen, not a voice
    // profile creator, so it must not be required to invalidate voiceProfiles.
    const voiceFiles = allFiles.filter(
      (f) =>
        /[\\/]voice[\\/]/.test(f.file) &&
        (f.file.includes('record') || f.file.includes('upload') || f.file.includes('diarize')),
    );
    expect(voiceFiles.length).toBeGreaterThanOrEqual(3);
    for (const vf of voiceFiles) {
      const keys = extractInvalidateKeys(vf.content);
      expect({ file: rel(vf.file), hasVoiceProfileInvalidation: keys.some((k) => k[0] === 'voiceProfiles') }).toEqual({
        file: rel(vf.file),
        hasVoiceProfileInvalidation: true,
      });
    }
  });
});

describe('오프라인 캐시 통합', () => {
  const CACHE_KEYS = ['offline_cache_alarms', 'offline_cache_messages', 'offline_cache_library', 'offline_cache_voices'];

  it('offlineCache 서비스에 4개 캐시 키가 정의되어 있다', () => {
    const cacheFile = allFiles.find((f) => f.file.includes('offlineCache'));
    expect(cacheFile).toBeDefined();
    for (const key of CACHE_KEYS) {
      expect(cacheFile!.content).toContain(key);
    }
  });

  it('알람 탭은 오프라인 캐시에서 데이터를 로드한다', () => {
    const alarmsTab = allFiles.find((f) => f.file.endsWith('alarms.tsx') && f.file.includes('(tabs)'));
    expect(alarmsTab).toBeDefined();
    expect(alarmsTab!.content).toContain('getCachedAlarms');
  });

  it('음성 탭은 오프라인 캐시에서 데이터를 로드한다', () => {
    const voicesTab = allFiles.find((f) => f.file.endsWith('voices.tsx') && f.file.includes('(tabs)'));
    expect(voicesTab).toBeDefined();
    expect(voicesTab!.content).toContain('getCachedVoices');
  });

  it('홈 화면은 알람+메시지 오프라인 캐시를 로드한다', () => {
    const homeTab = allFiles.find((f) => f.file.endsWith('index.tsx') && f.file.includes('(tabs)'));
    expect(homeTab).toBeDefined();
    expect(homeTab!.content).toContain('getCachedAlarms');
    expect(homeTab!.content).toContain('getCachedMessages');
  });

  it('라이브러리 화면은 오프라인 캐시를 로드한다', () => {
    const library = allFiles.find((f) => f.file.endsWith('index.tsx') && f.file.includes('library'));
    expect(library).toBeDefined();
    expect(library!.content).toContain('getCachedLibrary');
  });

  it('캐시 쓰기 패턴: 네트워크 데이터 도착 시 AsyncStorage에 저장한다', () => {
    const alarmsTab = allFiles.find((f) => f.file.endsWith('alarms.tsx') && f.file.includes('(tabs)'));
    expect(alarmsTab).toBeDefined();
    expect(alarmsTab!.content).toContain('cacheAlarms');
  });

  it('displayData 폴백 패턴: 네트워크 데이터 ?? 캐시 데이터 사용', () => {
    const voicesTab = allFiles.find((f) => f.file.endsWith('voices.tsx') && f.file.includes('(tabs)'));
    expect(voicesTab).toBeDefined();
    expect(voicesTab!.content).toMatch(/profiles\s*\?\?\s*cachedProfiles/);
  });
});

describe('쿼리 키 레지스트리 완전성', () => {
  const ALL_KNOWN_KEYS = [
    'alarms',
    'messages',
    'voiceProfiles',
    'familyVoiceProfiles',
    'character-me',
    'userProfile',
    'friends',
    'pending-requests',
    'family-group',
    'family-invites',
    'gifts-received',
    'notes-received',
    'notes-sent',
    'library',
    'stats',
    'activity',
    'dubLanguages',
    'sentGifts',
    'gifts-received',
    'subscription',
  ];

  it('알려진 쿼리 키 목록이 실제 소스와 일치한다', () => {
    const foundKeys = new Set<string>();
    for (const { content } of allFiles) {
      const keys = extractQueryKeys(content);
      for (const k of keys) {
        foundKeys.add(k[0]!);
      }
    }
    const unknownKeys = [...foundKeys].filter(
      (k) => !ALL_KNOWN_KEYS.includes(k) && !k.includes('alarm') && k !== 'character',
    );
    expect(unknownKeys).toEqual([]);
  });

  it('쿼리 키에 하이픈과 camelCase가 혼용되지 않는다 (같은 도메인 내)', () => {
    const domains = new Map<string, string[]>();
    for (const { content } of allFiles) {
      const keys = extractQueryKeys(content);
      for (const k of keys) {
        const base = k[0]!.replace(/-(.)/, (_, c: string) => c.toUpperCase()).replace(/[A-Z]/g, '');
        if (!domains.has(base)) domains.set(base, []);
        if (!domains.get(base)!.includes(k[0]!)) domains.get(base)!.push(k[0]!);
      }
    }
    for (const [, variants] of domains) {
      if (variants.length > 1) {
        const hasCamel = variants.some((v) => /[A-Z]/.test(v));
        const hasHyphen = variants.some((v) => v.includes('-'));
        if (hasCamel && hasHyphen) {
          const mixed = variants.filter((v) => /[A-Z]/.test(v) || v.includes('-'));
          expect(mixed.length).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('recentPresets 캐시', () => {
  it('offlineCache에 최대 5개 제한이 있다', () => {
    const cacheFile = allFiles.find((f) => f.file.includes('offlineCache'));
    expect(cacheFile).toBeDefined();
    expect(cacheFile!.content).toContain('MAX_RECENT_PRESETS = 5');
  });

  it('addRecentPresetMessage가 중복을 제거한다', () => {
    const cacheFile = allFiles.find((f) => f.file.includes('offlineCache'));
    expect(cacheFile).toBeDefined();
    expect(cacheFile!.content).toContain('.filter((m) => m !== text)');
  });

  it('최신 항목이 맨 앞에 온다', () => {
    const cacheFile = allFiles.find((f) => f.file.includes('offlineCache'));
    expect(cacheFile).toBeDefined();
    expect(cacheFile!.content).toMatch(/\[text,\s*\.\.\.existing/);
  });
});
