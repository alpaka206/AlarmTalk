/**
 * Perso(ESTsoft) 음성 합성 — 랜딩 이벤트의 **이름 클립** 전용.
 *
 * 이벤트 페이지는 문장 전체를 만들지 않는다. 본문("생일 축하해! …")은 랜딩의 정적 파일이고,
 * 서버가 만드는 것은 앞에 붙는 이름 한 마디("지민아")뿐이다(`routes/event.ts`).
 *
 * ⚠ 요청·응답 모양은 **가정**이다(2026-09-15, 문서 미확인). 실제 계약이 확인되면 이 파일의
 * `synthesizeName` 만 고친다 — 라우트·캐시·랜딩은 "텍스트 → 오디오 바이트" 만 안다.
 *   가정: POST {PERSO_TTS_URL}  Authorization: Bearer {PERSO_API_KEY}
 *         body { text, voice_id, language }  →  audio/* 바이트(mp3)
 */
export type PersoConfig = {
  apiKey: string;
  ttsUrl: string;
  /** 인물 id → Perso 목소리 id. `PERSO_VOICE_IDS` (JSON) 에서 읽는다. */
  voiceIds: Record<string, string>;
};

/** 셋 다 있어야 켜진다. 하나라도 없으면 null — 라우트는 503 으로 닫힌다. */
export function readPersoConfig(env: {
  PERSO_API_KEY?: string;
  PERSO_TTS_URL?: string;
  PERSO_VOICE_IDS?: string;
}): PersoConfig | null {
  if (!env.PERSO_API_KEY || !env.PERSO_TTS_URL || !env.PERSO_VOICE_IDS) return null;
  let voiceIds: Record<string, string>;
  try {
    const parsed: unknown = JSON.parse(env.PERSO_VOICE_IDS);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    voiceIds = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v) voiceIds[k] = v;
    }
  } catch {
    return null;
  }
  return { apiKey: env.PERSO_API_KEY, ttsUrl: env.PERSO_TTS_URL, voiceIds };
}

export type SynthesizedClip = { bytes: Uint8Array; mimeType: string };

export async function synthesizeName(
  config: PersoConfig,
  input: { voiceId: string; text: string; locale: string },
): Promise<SynthesizedClip> {
  const res = await fetch(config.ttsUrl, {
    method: 'POST',
    signal: AbortSignal.timeout(20_000),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
      accept: 'audio/mpeg',
    },
    body: JSON.stringify({ text: input.text, voice_id: input.voiceId, language: input.locale }),
  });
  if (!res.ok) {
    // 본문은 로그에만(키·내부 정보가 섞일 수 있다). 호출자는 502 로 닫는다.
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`Perso ${res.status}: ${detail}`);
  }
  const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'audio/mpeg';
  if (!mimeType.startsWith('audio/')) {
    throw new Error(`Perso returned ${mimeType}, not audio`);
  }
  return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType };
}
