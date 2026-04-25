interface Friend {
  id: string;
  user_a: string;
  user_b: string;
  friend_name: string | null;
  friend_email: string | null;
  created_at: string;
  status: string;
}

interface Gift {
  id: string;
  sender_email: string;
  recipient_id: string;
  message_text: string;
  status: 'pending' | 'accepted' | 'rejected';
  category: string;
}

interface Alarm {
  id: string;
  user_id: string;
  target_user_id: string | null;
}

type TFn = (key: string, params?: Record<string, unknown>) => string;

function findFriendById(friends: Friend[], id: string): Friend | undefined {
  return friends.find((f) => f.id === id);
}

function computeFriendName(friend: Friend): string {
  return friend.friend_name || friend.friend_email || '';
}

function computeInitial(friendName: string): string {
  return (friendName || '?')[0]!.toUpperCase();
}

function filterGiftsToFriend(
  sentGifts: Gift[],
  friend: Friend,
): Gift[] {
  return sentGifts.filter(
    (g) => g.recipient_id === friend.user_b || g.recipient_id === friend.user_a,
  );
}

function filterGiftsFromFriend(
  receivedGifts: Gift[],
  friendEmail: string,
): Gift[] {
  return receivedGifts.filter((g) => g.sender_email === friendEmail);
}

function filterAlarmsForFriend(alarms: Alarm[]): Alarm[] {
  return alarms.filter(
    (a) => a.target_user_id && a.target_user_id !== a.user_id,
  );
}

function statusText(status: string, t: TFn): string {
  if (status === 'pending') return t('friendProfile.pending');
  if (status === 'accepted') return t('friendProfile.accepted');
  return t('friendProfile.rejected');
}

function sliceRecent<T>(items: T[], count: number): T[] {
  return items.slice(0, count);
}

function formatSinceDate(createdAt: string): Date {
  return new Date(createdAt);
}

// ---------- Tests ----------

const t: TFn = (key, params) => {
  if (params) return `${key}:${JSON.stringify(params)}`;
  return key;
};

describe('friendProfileScreen — findFriendById', () => {
  const friends: Friend[] = [
    { id: 'f1', user_a: 'u1', user_b: 'u2', friend_name: 'Alice', friend_email: 'alice@test.com', created_at: '2025-01-01', status: 'accepted' },
    { id: 'f2', user_a: 'u1', user_b: 'u3', friend_name: 'Bob', friend_email: 'bob@test.com', created_at: '2025-02-01', status: 'accepted' },
  ];

  test('finds existing friend', () => {
    expect(findFriendById(friends, 'f1')?.friend_name).toBe('Alice');
  });

  test('finds second friend', () => {
    expect(findFriendById(friends, 'f2')?.friend_name).toBe('Bob');
  });

  test('returns undefined for unknown id', () => {
    expect(findFriendById(friends, 'f99')).toBeUndefined();
  });

  test('returns undefined for empty list', () => {
    expect(findFriendById([], 'f1')).toBeUndefined();
  });
});

describe('friendProfileScreen — computeFriendName', () => {
  test('returns friend_name when available', () => {
    expect(computeFriendName({ id: '1', user_a: '', user_b: '', friend_name: 'Alice', friend_email: 'a@b.com', created_at: '', status: '' }))
      .toBe('Alice');
  });

  test('falls back to friend_email', () => {
    expect(computeFriendName({ id: '1', user_a: '', user_b: '', friend_name: null, friend_email: 'a@b.com', created_at: '', status: '' }))
      .toBe('a@b.com');
  });

  test('returns empty for both null', () => {
    expect(computeFriendName({ id: '1', user_a: '', user_b: '', friend_name: null, friend_email: null, created_at: '', status: '' }))
      .toBe('');
  });

  test('empty string name falls back to email', () => {
    expect(computeFriendName({ id: '1', user_a: '', user_b: '', friend_name: '', friend_email: 'x@y.com', created_at: '', status: '' }))
      .toBe('x@y.com');
  });
});

describe('friendProfileScreen — computeInitial', () => {
  test('uppercase first char', () => {
    expect(computeInitial('alice')).toBe('A');
  });

  test('already uppercase', () => {
    expect(computeInitial('Bob')).toBe('B');
  });

  test('Korean name', () => {
    expect(computeInitial('김철수')).toBe('김');
  });

  test('email as name', () => {
    expect(computeInitial('user@test.com')).toBe('U');
  });

  test('empty string fallback to ?', () => {
    expect(computeInitial('')).toBe('?');
  });

  test('single character', () => {
    expect(computeInitial('z')).toBe('Z');
  });
});

