import { describe, expect, it } from 'vitest';
import { MANUAL_TTS_TEXT_MAX_LENGTH } from '../src/index.js';

describe('MANUAL_TTS_TEXT_MAX_LENGTH', () => {
  it('직접 입력 상한은 200자다(두 앱의 입력창과 같은 값)', () => {
    expect(MANUAL_TTS_TEXT_MAX_LENGTH).toBe(200);
  });
});
