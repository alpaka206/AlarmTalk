// 앱이 이슈 대신 브레드크럼(category `refusal`)으로 내리는 **사용자가 친 값의 예상된 거절**
// (`docs/spec/error-codes.md` §3 「앱도 같다」). 두 앱은 같은 값을 손으로 두고, 셋이 같은지는
// `scripts/check-expected-refusal-codes.py` 가 CI 에서 본다 — 여기서는 원본 목록 자체를 지킨다.
import { describe, expect, it } from 'vitest';
import {
  ALERTING_ERROR_CODES,
  CLIENT_EXPECTED_REFUSAL_CODES,
  isKnownErrorCode,
} from '../src/index.js';

describe('CLIENT_EXPECTED_REFUSAL_CODES', () => {
  // 열한 개였는데 프로모 코드 갈래 셋(CODE_EXHAUSTED·CODE_INACTIVE·CODE_NOT_IN_WINDOW)이 프로모 코드와 함께
  // 2026-10-12 에 사라졌고(App Store 3.1.1), 초대 코드 갈래 셋(CODE_EXPIRED·CODE_ALREADY_USED·
  // CODE_ALREADY_REDEEMED_BY_YOU)이 커플·가족 이용권과 함께 2026-10-20 에 사라졌다 — 서버가 더는 내지 않는 코드라
  // 목록에서도 뺐다. CODE_NOT_FOUND 는 옛 앱의 코드 등록 호환 응답이 계속 낸다.
  it('오너가 정한 다섯 개 그대로다 — 늘리거나 줄이면 두 앱과 스펙도 같이 바꾼다', () => {
    expect([...CLIENT_EXPECTED_REFUSAL_CODES].sort()).toEqual(
      [
        'AUTH_EMAIL_CODE_INVALID',
        'AUTH_EMAIL_CODE_EXPIRED',
        'AUTH_EMAIL_TAKEN',
        'AUTH_EMAIL_SOCIAL',
        'CODE_NOT_FOUND',
      ].sort(),
    );
  });

  it('전부 실재하는 코드이고 겹치지 않는다', () => {
    for (const code of CLIENT_EXPECTED_REFUSAL_CODES) {
      expect(isKnownErrorCode(code), `${code} 가 ERROR_CODES 에 없다`).toBe(true);
    }
    expect(new Set(CLIENT_EXPECTED_REFUSAL_CODES).size).toBe(CLIENT_EXPECTED_REFUSAL_CODES.length);
  });

  // 경보 목록은 '우리가 고칠 것', 이 목록은 '사용자가 고칠 것' 이다 — 한 코드가 둘 다일 수 없다. 겹치면 서버는
  // 경보로 올리는 거절을 앱은 숨긴다.
  it('경보 목록(ALERTING_ERROR_CODES)과 겹치지 않는다', () => {
    const alerting = new Set<string>(ALERTING_ERROR_CODES);
    expect(CLIENT_EXPECTED_REFUSAL_CODES.filter((code) => alerting.has(code))).toEqual([]);
  });

  // 거기 닿았다는 것은 화면이 사용자에게 시도를 다 태우게 뒀다는 뜻이다 — 고칠 것은 화면이라 이슈로 남긴다.
  // 1.2.10 의 두 묶음(같은 코드 다섯 번 제출, 낡은 등록 횟수)이 그렇게 드러났다.
  it.each(['AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED', 'VOICE_MONTHLY_CHANGE_LIMIT_REACHED'])(
    '%s 는 넣지 않는다 — 시끄럽게 둔다',
    (code) => {
      expect(isKnownErrorCode(code)).toBe(true);
      expect(CLIENT_EXPECTED_REFUSAL_CODES).not.toContain(code);
    },
  );
});
