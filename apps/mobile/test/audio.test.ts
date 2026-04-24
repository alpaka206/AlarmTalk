jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///data/app/files/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false }),
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  readDirectoryAsync: jest.fn().mockResolvedValue([]),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  EncodingType: { Base64: 'base64' },
}));

jest.mock('expo-av', () => ({
  Audio: {
    setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
    requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
    Recording: jest.fn().mockImplementation(() => ({
      prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
      startAsync: jest.fn().mockResolvedValue(undefined),
      stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined),
      getStatusAsync: jest.fn().mockResolvedValue({ durationMillis: 5000 }),
      getURI: jest.fn().mockReturnValue('file:///recorded.m4a'),
    })),
    RecordingOptionsPresets: { HIGH_QUALITY: { android: {}, ios: {} } },
    Sound: {
      createAsync: jest.fn().mockResolvedValue({ sound: { unloadAsync: jest.fn() } }),
    },
  },
}));

import {
  ensureAudioDir,
  setupAudioSession,
  requestMicPermission,
  startRecording,
  stopRecording,
  saveAudioLocally,
  getLocalAudioPath,
  isAudioCached,
  playAudio,
  deleteLocalAudio,
  getAudioCacheSize,
} from '../src/services/audio';

const mockFs = jest.requireMock<{
  getInfoAsync: jest.Mock;
  makeDirectoryAsync: jest.Mock;
  writeAsStringAsync: jest.Mock;
  readDirectoryAsync: jest.Mock;
  deleteAsync: jest.Mock;
}>('expo-file-system/legacy');

const mockAv = jest.requireMock<{
  Audio: {
    setAudioModeAsync: jest.Mock;
    requestPermissionsAsync: jest.Mock;
    Recording: jest.Mock;
    Sound: { createAsync: jest.Mock };
  };
}>('expo-av');

const AUDIO_DIR = 'file:///data/app/files/voice-alarm/audio/';

beforeEach(() => {
  mockFs.getInfoAsync.mockReset().mockResolvedValue({ exists: false });
  mockFs.makeDirectoryAsync.mockReset().mockResolvedValue(undefined);
  mockFs.writeAsStringAsync.mockReset().mockResolvedValue(undefined);
  mockFs.readDirectoryAsync.mockReset().mockResolvedValue([]);
  mockFs.deleteAsync.mockReset().mockResolvedValue(undefined);
  mockAv.Audio.setAudioModeAsync.mockReset().mockResolvedValue(undefined);
  mockAv.Audio.requestPermissionsAsync.mockReset().mockResolvedValue({ granted: true });
  mockAv.Audio.Sound.createAsync.mockReset().mockResolvedValue({ sound: { unloadAsync: jest.fn() } });
});

describe('getLocalAudioPath', () => {
  it('기본 mp3 포맷 경로를 반환한다', () => {
    expect(getLocalAudioPath('msg-123')).toBe(`${AUDIO_DIR}msg-123.mp3`);
  });

  it('커스텀 포맷 경로를 반환한다', () => {
    expect(getLocalAudioPath('msg-456', 'wav')).toBe(`${AUDIO_DIR}msg-456.wav`);
  });

  it('특수문자 포함 messageId도 그대로 사용한다', () => {
    expect(getLocalAudioPath('abc-def_123')).toBe(`${AUDIO_DIR}abc-def_123.mp3`);
  });
});

describe('ensureAudioDir', () => {
  it('디렉토리가 없으면 생성한다', async () => {
    mockFs.getInfoAsync.mockResolvedValue({ exists: false });
    await ensureAudioDir();
    expect(mockFs.getInfoAsync).toHaveBeenCalledWith(AUDIO_DIR);
    expect(mockFs.makeDirectoryAsync).toHaveBeenCalledWith(AUDIO_DIR, { intermediates: true });
  });

  it('디렉토리가 이미 존재하면 생성하지 않는다', async () => {
    mockFs.getInfoAsync.mockResolvedValue({ exists: true });
    await ensureAudioDir();
    expect(mockFs.getInfoAsync).toHaveBeenCalledWith(AUDIO_DIR);
    expect(mockFs.makeDirectoryAsync).not.toHaveBeenCalled();
  });
});