describe('friendProfileScreen — filterGiftsToFriend', () => {
  const friend: Friend = {
    id: 'f1', user_a: 'me', user_b: 'them',
    friend_name: 'Friend', friend_email: 'f@test.com',
    created_at: '', status: 'accepted',
  };

  const gifts: Gift[] = [
    { id: 'g1', sender_email: 'me@test.com', recipient_id: 'them', message_text: 'Hi', status: 'accepted', category: 'cheer' },
    { id: 'g2', sender_email: 'me@test.com', recipient_id: 'other', message_text: 'Hey', status: 'pending', category: 'morning' },
    { id: 'g3', sender_email: 'me@test.com', recipient_id: 'me', message_text: 'Self', status: 'accepted', category: 'love' },
  ];

  test('filters gifts matching user_b', () => {
    const result = filterGiftsToFriend(gifts, friend);
    expect(result).toHaveLength(2);
    expect(result.map((g) => g.id)).toEqual(['g1', 'g3']);
  });

  test('returns empty for no matches', () => {
    const noMatch: Friend = { ...friend, user_a: 'x', user_b: 'y' };
    expect(filterGiftsToFriend(gifts, noMatch)).toEqual([]);
  });

  test('returns empty for empty gifts', () => {
    expect(filterGiftsToFriend([], friend)).toEqual([]);
  });
});

describe('friendProfileScreen — filterGiftsFromFriend', () => {
  const gifts: Gift[] = [
    { id: 'g1', sender_email: 'f@test.com', recipient_id: 'me', message_text: 'From friend', status: 'accepted', category: 'cheer' },
    { id: 'g2', sender_email: 'other@test.com', recipient_id: 'me', message_text: 'From other', status: 'pending', category: 'morning' },
    { id: 'g3', sender_email: 'f@test.com', recipient_id: 'me', message_text: 'Another', status: 'rejected', category: 'love' },
  ];

  test('filters by friend email', () => {
    const result = filterGiftsFromFriend(gifts, 'f@test.com');
    expect(result).toHaveLength(2);
    expect(result.map((g) => g.id)).toEqual(['g1', 'g3']);
  });

  test('returns empty for non-matching email', () => {
    expect(filterGiftsFromFriend(gifts, 'nobody@test.com')).toEqual([]);
  });

  test('returns empty for empty gifts', () => {
    expect(filterGiftsFromFriend([], 'f@test.com')).toEqual([]);
  });

  test('case-sensitive email match', () => {
    expect(filterGiftsFromFriend(gifts, 'F@test.com')).toEqual([]);
  });
});

describe('friendProfileScreen — filterAlarmsForFriend', () => {
  const alarms: Alarm[] = [
    { id: 'a1', user_id: 'me', target_user_id: 'them' },
    { id: 'a2', user_id: 'me', target_user_id: null },
    { id: 'a3', user_id: 'me', target_user_id: 'me' },
    { id: 'a4', user_id: 'me', target_user_id: 'another' },
  ];

  test('filters to alarms with target_user_id different from user_id', () => {
    const result = filterAlarmsForFriend(alarms);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.id)).toEqual(['a1', 'a4']);
  });

  test('excludes null target_user_id', () => {
    const result = filterAlarmsForFriend([{ id: 'a1', user_id: 'me', target_user_id: null }]);
    expect(result).toEqual([]);
  });

  test('excludes self-targeted alarms', () => {
    const result = filterAlarmsForFriend([{ id: 'a1', user_id: 'me', target_user_id: 'me' }]);
    expect(result).toEqual([]);
  });

  test('returns empty for empty list', () => {
    expect(filterAlarmsForFriend([])).toEqual([]);
  });
});

describe('friendProfileScreen — statusText', () => {
  test('pending returns pending key', () => {
    expect(statusText('pending', t)).toBe('friendProfile.pending');
  });

  test('accepted returns accepted key', () => {
    expect(statusText('accepted', t)).toBe('friendProfile.accepted');
  });

  test('rejected returns rejected key', () => {
    expect(statusText('rejected', t)).toBe('friendProfile.rejected');
  });

  test('unknown status returns rejected fallback', () => {
    expect(statusText('unknown', t)).toBe('friendProfile.rejected');
  });

  test('empty status returns rejected fallback', () => {
    expect(statusText('', t)).toBe('friendProfile.rejected');
  });
});

