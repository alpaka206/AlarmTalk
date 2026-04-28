import type { TFunction } from 'i18next';

export type AuthMode = 'login' | 'register';

export interface EmailPasswordFormValues {
  mode: AuthMode;
  email: string;
  password: string;
  name: string;
}

export function validateEmailPasswordForm(values: EmailPasswordFormValues, t: TFunction): string | null {
  const { mode, email, password, name } = values;
  if (!email.trim() || !password) return t('authForm.allFieldsRequired');
  if (mode === 'register' && !name.trim()) return t('authForm.allFieldsRequired');
  if (mode === 'register' && password.length < 8) return t('authForm.passwordMinLength');
  return null;
}