describe('setupAudioSession', () => {
  it('녹음 허용 + 무음 모드 재생 + 백그라운드 재생을 설정한다', async () => {
    await setupAudioSession();
    expect(mockAv.Audio.setAudioModeAsync).toHaveBeenCalledWith({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
    });
  });
});

describe('requestMicPermission', () => {
  it('권한 부여 시 true를 반환한다', async () => {
    mockAv.Audio.requestPermissionsAsync.mockResolvedValue({ granted: true });
    expect(await requestMicPermission()).toBe(true);
  });

  it('권한 거부 시 false를 반환한다', async () => {
    mockAv.Audio.requestPermissionsAsync.mockResolvedValue({ granted: false });
    expect(await requestMicPermission()).toBe(false);
  });
});

describe('startRecording', () => {
  it('녹음 인스턴스를 생성하고 시작한다', async () => {
    const recording = await startRecording();
    expect(recording).toBeDefined();
    expect(recording.prepareToRecordAsync).toHaveBeenCalledWith(
      expect.objectContaining({ isMeteringEnabled: false }),
    );
    expect(recording.startAsync).toHaveBeenCalled();
  });

  it('미터링 활성화 옵션을 전달한다', async () => {
    const recording = await startRecording(true);
    expect(recording.prepareToRecordAsync).toHaveBeenCalledWith(
      expect.objectContaining({ isMeteringEnabled: true }),
    );
  });

  it('녹음 전 오디오 세션을 설정한다', async () => {
    await startRecording();
    expect(mockAv.Audio.setAudioModeAsync).toHaveBeenCalled();
  });
});

describe('stopRecording', () => {
  function createMockRecording(durationMs = 5000, uri = 'file:///rec.m4a') {
    return {
      stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined),
      getStatusAsync: jest.fn().mockResolvedValue({ durationMillis: durationMs }),
      getURI: jest.fn().mockReturnValue(uri),
    };
  }

  it('녹음을 중지하고 uri와 초 단위 duration을 반환한다', async () => {
    const rec = createMockRecording(5000, 'file:///recorded.m4a');
    const result = await stopRecording(rec as never);
    expect(rec.stopAndUnloadAsync).toHaveBeenCalled();
    expect(result.uri).toBe('file:///recorded.m4a');
    expect(result.duration).toBe(5);
  });

  it('밀리초를 정확하게 초로 변환한다', async () => {
    const rec = createMockRecording(12500);
    const result = await stopRecording(rec as never);
    expect(result.duration).toBe(12.5);
  });

  it('0ms 녹음도 처리한다', async () => {
    const rec = createMockRecording(0);
    const result = await stopRecording(rec as never);
    expect(result.duration).toBe(0);
  });
});

describe('saveAudioLocally', () => {
  it('base64 데이터를 mp3로 저장한다', async () => {
    mockFs.getInfoAsync.mockResolvedValue({ exists: true });
    const path = await saveAudioLocally('SGVsbG8=', 'msg-1');
    expect(path).toBe(`${AUDIO_DIR}msg-1.mp3`);
    expect(mockFs.writeAsStringAsync).toHaveBeenCalledWith(
      `${AUDIO_DIR}msg-1.mp3`,
      'SGVsbG8=',
      { encoding: 'base64' },
    );
  });

  it('커스텀 포맷으로 저장한다', async () => {
    mockFs.getInfoAsync.mockResolvedValue({ exists: true });
    const path = await saveAudioLocally('data', 'msg-2', 'wav');
    expect(path).toBe(`${AUDIO_DIR}msg-2.wav`);
  });

  it('디렉토리가 없으면 자동 생성한다', async () => {
    mockFs.getInfoAsync.mockResolvedValue({ exists: false });
    await saveAudioLocally('data', 'msg-3');
    expect(mockFs.makeDirectoryAsync).toHaveBeenCalledWith(AUDIO_DIR, { intermediates: true });
  });
});

