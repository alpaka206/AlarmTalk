import mp3EncoderWasm from 'wasm-media-encoders/wasm/mp3';
import { registerMp3EncoderModule } from '../../src/lib/voice-pitch';

/**
 * 테스트 파일마다 먼저 MP3 인코더를 등록한다(`vitest.config.ts` 의 `setupFiles`) — 워커 진입점(`src/index.ts`)이 시작할
 * 때 하는 것과 같다. 음량을 올리는 동안(`TTS_LOUDNESS_BOOST_DB` > 0)은 **모든 합성**이 PCM 을 받아 MP3 로 구우므로,
 * 등록이 없으면 합성을 지나는 테스트가 전부 'MP3 encoder module is not registered.' 로 실패한다.
 * (`.wasm` 은 `vitest.config.ts` 의 alias 가 같은 파일을 컴파일한 모듈로 바꿔 끼운다.)
 */
registerMp3EncoderModule(mp3EncoderWasm);
