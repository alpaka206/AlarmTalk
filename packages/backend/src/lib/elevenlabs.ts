const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io';
const DEFAULT_TTS_MODEL_ID = 'eleven_v3';
const DEFAULT_AUDIO_MIME_TYPE = 'audio/wav';

type AudioUploadOptions = {
  mimeType?: string | null;
  fileName?: string | null;
};

export class ElevenLabsClient {
  constructor(private apiKey: string) {}

  private async request(path: string, options: RequestInit = {}) {
    const url = `${ELEVENLABS_BASE_URL}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'xi-api-key': this.apiKey,
        ...options.headers,
      },
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`ElevenLabs API error ${res.status}: ${errorBody}`);
    }

    return res;
  }

  /** Instant Voice Clone - 짧은 샘플로 즉시 음성 클론 */
  async createInstantClone(
    audioData: ArrayBuffer,
    name: string,
    options?: AudioUploadOptions & { removeBackgroundNoise?: boolean },
  ): Promise<{ voice_id: string }> {
    const formData = new FormData();
    const mimeType = normalizeAudioMimeType(options?.mimeType);
    formData.append(
      'files',
      new Blob([audioData], { type: mimeType }),
      normalizeAudioFileName(options?.fileName, 'sample', mimeType),
    );
    formData.append('name', name);
    if (options?.removeBackgroundNoise) {
      formData.append('remove_background_noise', 'true');
    }

    const res = await fetch(`${ELEVENLABS_BASE_URL}/v1/voices/add`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
      },
      body: formData,
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`ElevenLabs clone error ${res.status}: ${errorBody}`);
    }

    return res.json();
  }

  /** TTS - 텍스트를 음성으로 변환 */
  async textToSpeech(
    voiceId: string,
    text: string,
    options?: {
      stability?: number;
      similarity_boost?: number;
      style?: number;
      speed?: number;
      use_speaker_boost?: boolean;
      model_id?: string;
      language_code?: string;
    },
  ): Promise<ArrayBuffer> {
    const modelId = options?.model_id ?? DEFAULT_TTS_MODEL_ID;
    const body: Record<string, unknown> = {
      text,
      model_id: modelId,
    };
    if (options?.language_code) {
      body.language_code = options.language_code;
    }

    // v3(eleven_v3)는 우리의 유일한 운영 모델이다. 과거에는 `modelId !== DEFAULT_TTS_MODEL_ID`
    // 라는 역조건 때문에 v3에는 voice_settings를 아예 보내지 않아 서버 디폴트가 적용됐고,
    // 그 결과 delivery 태그가 약하게 실현됐다(검증된 버그). 이제 모델과 무관하게 항상 전송한다.
    // 기본값: stability 0.5(Natural), similarity_boost 0.8, style 0.4, speed 1.0(sleep 0.95),
    // use_speaker_boost true. Robust(0.7+) 안정도는 태그를 억제하므로 쓰지 않는다.
    const voiceSettings: Record<string, number | boolean> = {
      stability: options?.stability ?? 0.5,
      similarity_boost: options?.similarity_boost ?? 0.8,
      style: options?.style ?? 0.4,
      speed: options?.speed ?? 1.0,
      use_speaker_boost: options?.use_speaker_boost ?? true,
    };
    body.voice_settings = voiceSettings;

    const res = await this.request(`/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify(body),
    });

    return res.arrayBuffer();
  }

  /** 음성 프로필 삭제 */
  async deleteVoice(voiceId: string): Promise<void> {
    await this.request(`/v1/voices/${voiceId}`, { method: 'DELETE' });
  }

  /** 사용 가능한 음성 목록 */
  async listVoices(): Promise<{ voices: Array<{ voice_id: string; name: string }> }> {
    const res = await this.request('/v1/voices');
    return res.json();
  }
}

function normalizeAudioMimeType(mimeType: string | null | undefined): string {
  const normalized = mimeType?.split(';')[0]?.trim().toLowerCase();
  return normalized?.startsWith('audio/') ? normalized : DEFAULT_AUDIO_MIME_TYPE;
}

function normalizeAudioFileName(
  fileName: string | null | undefined,
  fallbackBaseName: string,
  mimeType: string,
): string {
  const normalized = fileName?.trim().replace(/[\\/]/g, '_');
  if (normalized) return normalized.slice(0, 200);
  return `${fallbackBaseName}.${extensionForAudioMimeType(mimeType)}`;
}

function extensionForAudioMimeType(mimeType: string): string {
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('mp4') || mimeType.includes('aac') || mimeType.includes('m4a'))
    return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('flac')) return 'flac';
  return 'wav';
}

