/**
 * codeRegisterScreen.test.ts — business logic extracted from app/code-register/index.tsx
 */

// ---- Regex patterns (lines 22-23) ----
const VOUCHER_RE = /^VA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const INVITE_RE = /^[0-9]{6}$/;

// ---- detectCodeType (lines 27-32) ----
type DetectedType = 'voucher' | 'invite' | null;

function detectCodeType(code: string): DetectedType {
  const trimmed = code.trim().toUpperCase();
  if (VOUCHER_RE.test(trimmed)) return 'voucher';
  if (INVITE_RE.test(code.trim())) return 'invite';
  return null;
}

// ---- Error message extraction (lines 66-74) ----
class MockApiError extends Error {
  responseData: unknown;
  constructor(responseData: unknown) {
    super('API Error');
    this.responseData = responseData;
  }
}

function extractErrorMessage(
  err: unknown,
  fallback: string,
  ApiErrorClass: new (...args: unknown[]) => MockApiError,
): string | null {
  if (err instanceof ApiErrorClass) {
    const data = err.responseData as { error?: string };
    return data?.error ?? fallback;
  }
  return fallback;
}

// ============================================================
// Tests
// ============================================================

describe('VOUCHER_RE', () => {
  it('matches valid voucher code', () => {
    expect(VOUCHER_RE.test('VA-ABCD-1234-WXYZ')).toBe(true);
  });

  it('matches all-numeric segments', () => {
    expect(VOUCHER_RE.test('VA-1234-5678-9012')).toBe(true);
  });

  it('matches all-alpha segments', () => {
    expect(VOUCHER_RE.test('VA-ABCD-EFGH-IJKL')).toBe(true);
  });

  it('matches mixed alpha-numeric', () => {
    expect(VOUCHER_RE.test('VA-A1B2-C3D4-E5F6')).toBe(true);
  });

  it('rejects lowercase', () => {
    expect(VOUCHER_RE.test('VA-abcd-1234-wxyz')).toBe(false);
  });

  it('rejects missing VA- prefix', () => {
    expect(VOUCHER_RE.test('XX-ABCD-1234-WXYZ')).toBe(false);
  });

  it('rejects wrong segment length (3 chars)', () => {
    expect(VOUCHER_RE.test('VA-ABC-1234-WXYZ')).toBe(false);
  });

  it('rejects wrong segment length (5 chars)', () => {
    expect(VOUCHER_RE.test('VA-ABCDE-1234-WXYZ')).toBe(false);
  });

  it('rejects missing segments', () => {
    expect(VOUCHER_RE.test('VA-ABCD-1234')).toBe(false);
  });

  it('rejects extra segments', () => {
    expect(VOUCHER_RE.test('VA-ABCD-1234-WXYZ-EXTRA')).toBe(false);
  });

  it('rejects special characters', () => {
    expect(VOUCHER_RE.test('VA-AB!D-1234-WXYZ')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(VOUCHER_RE.test('')).toBe(false);
  });
});

describe('INVITE_RE', () => {
  it('matches 6-digit invite code', () => {
    expect(INVITE_RE.test('123456')).toBe(true);
  });

  it('matches all zeros', () => {
    expect(INVITE_RE.test('000000')).toBe(true);
  });

  it('matches all nines', () => {
    expect(INVITE_RE.test('999999')).toBe(true);
  });

  it('rejects 5-digit code', () => {
    expect(INVITE_RE.test('12345')).toBe(false);
  });

  it('rejects 7-digit code', () => {
    expect(INVITE_RE.test('1234567')).toBe(false);
  });

  it('rejects alpha characters', () => {
    expect(INVITE_RE.test('12345A')).toBe(false);
  });

  it('rejects spaces', () => {
    expect(INVITE_RE.test('123 56')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(INVITE_RE.test('')).toBe(false);
  });

  it('rejects dashes', () => {
    expect(INVITE_RE.test('123-56')).toBe(false);
  });
});

describe('detectCodeType', () => {
  describe('voucher detection', () => {
    it('detects valid voucher', () => {
      expect(detectCodeType('VA-ABCD-1234-WXYZ')).toBe('voucher');
    });

    it('detects voucher with leading/trailing spaces', () => {
      expect(detectCodeType('  VA-ABCD-1234-WXYZ  ')).toBe('voucher');
    });

    it('detects lowercase voucher (auto-uppercases)', () => {
      expect(detectCodeType('va-abcd-1234-wxyz')).toBe('voucher');
    });

    it('detects mixed-case voucher', () => {
      expect(detectCodeType('Va-AbCd-1234-WxYz')).toBe('voucher');
    });
  });

  describe('invite detection', () => {
    it('detects valid invite code', () => {
      expect(detectCodeType('123456')).toBe('invite');
    });

    it('detects invite with leading/trailing spaces', () => {
      expect(detectCodeType('  123456  ')).toBe('invite');
    });

    it('detects invite with only leading space', () => {
      expect(detectCodeType(' 123456')).toBe('invite');
    });
  });

  describe('null detection', () => {
    it('returns null for empty string', () => {
      expect(detectCodeType('')).toBe(null);
    });

    it('returns null for whitespace only', () => {
      expect(detectCodeType('   ')).toBe(null);
    });

    it('returns null for random text', () => {
      expect(detectCodeType('hello world')).toBe(null);
    });

    it('returns null for partial voucher', () => {
      expect(detectCodeType('VA-ABCD')).toBe(null);
    });

    it('returns null for 5-digit number', () => {
      expect(detectCodeType('12345')).toBe(null);
    });

    it('returns null for 7-digit number', () => {
      expect(detectCodeType('1234567')).toBe(null);
    });

    it('returns null for voucher with wrong prefix', () => {
      expect(detectCodeType('VB-ABCD-1234-WXYZ')).toBe(null);
    });
  });

  describe('priority', () => {
    it('voucher takes priority if pattern matches both (impossible in practice)', () => {
      // "VA-1234-5678-9012" is only a voucher, not a 6-digit invite
      expect(detectCodeType('VA-1234-5678-9012')).toBe('voucher');
    });
  });
});

describe('error message extraction', () => {
  it('extracts error from ApiError responseData', () => {
    const err = new MockApiError({ error: 'Code expired' });
    const msg = extractErrorMessage(err, 'Unknown error', MockApiError);
    expect(msg).toBe('Code expired');
  });

  it('uses fallback when responseData has no error field', () => {
    const err = new MockApiError({});
    const msg = extractErrorMessage(err, 'Unknown error', MockApiError);
    expect(msg).toBe('Unknown error');
  });

  it('uses fallback when responseData is null', () => {
    const err = new MockApiError(null);
    const msg = extractErrorMessage(err, 'Unknown error', MockApiError);
    expect(msg).toBe('Unknown error');
  });

  it('uses fallback when responseData.error is undefined', () => {
    const err = new MockApiError({ error: undefined });
    const msg = extractErrorMessage(err, 'Fallback', MockApiError);
    expect(msg).toBe('Fallback');
  });

  it('uses fallback for non-ApiError', () => {
    const err = new Error('network fail');
    const msg = extractErrorMessage(err, 'Unknown error', MockApiError);
    expect(msg).toBe('Unknown error');
  });

  it('uses fallback for string error', () => {
    const msg = extractErrorMessage('some string', 'Unknown error', MockApiError);
    expect(msg).toBe('Unknown error');
  });

  it('uses fallback for null error', () => {
    const msg = extractErrorMessage(null, 'Unknown error', MockApiError);
    expect(msg).toBe('Unknown error');
  });

  it('preserves server error message verbatim', () => {
    const err = new MockApiError({ error: 'invite_expired' });
    const msg = extractErrorMessage(err, 'Fallback', MockApiError);
    expect(msg).toBe('invite_expired');
  });

  it('handles responseData with extra fields', () => {
    const err = new MockApiError({ error: 'not_found', details: 'Code does not exist' });
    const msg = extractErrorMessage(err, 'Fallback', MockApiError);
    expect(msg).toBe('not_found');
  });
});

describe('button disabled logic', () => {
  function isDisabled(code: string, isPending: boolean): boolean {
    return !code.trim() || isPending;
  }

  it('disabled when code is empty', () => {
    expect(isDisabled('', false)).toBe(true);
  });

  it('disabled when code is whitespace', () => {
    expect(isDisabled('   ', false)).toBe(true);
  });

  it('disabled when mutation is pending', () => {
    expect(isDisabled('VA-ABCD-1234-WXYZ', true)).toBe(true);
  });

  it('enabled when code has value and not pending', () => {
    expect(isDisabled('VA-ABCD-1234-WXYZ', false)).toBe(false);
  });

  it('disabled when code is empty and pending', () => {
    expect(isDisabled('', true)).toBe(true);
  });
});

describe('success message branching', () => {
  function successMessage(type: 'voucher' | 'invite'): string {
    return type === 'voucher' ? 'codeRegister.voucherSuccess' : 'codeRegister.inviteSuccess';
  }

  function successDetail(type: 'voucher' | 'invite'): string {
    return type === 'voucher' ? 'codeRegister.voucherSuccessDetail' : 'codeRegister.inviteSuccessDetail';
  }

  it('returns voucher success for voucher type', () => {
    expect(successMessage('voucher')).toBe('codeRegister.voucherSuccess');
    expect(successDetail('voucher')).toBe('codeRegister.voucherSuccessDetail');
  });

  it('returns invite success for invite type', () => {
    expect(successMessage('invite')).toBe('codeRegister.inviteSuccess');
    expect(successDetail('invite')).toBe('codeRegister.inviteSuccessDetail');
  });
});
