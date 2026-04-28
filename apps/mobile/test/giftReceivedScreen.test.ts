interface Gift {
  id: string;
  sender_name: string | null;
  sender_email: string;
  category: string;
  message_text: string;
  message_id: string;
  note: string | null;
  status: 'pending' | 'accepted' | 'rejected';
}

function statusLabel(
  status: string,
  labels: { accepted: string; rejected: string; pending: string },
): string {
  if (status === 'accepted') return labels.accepted;
  if (status === 'rejected') return labels.rejected;
  return labels.pending;
}

function isPending(gift: Gift): boolean {
  return gift.status === 'pending';
}

function isAccepted(gift: Gift): boolean {
  return gift.status === 'accepted';
}

function isRejected(gift: Gift): boolean {
  return gift.status === 'rejected';
}

function shouldShowActions(gift: Gift): boolean {
  return isPending(gift);
}

function shouldShowSetAlarm(gift: Gift): boolean {
  return isAccepted(gift);
}

function hasNote(gift: Gift): boolean {
  return !!gift.note;
}

function getSenderDisplay(gift: Gift): string {
  return gift.sender_name || '알 수 없음';
}

function applyOptimisticAccept(gifts: Gift[], id: string): Gift[] {
  return gifts.map((g) =>
    g.id === id ? { ...g, status: 'accepted' as const } : g,
  );
}

function applyOptimisticReject(gifts: Gift[], id: string): Gift[] {
  return gifts.map((g) =>
    g.id === id ? { ...g, status: 'rejected' as const } : g,
  );
}

function countByStatus(gifts: Gift[]): { pending: number; accepted: number; rejected: number } {
  return {
    pending: gifts.filter((g) => g.status === 'pending').length,
    accepted: gifts.filter((g) => g.status === 'accepted').length,
    rejected: gifts.filter((g) => g.status === 'rejected').length,
  };
}

function makeGift(overrides: Partial<Gift> = {}): Gift {
  return {
    id: 'g-1',
    sender_name: 'Alice',
    sender_email: 'alice@test.com',
    category: 'encouragement',
    message_text: '화이팅!',
    message_id: 'msg-1',
    note: null,
    status: 'pending',
    ...overrides,
  };
}

describe('GiftReceivedScreen — statusLabel', () => {
  const labels = { accepted: '수락됨', rejected: '거절됨', pending: '대기중' };

  it('returns accepted label', () => {
    expect(statusLabel('accepted', labels)).toBe('수락됨');
  });

  it('returns rejected label', () => {
    expect(statusLabel('rejected', labels)).toBe('거절됨');
  });

  it('returns pending label for pending status', () => {
    expect(statusLabel('pending', labels)).toBe('대기중');
  });

  it('returns pending label for unknown status', () => {
    expect(statusLabel('unknown', labels)).toBe('대기중');
  });
});

describe('GiftReceivedScreen — status checks', () => {
  it('isPending returns true for pending gift', () => {
    expect(isPending(makeGift({ status: 'pending' }))).toBe(true);
  });

  it('isPending returns false for accepted gift', () => {
    expect(isPending(makeGift({ status: 'accepted' }))).toBe(false);
  });

  it('isAccepted returns true for accepted gift', () => {
    expect(isAccepted(makeGift({ status: 'accepted' }))).toBe(true);
  });

  it('isRejected returns true for rejected gift', () => {
    expect(isRejected(makeGift({ status: 'rejected' }))).toBe(true);
  });
});

describe('GiftReceivedScreen — shouldShowActions', () => {
  it('shows actions for pending gift', () => {
    expect(shouldShowActions(makeGift({ status: 'pending' }))).toBe(true);
  });

  it('hides actions for accepted gift', () => {
    expect(shouldShowActions(makeGift({ status: 'accepted' }))).toBe(false);
  });

  it('hides actions for rejected gift', () => {
    expect(shouldShowActions(makeGift({ status: 'rejected' }))).toBe(false);
  });
});

