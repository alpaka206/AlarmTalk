const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io';

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
  async createInstantClone(audioData: ArrayBuffer, name: string): Promise<{ voice_id: string }> {
    const formData = new FormData();
    formData.append('files', new Blob([audioData], { type: 'audio/wav' }), 'sample.wav');
    formData.append('name', name);

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
    },
  ): Promise<ArrayBuffer> {
    const res = await this.request(`/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: options?.model_id ?? 'eleven_multilingual_v2',
        voice_settings: {
          stability: options?.stability ?? 1,
          similarity_boost: options?.similarity_boost ?? 0.75,
          style: options?.style ?? 0,
          speed: options?.speed ?? 1,
          use_speaker_boost: options?.use_speaker_boost ?? true,
        },
      }),
    });

    return res.arrayBuffer();
  }

  /** Speaker Diarization - 화자 분리 */
  async diarize(audioData: ArrayBuffer): Promise<{
    speakers: Array<{
      speaker_id: string;
      segments: Array<{
        start: number;
        end: number;
      }>;
    }>;
  }> {
    const formData = new FormData();
    formData.append('audio', new Blob([audioData], { type: 'audio/wav' }), 'recording.wav');

    const res = await fetch(`${ELEVENLABS_BASE_URL}/v1/audio/diarize`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
      },
      body: formData,
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`ElevenLabs diarize error ${res.status}: ${errorBody}`);
    }

    return res.json();
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
