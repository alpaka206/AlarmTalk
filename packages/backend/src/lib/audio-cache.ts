export interface TtsCacheInput {
  provider: string;
  providerVoiceId: string;
  voiceProfileId: string;
  modelId: string;
  language: string;
  text: string;
  outputFormat: string;
  voiceSettings?: Record<string, string | number | boolean | null | undefined>;
}

export function normalizeTtsText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export async function computeTtsCacheKey(input: TtsCacheInput): Promise<string> {
  const normalized = {
    provider: input.provider,
    providerVoiceId: input.providerVoiceId,
    voiceProfileId: input.voiceProfileId,
    modelId: input.modelId,
    language: input.language,
    text: normalizeTtsText(input.text),
    outputFormat: input.outputFormat,
    voiceSettings: stableObject(input.voiceSettings ?? {}),
  };
  return sha256Hex(JSON.stringify(normalized));
}

export function generatedTtsObjectKey(userId: string, cacheKey: string, format = 'mp3'): string {
  const safeFormat = format.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'mp3';
  return `generated-tts/${encodeURIComponent(userId)}/${cacheKey}.${safeFormat}`;
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function stableObject(input: Record<string, string | number | boolean | null | undefined>) {
  return Object.keys(input)
    .sort()
    .reduce<Record<string, string | number | boolean | null>>((acc, key) => {
      const value = input[key];
      if (value !== undefined) acc[key] = value;
      return acc;
    }, {});
}
