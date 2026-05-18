import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ElevenLabsClient } from '../src/lib/elevenlabs';

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

function okArrayBuffer() {
  return new Response(new ArrayBuffer(100), { status: 200 });
}

function errorResponse(status: number, body: string) {
  return new Response(body, { status, statusText: 'Error' });
}

describe('ElevenLabsClient', () => {
  const client = new ElevenLabsClient('test-api-key-123');

  describe('listVoices', () => {
    it('올바른 URL + 헤더로 요청', async () => {
      mockFetch.mockResolvedValueOnce(okJson({ voices: [{ voice_id: 'v1', name: 'Test' }] }));

      const result = await client.listVoices();

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.elevenlabs.io/v1/voices');
      expect(opts.headers['xi-api-key']).toBe('test-api-key-123');
      expect(result.voices).toHaveLength(1);
      expect(result.voices[0].voice_id).toBe('v1');
    });

    it('API 에러 시 예외 발생', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(401, 'Unauthorized'));

      await expect(client.listVoices()).rejects.toThrow('ElevenLabs API error 401: Unauthorized');
    });
  });

  describe('textToSpeech', () => {
    it('올바른 요청 바디 구성', async () => {
      mockFetch.mockResolvedValueOnce(okArrayBuffer());

      await client.textToSpeech('voice-123', '안녕하세요');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice-123');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.text).toBe('안녕하세요');
      expect(body.model_id).toBe('eleven_v3');
      expect(body.voice_settings.stability).toBe(0.5);
      expect(body.voice_settings.similarity_boost).toBe(0.82);
      expect(body.voice_settings.style).toBe(0.25);
      expect(body.voice_settings.speed).toBe(0.96);
      expect(body.voice_settings.use_speaker_boost).toBeUndefined();
    });

    it('커스텀 옵션 반영', async () => {
      mockFetch.mockResolvedValueOnce(okArrayBuffer());

      await client.textToSpeech('v1', 'hello', {
        stability: 0.8,
        similarity_boost: 0.9,
        style: 0.3,
        model_id: 'eleven_turbo_v2',
        language_code: 'ko',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model_id).toBe('eleven_turbo_v2');
      expect(body.language_code).toBe('ko');
      expect(body.voice_settings.stability).toBe(0.8);
      expect(body.voice_settings.similarity_boost).toBe(0.9);
      expect(body.voice_settings.style).toBe(0.3);
    });

    it('ArrayBuffer 반환', async () => {
      mockFetch.mockResolvedValueOnce(okArrayBuffer());

      const result = await client.textToSpeech('v1', 'test');
      expect(result).toBeInstanceOf(ArrayBuffer);
    });

    it('API 에러 시 예외', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(429, 'Rate limit'));

      await expect(client.textToSpeech('v1', 'test')).rejects.toThrow('ElevenLabs API error 429');
    });
  });

  describe('createInstantClone', () => {
    it('FormData로 전송', async () => {
      mockFetch.mockResolvedValueOnce(okJson({ voice_id: 'new-voice-id' }));

      const result = await client.createInstantClone(new ArrayBuffer(1000), '엄마 목소리');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.elevenlabs.io/v1/voices/add');
      expect(opts.method).toBe('POST');
      expect(opts.headers['xi-api-key']).toBe('test-api-key-123');
      expect(result.voice_id).toBe('new-voice-id');
    });

    it('기본 옵션에서는 remove_background_noise 미전송', async () => {
      mockFetch.mockResolvedValueOnce(okJson({ voice_id: 'v' }));
      await client.createInstantClone(new ArrayBuffer(10), 'n');
      const body = mockFetch.mock.calls[0][1].body as FormData;
      expect(body.get('remove_background_noise')).toBeNull();
    });

    it('removeBackgroundNoise=true 시 FormData 에 remove_background_noise=true 첨부', async () => {
      mockFetch.mockResolvedValueOnce(okJson({ voice_id: 'v' }));
      await client.createInstantClone(new ArrayBuffer(10), 'n', { removeBackgroundNoise: true });
      const body = mockFetch.mock.calls[0][1].body as FormData;
      expect(body.get('remove_background_noise')).toBe('true');
    });

    it('API 에러 시 예외', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(400, 'Bad audio'));

      await expect(client.createInstantClone(new ArrayBuffer(10), 'test')).rejects.toThrow(
        'ElevenLabs clone error 400: Bad audio',
      );
    });
  });

  describe('diarize', () => {
    it('FormData로 전송 + 결과 반환', async () => {
      const diarizeResult = {
        words: [
          { text: 'hello', start: 0, end: 0.4, type: 'word', speaker_id: 'speaker_1' },
          { text: 'world', start: 0.45, end: 0.8, type: 'word', speaker_id: 'speaker_1' },
          { text: 'again', start: 1.5, end: 2, type: 'word', speaker_id: 'speaker_2' },
        ],
      };
      mockFetch.mockResolvedValueOnce(okJson(diarizeResult));

      const result = await client.diarize(new ArrayBuffer(500));

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
      expect(opts.method).toBe('POST');
      const body = opts.body as FormData;
      expect(body.get('model_id')).toBe('scribe_v2');
      expect(body.get('diarize')).toBe('true');
      expect(body.get('timestamps_granularity')).toBe('word');
      expect(result.speakers).toHaveLength(2);
      expect(result.speakers[0].speaker_id).toBe('speaker_1');
      expect(result.speakers[0].segments).toEqual([{ start: 0, end: 0.8 }]);
    });

    it('API 에러 시 예외', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(500, 'Internal error'));

      await expect(client.diarize(new ArrayBuffer(10))).rejects.toThrow(
        'ElevenLabs diarize error 500',
      );
    });
  });

  describe('deleteVoice', () => {
    it('DELETE 메서드로 요청', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

      await client.deleteVoice('voice-to-delete');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.elevenlabs.io/v1/voices/voice-to-delete');
      expect(opts.method).toBe('DELETE');
    });

    it('API 에러 시 예외', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(404, 'Not found'));

      await expect(client.deleteVoice('no-exist')).rejects.toThrow('ElevenLabs API error 404');
    });
  });
});
