import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { inferSynthesisLanguage } from '../../text-quality/language.ts';

describe('inferSynthesisLanguage (백엔드 사본)', () => {
  it('한글이 한 글자라도 있으면 ko', () => {
    expect(inferSynthesisLanguage('Good morning 민지')).toBe('ko');
  });
  it('한글 없이 가나가 있으면 ja, 라틴만 있으면 en', () => {
    expect(inferSynthesisLanguage('おはよう Yui')).toBe('ja');
    expect(inferSynthesisLanguage('Wake up')).toBe('en');
  });
  it('한자만·숫자만이면 fallback(지원 언어가 아니면 ko)', () => {
    expect(inferSynthesisLanguage('起床', 'ja')).toBe('ja');
    expect(inferSynthesisLanguage('7:30', 'en')).toBe('en');
    expect(inferSynthesisLanguage('7:30', 'zz')).toBe('ko');
  });

  it('백엔드 원본(voice-provider.ts)의 판정 정규식과 같다 — 원본이 바뀌면 이 사본도 고친다', () => {
    // 정규식 객체의 source 는 변환기가 \u 이스케이프를 글자로 풀어 버릴 수 있어, 두 파일의 **글자 그대로**를 견준다.
    const here = dirname(fileURLToPath(import.meta.url));
    const backend = readFileSync(
      resolve(here, '../../../backend/src/lib/voice-provider.ts'),
      'utf8',
    );
    const copy = readFileSync(resolve(here, '../../text-quality/language.ts'), 'utf8');
    const patterns = [
      String.raw`/[\uAC00-\uD7A3]/`,
      String.raw`/[\u3040-\u30FF\u31F0-\u31FF]/`,
      String.raw`/[A-Za-z]/`,
    ];
    for (const pattern of patterns) {
      expect(backend).toContain(`if (${pattern}.test(text))`);
      expect(copy).toContain(pattern);
    }
  });
});
