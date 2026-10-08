// 워커 묶음 — MP3 인코더(`wasm-media-encoders` 의 `.wasm`)는 wrangler 규칙이 import **문자열**에 맞아야 미리 컴파일된
// 모듈로 묶인다. 어긋나면 배포 빌드가 "No loader is configured for .wasm" 로 죽거나, 묶여도 등록이 빠져 높이가 있는
// 목소리의 합성이 전부 실패한다. CI 는 배포 빌드를 돌리지 않으므로 세 자리(import·등록·규칙)가 맞는지를 글자로 고정한다.
// (실제 묶음 확인: `npx wrangler deploy --env dev --dry-run --outdir <임시 폴더>` — 업로드하지 않는다.)
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const indexSource = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const wranglerToml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

describe('MP3 인코더 묶음', () => {
  it('진입점이 .wasm 을 import 해 등록하고, wrangler 규칙이 그 import 를 CompiledWasm 으로 잡는다', () => {
    const imported = indexSource.match(/^import (\w+) from '(wasm-media-encoders\/[^']+)';$/m);
    expect(imported, 'src/index.ts 의 인코더 import').not.toBeNull();
    const [, binding, specifier] = imported!;
    expect(indexSource).toContain(`registerMp3EncoderModule(${binding});`);

    // `[[rules]]` 는 최상위에 있어야 [env.*] 로 상속된다 — 첫 환경 표보다 앞이어야 한다.
    const firstEnv = wranglerToml.search(/^\[env\./m);
    const blocks = [...wranglerToml.matchAll(/^\[\[rules\]\]\n([\s\S]*?)(?=^\[|(?![\s\S]))/gm)];
    const rule = blocks.find(
      (block) => /type\s*=\s*"CompiledWasm"/.test(block[1]!) && block[1]!.includes(`"${specifier}"`),
    );
    expect(rule, `wrangler.toml 에 "${specifier}" 를 잡는 CompiledWasm 규칙`).toBeDefined();
    expect(rule!.index!).toBeLessThan(firstEnv);
  });
});
