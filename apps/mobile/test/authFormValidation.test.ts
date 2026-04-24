import {
  validateEmailPasswordForm,
  type EmailPasswordFormValues,
} from '../src/lib/authFormValidation';

const base: EmailPasswordFormValues = {
  mode: 'login',
  email: 'test@example.com',
  password: 'password123',
  name: '',
};

describe('validateEmailPasswordForm', () => {
  describe('login 모드', () => {
    it('유효한 이메일+비밀번호면 null 반환', () => {
      expect(validateEmailPasswordForm(base)).toBeNull();
    });

    it('이메일이 비어있으면 에러', () => {
      expect(validateEmailPasswordForm({ ...base, email: '' })).not.toBeNull();
    });

    it('이메일이 공백만이면 에러', () => {
      expect(validateEmailPasswordForm({ ...base, email: '   ' })).not.toBeNull();
    });

    it('비밀번호가 비어있으면 에러', () => {
      expect(validateEmailPasswordForm({ ...base, password: '' })).not.toBeNull();
    });

    it('login 모드에서는 name이 비어도 통과', () => {
      expect(validateEmailPasswordForm({ ...base, name: '' })).toBeNull();
    });

    it('login 모드에서는 짧은 비밀번호도 통과', () => {
      expect(validateEmailPasswordForm({ ...base, password: '1234' })).toBeNull();
    });
  });

  describe('register 모드', () => {
    const reg: EmailPasswordFormValues = {
      mode: 'register',
      email: 'new@example.com',
      password: 'longpassword',
      name: '김테스트',
    };

    it('모든 필드 유효하면 null 반환', () => {
      expect(validateEmailPasswordForm(reg)).toBeNull();
    });

    it('name이 비어있으면 에러', () => {
      expect(validateEmailPasswordForm({ ...reg, name: '' })).not.toBeNull();
    });

    it('name이 공백만이면 에러', () => {
      expect(validateEmailPasswordForm({ ...reg, name: '   ' })).not.toBeNull();
    });

    it('비밀번호 8자 미만이면 에러', () => {
      expect(validateEmailPasswordForm({ ...reg, password: '1234567' })).not.toBeNull();
    });

    it('비밀번호 정확히 8자이면 통과', () => {
      expect(validateEmailPasswordForm({ ...reg, password: '12345678' })).toBeNull();
    });

    it('이메일이 비어있으면 에러', () => {
      expect(validateEmailPasswordForm({ ...reg, email: '' })).not.toBeNull();
    });

    it('비밀번호가 비어있으면 에러 (빈필드 우선)', () => {
      expect(validateEmailPasswordForm({ ...reg, password: '' })).not.toBeNull();
    });
  });
});
