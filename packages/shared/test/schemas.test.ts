import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  EMAIL_PATTERN,
  EmailSchema,
  RegisterRequestSchema,
  LoginRequestSchema,
  DisplayNameSchema,
  clampDisplayName,
  isValidEmailFormat,
  normalizeEmail,
} from '../src/index.js';

/**
 * **세 구현이 같은 답을 내야 하는 케이스 표.**
 *
 * 같은 표가 앱에도 있다 — 안드로이드 `core/AuthEmailFormatTest.kt`, iOS
 * `AuthEmailFormatTests.swift`. 한 줄을 고치면 **셋을 같이 고친다.** 앱이 서버보다
 * 느슨하면 서버가 거절하고, 빡빡하면 서버가 허용하는 주소를 쓸 수 없다.
 */
const EMAIL_CASES: ReadonlyArray<readonly [string, boolean, string]> = [
  // ⚠ 이 줄이 이 표가 생긴 이유다. 서버는 받는데 앱 둘이 막아서, 이 주소로 가입한
  // 사람은 **로그인 자체가 불가능**했다(CLAUDE.md 의 "O'Brien 은 정당한 이름이다").
  ["o'brien@example.com", true, '아포스트로피'],
  // 반대 방향. 앱 둘은 받았지만 서버가 거절해 왔다 — 이제 앱도 같이 거절한다.
  ['user%tag@example.com', false, '퍼센트'],
  ['  KIM@Example.COM  ', true, '앞뒤 공백 + 대문자'],
  ['WITH-CAPS@DOMAIN.COM', true, '대문자'],
  ['a.b+tag@sub.example.co', true, '점·플러스·서브도메인'],
  ['no-at-sign', false, '@ 없음'],
  ['a@example.c', false, 'TLD 1글자'],
  ['@no-local.com', false, '로컬 파트 없음'],
  ['space in@local.com', false, '가운데 공백'],
  ['', false, '빈 문자열'],
];

describe('이메일 형식 규칙', () => {
  it.each(EMAIL_CASES)('%s → %s (%s)', (input, expected) => {
    expect(isValidEmailFormat(input)).toBe(expected);
  });

  // 같은 표를 스키마로도 돌린다 — 판정과 스키마가 갈라지면 앱이 통과시킨 값을
  // 서버가 거절하는 원래 사고로 되돌아간다.
  it.each(EMAIL_CASES)('스키마도 같은 답을 낸다: %s → %s (%s)', (input, expected) => {
    expect(EmailSchema.safeParse(input).success).toBe(expected);
    expect(
      LoginRequestSchema.safeParse({ email: input, password: 'any-non-empty' }).success,
    ).toBe(expected);
  });

  it('스키마가 돌려주는 값은 정규화된 값이다', () => {
    expect(EmailSchema.parse('  KIM@Example.COM  ')).toBe('kim@example.com');
    expect(normalizeEmail('  KIM@Example.COM \n')).toBe('kim@example.com');
  });

  /**
   * ⚠ **좁히면 가입자가 로그인 불가가 된다.** 지금까지 실제로 가입을 받아 온 규칙은
   * zod 의 `.email()` 기본 정규식이므로, 새 패턴은 **그것이 받던 것을 최소한 그대로
   * 받아야 한다.** 케이스를 손으로 고르면 고른 사람이 생각 못 한 글자가 빠지므로,
   * 로컬·도메인·TLD 조각을 곱해 만든 표를 통째로 대조한다.
   *
   * 조각에는 일부러 함정을 섞었다 — 점 연속·앞뒤 점·언더스코어 도메인·하이픈으로
   * 시작하는 라벨처럼, 사람이 "당연히 되겠지" 하고 넘기는 경계들이다.
   */
  it('zod 의 기본 이메일 규칙보다 좁지 않다', () => {
    const zodEmail = z.string().email();
    const locals = ['a', 'A1', "o'brien", 'a.b', 'a..b', '.a', 'a.', '_', '+', '-', '%', 'a b', "'", '', 'a+b'];
    const domains = ['example', 'ex-ample', '-example', 'example-', 'sub.example', 'ex_ample', '', 'e', 'EX'];
    const tlds = ['com', 'c', '', 'co.kr', 'CO', 'c0m', '-com', 'museum'];

    const candidates: string[] = [];
    for (const local of locals) {
      for (const domain of domains) {
        for (const tld of tlds) candidates.push(`${local}@${domain}.${tld}`);
      }
      candidates.push(local, `${local}@example.com`, `  ${local}@EXAMPLE.COM  `);
    }

    const acceptedByZod = candidates.filter((c) => zodEmail.safeParse(normalizeEmail(c)).success);
    // 표가 통째로 거절되고 있으면 이 검사는 아무것도 지키지 못한다.
    expect(acceptedByZod.length).toBeGreaterThan(50);

    const narrowed = acceptedByZod.filter((c) => !isValidEmailFormat(c));
    expect(narrowed).toEqual([]);
  });

  it('패턴 상수는 앱이 베껴 쓰는 값 그대로다', () => {
    // 앱 둘이 같은 문자열을 자기 언어로 적어 둔다. 여기서 바뀌면 앱도 같이 바꿔야
    // 하므로, 값을 못 박아 "여기만 고치고 끝" 을 막는다.
    expect(EMAIL_PATTERN).toBe(
      "^(?:[A-Za-z0-9_'+-]+\\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\\.)+[A-Za-z]{2,}$",
    );
  });
});