describe('friendProfileScreen — sliceRecent', () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  test('slices to 5', () => {
    expect(sliceRecent(items, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  test('returns all when count exceeds length', () => {
    expect(sliceRecent(items, 20)).toEqual(items);
  });

  test('returns empty for count 0', () => {
    expect(sliceRecent(items, 0)).toEqual([]);
  });

  test('returns empty for empty list', () => {
    expect(sliceRecent([], 5)).toEqual([]);
  });

  test('returns 1 item', () => {
    expect(sliceRecent(items, 1)).toEqual([1]);
  });
});

describe('friendProfileScreen — formatSinceDate', () => {
  test('parses ISO date string', () => {
    const d = formatSinceDate('2025-06-15T10:30:00Z');
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(15);
  });

  test('parses simple date string', () => {
    const d = formatSinceDate('2024-01-01');
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(0);
  });
});

describe('friendProfileScreen — combined flow: friend profile data derivation', () => {
  const friends: Friend[] = [
    { id: 'f1', user_a: 'me', user_b: 'alice-id', friend_name: 'Alice', friend_email: 'alice@test.com', created_at: '2025-03-15', status: 'accepted' },
  ];

  const sentGifts: Gift[] = [
    { id: 'g1', sender_email: 'me@test.com', recipient_id: 'alice-id', message_text: 'Happy birthday!', status: 'accepted', category: 'love' },
    { id: 'g2', sender_email: 'me@test.com', recipient_id: 'bob-id', message_text: 'Hey', status: 'pending', category: 'cheer' },
  ];

  const receivedGifts: Gift[] = [
    { id: 'g3', sender_email: 'alice@test.com', recipient_id: 'me', message_text: 'Thank you!', status: 'accepted', category: 'cheer' },
    { id: 'g4', sender_email: 'charlie@test.com', recipient_id: 'me', message_text: 'Hello', status: 'pending', category: 'morning' },
  ];

  const alarms: Alarm[] = [
    { id: 'a1', user_id: 'me', target_user_id: 'alice-id' },
    { id: 'a2', user_id: 'me', target_user_id: null },
  ];

  test('derives complete profile data', () => {
    const friend = findFriendById(friends, 'f1')!;
    expect(friend).toBeDefined();

    const friendEmail = friend.friend_email ?? '';
    const friendName = computeFriendName(friend);
    const initial = computeInitial(friendName);

    expect(friendName).toBe('Alice');
    expect(initial).toBe('A');

    const giftsTo = filterGiftsToFriend(sentGifts, friend);
    const giftsFrom = filterGiftsFromFriend(receivedGifts, friendEmail);
    const friendAlarms = filterAlarmsForFriend(alarms);

    expect(giftsTo).toHaveLength(1);
    expect(giftsTo[0]!.message_text).toBe('Happy birthday!');

    expect(giftsFrom).toHaveLength(1);
    expect(giftsFrom[0]!.message_text).toBe('Thank you!');

    expect(friendAlarms).toHaveLength(1);
    expect(friendAlarms[0]!.id).toBe('a1');
  });

  test('derives profile data for friend with no name', () => {
    const noNameFriends: Friend[] = [
      { id: 'f2', user_a: 'me', user_b: 'bob-id', friend_name: null, friend_email: 'bob@test.com', created_at: '2025-01-01', status: 'accepted' },
    ];

    const friend = findFriendById(noNameFriends, 'f2')!;
    const friendName = computeFriendName(friend);
    const initial = computeInitial(friendName);

    expect(friendName).toBe('bob@test.com');
    expect(initial).toBe('B');
  });

  test('derives empty stats for friend with no interactions', () => {
    const lonelyFriend: Friend = {
      id: 'f3', user_a: 'me', user_b: 'lonely-id',
      friend_name: 'Lonely', friend_email: 'lonely@test.com',
      created_at: '2025-01-01', status: 'accepted',
    };

    const giftsTo = filterGiftsToFriend([], lonelyFriend);
    const giftsFrom = filterGiftsFromFriend([], 'lonely@test.com');

    expect(giftsTo).toEqual([]);
    expect(giftsFrom).toEqual([]);
  });
});

describe('friendProfileScreen — statusText for gift items', () => {
  const gifts: Gift[] = [
    { id: 'g1', sender_email: 'a@b.com', recipient_id: 'x', message_text: 't1', status: 'pending', category: 'c' },
    { id: 'g2', sender_email: 'a@b.com', recipient_id: 'x', message_text: 't2', status: 'accepted', category: 'c' },
    { id: 'g3', sender_email: 'a@b.com', recipient_id: 'x', message_text: 't3', status: 'rejected', category: 'c' },
  ];

  test('maps each gift status correctly', () => {
    const statuses = gifts.map((g) => statusText(g.status, t));
    expect(statuses).toEqual([
      'friendProfile.pending',
      'friendProfile.accepted',
      'friendProfile.rejected',
    ]);
  });
});
