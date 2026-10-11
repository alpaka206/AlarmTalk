// **인증 메일 — 세 언어로, 가장 새 코드만 된다고 말한다**(스펙 session-and-auth 「메일」).
//
// 2026-10-09 prod 에서 신규 가입자 한 명이 인증 코드로 가입을 끝내지 못했다. 그때 메일은
//   - 한국어뿐이었고,
//   - 제목이 늘 같아(`AlarmTalk 이메일 인증 코드`) 다시 받은 메일이 앞 메일과 한 대화로 묶이기 쉬웠고,
//   - 새 코드를 받으면 앞의 코드가 죽는다는 말이 어디에도 없었다.
//
// 제목·본문을 만드는 일을 순수 함수로 뽑았다 — 이 파일은 그 함수만 본다(메일을 보내지 않는다).
// 맨 아래 두 테스트만 보내는 함수가 그 결과를 **그대로** 싣는지 확인하고, 그때도 `fetch` 는 대역이다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/types';
import {
  EMAIL_VERIFICATION_TTL_SECONDS,
  buildEmailVerificationMail,
  buildPasswordResetMail,
  sendEmailVerificationCode,
  sendPasswordResetCode,
} from '../src/lib/email-verification';

const CODE = '482913';
const OTHER_CODE = '070605';
const TTL_MINUTES = EMAIL_VERIFICATION_TTL_SECONDS / 60;

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** 메일 앱이 미리보기를 뽑는 재료 — 태그를 걷어낸 html 의 글자. */
function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const MAILS = [
  ['가입 인증', buildEmailVerificationMail],
  ['비밀번호 재설정', buildPasswordResetMail],
] as const;

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('인증 메일 본문 — 두 메일 공통', () => {
  it.each(MAILS)('%s: 한국어·영어·일본어가 각각 실제 수명을 말한다', (_name, build) => {
    // 숫자를 테스트에 베끼지 않는다 — TTL 을 바꾸면 메일도 따라 바뀌어야 한다.
    expect(Number.isInteger(TTL_MINUTES)).toBe(true);
    for (const body of [build(CODE).text, visibleText(build(CODE).html)]) {
      expect(body).toContain(`${TTL_MINUTES}분 안에`);
      expect(body).toContain(`within ${TTL_MINUTES} minutes`);
      expect(body).toContain(`${TTL_MINUTES}分以内`);
    }
  });

  it.each(MAILS)('%s: 세 언어가 각각 "가장 최근 코드만 된다" 고 말한다', (_name, build) => {
    for (const body of [build(CODE).text, visibleText(build(CODE).html)]) {
      expect(body).toContain('가장 최근에 받은 코드만 쓸 수 있어요');
      expect(body).toContain('Only the most recent code works');
      expect(body).toContain('最後に届いたコードだけです');
    }
  });

  it.each(MAILS)('%s: 코드는 본문에 정확히 한 번 나온다(text·html 각각)', (_name, build) => {
    const mail = build(CODE);
    expect(occurrences(mail.text, CODE)).toBe(1);
    expect(occurrences(mail.html, CODE)).toBe(1);
    // 받은 코드가 그대로 실린다 — 다른 코드를 주면 다른 본문이다.
    expect(build(OTHER_CODE).text).toContain(OTHER_CODE);
    expect(build(OTHER_CODE).text).not.toContain(CODE);
  });

  it.each(MAILS)('%s: 만드는 함수는 아무것도 보내지 않는다', (_name, build) => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    build(CODE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('가입 인증 메일 — 제목에 코드를 넣는다', () => {
  it('제목에 코드가 있다 — 알림에서 바로 읽힌다', () => {
    expect(buildEmailVerificationMail(CODE).subject).toContain(CODE);
  });

  // 같은 제목은 메일 앱이 한 대화로 묶기 쉽고, 묶이면 먼저 온(이미 죽은) 코드가 먼저 보인다.
  it('코드가 다르면 제목도 다르다 — 다시 받은 메일이 앞 메일과 같은 제목이 아니다', () => {
    expect(buildEmailVerificationMail(CODE).subject).not.toBe(
      buildEmailVerificationMail(OTHER_CODE).subject,
    );
  });

  it('제목이 세 언어로 무엇인지 말한다', () => {
    const { subject } = buildEmailVerificationMail(CODE);
    expect(subject).toContain('인증 코드');
    expect(subject).toContain('Verification code');
    expect(subject).toContain('認証コード');
  });
});

describe('비밀번호 재설정 메일 — 제목에 코드를 넣지 않는다', () => {
  // ⚠ 제목은 잠금 화면 알림에 그대로 뜬다. 재설정 코드는 비밀번호를 바꿀 권한이다 —
  // 가입 메일과 "같게 맞추자" 며 여기에 코드를 넣으면 이 테스트가 막는다.
  it('제목에 코드가 없다 — 어떤 코드를 주어도 같은 제목이고 숫자 여섯 자가 없다', () => {
    const { subject } = buildPasswordResetMail(CODE);
    expect(subject).not.toContain(CODE);
    expect(subject).toBe(buildPasswordResetMail(OTHER_CODE).subject);
    expect(subject).not.toMatch(/\d{6}/);
  });

  it('제목이 세 언어로 무엇인지 말한다', () => {
    const { subject } = buildPasswordResetMail(CODE);
    expect(subject).toContain('비밀번호 재설정');
    expect(subject).toContain('Password reset');
    expect(subject).toContain('パスワード再設定');
  });

  // 알림의 미리보기는 본문 앞머리를 함께 보여 주는 경우가 많다. 코드가 본문 첫 줄이면 제목에서
  // 뺀 것이 소용없다. 기준 길이는 메일 앱의 미리보기를 흉내 낸 어림값이다(앱마다 다르다 —
  // 이 숫자를 넘겼다고 가려진다는 보장은 아니고, "코드로 시작하지 않는다" 를 고정하는 것이다).
  it('본문이 코드로 시작하지 않는다 — 세 언어의 머리말이 코드보다 먼저다', () => {
    const PREVIEW_LENGTH = 120;
    const mail = buildPasswordResetMail(CODE);
    expect(mail.text.slice(0, PREVIEW_LENGTH)).not.toContain(CODE);
    expect(visibleText(mail.html).slice(0, PREVIEW_LENGTH)).not.toContain(CODE);
  });

  it('본인이 요청하지 않았으면 무시하라고 세 언어로 말한다', () => {
    const { text } = buildPasswordResetMail(CODE);
    expect(text).toContain('본인이 요청하지 않았다면');
    expect(text).toContain("If you didn't request this");
    expect(text).toContain('お心当たりがない場合');
  });

  it('가입 메일과 다른 메일이다', () => {
    const register = buildEmailVerificationMail(CODE);
    const reset = buildPasswordResetMail(CODE);
    expect(reset.subject).not.toBe(register.subject);
    expect(reset.text).not.toBe(register.text);
    expect(reset.html).not.toBe(register.html);
    // 가입 메일에는 '무시하라' 는 말이 없다 — 가입은 본인이 방금 누른 것이다.
    expect(register.text).not.toContain('본인이 요청하지 않았다면');
  });
});

describe('보내는 함수는 만든 메일을 그대로 싣는다', () => {
  // `fetch` 는 대역이다 — 메일 서비스로 나가는 요청은 없다. 요청 몸통만 들여다본다.
  const DELIVERY_ENV = {
    ENVIRONMENT: 'test',
    RESEND_API_KEY: 'test-resend-key',
    AUTH_EMAIL_FROM: 'AlarmTalk <no-reply@example.test>',
  } as unknown as Env;

  function stubDelivery() {
    const fetchSpy = vi.fn(async (_url: string, _init: { body: string }) => new Response('{}'));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    return () => JSON.parse(fetchSpy.mock.calls[0]![1].body) as Record<string, unknown>;
  }

  it('가입 인증: 제목·text·html 이 buildEmailVerificationMail 의 것이다', async () => {
    const sentBody = stubDelivery();
    await sendEmailVerificationCode(DELIVERY_ENV, 'kim@example.test', CODE);
    expect(sentBody()).toMatchObject({
      to: ['kim@example.test'],
      ...buildEmailVerificationMail(CODE),
    });
  });

  it('비밀번호 재설정: 제목·text·html 이 buildPasswordResetMail 의 것이다 — 제목에 코드가 없다', async () => {
    const sentBody = stubDelivery();
    await sendPasswordResetCode(DELIVERY_ENV, 'kim@example.test', CODE);
    const body = sentBody();
    expect(body).toMatchObject({ to: ['kim@example.test'], ...buildPasswordResetMail(CODE) });
    expect(String(body.subject)).not.toContain(CODE);
  });
});