describe('RegisterRequestSchema', () => {
  it('accepts a well-formed registration', () => {
    const r = RegisterRequestSchema.parse({
      email: 'kim@example.com',
      password: 's3curepass!',
      name: '김규원',
      email_verification_code: '123456',
    });
    expect(r.email).toBe('kim@example.com');
  });
  it('rejects password shorter than 8 chars', () => {
    expect(() =>
      RegisterRequestSchema.parse({
        email: 'kim@example.com',
        password: 'short',
        name: 'kim',
      }),
    ).toThrow();
  });
  it('rejects password without a digit', () => {
    expect(() =>
      RegisterRequestSchema.parse({
        email: 'kim@example.com',
        password: 'onlyletters',
        name: 'kim',
        email_verification_code: '123456',
      }),
    ).toThrow();
  });
  it('rejects password without a letter', () => {
    expect(() =>
      RegisterRequestSchema.parse({
        email: 'kim@example.com',
        password: '12345678',
        name: 'kim',
        email_verification_code: '123456',
      }),
    ).toThrow();
  });
  it('rejects malformed email', () => {
    expect(() =>
      RegisterRequestSchema.parse({
        email: 'not-an-email',
        password: 's3curepass!',
        name: 'kim',
      }),
    ).toThrow();
  });
});

describe('LoginRequestSchema', () => {
  it('accepts a login payload', () => {
    const l = LoginRequestSchema.parse({
      email: 'kim@example.com',
      password: 'any-non-empty',
    });
    expect(l.password).toBe('any-non-empty');
  });
  it('rejects empty password', () => {
    expect(() => LoginRequestSchema.parse({ email: 'kim@example.com', password: '' })).toThrow();
  });

  // ⚠ **정규화가 형식 검증보다 먼저**여야 한다. 순서가 뒤집히면 앞뒤 공백 하나로
  // 로그인이 400 이 난다 — 자동완성·복사붙여넣기가 실제로 붙이는 값이다.
  it('앞뒤 공백과 대문자를 검증 전에 정규화한다', () => {
    const l = LoginRequestSchema.parse({
      email: '  KIM@Example.COM \n',
      password: 'any-non-empty',
    });
    expect(l.email).toBe('kim@example.com');
  });

  it('정규화해도 이메일이 아니면 거부한다', () => {
    expect(() =>
      LoginRequestSchema.parse({ email: '  not-an-email  ', password: 'any-non-empty' }),
    ).toThrow();
  });

  // 서버가 이메일만 지목해 답하려면(`AUTH_EMAIL_INVALID`) issue 의 path 가 email 하나뿐
  // 이어야 한다. 비밀번호까지 비어 있으면 두 개가 되고, 그때는 이메일만 고쳐도 통과하지
  // 못하므로 백엔드가 기존 `AUTH_VALIDATION_FAILED` 로 되돌아간다.
  it('이메일만 틀리면 issue 도 email 하나뿐이다', () => {
    const bad = LoginRequestSchema.safeParse({ email: 'nope', password: 'any-non-empty' });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues.map((i) => i.path.join('.'))).toEqual(['email']);

    const both = LoginRequestSchema.safeParse({ email: 'nope', password: '' });
    expect(both.error?.issues.map((i) => i.path.join('.')).sort()).toEqual(['email', 'password']);
  });
});

