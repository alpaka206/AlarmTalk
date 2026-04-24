import {
  INITIAL_STATE,
  sanitizeLabel,
  speakerPickerReducer,
  type SpeakerPickerState,
} from '../src/lib/speakerPickerState';
import type { TFunction } from 'i18next';

const t = ((key: string) => key) as TFunction;

const uploadMeta = {
  id: 'u1',
  objectKey: 'mem://u/x',
  mimeType: 'audio/mpeg',
  sizeBytes: 4,
  durationMs: 3000,
  originalName: 'a.mp3',
  createdAt: '2026-04-21T00:00:00Z',
};

function speaker(id: string, label: string) {
  return {
    id,
    upload_id: 'u1',
    label,
    start_ms: 0,
    end_ms: 3000,
    confidence: 0.9,
  };
}

describe('speakerPickerReducer', () => {
  it('초기 상태는 idle/빈 배열/에러 없음', () => {
    expect(INITIAL_STATE.phase).toBe('idle');
    expect(INITIAL_STATE.speakers).toHaveLength(0);
    expect(INITIAL_STATE.error).toBeNull();
  });

  it('PICK_FILE 은 파일을 설정하고 이전 에러를 비운다', () => {
    const start: SpeakerPickerState = { ...INITIAL_STATE, phase: 'error', error: '이전 실패' };
    const next = speakerPickerReducer(start, {
      type: 'PICK_FILE',
      file: { uri: 'file://a', name: 'a.mp3', type: 'audio/mpeg' },
    });
    expect(next.file?.name).toBe('a.mp3');
    expect(next.error).toBeNull();
  });

  it('UPLOAD_START → UPLOAD_SUCCESS → SEPARATE_START → READY 정상 플로우', () => {
    let s: SpeakerPickerState = INITIAL_STATE;
    s = speakerPickerReducer(s, { type: 'UPLOAD_START' });
    expect(s.phase).toBe('uploading');
    s = speakerPickerReducer(s, { type: 'UPLOAD_SUCCESS', upload: uploadMeta });
    expect(s.upload?.id).toBe('u1');
    s = speakerPickerReducer(s, { type: 'SEPARATE_START' });
    expect(s.phase).toBe('separating');
    s = speakerPickerReducer(s, {
      type: 'READY',
      speakers: [speaker('s1', '화자 1'), speaker('s2', '화자 2')],
    });
    expect(s.phase).toBe('ready');
    expect(s.speakers).toHaveLength(2);
  });

  it('FAIL 은 에러 상태로 전이하고 메시지를 저장한다', () => {
    const next = speakerPickerReducer(INITIAL_STATE, { type: 'FAIL', message: '네트워크 오류' });
    expect(next.phase).toBe('error');
    expect(next.error).toBe('네트워크 오류');
  });

  it('SELECT 는 selectedSpeakerId 를 바꾼다', () => {
    const start: SpeakerPickerState = {
      ...INITIAL_STATE,
      speakers: [speaker('s1', '화자 1')],
      phase: 'ready',
    };
    const next = speakerPickerReducer(start, { type: 'SELECT', speakerId: 's1' });
    expect(next.selectedSpeakerId).toBe('s1');
  });

  it('EDIT_BEGIN/CHANGE/CANCEL 은 editing 상태만 바꾸고 speakers 배열은 유지', () => {
    const start: SpeakerPickerState = {
      ...INITIAL_STATE,
      speakers: [speaker('s1', '화자 1')],
      phase: 'ready',
    };
    let s = speakerPickerReducer(start, { type: 'EDIT_BEGIN', speakerId: 's1', label: '화자 1' });
    expect(s.editingSpeakerId).toBe('s1');
    expect(s.draftLabel).toBe('화자 1');
    s = speakerPickerReducer(s, { type: 'EDIT_CHANGE', label: '엄마' });
    expect(s.draftLabel).toBe('엄마');
    expect(s.speakers[0]!.label).toBe('화자 1');
    s = speakerPickerReducer(s, { type: 'EDIT_CANCEL' });
    expect(s.editingSpeakerId).toBeNull();
    expect(s.draftLabel).toBe('');
  });

  it('EDIT_COMMIT 은 대상 화자 라벨만 교체한다', () => {
    const start: SpeakerPickerState = {
      ...INITIAL_STATE,
      speakers: [speaker('s1', '화자 1'), speaker('s2', '화자 2')],
      editingSpeakerId: 's1',
      draftLabel: '엄마',
      phase: 'ready',
    };
    const next = speakerPickerReducer(start, {
      type: 'EDIT_COMMIT',
      speakerId: 's1',
      label: '엄마',
    });
    expect(next.speakers[0]!.label).toBe('엄마');
    expect(next.speakers[1]!.label).toBe('화자 2');
    expect(next.editingSpeakerId).toBeNull();
  });

  it('RESET 은 초기 상태로 되돌린다', () => {
    const dirty: SpeakerPickerState = {
      ...INITIAL_STATE,
      phase: 'ready',
      speakers: [speaker('s1', '화자 1')],
      selectedSpeakerId: 's1',
    };
    expect(speakerPickerReducer(dirty, { type: 'RESET' })).toEqual(INITIAL_STATE);
  });
});

describe('sanitizeLabel', () => {
  it('앞뒤 공백을 제거한다', () => {
    expect(sanitizeLabel('  엄마  ', t)).toEqual({ ok: true, value: '엄마' });
  });

  it('빈 문자열은 거절한다', () => {
    const r = sanitizeLabel('   ', t);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('speakerPicker.labelRequired');
  });

  it('51자 이상이면 거절한다', () => {
    const r = sanitizeLabel('가'.repeat(51), t);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('speakerPicker.labelTooLong');
  });

  it('50자 정확히는 허용', () => {
    const r = sanitizeLabel('가'.repeat(50), t);
    expect(r.ok).toBe(true);
  });
});
