jest.mock('../src/services/api/core', () => ({
  get: jest.fn(),
  post: jest.fn(),
  patch: jest.fn(),
  del: jest.fn(),
}));

import { get, post, patch, del } from '../src/services/api/core';
import {
  getVoiceProfiles,
  getVoiceProfile,
  createVoiceClone,
  diarizeAudio,
  deleteVoiceProfile,
  getFamilyVoiceProfiles,
  updateVoiceProfile,
  uploadVoiceAudio,
  separateUpload,
  listSpeakers,
  renameSpeaker,
  generateTTS,
  getMessages,
  getMessagesByVoice,
  getPresets,
  getDubLanguages,
  startDub,
  getDubStatus,
  getDubJobs,
} from '../src/services/api/voice';

const mockGet = get as jest.MockedFunction<typeof get>;
const mockPost = post as jest.MockedFunction<typeof post>;
const mockPatch = patch as jest.MockedFunction<typeof patch>;
const mockDel = del as jest.MockedFunction<typeof del>;

beforeEach(() => jest.clearAllMocks());

describe('Voice Profile API', () => {
  it('getVoiceProfiles → GET /voice', async () => {
    const profiles = [{ id: 'vp1', name: 'My Voice' }];
    mockGet.mockResolvedValue({ profiles });

    const result = await getVoiceProfiles();

    expect(mockGet).toHaveBeenCalledWith('/voice');
    expect(result).toEqual(profiles);
  });

  it('getVoiceProfile → GET /voice/:id', async () => {
    const profile = { id: 'vp1', name: 'My Voice', status: 'ready' };
    mockGet.mockResolvedValue({ profile });

    const result = await getVoiceProfile('vp1');

    expect(mockGet).toHaveBeenCalledWith('/voice/vp1');
    expect(result).toEqual(profile);
  });

  it('createVoiceClone → POST /voice/clone with FormData', async () => {
    const profile = { id: 'vp-new', name: 'Clone' };
    mockPost.mockResolvedValue({ profile });

    const audioFile = { uri: 'file:///audio.wav', name: 'audio.wav', type: 'audio/wav' };
    const result = await createVoiceClone(audioFile, 'Clone');

    expect(mockPost).toHaveBeenCalledWith(
      '/voice/clone',
      expect.any(FormData),
      { isFormData: true },
    );
    expect(result).toEqual(profile);
  });

  it('diarizeAudio → POST /voice/diarize with FormData', async () => {
    const speakers = [{ id: 's1', label: 'Speaker 1' }];
    mockPost.mockResolvedValue({ speakers });

    const audioFile = { uri: 'file:///call.wav', name: 'call.wav', type: 'audio/wav' };
    const result = await diarizeAudio(audioFile);

    expect(mockPost).toHaveBeenCalledWith(
      '/voice/diarize',
      expect.any(FormData),
      { isFormData: true },
    );
    expect(result).toEqual(speakers);
  });

  it('deleteVoiceProfile → DELETE /voice/:id', async () => {
    mockDel.mockResolvedValue(undefined);

    await deleteVoiceProfile('vp1');

    expect(mockDel).toHaveBeenCalledWith('/voice/vp1');
  });

  it('getFamilyVoiceProfiles → GET /voice/family', async () => {
    const profiles = [
      { id: 'fvp1', name: "Mom's Voice", status: 'ready', created_at: '', user_id: 'u2', owner_name: 'Mom' },
    ];
    mockGet.mockResolvedValue({ profiles });

    const result = await getFamilyVoiceProfiles();

    expect(mockGet).toHaveBeenCalledWith('/voice/family');
    expect(result).toEqual(profiles);
  });

  it('updateVoiceProfile → PATCH /voice/:id', async () => {
    mockPatch.mockResolvedValue({ profile: { id: 'vp1', name: 'Renamed' } });

    const result = await updateVoiceProfile('vp1', 'Renamed');

    expect(mockPatch).toHaveBeenCalledWith('/voice/vp1', { name: 'Renamed' });
    expect(result).toEqual({ id: 'vp1', name: 'Renamed' });
  });
});

