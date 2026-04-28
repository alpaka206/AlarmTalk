import { validateEmailPasswordForm } from '../src/lib/authFormValidation';
import type { TFunction } from 'i18next';

const t = ((key: string) => key) as TFunction;

describe('validateEmailPasswordForm', () => {
  it('로그인: 이메일/비밀번호 모두 있으면 null', () => {
    expect(
      validateEmailPasswordForm({
        mode: 'login',
        email: 'a@b.com',
        password: 'anything',
        name: '',
      }, t),
    ).toBeNull();
  });

  it('로그인: 이메일 공백이면 allFieldsRequired 에러', () => {
    expect(
      validateEmailPasswordForm({
        mode: 'login',
        email: '   ',
        password: 'pw',
        name: '',
      }, t),
    ).toBe('authForm.allFieldsRequired');
  });

  it('로그인: 비밀번호 누락이면 에러', () => {
    expect(
      validateEmailPasswordForm({
        mode: 'login',
        email: 'a@b.com',
        password: '',
        name: '',
      }, t),
    ).toBe('authForm.allFieldsRequired');
  });

  it('가입: 이름 누락이면 에러', () => {
    expect(
      validateEmailPasswordForm({
        mode: 'register',
        email: 'a@b.com',
        password: 'superSecret1',
        name: '',
      }, t),
    ).toBe('authForm.allFieldsRequired');
  });

  it('가입: 비밀번호가 8자 미만이면 passwordMinLength 에러', () => {
    expect(
      validateEmailPasswordForm({
        mode: 'register',
        email: 'a@b.com',
        password: 'short',
        name: '홍길동',
      }, t),
    ).toBe('authForm.passwordMinLength');
  });

  it('가입: 이메일·비번(8자 이상)·이름 모두 있으면 null', () => {
    expect(
      validateEmailPasswordForm({
        mode: 'register',
        email: 'a@b.com',
        password: 'eightchars1',
        name: '홍길동',
      }, t),
    ).toBeNull();
  });

  it('로그인 모드에서는 비밀번호 길이 제한을 걸지 않는다', () => {
    expect(
      validateEmailPasswordForm({
        mode: 'login',
        email: 'a@b.com',
        password: 'pw',
        name: '',
      }, t),
    ).toBeNull();
  });
});
