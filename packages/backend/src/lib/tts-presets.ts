import type { Env } from '../types';
import { PRESETS } from '../data/presets';
import { getDB } from './db';

export type TtsPreset = {
  category: string;
  label?: string;
  emoji?: string;
  messages: string[];
};

type PresetRow = {
  category: string;
  label: string;
  emoji: string | null;
  messages_json: string;
};

const FALLBACK_PRESETS: TtsPreset[] = PRESETS.map((preset) => ({
  category: preset.category,
  label: preset.label,
  emoji: preset.emoji,
  messages: [...preset.messages],
}));

export async function loadTtsPresets(env?: Env): Promise<TtsPreset[]> {
  if (!env?.TURSO_DATABASE_URL) return FALLBACK_PRESETS;

  try {
    const result = await getDB(env).execute({
      sql: `SELECT category, label, emoji, messages_json
            FROM tts_presets
            WHERE enabled = 1
            ORDER BY sort_order ASC, category ASC`,
      args: [],
    });
    const presets = result.rows
      .map((row) => parsePresetRow(row as unknown as PresetRow))
      .filter((preset): preset is TtsPreset => preset != null);

    return presets.length > 0 ? presets : FALLBACK_PRESETS;
  } catch {
    return FALLBACK_PRESETS;
  }
}

function parsePresetRow(row: PresetRow): TtsPreset | null {
  try {
    const messages = JSON.parse(row.messages_json) as unknown;
    if (!Array.isArray(messages)) return null;
    const cleanMessages = messages
      .filter((message): message is string => typeof message === 'string')
      .map((message) => message.trim())
      .filter(Boolean);
    if (cleanMessages.length === 0) return null;

    return {
      category: row.category,
      label: row.label,
      emoji: row.emoji ?? undefined,
      messages: cleanMessages,
    };
  } catch {
    return null;
  }
}
