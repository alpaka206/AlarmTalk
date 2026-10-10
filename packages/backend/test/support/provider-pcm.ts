/**
 * ElevenLabs `pcm_44100` 이 주는 모양의 가짜 소리 — 16-bit 리틀엔디언 모노, 44.1 kHz, 160 Hz 와 그 배음(320 Hz).
 * 봉우리는 [scale] 의 약 1.3배다(기본 0.4 → ≈0.52).
 *
 * 음량을 올리는 동안(`TTS_LOUDNESS_BOOST_DB` > 0)은 **모든 합성**이 PCM 을 받아 굽는다(`createSynthesisAttempts`) —
 * 합성을 지나는 테스트의 가짜 응답은 이 모양이어야 한다. 1바이트 같은 값은 홀수 길이라 굽기가 던진다.
 */
export function tonePcm(seconds = 1, scale = 0.4): Uint8Array {
  const sr = 44_100;
  const count = Math.round(sr * seconds);
  const out = new Uint8Array(count * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < count; i++) {
    const t = i / sr;
    const v = scale * (Math.sin(2 * Math.PI * 160 * t) + 0.5 * Math.sin(2 * Math.PI * 320 * t));
    view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, v)) * 32767), true);
  }
  return out;
}

/** MPEG 오디오 프레임 동기(11비트 1) — LAME 출력은 프레임으로 바로 시작한다. */
export function looksLikeMp3(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
}
