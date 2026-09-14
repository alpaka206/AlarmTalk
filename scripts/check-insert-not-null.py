#!/usr/bin/env python3
"""INSERT 문이 NOT NULL(기본값 없음) 컬럼을 빠뜨렸는지 검사한다.

왜 필요한가 — 2026-08-18 에 **선물 결제 두 갈래가 모두** 이 이유로 실패했다.
`store_transactions.plan_key` 는 `TEXT NOT NULL`(기본값 없음)인데 애플·구글 양쪽
INSERT 가 그 컬럼을 빼먹었다. libSQL 이 INSERT 를 거절하면 `withWriteTransaction`
이 통째로 롤백돼, **스토어는 이미 결제를 받았는데 바우처가 안 나간다.**
타입체커는 SQL 문자열 안을 보지 않고, 이 경로를 태우는 테스트도 없었다.

판정 기준: `migrations.ts` 의 **마지막** `CREATE TABLE` 정의가 그 테이블의 현재
스키마다(테이블 재작성 마이그레이션이 컬럼을 nullable 로 바꾸기도 한다 —
`users.google_id` 가 실제로 그렇다). 합집합으로 보면 오탐이 난다.
"""
import re
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / 'packages/backend/src/lib/migrations.ts'
SRC = ROOT / 'packages/backend/src'

SKIP_LINE_PREFIXES = ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE', 'CHECK', 'CONSTRAINT')


def _not_null_columns(body: str) -> set[str]:
    cols: set[str] = set()
    for raw in body.split('\n'):
        line = raw.strip().rstrip(',')
        if not line or line.upper().startswith(SKIP_LINE_PREFIXES):
            continue
        parts = line.split()
        name = parts[0] if parts else ''
        if not re.fullmatch(r'\w+', name):
            continue
        upper = line.upper()
        if 'NOT NULL' in upper and 'DEFAULT' not in upper and 'PRIMARY KEY' not in upper:
            cols.add(name)
    return cols


def required_columns() -> dict[str, set[str]]:
    """테이블 → NOT NULL(기본값 없음) 컬럼.

    ⚠ **문장을 순서대로 재생해야 한다.** 스키마 변경은 `_v2`/`_v3` 테이블을 새로 만들고
    `RENAME TO` 로 갈아 끼우는 식이라, `CREATE TABLE` 만 모으면 **현재 스키마가 아니다.**
    실제로 `users.google_id` 는 처음엔 NOT NULL 이었다가 `users_new` 재작성에서 nullable
    이 됐고, `store_transactions` 는 v3 까지 두 번 갈렸다(그쪽 `plan_key` 는 여전히
    NOT NULL 이다 — 그래서 선물 INSERT 가 실제로 실패했다).
    """
    text = MIGRATIONS.read_text()
    out: dict[str, set[str]] = {}
    pattern = re.compile(
        r'CREATE TABLE (?:IF NOT EXISTS )?(?P<create>\w+)\s*\((?P<body>[^`]*?)\)`'
        r'|ALTER TABLE (?P<from>\w+) RENAME TO (?P<to>\w+)',
        re.S,
    )
    for m in pattern.finditer(text):
        if m.group('create'):
            out[m.group('create')] = _not_null_columns(m.group('body'))
        else:
            src, dst = m.group('from'), m.group('to')
            if src in out:
                out[dst] = out.pop(src)
    return out


def main() -> int:
    required = required_columns()
    violations = []
    for path in sorted(SRC.rglob('*.ts')):
        src = path.read_text()
        for m in re.finditer(r'INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)\s*\(([^)]*)\)', src, re.I | re.S):
            table, collist = m.group(1), m.group(2)
            need = required.get(table)
            if not need:
                continue
            given = {c.strip() for c in collist.split(',') if c.strip()}
            missing = need - given
            if missing:
                line = src[: m.start()].count('\n') + 1
                rel = path.relative_to(ROOT)
                violations.append(f'{rel}:{line}  {table} ← 빠진 NOT NULL 컬럼: {", ".join(sorted(missing))}')

    if violations:
        print('INSERT 문이 NOT NULL 컬럼을 빠뜨렸다 — 실행 시 트랜잭션이 통째로 롤백된다:\n')
        for v in violations:
            print('  ' + v)
        print('\n컬럼을 추가하거나, 마이그레이션에서 기본값을 주라.')
        return 1

    print(f'OK — 테이블 {len(required)}개, 위반 없음')
    return 0


if __name__ == '__main__':
    sys.exit(main())
