import { create } from 'zustand';
import type { VibrationPattern } from '../types';

/**
 * Holds the in-progress alarm form values that need to survive navigation
 * to a sub-screen (snooze, vibration). Create / Edit screens reset() on mount,
 * read live values for display, and consume them at submit time.
 *
 * Lives outside `useAppStore` because it is screen-scoped UI state, not
 * persisted user state.
 */
export interface RawAudioSource {
  uri: string;
  durationMs: number;
  /** 'recording' (live) or 'upload' (file picker). */
  origin: 'recording' | 'upload';
  /** Original filename when origin='upload'; for recordings we synthesize one. */
  fileName: string;
  mimeType: string;
}

interface AlarmDraftState {
  snoozeMinutes: number;
  vibrationPattern: VibrationPattern;
  rawAudio: RawAudioSource | null;
  setSnoozeMinutes: (m: number) => void;
  setVibrationPattern: (p: VibrationPattern) => void;
  setRawAudio: (audio: RawAudioSource | null) => void;
  reset: (next: { snoozeMinutes: number; vibrationPattern: VibrationPattern }) => void;
}

export const useAlarmDraftStore = create<AlarmDraftState>((set) => ({
  snoozeMinutes: 5,
  vibrationPattern: 'default',
  rawAudio: null,
  setSnoozeMinutes: (snoozeMinutes) => set({ snoozeMinutes }),
  setVibrationPattern: (vibrationPattern) => set({ vibrationPattern }),
  setRawAudio: (rawAudio) => set({ rawAudio }),
  reset: (next) =>
    set({
      snoozeMinutes: next.snoozeMinutes,
      vibrationPattern: next.vibrationPattern,
      rawAudio: null,
    }),
}));
