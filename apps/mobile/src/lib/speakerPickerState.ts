import type { TFunction } from 'i18next';
import type { SpeakerSegment, VoiceUploadMeta } from '../services/api';

export type SpeakerPickerPhase =
  | 'idle'
  | 'uploading'
  | 'separating'
  | 'ready'
  | 'error';

export interface SpeakerPickerState {
  phase: SpeakerPickerPhase;
  file: { uri: string; name: string; type: string } | null;
  upload: VoiceUploadMeta | null;
  speakers: SpeakerSegment[];
  selectedSpeakerId: string | null;
  editingSpeakerId: string | null;
  draftLabel: string;
  error: string | null;
}

export const INITIAL_STATE: SpeakerPickerState = {
  phase: 'idle',
  file: null,
  upload: null,
  speakers: [],
  selectedSpeakerId: null,
  editingSpeakerId: null,
  draftLabel: '',
  error: null,
};

export type SpeakerPickerAction =
  | { type: 'PICK_FILE'; file: { uri: string; name: string; type: string } | null }
  | { type: 'UPLOAD_START' }
  | { type: 'UPLOAD_SUCCESS'; upload: VoiceUploadMeta }
  | { type: 'SEPARATE_START' }
  | { type: 'READY'; speakers: SpeakerSegment[] }
  | { type: 'FAIL'; message: string }
  | { type: 'SELECT'; speakerId: string }
  | { type: 'EDIT_BEGIN'; speakerId: string; label: string }
  | { type: 'EDIT_CHANGE'; label: string }
  | { type: 'EDIT_CANCEL' }
  | { type: 'EDIT_COMMIT'; speakerId: string; label: string }
  | { type: 'RESET' };

export function speakerPickerReducer(
  state: SpeakerPickerState,
  action: SpeakerPickerAction,
): SpeakerPickerState {
  switch (action.type) {
    case 'PICK_FILE':
      return { ...state, file: action.file, error: null };
    case 'UPLOAD_START':
      return { ...state, phase: 'uploading', error: null };
    case 'UPLOAD_SUCCESS':
      return { ...state, upload: action.upload };
    case 'SEPARATE_START':
      return { ...state, phase: 'separating' };
    case 'READY':
      return { ...state, phase: 'ready', speakers: action.speakers, error: null };
    case 'FAIL':
      return { ...state, phase: 'error', error: action.message };
    case 'SELECT':
      return { ...state, selectedSpeakerId: action.speakerId };
    case 'EDIT_BEGIN':
      return { ...state, editingSpeakerId: action.speakerId, draftLabel: action.label };
    case 'EDIT_CHANGE':
      return { ...state, draftLabel: action.label };
    case 'EDIT_CANCEL':
      return { ...state, editingSpeakerId: null, draftLabel: '' };
    case 'EDIT_COMMIT': {
      const next = state.speakers.map((s) =>
        s.id === action.speakerId ? { ...s, label: action.label } : s,
      );
      return { ...state, speakers: next, editingSpeakerId: null, draftLabel: '' };
    }
    case 'RESET':
      return INITIAL_STATE;
    default:
      return state;
  }
}

export interface SanitizedLabel {
  ok: boolean;
  value: string;
  error?: string;
}

export function sanitizeLabel(raw: string, t: TFunction): SanitizedLabel {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, value: '', error: t('speakerPicker.labelRequired') };
  }
  if (trimmed.length > 50) {
    return { ok: false, value: trimmed, error: t('speakerPicker.labelTooLong') };
  }
  return { ok: true, value: trimmed };
}
