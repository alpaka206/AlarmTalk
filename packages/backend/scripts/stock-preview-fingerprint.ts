/**
 * **시청본이 지금 카탈로그로 구워진 것인가.**
 *
 * ⚠ 파일이 있다는 것만으로 최신이라고 보면 안 된다(2026-09-03 리뷰 15차). 파일 이름은
 *   `<카테고리>_<변형>.mp3` 라 **대사가 바뀌어도 그대로**고, 목소리를 갈아도 그대로다.
 *   실제로 이 작업 중에 그 함정을 밟았다 — `withClosingBreath` 를 빼먹고 구운 80개와
 *   붙여서 구운 160개가 **같은 이름으로 섞였고**, 바이트 크기로는 구분되지 않았다
 *   (v3 는 매번 다르게 합성한다). 그대로 게시했으면 사람이 들어 본 소리와 다른 것이
 *   프로덕션에 올라갔을 것이다.
 *
 * 그래서 굽는 순간 **합성 입력의 지문**을 남기고, 다음 실행이 그 지문으로 판정한다.
 * 하나라도 달라지면(대사·목소리·모델·voice_settings·출력 형식·후처리 파이프라인)
 * 지문이 갈라져 다시 굽는다.
 *
 * 게시 스크립트도 같은 지문을 본다 — **들어 본 것과 다른 바이트를 올리지 않기 위해서다.**
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/**
 * 후처리 파이프라인의 세대. `withClosingBreath`·`appendMp3TrailingSilence` 처럼
 * **바이트를 바꾸는 단계**를 더하거나 빼면 이 값을 올린다 — 대사가 그대로여도 소리가
 * 달라지므로 지문이 갈라져야 한다.
 */
const PIPELINE_VERSION = 'closing-breath+mp3-silence@1';

const FINGERPRINT_FILE = '_fingerprints.json';

export interface FingerprintInput {
  providerVoiceId: string;
  modelId: string;
  outputFormat: string;
  voiceSettings: Record<string, number | boolean>;
  /** 제공자에게 실제로 보내는 글자(여운 꼬리 포함). */
  providerText: string;
}

/** `<언어>/<목소리>/<파일명>` — 지문 표의 키. */
export function fingerprintKey(language: string, voiceName: string, fileName: string): string {
  return `${language}/${voiceName}/${fileName}`;
}

export function computeFingerprint(input: FingerprintInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        pipeline: PIPELINE_VERSION,
        providerVoiceId: input.providerVoiceId,
        modelId: input.modelId,
        outputFormat: input.outputFormat,
        // 키 순서가 흔들리면 지문이 이유 없이 갈라진다 — 정렬해서 넣는다.
        voiceSettings: Object.fromEntries(
          Object.entries(input.voiceSettings).sort(([a], [b]) => a.localeCompare(b)),
        ),
        providerText: input.providerText,
      }),
    )
    .digest('hex');
}

export function loadFingerprints(outRoot: string): Record<string, string> {
  const path = resolve(outRoot, FINGERPRINT_FILE);
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, string>;
  } catch {
    // 깨진 표는 **없는 것으로 친다** — 그러면 전부 다시 굽는다. 반대로 살려 쓰면
    // 낡은 소리를 최신이라고 읽을 수 있고, 그게 이 파일이 막으려는 사고다.
    return {};
  }
}

export function saveFingerprints(outRoot: string, table: Record<string, string>): void {
  const sorted = Object.fromEntries(Object.entries(table).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(resolve(outRoot, FINGERPRINT_FILE), `${JSON.stringify(sorted, null, 2)}\n`, 'utf-8');
}