describe('isAudioCached', () => {
  it('파일이 존재하면 true를 반환한다', async () => {
    mockFs.getInfoAsync.mockResolvedValue({ exists: true });
    expect(await isAudioCached('msg-1')).toBe(true);
    expect(mockFs.getInfoAsync).toHaveBeenCalledWith(`${AUDIO_DIR}msg-1.mp3`);
  });

  it('파일이 없으면 false를 반환한다', async () => {
    mockFs.getInfoAsync.mockResolvedValue({ exists: false });
    expect(await isAudioCached('msg-2')).toBe(false);
  });

  it('커스텀 포맷도 정확한 경로로 확인한다', async () => {
    mockFs.getInfoAsync.mockResolvedValue({ exists: true });
    await isAudioCached('msg-3', 'wav');
    expect(mockFs.getInfoAsync).toHaveBeenCalledWith(`${AUDIO_DIR}msg-3.wav`);
  });
});

describe('playAudio', () => {
  it('재생 전용 오디오 모드 설정 후 사운드를 생성한다', async () => {
    const mockSound = { unloadAsync: jest.fn() };
    mockAv.Audio.Sound.createAsync.mockResolvedValue({ sound: mockSound });

    const sound = await playAudio('file:///audio.mp3');
    expect(mockAv.Audio.setAudioModeAsync).toHaveBeenCalledWith({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
    });
    expect(mockAv.Audio.Sound.createAsync).toHaveBeenCalledWith(
      { uri: 'file:///audio.mp3' },
      { shouldPlay: true },
    );
    expect(sound).toBe(mockSound);
  });
});

describe('deleteLocalAudio', () => {
  it('파일이 존재하면 삭제한다', async () => {
    mockFs.getInfoAsync.mockResolvedValue({ exists: true });
    await deleteLocalAudio('msg-1');
    expect(mockFs.deleteAsync).toHaveBeenCalledWith(`${AUDIO_DIR}msg-1.mp3`);
  });

  it('파일이 없으면 삭제하지 않는다', async () => {
    mockFs.getInfoAsync.mockResolvedValue({ exists: false });
    await deleteLocalAudio('msg-2');
    expect(mockFs.deleteAsync).not.toHaveBeenCalled();
  });

  it('커스텀 포맷을 삭제한다', async () => {
    mockFs.getInfoAsync.mockResolvedValue({ exists: true });
    await deleteLocalAudio('msg-3', 'wav');
    expect(mockFs.deleteAsync).toHaveBeenCalledWith(`${AUDIO_DIR}msg-3.wav`);
  });
});

describe('getAudioCacheSize', () => {
  it('모든 파일 크기의 합을 반환한다', async () => {
    mockFs.getInfoAsync
      .mockResolvedValueOnce({ exists: true })
      .mockResolvedValueOnce({ exists: true, size: 1024 })
      .mockResolvedValueOnce({ exists: true, size: 2048 });
    mockFs.readDirectoryAsync.mockResolvedValue(['a.mp3', 'b.mp3']);

    expect(await getAudioCacheSize()).toBe(3072);
  });

  it('파일이 없으면 0을 반환한다', async () => {
    mockFs.getInfoAsync.mockResolvedValue({ exists: true });
    mockFs.readDirectoryAsync.mockResolvedValue([]);

    expect(await getAudioCacheSize()).toBe(0);
  });

  it('size가 null인 파일은 건너뛴다', async () => {
    mockFs.getInfoAsync
      .mockResolvedValueOnce({ exists: true })
      .mockResolvedValueOnce({ exists: true, size: 500 })
      .mockResolvedValueOnce({ exists: true, size: null });
    mockFs.readDirectoryAsync.mockResolvedValue(['a.mp3', 'b.mp3']);

    expect(await getAudioCacheSize()).toBe(500);
  });

  it('존재하지 않는 파일 항목은 건너뛴다', async () => {
    mockFs.getInfoAsync
      .mockResolvedValueOnce({ exists: true })
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: true, size: 300 });
    mockFs.readDirectoryAsync.mockResolvedValue(['deleted.mp3', 'exists.mp3']);

    expect(await getAudioCacheSize()).toBe(300);
  });
});
