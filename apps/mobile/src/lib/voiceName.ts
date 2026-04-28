import type { TFunction } from 'i18next';

export interface SanitizedVoiceName {
  ok: boolean;
  value: string;
  error?: string;
}

export function sanitizeVoiceName(raw: string, t: TFunction): SanitizedVoiceName {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, value: '', error: t('voiceName.nameRequired') };
  }
  if (trimmed.length > 50) {
    return { ok: false, value: trimmed, error: t('voiceName.nameTooLong') };
  }
  return { ok: true, value: trimmed };
}
