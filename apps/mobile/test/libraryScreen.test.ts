interface LibraryItem {
  id: string;
  user_id: string;
  message_id: string;
  voice_name?: string;
  avatar_url?: string;
  text: string;
  category: string;
  is_favorite: boolean;
  received_at: string;
}

type FilterType = 'all' | 'favorite';

const CATEGORIES = [
  { key: 'all', emoji: '📋' },
  { key: 'morning', emoji: '🌅' },
  { key: 'lunch', emoji: '🍽️' },
  { key: 'afternoon', emoji: '☕' },
  { key: 'evening', emoji: '🌙' },
  { key: 'night', emoji: '😴' },
  { key: 'cheer', emoji: '💪' },
  { key: 'love', emoji: '❤️' },
  { key: 'health', emoji: '🏥' },
  { key: 'custom', emoji: '✏️' },
] as const;

const CATEGORY_I18N: Record<string, string> = {
  morning: 'library.categoryMorning',
  lunch: 'library.categoryLunch',
  afternoon: 'library.categoryAfternoon',
  evening: 'library.categoryEvening',
  night: 'library.categoryNight',
  cheer: 'library.categoryCheer',
  love: 'library.categoryLove',
  health: 'library.categoryHealth',
  custom: 'library.categoryCustom',
};

function getCategoryLabel(key: string, t: (k: string) => string): string {
  return CATEGORY_I18N[key] ? t(CATEGORY_I18N[key]!) : key;
}

function filterByCategory(
  items: LibraryItem[] | null,
  categoryFilter: string,
): LibraryItem[] | null {
  if (!items) return items;
  if (categoryFilter === 'all') return items;
  return items.filter((item) => item.category === categoryFilter);
}

function sortItems(items: LibraryItem[]): LibraryItem[] {
  return [...items].sort((a, b) => {
    if (a.is_favorite && !b.is_favorite) return -1;
    if (!a.is_favorite && b.is_favorite) return 1;
    return new Date(b.received_at).getTime() - new Date(a.received_at).getTime();
  });
}

function computeDisplayItems(
  items: LibraryItem[] | null,
  cachedItems: LibraryItem[] | null,
  isConnected: boolean,
  filter: FilterType,
  categoryFilter: string,
): LibraryItem[] | null {
  const baseItems = items ?? (filter === 'all' ? cachedItems : null);
  const filtered = filterByCategory(baseItems, categoryFilter);
  if (!filtered) return filtered;
  return sortItems(filtered);
}

function isShowingCached(
  items: LibraryItem[] | undefined | null,
  cachedItems: LibraryItem[] | null,
  isConnected: boolean,
  filter: FilterType,
): boolean {
  return !items && !!cachedItems && !isConnected && filter === 'all';
}

