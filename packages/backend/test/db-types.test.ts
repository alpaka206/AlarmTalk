import { describe, expect, it } from 'vitest';
import { typedRow, getFormFile } from '../src/lib/db-types';
import type { Row } from '@libsql/client/web';

function makeRow(data: Record<string, unknown>): Row {
  const entries = Object.entries(data);
  const row: Record<string | number, unknown> = { length: entries.length };
  entries.forEach(([key, value], idx) => {
    row[key] = value;
    row[idx] = value;
  });
  return row as unknown as Row;
}

describe('typedRow', () => {
  it('returns typed object from Row', () => {
    const row = makeRow({ id: 'abc', email: 'a@b.com', plan: 'free' });
    const typed = typedRow<{ id: string; email: string; plan: string }>(row);
    expect(typed.id).toBe('abc');
    expect(typed.email).toBe('a@b.com');
    expect(typed.plan).toBe('free');
  });

  it('preserves null values', () => {
    const row = makeRow({ name: null, plan: null });
    const typed = typedRow<{ name: string | null; plan: string | null }>(row);
    expect(typed.name).toBeNull();
    expect(typed.plan).toBeNull();
  });

  it('preserves numeric values', () => {
    const row = makeRow({ count: 42, total: 0 });
    const typed = typedRow<{ count: number; total: number }>(row);
    expect(typed.count).toBe(42);
    expect(typed.total).toBe(0);
  });

  it('works with empty row', () => {
    const row = makeRow({});
    const typed = typedRow<Record<string, unknown>>(row);
    expect(typed).toBeDefined();
  });
});

describe('getFormFile', () => {
  it('returns File when entry is a File', () => {
    const file = new File(['audio-data'], 'test.mp3', { type: 'audio/mpeg' });
    const formData = new FormData();
    formData.append('audio', file);

    const result = getFormFile(formData, 'audio');
    expect(result).toBeInstanceOf(File);
    expect(result!.name).toBe('test.mp3');
    expect(result!.type).toBe('audio/mpeg');
  });

  it('returns null when key does not exist', () => {
    const formData = new FormData();
    expect(getFormFile(formData, 'audio')).toBeNull();
  });

  it('returns null when entry is a string', () => {
    const formData = new FormData();
    formData.append('audio', 'not-a-file');
    expect(getFormFile(formData, 'audio')).toBeNull();
  });

  it('returns null for empty string entry', () => {
    const formData = new FormData();
    formData.append('audio', '');
    expect(getFormFile(formData, 'audio')).toBeNull();
  });

  it('returns File for zero-byte file', () => {
    const file = new File([], 'empty.wav', { type: 'audio/wav' });
    const formData = new FormData();
    formData.append('audio', file);

    const result = getFormFile(formData, 'audio');
    expect(result).toBeInstanceOf(File);
    expect(result!.size).toBe(0);
  });

  it('retrieves correct file among multiple fields', () => {
    const audio = new File(['a'], 'audio.mp3', { type: 'audio/mpeg' });
    const image = new File(['i'], 'photo.png', { type: 'image/png' });
    const formData = new FormData();
    formData.append('audio', audio);
    formData.append('image', image);

    const result = getFormFile(formData, 'audio');
    expect(result!.name).toBe('audio.mp3');

    const imgResult = getFormFile(formData, 'image');
    expect(imgResult!.name).toBe('photo.png');
  });
});