describe('Voice Upload + Speaker Picker API', () => {
  it('uploadVoiceAudio → POST /voice/upload with FormData', async () => {
    const upload = { id: 'up1', objectKey: 'key', mimeType: 'audio/wav', sizeBytes: 1024, durationMs: 5000, originalName: 'audio.wav', createdAt: '' };
    mockPost.mockResolvedValue({ upload });

    const audioFile = { uri: 'file:///audio.wav', name: 'audio.wav', type: 'audio/wav' };
    const result = await uploadVoiceAudio(audioFile, 5000);

    expect(mockPost).toHaveBeenCalledWith(
      '/voice/upload',
      expect.any(FormData),
      { isFormData: true },
    );
    expect(result).toEqual(upload);
  });

  it('uploadVoiceAudio without durationMs', async () => {
    mockPost.mockResolvedValue({ upload: { id: 'up2' } });

    const audioFile = { uri: 'file:///a.wav', name: 'a.wav', type: 'audio/wav' };
    await uploadVoiceAudio(audioFile);

    expect(mockPost).toHaveBeenCalled();
  });

  it('separateUpload normalizes speaker segments', async () => {
    mockPost.mockResolvedValue({
      speakers: [
        { id: 's1', upload_id: 'up1', label: 'Speaker 1', start_ms: 0, end_ms: 5000, confidence: 0.95 },
        { speaker_id: 's2', uploadId: 'up1', label: 'Speaker 2', startMs: 5000, endMs: 10000, confidence: 0.8 },
      ],
    });

    const result = await separateUpload('up1');

    expect(mockPost).toHaveBeenCalledWith('/voice/uploads/up1/separate');
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('s1');
    expect(result[0]!.start_ms).toBe(0);
    expect(result[1]!.id).toBe('s2');
    expect(result[1]!.start_ms).toBe(5000);
    expect(result[1]!.upload_id).toBe('up1');
  });

  it('listSpeakers normalizes segments', async () => {
    mockGet.mockResolvedValue({
      speakers: [
        { id: 's1', upload_id: 'up1', label: 'A', start_ms: 0, end_ms: 3000, confidence: 0.9, created_at: '2026-01-01' },
      ],
    });

    const result = await listSpeakers('up1');

    expect(mockGet).toHaveBeenCalledWith('/voice/uploads/up1/speakers');
    expect(result[0]!.created_at).toBe('2026-01-01');
  });

  it('separateUpload handles missing fields with defaults', async () => {
    mockPost.mockResolvedValue({
      speakers: [{ label: 'Unknown' }],
    });

    const result = await separateUpload('up1');

    expect(result[0]!.id).toBe('');
    expect(result[0]!.upload_id).toBe('');
    expect(result[0]!.start_ms).toBe(0);
    expect(result[0]!.end_ms).toBe(0);
    expect(result[0]!.confidence).toBe(0);
  });

  it('renameSpeaker → PATCH /voice/uploads/:uploadId/speakers/:speakerId', async () => {
    mockPatch.mockResolvedValue({ speaker: { id: 's1', label: 'Mom' } });

    const result = await renameSpeaker('up1', 's1', 'Mom');

    expect(mockPatch).toHaveBeenCalledWith('/voice/uploads/up1/speakers/s1', { label: 'Mom' });
    expect(result).toEqual({ id: 's1', label: 'Mom' });
  });
});

