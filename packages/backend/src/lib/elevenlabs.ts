const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io';
const DEFAULT_TTS_MODEL_ID = 'eleven_v3';
const DIARIZATION_MERGE_GAP_SECONDS = 0.35;
const DEFAULT_AUDIO_MIME_TYPE = 'audio/wav';
// 가족/연인 녹음은 보통 1~3명이다. 앱의 화자 처리 상한과 동일하게 맞춰 과분할을 막는다.
const DEFAULT_MAX_DIARIZATION_SPEAKERS = 3;
const SCRIBE_MAX_SPEAKERS = 32;

function clampSpeakerCount(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_DIARIZATION_SPEAKERS;
  return Math.max(1, Math.min(SCRIBE_MAX_SPEAKERS, Math.round(value)));
}

type TranscriptWord = {
  start?: number;
  end?: number;
  type?: string;
  speaker_id?: string | null;
};

type SpeechToTextResponse = {
  words?: TranscriptWord[];
  transcripts?: Array<{
    words?: TranscriptWord[];
  }>;
};

type DiarizedSpeaker = {
  speaker_id: string;
  segments: Array<{
    start: number;
    end: number;
  }>;
};

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

  /** Speaker Diarization - 화자 분리 */
  async diarize(
    audioData: ArrayBuffer,
    options?: AudioUploadOptions & { numSpeakers?: number; languageCode?: string | null },
  ): Promise<{
    speakers: DiarizedSpeaker[];
  }> {
    const formData = new FormData();
    const mimeType = normalizeAudioMimeType(options?.mimeType);
    formData.append(
      'file',
      new Blob([audioData], { type: mimeType }),
      normalizeAudioFileName(options?.fileName, 'recording', mimeType),
    );
    formData.append('model_id', 'scribe_v2');
    formData.append('diarize', 'true');
    formData.append('timestamps_granularity', 'word');
    formData.append('tag_audio_events', 'false');
    // num_speakers 를 지정하지 않으면 scribe 가 화자 수를 모델 최대치로 가정해
    // 한두 명짜리 녹음을 여러 '유령 화자'로 과분할한다 → 분리 결과가 애매해진다.
    // 앱이 실제로 지원하는 화자 수 상한으로 고정해 과분할을 억제한다(정확도 개선).
    const numSpeakers = clampSpeakerCount(options?.numSpeakers ?? DEFAULT_MAX_DIARIZATION_SPEAKERS);
    formData.append('num_speakers', String(numSpeakers));
    // 언어를 알면 전사 정확도가 올라가 단어 타임스탬프(화자 분리의 입력)도 좋아진다.
    // 모르면 생략해 자동 감지에 맡긴다(다국어 녹음 회귀 방지).
    if (options?.languageCode) {
      formData.append('language_code', options.languageCode);
    }

    const res = await fetch(`${ELEVENLABS_BASE_URL}/v1/speech-to-text`, {
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

    const transcript = (await res.json()) as SpeechToTextResponse;
    return { speakers: diarizedSpeakersFromTranscript(transcript) };
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

function diarizedSpeakersFromTranscript(transcript: SpeechToTextResponse): DiarizedSpeaker[] {
  const words = [
    ...(transcript.words ?? []),
    ...(transcript.transcripts ?? []).flatMap((item) => item.words ?? []),
  ];
  const bySpeaker = new Map<string, Array<{ start: number; end: number }>>();

  for (const word of words) {
    if (!word.speaker_id || word.type === 'spacing') continue;
    if (typeof word.start !== 'number' || typeof word.end !== 'number') continue;
    if (word.end <= word.start) continue;

    const segments = bySpeaker.get(word.speaker_id) ?? [];
    segments.push({ start: word.start, end: word.end });
    bySpeaker.set(word.speaker_id, segments);
  }

  return Array.from(bySpeaker.entries())
    .map(([speakerId, segments]) => ({
      speaker_id: speakerId,
      segments: mergeDiarizedSegments(segments),
    }))
    .filter((speaker) => speaker.segments.length > 0)
    .sort((a, b) => a.segments[0]!.start - b.segments[0]!.start);
}

function mergeDiarizedSegments(
  segments: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];

  for (const segment of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || segment.start > previous.end + DIARIZATION_MERGE_GAP_SECONDS) {
      merged.push({ ...segment });
      continue;
    }
    previous.end = Math.max(previous.end, segment.end);
  }

  return merged;
}
