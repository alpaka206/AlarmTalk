import type { Row } from '@libsql/client/web';

/**
 * Turso Row → typed object. Centralises the double-assertion that Row's
 * index-signature (`[name: string]: Value`) otherwise requires.
 */
export function typedRow<T extends Record<string, unknown>>(row: Row): T {
  return row as unknown as T;
}

export function getFormFile(formData: FormData, name: string): File | null {
  const entry = formData.get(name);
  if (!entry || typeof entry === 'string') return null;
  return entry;
}