describe('GiftReceivedScreen — shouldShowSetAlarm', () => {
  it('shows set alarm for accepted gift', () => {
    expect(shouldShowSetAlarm(makeGift({ status: 'accepted' }))).toBe(true);
  });

  it('hides set alarm for pending gift', () => {
    expect(shouldShowSetAlarm(makeGift({ status: 'pending' }))).toBe(false);
  });

  it('hides set alarm for rejected gift', () => {
    expect(shouldShowSetAlarm(makeGift({ status: 'rejected' }))).toBe(false);
  });
});

describe('GiftReceivedScreen — hasNote', () => {
  it('returns true when note exists', () => {
    expect(hasNote(makeGift({ note: '잘 먹어!' }))).toBe(true);
  });

  it('returns false when note is null', () => {
    expect(hasNote(makeGift({ note: null }))).toBe(false);
  });

  it('returns false when note is empty string', () => {
    expect(hasNote(makeGift({ note: '' }))).toBe(false);
  });
});

describe('GiftReceivedScreen — getSenderDisplay', () => {
  it('returns sender name when available', () => {
    expect(getSenderDisplay(makeGift({ sender_name: 'Bob' }))).toBe('Bob');
  });

  it('returns fallback when sender name is null', () => {
    expect(getSenderDisplay(makeGift({ sender_name: null }))).toBe('알 수 없음');
  });

  it('returns fallback when sender name is empty', () => {
    expect(getSenderDisplay(makeGift({ sender_name: '' }))).toBe('알 수 없음');
  });
});

describe('GiftReceivedScreen — optimistic updates', () => {
  const gifts = [
    makeGift({ id: 'g-1', status: 'pending' }),
    makeGift({ id: 'g-2', status: 'pending' }),
    makeGift({ id: 'g-3', status: 'accepted' }),
  ];

  it('optimistically accepts a gift', () => {
    const result = applyOptimisticAccept(gifts, 'g-1');
    expect(result[0]?.status).toBe('accepted');
    expect(result[1]?.status).toBe('pending');
    expect(result[2]?.status).toBe('accepted');
  });

  it('optimistically rejects a gift', () => {
    const result = applyOptimisticReject(gifts, 'g-2');
    expect(result[0]?.status).toBe('pending');
    expect(result[1]?.status).toBe('rejected');
    expect(result[2]?.status).toBe('accepted');
  });

  it('does not affect other gifts on accept', () => {
    const result = applyOptimisticAccept(gifts, 'g-1');
    expect(result.length).toBe(3);
    result.forEach((g, i) => {
      if (i !== 0) expect(g.status).toBe(gifts[i]!.status);
    });
  });

  it('handles non-existent id gracefully', () => {
    const result = applyOptimisticAccept(gifts, 'g-999');
    expect(result).toEqual(gifts);
  });
});

describe('GiftReceivedScreen — countByStatus', () => {
  it('counts each status correctly', () => {
    const gifts = [
      makeGift({ id: 'g-1', status: 'pending' }),
      makeGift({ id: 'g-2', status: 'pending' }),
      makeGift({ id: 'g-3', status: 'accepted' }),
      makeGift({ id: 'g-4', status: 'rejected' }),
    ];
    const counts = countByStatus(gifts);
    expect(counts.pending).toBe(2);
    expect(counts.accepted).toBe(1);
    expect(counts.rejected).toBe(1);
  });

  it('returns zeros for empty array', () => {
    const counts = countByStatus([]);
    expect(counts.pending).toBe(0);
    expect(counts.accepted).toBe(0);
    expect(counts.rejected).toBe(0);
  });

  it('handles all same status', () => {
    const gifts = [
      makeGift({ id: 'g-1', status: 'accepted' }),
      makeGift({ id: 'g-2', status: 'accepted' }),
    ];
    const counts = countByStatus(gifts);
    expect(counts.pending).toBe(0);
    expect(counts.accepted).toBe(2);
    expect(counts.rejected).toBe(0);
  });
});