describe('DisplayNameSchema', () => {
  // 앱의 sanitizeDisplayName 과 같은 규칙이다. 두 쪽이 어긋나면 앱을 우회한 요청만
  // 다른 규칙을 받게 되므로, 가장 느슨한 쪽이 실질 규칙이 된다.
  it('보이지 않는 문자를 걷어낸다', () => {
    // 제로폭 공백이 낀 이름은 눈에 같아 보이는데 시스템에는 다른 값이다.
    expect(DisplayNameSchema.parse('홍\u200B길\uFEFF동')).toBe('홍길동');
    // 양방향 제어문자는 화면에 보이는 글자 순서를 뒤집는다 — 이름 스푸핑의 고전 수법.
    expect(DisplayNameSchema.parse('a\u202Eb\u202Cc')).toBe('abc');
  });

  it('줄바꿈은 지우지 않고 공백으로 바꾼다', () => {
    // 지우면 "김규원" 이 되어 원래 없던 한 단어가 만들어진다.
    expect(DisplayNameSchema.parse('김\n규원')).toBe('김 규원');
    expect(DisplayNameSchema.parse('김   규원')).toBe('김 규원');
  });

  it('정당한 문장부호는 남긴다', () => {
    // "O'Brien" 을 막는 건 주입 방어가 아니라 이름을 못 쓰게 하는 것이다.
    expect(DisplayNameSchema.parse("O'Brien; Jr.")).toBe("O'Brien; Jr.");
  });

  it('공백만인 이름과 30자 초과를 거부한다', () => {
    expect(DisplayNameSchema.safeParse('   ').success).toBe(false);
    expect(DisplayNameSchema.safeParse('\u200B\u200B').success).toBe(false);
    expect(DisplayNameSchema.safeParse('가'.repeat(30)).success).toBe(true);
    expect(DisplayNameSchema.safeParse('가'.repeat(31)).success).toBe(false);
  });

  it('가입 스키마도 같은 규칙을 쓴다', () => {
    // 예전엔 가입만 max(64)에 trim 도 없어 공백뿐인 이름이 통과했다.
    const base = {
      email: 'kim@example.com',
      password: 's3curepass!',
      email_verification_code: '123456',
    };
    expect(RegisterRequestSchema.safeParse({ ...base, name: '  ' }).success).toBe(false);
    expect(RegisterRequestSchema.safeParse({ ...base, name: '가'.repeat(31) }).success).toBe(false);
    expect(RegisterRequestSchema.parse({ ...base, name: '  김규원 ' }).name).toBe('김규원');
  });
});

describe('clampDisplayName', () => {
  it('상한을 넘으면 자르되 이모지를 반으로 가르지 않는다', () => {
    // 29자 + 이모지(서러게이트 쌍) = 31 유닛. 30 에서 그냥 자르면 앞쪽 절반만 남아
    // 깨진 문자가 DB·JWT 에 그대로 실린다.
    const name = `${'a'.repeat(29)}\u{1F600}`;
    const clamped = clampDisplayName(name);
    expect(clamped).toBe('a'.repeat(29));
    // 깨진 서러게이트가 남지 않았는지 — 코드포인트로 다시 세도 같은 길이여야 한다.
    expect([...clamped].length).toBe(clamped.length);
  });

  it('경계가 쌍 밖이면 그대로 30자까지 자른다', () => {
    expect(clampDisplayName('가'.repeat(40))).toBe('가'.repeat(30));
  });

  it('짧으면 정리만 하고 그대로 둔다', () => {
    expect(clampDisplayName('  김\u200B규원 ')).toBe('김규원');
    // 이모지로 끝나도 상한 안이면 온전히 남는다.
    expect(clampDisplayName('웃음\u{1F600}')).toBe('웃음\u{1F600}');
  });
});

describe('DisplayNameSchema — 양방향 표식', () => {
  it('삽입·격리뿐 아니라 방향 표식(ALM/LRM/RLM)도 거른다', () => {
    // U+202A~ 만 막으면 표식만으로 같은 스푸핑이 된다(Codex #672 P2).
    expect(DisplayNameSchema.parse('a\u061Cb\u200Ec\u200Fd')).toBe('abcd');
  });
});