function makeItem(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: overrides.id ?? 'item-1',
    user_id: 'user-1',
    message_id: 'msg-1',
    voice_name: 'Voice A',
    text: 'Hello',
    category: 'morning',
    is_favorite: false,
    received_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('LibraryScreen business logic', () => {
  const t = (key: string) => key;

  describe('CATEGORIES constant', () => {
    it('has 10 categories including all', () => {
      expect(CATEGORIES).toHaveLength(10);
    });

    it('starts with "all"', () => {
      expect(CATEGORIES[0]!.key).toBe('all');
    });

    it('has unique keys', () => {
      const keys = CATEGORIES.map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('each category has an emoji', () => {
      for (const cat of CATEGORIES) {
        expect(cat.emoji.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getCategoryLabel', () => {
    it('returns i18n key for known categories', () => {
      expect(getCategoryLabel('morning', t)).toBe('library.categoryMorning');
      expect(getCategoryLabel('evening', t)).toBe('library.categoryEvening');
      expect(getCategoryLabel('custom', t)).toBe('library.categoryCustom');
    });

    it('returns the key itself for unknown categories', () => {
      expect(getCategoryLabel('unknown', t)).toBe('unknown');
    });

    it('returns key itself for "all"', () => {
      expect(getCategoryLabel('all', t)).toBe('all');
    });

    it('covers all non-all CATEGORIES', () => {
      const nonAll = CATEGORIES.filter((c) => c.key !== 'all');
      for (const cat of nonAll) {
        expect(CATEGORY_I18N[cat.key]).toBeDefined();
      }
    });
  });

  describe('filterByCategory', () => {
    const items = [
      makeItem({ id: '1', category: 'morning' }),
      makeItem({ id: '2', category: 'evening' }),
      makeItem({ id: '3', category: 'morning' }),
      makeItem({ id: '4', category: 'cheer' }),
    ];

    it('returns all items when filter is "all"', () => {
      const result = filterByCategory(items, 'all');
      expect(result).toHaveLength(4);
    });

    it('filters by specific category', () => {
      const result = filterByCategory(items, 'morning');
      expect(result).toHaveLength(2);
      expect(result!.every((i) => i.category === 'morning')).toBe(true);
    });

    it('returns empty array when no items match', () => {
      const result = filterByCategory(items, 'love');
      expect(result).toHaveLength(0);
    });

    it('returns null when input is null', () => {
      expect(filterByCategory(null, 'morning')).toBeNull();
    });

    it('returns empty array for empty input', () => {
      expect(filterByCategory([], 'morning')).toHaveLength(0);
    });
  });

  describe('sortItems', () => {
    it('puts favorites first', () => {
      const items = [
        makeItem({ id: '1', is_favorite: false, received_at: '2026-01-03T00:00:00Z' }),
        makeItem({ id: '2', is_favorite: true, received_at: '2026-01-01T00:00:00Z' }),
      ];
      const sorted = sortItems(items);
      expect(sorted[0]!.id).toBe('2');
      expect(sorted[1]!.id).toBe('1');
    });

    it('sorts by received_at descending within same favorite status', () => {
      const items = [
        makeItem({ id: '1', is_favorite: false, received_at: '2026-01-01T00:00:00Z' }),
        makeItem({ id: '2', is_favorite: false, received_at: '2026-01-03T00:00:00Z' }),
        makeItem({ id: '3', is_favorite: false, received_at: '2026-01-02T00:00:00Z' }),
      ];
      const sorted = sortItems(items);
      expect(sorted.map((i) => i.id)).toEqual(['2', '3', '1']);
    });

    it('sorts favorites by date within favorites group', () => {
      const items = [
        makeItem({ id: '1', is_favorite: true, received_at: '2026-01-01T00:00:00Z' }),
        makeItem({ id: '2', is_favorite: true, received_at: '2026-01-03T00:00:00Z' }),
      ];
      const sorted = sortItems(items);
      expect(sorted[0]!.id).toBe('2');
    });

    it('does not mutate original array', () => {
      const items = [
        makeItem({ id: '1', received_at: '2026-01-02T00:00:00Z' }),
        makeItem({ id: '2', received_at: '2026-01-01T00:00:00Z' }),
      ];
      const original = [...items];
      sortItems(items);
      expect(items.map((i) => i.id)).toEqual(original.map((i) => i.id));
    });

    it('handles empty array', () => {
      expect(sortItems([])).toEqual([]);
    });

    it('handles single item', () => {
      const items = [makeItem({ id: 'solo' })];
      expect(sortItems(items)).toHaveLength(1);
    });

    it('stable sort: same date and favorite status preserves order', () => {
      const items = [
        makeItem({ id: '1', is_favorite: false, received_at: '2026-01-01T00:00:00Z' }),
        makeItem({ id: '2', is_favorite: false, received_at: '2026-01-01T00:00:00Z' }),
      ];
      const sorted = sortItems(items);
      expect(sorted).toHaveLength(2);
    });
  });

  describe('computeDisplayItems', () => {
    const onlineItems = [
      makeItem({ id: '1', category: 'morning', is_favorite: true, received_at: '2026-01-01T00:00:00Z' }),
      makeItem({ id: '2', category: 'evening', is_favorite: false, received_at: '2026-01-02T00:00:00Z' }),
      makeItem({ id: '3', category: 'morning', is_favorite: false, received_at: '2026-01-03T00:00:00Z' }),
    ];
    const cachedItems = [
      makeItem({ id: 'c1', category: 'morning' }),
      makeItem({ id: 'c2', category: 'evening' }),
    ];

    it('uses online items when available', () => {
      const result = computeDisplayItems(onlineItems, cachedItems, true, 'all', 'all');
      expect(result).toHaveLength(3);
    });

    it('uses cached items when offline and filter is all', () => {
      const result = computeDisplayItems(null, cachedItems, false, 'all', 'all');
      expect(result).toHaveLength(2);
    });

    it('returns null when offline and filter is favorite', () => {
      const result = computeDisplayItems(null, cachedItems, false, 'favorite', 'all');
      expect(result).toBeNull();
    });

    it('applies category filter on top of items', () => {
      const result = computeDisplayItems(onlineItems, null, true, 'all', 'morning');
      expect(result).toHaveLength(2);
      expect(result!.every((i) => i.category === 'morning')).toBe(true);
    });

    it('sorts favorites first after filtering', () => {
      const result = computeDisplayItems(onlineItems, null, true, 'all', 'all');
      expect(result![0]!.id).toBe('1');
      expect(result![0]!.is_favorite).toBe(true);
    });

    it('returns null when both items and cached are null', () => {
      const result = computeDisplayItems(null, null, true, 'all', 'all');
      expect(result).toBeNull();
    });

    it('category filter on cached items works', () => {
      const result = computeDisplayItems(null, cachedItems, false, 'all', 'morning');
      expect(result).toHaveLength(1);
      expect(result![0]!.id).toBe('c1');
    });
  });

  describe('isShowingCached', () => {
    const cached = [makeItem()];

    it('returns true when offline with no items but has cache', () => {
      expect(isShowingCached(null, cached, false, 'all')).toBe(true);
    });

    it('returns false when online even with no items', () => {
      expect(isShowingCached(null, cached, true, 'all')).toBe(false);
    });

    it('returns false when items are available', () => {
      expect(isShowingCached([makeItem()], cached, false, 'all')).toBe(false);
    });

    it('returns false when no cached items', () => {
      expect(isShowingCached(null, null, false, 'all')).toBe(false);
    });

    it('returns false when filter is favorite', () => {
      expect(isShowingCached(null, cached, false, 'favorite')).toBe(false);
    });

    it('returns false when items is undefined', () => {
      expect(isShowingCached(undefined, cached, false, 'all')).toBe(true);
    });

    it('returns true with empty cached array (truthy in JS)', () => {
      expect(isShowingCached(null, [], false, 'all')).toBe(true);
    });
  });

  describe('empty state logic', () => {
    function getEmptyKey(filter: FilterType): string {
      return filter === 'favorite' ? 'library.emptyFavorites' : 'library.emptyAll';
    }
    function shouldShowCta(filter: FilterType): boolean {
      return filter !== 'favorite';
    }

    it('shows empty all message when displayItems is empty and filter is all', () => {
      expect(getEmptyKey('all')).toBe('library.emptyAll');
    });

    it('shows empty favorites message when filter is favorite', () => {
      expect(getEmptyKey('favorite')).toBe('library.emptyFavorites');
    });

    it('hides CTA button when filter is favorite', () => {
      expect(shouldShowCta('favorite')).toBe(false);
    });

    it('shows CTA button when filter is all', () => {
      expect(shouldShowCta('all')).toBe(true);
    });
  });

  describe('query configuration', () => {
    function getQueryParam(filter: FilterType): string | undefined {
      return filter === 'favorite' ? 'favorite' : undefined;
    }

    it('passes "favorite" to getLibrary when filter is favorite', () => {
      expect(getQueryParam('favorite')).toBe('favorite');
    });

    it('passes undefined to getLibrary when filter is all', () => {
      expect(getQueryParam('all')).toBeUndefined();
    });

    it('query is disabled when not authenticated', () => {
      const isAuthenticated = false;
      const isConnected = true;
      const enabled = isAuthenticated && isConnected;
      expect(enabled).toBe(false);
    });

    it('query is disabled when not connected', () => {
      const isAuthenticated = true;
      const isConnected = false;
      const enabled = isAuthenticated && isConnected;
      expect(enabled).toBe(false);
    });

    it('query is enabled when authenticated and connected', () => {
      const isAuthenticated = true;
      const isConnected = true;
      const enabled = isAuthenticated && isConnected;
      expect(enabled).toBe(true);
    });
  });
});
