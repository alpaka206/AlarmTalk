import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * **가입만으로 '설정 불가능 시간' 이 생기지 않는다**(2026-08-08 규칙).
 *
 * ⚠ 이 검사가 소스 문자열을 보는 이유: 사고의 원인이 **SQLite 의 컬럼 DEFAULT** 였다.
 * `family_alarm_quiet_windows` 를 INSERT 에서 빠뜨리면 DB 가 `평일 09:00-18:30` 을 박고,
 * 그러면 아무도 설정한 적 없는 시간대에 가족 알람이 막힌다. 컬럼 DEFAULT 는 SQLite 에서
 * 바꿀 수 없어(테이블 재작성 필요 — prod 재생성 금지) INSERT 마다 명시하는 게 유일한 길이다.
 *
 * 런타임 테스트로는 못 잡는다 — 목 DB 는 컬럼 DEFAULT 를 흉내 내지 않아 그냥 통과한다.
 * 그래서 "새 INSERT 를 만들면서 빠뜨렸는가" 를 소스에서 본다.
 */
describe('가입 INSERT 는 방해금지 창을 명시한다', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../src/routes/auth.ts', import.meta.url)),
    'utf8',
  );

  it('users 로의 모든 INSERT 가 family_alarm_quiet_windows 를 포함한다', () => {
    const inserts = source.match(/INSERT INTO users \([^)]*\)/g) ?? [];
    expect(inserts.length).toBeGreaterThan(0);
    for (const stmt of inserts) {
      expect(
        stmt,
        `이 INSERT 가 컬럼을 빠뜨렸다 — DB DEFAULT(평일 09:00-18:30)가 박힌다: ${stmt}`,
      ).toContain('family_alarm_quiet_windows');
    }
  });

  it('가입 응답이 기본 창을 실어 보내지 않는다', () => {
    // 회원가입 201 응답 본문. 여기에 창을 넣으면 앱이 그걸 '설정된 값' 으로 그린다.
    expect(source).toContain('family_alarm_quiet_windows: []');
    expect(source).not.toContain(
      "family_alarm_quiet_windows: [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '18:30' }]",
    );
  });
});