describe('TTS API', () => {
  it('generateTTS → POST /tts/generate', async () => {
    const ttsResponse = {
      message_id: 'm1',
      audio_base64: 'base64data',
      audio_format: 'mp3',
      text: 'hello',
      voice_profile_id: 'vp1',
    };
    mockPost.mockResolvedValue(ttsResponse);

    const result = await generateTTS({ voice_profile_id: 'vp1', text: 'hello' });

    expect(mockPost).toHaveBeenCalledWith('/tts/generate', { voice_profile_id: 'vp1', text: 'hello' });
    expect(result.audio_base64).toBe('base64data');
  });

  it('generateTTS with category', async () => {
    mockPost.mockResolvedValue({ message_id: 'm1', audio_base64: '', audio_format: 'mp3', text: '', voice_profile_id: '' });

    await generateTTS({ voice_profile_id: 'vp1', text: 'hi', category: 'morning' });

    expect(mockPost).toHaveBeenCalledWith('/tts/generate', {
      voice_profile_id: 'vp1',
      text: 'hi',
      category: 'morning',
    });
  });

  it('getMessages → GET /tts/messages without category', async () => {
    const messages = [{ id: 'm1', text: 'Good morning' }];
    mockGet.mockResolvedValue({ messages });

    const result = await getMessages();

    expect(mockGet).toHaveBeenCalledWith('/tts/messages', undefined);
    expect(result).toEqual(messages);
  });

  it('getMessages with category', async () => {
    mockGet.mockResolvedValue({ messages: [] });

    await getMessages('motivation');

    expect(mockGet).toHaveBeenCalledWith('/tts/messages', { category: 'motivation' });
  });

  it('getMessagesByVoice → GET /tts/messages with voice_profile_id', async () => {
    mockGet.mockResolvedValue({ messages: [{ id: 'm1' }] });

    const result = await getMessagesByVoice('vp1');

    expect(mockGet).toHaveBeenCalledWith('/tts/messages', { voice_profile_id: 'vp1' });
    expect(result).toHaveLength(1);
  });

  it('getPresets → GET /tts/presets', async () => {
    const presets = [{ id: 'p1', text: 'Preset 1', is_preset: true }];
    mockGet.mockResolvedValue({ presets });

    const result = await getPresets();

    expect(mockGet).toHaveBeenCalledWith('/tts/presets');
    expect(result).toEqual(presets);
  });
});

describe('Dub API', () => {
  it('getDubLanguages → GET /dub/languages', async () => {
    const languages = [{ code: 'ko', name: 'Korean' }];
    mockGet.mockResolvedValue({ languages });

    const result = await getDubLanguages();

    expect(mockGet).toHaveBeenCalledWith('/dub/languages');
    expect(result).toEqual(languages);
  });

  it('startDub → POST /dub with FormData', async () => {
    mockPost.mockResolvedValue({ dub_id: 'd1', status: 'processing' });

    const audioFile = { uri: 'file:///audio.wav', name: 'audio.wav', type: 'audio/wav' };
    const result = await startDub(audioFile, 'ko', 'en');

    expect(mockPost).toHaveBeenCalledWith(
      '/dub',
      expect.any(FormData),
      { isFormData: true },
    );
    expect(result.dub_id).toBe('d1');
  });

  it('startDub with sourceMessageId', async () => {
    mockPost.mockResolvedValue({ dub_id: 'd2', status: 'processing' });

    const audioFile = { uri: 'file:///a.wav', name: 'a.wav', type: 'audio/wav' };
    await startDub(audioFile, 'en', 'ja', 'msg-1');

    expect(mockPost).toHaveBeenCalledWith(
      '/dub',
      expect.any(FormData),
      { isFormData: true },
    );
  });

  it('getDubStatus → GET /dub/:id', async () => {
    const status = { id: 'd1', status: 'completed', audio_url: 'https://cdn/d1.mp3' };
    mockGet.mockResolvedValue(status);

    const result = await getDubStatus('d1');

    expect(mockGet).toHaveBeenCalledWith('/dub/d1');
    expect(result).toEqual(status);
  });

  it('getDubJobs → GET /dub/jobs', async () => {
    const jobs = [{ id: 'j1', status: 'completed' }];
    mockGet.mockResolvedValue({ jobs });

    const result = await getDubJobs();

    expect(mockGet).toHaveBeenCalledWith('/dub/jobs');
    expect(result).toEqual(jobs);
  });
});
