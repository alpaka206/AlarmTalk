import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PersoClient } from '../src/lib/perso';

const mockFetch = vi.fn();
const origFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = mockFetch;
  mockFetch.mockReset();
});

afterEach(() => {
  globalThis.fetch = origFetch;
});

function okJson(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function errorResponse(status: number, body: string) {
  return new Response(body, { status, statusText: 'Error' });
}

describe('PersoClient', () => {
  const client = new PersoClient('perso-key-abc');

  describe('listSpaces', () => {
    it('올바른 URL + 헤더로 요청', async () => {
      mockFetch.mockResolvedValueOnce(okJson({ result: [{ spaceSeq: 1, spaceName: 'My Space' }] }));

      const result = await client.listSpaces();

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.perso.ai/portal/api/v1/spaces');
      expect(opts.headers['XP-API-KEY']).toBe('perso-key-abc');
      expect(opts.headers['Content-Type']).toBe('application/json');
      expect(result.result[0].spaceSeq).toBe(1);
    });

    it('API 에러 시 예외', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(403, 'Forbidden'));

      await expect(client.listSpaces()).rejects.toThrow('Perso API error 403: Forbidden');
    });
  });

  describe('getSasToken', () => {
    it('파일명 인코딩 확인', async () => {
      mockFetch.mockResolvedValueOnce(okJson({ blobSasUrl: 'https://blob.url', expirationDatetime: '2026-12-31' }));

      await client.getSasToken('테스트 파일.wav');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain(encodeURIComponent('테스트 파일.wav'));
    });
  });

  describe('uploadToBlob', () => {
    it('PUT + BlockBlob 헤더로 업로드', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 201 }));

      await client.uploadToBlob('https://blob.azure/file?sas=token', new ArrayBuffer(100));

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://blob.azure/file?sas=token');
      expect(opts.method).toBe('PUT');
      expect(opts.headers['x-ms-blob-type']).toBe('BlockBlob');
    });

    it('업로드 실패 시 예외', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 403 }));

      await expect(
        client.uploadToBlob('https://blob.azure/file', new ArrayBuffer(10)),
      ).rejects.toThrow('Azure Blob upload failed: 403');
    });
  });

  describe('registerAudio', () => {
    it('올바른 바디 전송', async () => {
      mockFetch.mockResolvedValueOnce(
        okJson({ seq: 42, originalName: 'test.wav', audioFilePath: '/path', size: 1000, durationMs: 5000 }),
      );

      const result = await client.registerAudio(1, 'https://file.url', 'test.wav');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.perso.ai/file/api/upload/audio');
      expect(opts.method).toBe('PUT');
      const body = JSON.parse(opts.body);
      expect(body.spaceSeq).toBe(1);
      expect(body.fileUrl).toBe('https://file.url');
      expect(result.seq).toBe(42);
    });
  });

  describe('requestTranslation', () => {
    it('기본값 포함 요청 바디', async () => {
      mockFetch.mockResolvedValueOnce(okJson({ result: { startGenerateProjectIdList: [100] } }));

      const result = await client.requestTranslation(1, {
        mediaSeq: 42,
        isVideoProject: false,
        sourceLanguageCode: 'ko',
        targetLanguageCodes: ['en'],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.numberOfSpeakers).toBe(1);
      expect(body.preferredSpeedType).toBe('GREEN');
      expect(body.mediaSeq).toBe(42);
      expect(body.sourceLanguageCode).toBe('ko');
      expect(result.result.startGenerateProjectIdList).toEqual([100]);
    });

    it('사용자 지정 numberOfSpeakers 우선', async () => {
      mockFetch.mockResolvedValueOnce(okJson({ result: { startGenerateProjectIdList: [101] } }));

      await client.requestTranslation(1, {
        mediaSeq: 42,
        isVideoProject: false,
        sourceLanguageCode: 'ko',
        targetLanguageCodes: ['en'],
        numberOfSpeakers: 3,
        preferredSpeedType: 'RED',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.numberOfSpeakers).toBe(3);
      expect(body.preferredSpeedType).toBe('RED');
    });
  });

  describe('getProgress', () => {
    it('올바른 URL 구성', async () => {
      mockFetch.mockResolvedValueOnce(
        okJson({ result: { projectSeq: 10, progress: 50, progressReason: 'processing', hasFailed: false } }),
      );

      const result = await client.getProgress(10, 1);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.perso.ai/video-translator/api/v1/projects/10/space/1/progress');
      expect(result.result.progress).toBe(50);
    });
  });

  describe('getScript', () => {
    it('스크립트 결과 파싱', async () => {
      const scriptData = {
        result: {
          sentences: [{ seq: 1, speakerOrderIndex: 0, offsetMs: 0, durationMs: 1000, originalText: '안녕', translatedText: 'Hello' }],
          speakers: [{ speakerOrderIndex: 0, externalSpeakerSeq: 'spk1' }],
        },
      };
      mockFetch.mockResolvedValueOnce(okJson(scriptData));

      const result = await client.getScript(10, 1);

      expect(result.result.sentences).toHaveLength(1);
      expect(result.result.sentences[0].originalText).toBe('안녕');
    });
  });

  describe('getDownloadInfo', () => {
    it('다운로드 정보 반환', async () => {
      mockFetch.mockResolvedValueOnce(
        okJson({ hasTranslatedVoice: true, hasOriginalVoiceOnly: false, hasTranslatedVideo: false }),
      );

      const result = await client.getDownloadInfo(10, 1);
      expect(result.hasTranslatedVoice).toBe(true);
    });
  });

  describe('download', () => {
    it('올바른 target 쿼리 파라미터', async () => {
      mockFetch.mockResolvedValueOnce(
        okJson({ result: { audioFile: { voiceAudioDownloadLink: 'https://dl.url' } } }),
      );

      const result = await client.download(10, 1, 'translatedVoice');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('target=translatedVoice');
      expect(result.result.audioFile?.voiceAudioDownloadLink).toBe('https://dl.url');
    });
  });

  describe('listLanguages', () => {
    it('언어 목록 반환', async () => {
      mockFetch.mockResolvedValueOnce(
        okJson({ result: { languages: [{ code: 'ko', name: 'Korean', experiment: false }] } }),
      );

      const result = await client.listLanguages();
      expect(result.result.languages[0].code).toBe('ko');
    });
  });

  describe('toFileUrl (static)', () => {
    it('상대 경로를 절대 URL로 변환', () => {
      expect(PersoClient.toFileUrl('/uploads/audio/test.wav')).toBe(
        'https://portal-media.perso.ai/uploads/audio/test.wav',
      );
    });
  });

  describe('204 응답 처리', () => {
    it('204 No Content — 빈 객체 반환', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

      const result = await client.listSpaces();
      expect(result).toEqual({});
    });
  });
});
