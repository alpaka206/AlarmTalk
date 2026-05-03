const PERSO_API_BASE = 'https://api.perso.ai';
const PERSO_FILE_BASE = 'https://portal-media.perso.ai';

export class PersoClient {
  constructor(private apiKey: string) {}

  private async request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${PERSO_API_BASE}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'XP-API-KEY': this.apiKey,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Perso API error ${res.status}: ${errorBody}`);
    }

    if (res.status === 204) return {} as T;
    return res.json();
  }

  async listSpaces(): Promise<{
    result: Array<{
      spaceSeq: number;
      spaceName: string;
      planName: string;
      tier: string;
      memberRole: string;
    }>;
  }> {
    return this.request('/portal/api/v1/spaces');
  }

  async getSasToken(fileName: string): Promise<{
    blobSasUrl: string;
    expirationDatetime: string;
  }> {
    return this.request(`/file/api/upload/sas-token?fileName=${encodeURIComponent(fileName)}`);
  }

  async uploadToBlob(blobSasUrl: string, data: ArrayBuffer): Promise<void> {
    const res = await fetch(blobSasUrl, {
      method: 'PUT',
      headers: {
        'x-ms-blob-type': 'BlockBlob',
        'Content-Type': 'application/octet-stream',
      },
      body: data,
    });

    if (!res.ok) {
      throw new Error(`Azure Blob upload failed: ${res.status}`);
    }
  }

  async registerAudio(
    spaceSeq: number,
    fileUrl: string,
    fileName: string,
  ): Promise<{
    seq: number;
    originalName: string;
    audioFilePath: string;
    size: number;
    durationMs: number;
  }> {
    return this.request('/file/api/upload/audio', {
      method: 'PUT',
      body: JSON.stringify({ spaceSeq, fileUrl, fileName }),
    });
  }

  async requestTranslation(
    spaceSeq: number,
    params: {
      mediaSeq: number;
      isVideoProject: boolean;
      sourceLanguageCode: string;
      targetLanguageCodes: string[];
      numberOfSpeakers?: number;
      preferredSpeedType?: 'GREEN' | 'RED';
      ttsModel?: 'ELEVEN_V2' | 'ELEVEN_V3';
      title?: string;
    },
  ): Promise<{
    result: { startGenerateProjectIdList: number[] };
  }> {
    return this.request(`/video-translator/api/v1/projects/spaces/${spaceSeq}/translate`, {
      method: 'POST',
      body: JSON.stringify({
        numberOfSpeakers: 1,
        preferredSpeedType: 'GREEN',
        ...params,
      }),
    });
  }

  async getProgress(
    projectSeq: number,
    spaceSeq: number,
  ): Promise<{
    result: {
      projectSeq: number;
      progress: number;
      progressReason: string;
      hasFailed: boolean;
      expectedRemainingTimeMinutes?: number;
    };
  }> {
    return this.request(
      `/video-translator/api/v1/projects/${projectSeq}/space/${spaceSeq}/progress`,
    );
  }

  async getScript(
    projectSeq: number,
    spaceSeq: number,
  ): Promise<{
    result: {
      sentences: Array<{
        seq: number;
        speakerOrderIndex: number;
        offsetMs: number;
        durationMs: number;
        originalText: string;
        translatedText: string;
        audioUrl?: string;
      }>;
      speakers: Array<{
        speakerOrderIndex: number;
        externalSpeakerSeq: string;
      }>;
    };
  }> {
    return this.request(
      `/video-translator/api/v1/projects/${projectSeq}/spaces/${spaceSeq}/script`,
    );
  }

  async generateSentenceAudio(
    projectSeq: number,
    audioSentenceSeq: number,
    targetText: string,
  ): Promise<{
    result: {
      scriptSeq: number;
      translatedText: string;
      generateAudioFilePath: string;
      matchingRate: { level: number; levelType: string };
    };
  }> {
    return this.request(
      `/video-translator/api/v1/project/${projectSeq}/audio-sentence/${audioSentenceSeq}/generate-audio`,
      {
        method: 'PATCH',
        body: JSON.stringify({ targetText }),
      },
    );
  }

  async getDownloadInfo(
    projectSeq: number,
    spaceSeq: number,
  ): Promise<{
    hasTranslatedVoice: boolean;
    hasOriginalVoiceOnly: boolean;
    hasTranslatedVideo: boolean;
    [key: string]: boolean | null;
  }> {
    return this.request(
      `/video-translator/api/v1/projects/${projectSeq}/spaces/${spaceSeq}/download-info`,
    );
  }

  async download(
    projectSeq: number,
    spaceSeq: number,
    target: string,
  ): Promise<{
    result: {
      videoFile?: { videoDownloadLink: string };
      audioFile?: {
        voiceAudioDownloadLink?: string;
        backgroundAudioDownloadLink?: string;
      };
      srtFile?: {
        originalSubtitleDownloadLink?: string;
        translatedSubtitleDownloadLink?: string;
      };
    };
  }> {
    return this.request(
      `/video-translator/api/v1/projects/${projectSeq}/spaces/${spaceSeq}/download?target=${target}`,
    );
  }

  async listLanguages(): Promise<{
    result: {
      languages: Array<{
        code: string;
        name: string;
        experiment: boolean;
      }>;
    };
  }> {
    return this.request('/video-translator/api/v1/languages');
  }

  static toFileUrl(relativePath: string): string {
    return `${PERSO_FILE_BASE}${relativePath}`;
  }
}
