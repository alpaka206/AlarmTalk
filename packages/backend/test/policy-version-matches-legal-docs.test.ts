// 서버의 문서 버전(`CURRENT_POLICY_VERSION`)은 법무 문서 머리말 '정책 버전: N' 의 **사본**이다.
//
// 원본은 `docs/legal` 의 두 문서다 — 두 앱은 빌드할 때 그 줄을 읽어 `document_version` 으로 보낸다(안드로이드
// `app/build.gradle.kts` 의 `legalPolicyVersion`, iOS `scripts/generate-legal-version.sh`). 서버는 워커라 실행 중에
// 저장소 파일을 읽을 수 없어 값을 따로 적는다. 그 둘이 어긋나면 새 문서를 실은 앱의 가입·재동의가 전부
// 409 `POLICY_VERSION_MISMATCH` 로 막힌다 — 그래서 여기서 문서를 직접 읽어 비교한다(2026-10-16).
// 문서 버전을 올릴 때는 문서 머리말과 `consent.ts` 를 같이 고친다(순서는 `docs/spec/consent.md` — 서버 먼저).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { ACCEPTED_POLICY_VERSIONS, CURRENT_POLICY_VERSION } from '../src/lib/consent';

const LEGAL_DIR = join(__dirname, '../../../docs/legal');
/** 두 앱이 읽는 것과 같은 문서·같은 줄 모양이다. */
const BUNDLED_DOCS = ['privacy-policy.ko.md', 'terms-of-service.ko.md'];
const VERSION_LINE = /^정책 버전:\s*(\d+)\s*$/m;

function docVersion(name: string): string {
  const match = VERSION_LINE.exec(readFileSync(join(LEGAL_DIR, name), 'utf-8'));
  expect(match, `${name} 에 '정책 버전: N' 줄이 없다`).not.toBeNull();
  return match![1]!;
}

describe('문서 버전 — 법무 문서 머리말과 서버 상수', () => {
  it.each(BUNDLED_DOCS)('%s 의 정책 버전이 CURRENT_POLICY_VERSION 과 같다', (name) => {
    expect(docVersion(name)).toBe(CURRENT_POLICY_VERSION);
  });

  it('서버는 지금 문서 버전을 받는다', () => {
    expect(ACCEPTED_POLICY_VERSIONS).toContain(CURRENT_POLICY_VERSION);
  });
});
