import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * 워커에서는 wrangler 가 `wasm-media-encoders/wasm/mp3` 를 미리 컴파일된 `WebAssembly.Module` 로 묶는다(`src/index.ts`).
 * Node(vitest)는 `.wasm` 을 import 하지 못하므로 `vitest.config.ts` 의 alias 가 이 파일로 바꿔 끼운다 — 같은 파일을
 * 읽어 컴파일한다.
 */
const require = createRequire(import.meta.url);
// 패키지가 내보내는 경로(`./wasm/mp3` → `wasm/mp3.wasm`)를 Node 해석기로 찾는다 — 워커와 같은 파일이다.
const mp3EncoderWasm = new WebAssembly.Module(readFileSync(require.resolve('wasm-media-encoders/wasm/mp3')));
export default mp3EncoderWasm;
