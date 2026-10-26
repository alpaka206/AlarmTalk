// 언어 판정 — 백엔드 `inferSynthesisLanguage`(packages/backend/src/lib/voice-provider.ts)의 사본이다.
//
// 왜 가져다 쓰지 않고 베끼는가: 백엔드가 이 패키지(@alarmtalk/voice)를 쓰므로 거꾸로 백엔드를 부르면
// 의존이 돈다. 대신 `test/eval/language.test.ts` 가 백엔드 원본의 정규식 세 개가 그대로인지 읽어서
// 확인한다 — 원본을 고치면 그 테스트가 깨져 이 사본도 함께 고치게 된다.
//
// 판정 순서가 곧 규칙이다: 한글이 **한 글자라도** 있으면 ko, 없고 가나가 있으면 ja, 없고 라틴 글자가
// 있으면 en. 한자만 있는 일본어('起床')는 어느 쪽에도 안 걸려 fallback 으로 간다.

const SUPPORTED_SYNTHESIS_LANGUAGES = new Set(['ko', 'en', 'ja', 'fr', 'it']);

export const HANGUL_RE = /[\uAC00-\uD7A3]/;
export const KANA_RE = /[\u3040-\u30FF\u31F0-\u31FF]/;
export const LATIN_RE = /[A-Za-z]/;

export function normalizeSynthesisLanguage(language: string | null | undefined): string {
  const normalized = language?.trim().toLowerCase().split(/[-_]/)[0] || 'ko';
  return SUPPORTED_SYNTHESIS_LANGUAGES.has(normalized) ? normalized : 'ko';
}

export function inferSynthesisLanguage(text: string, fallback = 'ko'): string {
  if (HANGUL_RE.test(text)) return 'ko';
  if (KANA_RE.test(text)) return 'ja';
  if (LATIN_RE.test(text)) return 'en';
  return normalizeSynthesisLanguage(fallback);
}
