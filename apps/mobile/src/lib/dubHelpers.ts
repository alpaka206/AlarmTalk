import type { DubLanguage } from '../types';

export interface SourceLanguage {
  code: string;
  name: string;
}

export const SOURCE_LANGUAGES: readonly SourceLanguage[] = [
  { code: 'ko', name: '한국어' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'zh', name: '中文' },
] as const;

export function filterTargetLanguages(
  languages: DubLanguage[] | undefined,
  sourceLanguage: string,
): DubLanguage[] {
  return languages?.filter((l) => l.code !== sourceLanguage) ?? [];
}

export function validateDubStart(
  targetLanguage: string,
  sourceLanguage: string,
): 'selectLanguage' | 'sameLanguage' | null {
  if (!targetLanguage) return 'selectLanguage';
  if (sourceLanguage === targetLanguage) return 'sameLanguage';
  return null;
}

export type DubPhase = 'idle' | 'processing' | 'ready' | 'failed';

export function getDubPhase(dubStatus: string | null, isPending: boolean): DubPhase {
  if (dubStatus === 'ready') return 'ready';
  if (dubStatus === 'failed') return 'failed';
  if (dubStatus === 'processing' || isPending) return 'processing';
  return 'idle';
}

export function shouldSaveAudio(result: {
  audio_base64?: string | null;
  result_message_id?: string | null;
}): boolean {
  return Boolean(result.audio_base64 && result.result_message_id);
}
