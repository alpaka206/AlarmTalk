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
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
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
    it('옵션 미지정 시 v3 디폴트 voice_settings를 전송한다', async () => {
      mockFetch.mockResolvedValueOnce(okArrayBuffer());

      await client.textToSpeech('voice-123', '안녕하세요');

      const [url, opts] = mockFetch.mock.calls[0];
      // K2: output_format 을 명시 고정한다(제공자 기본값 의존 제거).
      expect(url).toBe(
        'https://api.elevenlabs.io/v1/text-to-speech/voice-123?output_format=mp3_44100_128',
      );
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.text).toBe('안녕하세요');
      expect(body.model_id).toBe('eleven_v3');
      // 검증된 버그 수정: v3에도 항상 voice_settings를 전송한다(이전엔 역조건으로 미전송).
      expect(body.voice_settings).toEqual({
        stability: 0.5,
        similarity_boost: 0.8,
        style: 0.4,
        speed: 1.0,
        use_speaker_boost: true,
      });
    });

    it('v3도 커스텀 voice settings 옵션을 전송한다(버그 수정)', async () => {
      mockFetch.mockResolvedValueOnce(okArrayBuffer());

      await client.textToSpeech('v1', 'hello', {
        stability: 0.8,
        similarity_boost: 0.9,
        style: 0.3,
        speed: 0.7,
        use_speaker_boost: true,
        language_code: 'ko',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model_id).toBe('eleven_v3');
      expect(body.language_code).toBe('ko');
      expect(body.voice_settings.stability).toBe(0.8);
      expect(body.voice_settings.similarity_boost).toBe(0.9);
      expect(body.voice_settings.style).toBe(0.3);
      expect(body.voice_settings.speed).toBe(0.7);
      expect(body.voice_settings.use_speaker_boost).toBe(true);
    });

    it('비-v3 모델도 커스텀 옵션을 반영(미지정 항목은 디폴트)', async () => {
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
      expect(body.voice_settings.speed).toBe(1.0);
      expect(body.voice_settings.use_speaker_boost).toBe(true);
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

  describe('speechToText', () => {
    it('scribe_v2 모델로 전사 요청 (scribe_v1 은 2026-07-09 제거됨)', async () => {
      mockFetch.mockResolvedValueOnce(okJson({ text: '  안녕하세요 반갑습니다  ' }));

      const text = await client.speechToText(new ArrayBuffer(100), {
        mimeType: 'audio/mpeg',
        fileName: 'voice.mp3',
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
      expect(opts.method).toBe('POST');
      expect(opts.headers['xi-api-key']).toBe('test-api-key-123');
      const body = opts.body as FormData;
      expect(body.get('model_id')).toBe('scribe_v2');
      const file = body.get('file') as Blob & { name?: string };
      expect(file.type).toBe('audio/mpeg');
      expect(file.name).toBe('voice.mp3');
      // 응답 {text} 는 trim 되어 반환된다.
      expect(text).toBe('안녕하세요 반갑습니다');
    });

    it('text 필드 없으면 빈 문자열', async () => {
      mockFetch.mockResolvedValueOnce(okJson({}));
      const text = await client.speechToText(new ArrayBuffer(10));
      expect(text).toBe('');
    });

    it('API 에러 시 예외 (호출자가 failed 상태를 기록)', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(400, 'invalid_model_id'));
      await expect(client.speechToText(new ArrayBuffer(10))).rejects.toThrow(
        'ElevenLabs API error 400',
      );
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

    it('clone 업로드에서 mp3 MIME 과 파일명을 보존', async () => {
      mockFetch.mockResolvedValueOnce(okJson({ voice_id: 'v' }));
      await client.createInstantClone(new ArrayBuffer(10), 'n', {
        mimeType: 'audio/mpeg',
        fileName: 'voice.mp3',
      });
      const body = mockFetch.mock.calls[0][1].body as FormData;
      const file = body.get('files') as Blob & { name?: string };
      expect(file.type).toBe('audio/mpeg');
      expect(file.name).toBe('voice.mp3');
    });

    it('API 에러 시 예외', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(400, 'Bad audio'));

      await expect(client.createInstantClone(new ArrayBuffer(10), 'test')).rejects.toThrow(
        'ElevenLabs clone error 400: Bad audio',
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
