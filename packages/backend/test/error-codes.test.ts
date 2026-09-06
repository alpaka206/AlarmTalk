import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ERROR_CODES, ALERTING_ERROR_CODES, isKnownErrorCode } from '@alarmtalk/shared';

const SRC = join(import.meta.dirname, '..', 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

/** `error_code: 'X'` 로 적힌 리터럴을 전부 모은다(파일:줄 과 함께). */
function collectLiterals(): { file: string; line: number; code: string }[] {
  const out: { file: string; line: number; code: string }[] = [];
  for (const file of walk(SRC)) {
    // 목록 자체와 그것을 소비하는 헬퍼는 검사 대상이 아니다.
    if (file.endsWith(join('lib', 'api-error.ts'))) continue;
    if (file.endsWith(join('middleware', 'errorCode.ts'))) continue;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((text, index) => {
        // `error_code: 'X'` 와 `errorBody('X', ...)` — 코드가 리터럴로 적히는 두 형태.
        for (const m of text.matchAll(/(?:error_code:\s*|errorBody\(\s*)'([^']+)'/g)) {
          out.push({ file: file.slice(SRC.length + 1), line: index + 1, code: m[1] });
        }
        // 코드를 담아 돌려주는 판정 헬퍼(`{ ok: false, code: 'X' }`).
        for (const m of text.matchAll(/\bcode:\s*'([A-Z][A-Z0-9_]+)'/g)) {
          out.push({ file: file.slice(SRC.length + 1), line: index + 1, code: m[1] });
        }
      });
  }
  return out;
}

describe('에러 코드 목록', () => {
  it('코드가 겹치지 않는다', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it('경보 목록은 전부 실재하는 코드다', () => {
    // ⚠ 여기가 어긋나면 **아무 경보도 오지 않는다** — 오탈자는 조용히 매칭에 실패할 뿐이다.
    for (const code of ALERTING_ERROR_CODES) {
      expect(isKnownErrorCode(code), `${code} 가 ERROR_CODES 에 없다`).toBe(true);
    }
  });

  it('라우트가 내보내는 코드는 전부 목록에 있다', () => {
    // ⚠ 이 검사가 이 규약의 **유일한 강제 수단**이다. `error_code: 'FOO'` 는 그냥 문자열이라
    //   오타를 내도 컴파일이 통과하고, 그 코드로 분기하던 앱만 조용히 폴백으로 떨어진다.
    const unknown = collectLiterals().filter((x) => !isKnownErrorCode(x.code));
    expect(
      unknown.map((x) => `${x.file}:${x.line} ${x.code}`),
      '새 코드는 packages/shared/src/schemas/error-codes.ts 에 먼저 추가한다',
    ).toEqual([]);
  });

  it('목록에 있지만 아무 데서도 안 쓰는 코드는 없다', () => {
    // 사장된 코드는 앱의 문구 표만 부풀린다. 라우트에서 지웠으면 목록에서도 지운다.
    //
    // ⚠ 여기서는 **넓게** 훑는다 — `new RedemptionError('CODE_EXPIRED', …)` 나 삼항으로
    //   고르는 자리처럼 `error_code:` 라고 적히지 않는 형태가 많다. 위의 '모르는 코드'
    //   검사는 좁게 봐야 하지만(관계없는 대문자 상수까지 걸린다), 사용 여부는 넓게 본다.
    const used = new Set<string>();
    for (const file of walk(SRC)) {
      for (const m of readFileSync(file, 'utf8').matchAll(/'([A-Z][A-Z0-9_]{2,})'/g)) {
        if (isKnownErrorCode(m[1])) used.add(m[1]);
      }
    }
    // 미들웨어·전역 핸들러가 내는 코드는 리터럴이 아닌 자리에도 있어 예외로 둔다.
    const emittedElsewhere = new Set(['INTERNAL_ERROR']);
    const unused = ERROR_CODES.filter((c) => !used.has(c) && !emittedElsewhere.has(c));
    expect(unused).toEqual([]);
  });
});

/**
 * 본문을 리터럴이 아닌 방식으로 넘기는 자리들. 전부 자기 안에 `error_code` 를 담는다.
 * 새 헬퍼를 만들면 여기에 적어야 검사를 통과한다 — 그때 "이 헬퍼가 코드를 담는가" 를 본다.
 */
const KNOWN_INDIRECTIONS = [
  /^errorBody\(/, //                        auth.ts — 상태만 갈래별로 다른 자리
  /^fieldError\s*,/, //                     alarm-mutation.ts — validateAlarmFields 의 결과
  /^checkoutDisabledResponse\(\)\s*,/, //    billing-mutation.ts
  /^\{\s*\.\.\./, //                       voice-profile.ts — 공용 거절 상수를 편 것
];

describe('에러 응답', () => {
  it('4xx/5xx 응답에는 반드시 error_code 가 있다', () => {
    // 코드 없는 에러는 앱이 문구를 고를 수 없고, 우리도 무엇이 얼마나 나갔는지 셀 수 없다.
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(/c\.json\(/g)) {
        let i = m.index + m[0].length;
        let depth = 1;
        while (i < source.length && depth > 0) {
          if (source[i] === '(') depth++;
          else if (source[i] === ')') depth--;
          i++;
        }
        const body = source.slice(m.index + m[0].length, i - 1).trim();
        const status = /,\s*(\d{3})\s*(?:as\s+[A-Za-z]+)?\s*,?\s*$/.exec(body);
        if (!status || Number(status[1]) < 400) continue;
        if (body.includes('error_code')) continue;
        // 본문을 **헬퍼·상수로 만들어** 넘기는 자리. 그 헬퍼가 코드를 담고 있고, 위의
        // '리터럴은 전부 목록에 있다' 검사가 그 안쪽을 이미 본다.
        // ⚠ 목록으로 둔 이유: 새 우회 헬퍼가 생기면 여기서 걸려 **한 번 더 생각하게** 한다.
        if (KNOWN_INDIRECTIONS.some((re) => re.test(body))) continue;
        const line = source.slice(0, m.index).split('\n').length;
        offenders.push(`${file.slice(SRC.length + 1)}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
