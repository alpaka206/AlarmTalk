// `.wasm` 정적 import 의 타입 — wrangler 가 `WebAssembly.Module` 로 묶는다(`src/index.ts`).
declare module 'wasm-media-encoders/wasm/mp3' {
  const module: WebAssembly.Module;
  export default module;
}
