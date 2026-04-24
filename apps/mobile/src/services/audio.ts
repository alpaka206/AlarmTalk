import { Audio } from 'expo-av';
import { Platform } from 'react-native';

interface FileInfo {
  exists: boolean;
  size?: number;
}

type GetInfoFn = (path: string) => Promise<FileInfo>;
type MakeDirFn = (path: string, opts?: { intermediates?: boolean }) => Promise<void>;
type WriteStringFn = (path: string, data: string, opts?: { encoding: string }) => Promise<void>;
type ReadDirFn = (path: string) => Promise<string[]>;
type DeleteFn = (path: string) => Promise<void>;

const isWeb = Platform.OS === 'web';

let documentDirectory: string | null = null;
let getInfoAsync: GetInfoFn = async () => ({ exists: false });
let makeDirectoryAsync: MakeDirFn = async () => {};
let writeAsStringAsync: WriteStringFn = async () => {};
let readDirectoryAsync: ReadDirFn = async () => [];
let deleteAsync: DeleteFn = async () => {};
let EncodingType: { Base64: string } = { Base64: 'base64' };

if (!isWeb) {
  const fs = require('expo-file-system/legacy');
  documentDirectory = fs.documentDirectory;
  getInfoAsync = fs.getInfoAsync;
  makeDirectoryAsync = fs.makeDirectoryAsync;
  writeAsStringAsync = fs.writeAsStringAsync;
  readDirectoryAsync = fs.readDirectoryAsync;
  deleteAsync = fs.deleteAsync;
  EncodingType = fs.EncodingType;
}

const AUDIO_DIR = documentDirectory ? `${documentDirectory}voice-alarm/audio/` : '';

/** 오디오 디렉토리 초기화 */
export async function ensureAudioDir() {
  if (isWeb) return;
  const dirInfo = await getInfoAsync(AUDIO_DIR);
  if (!dirInfo.exists) {
    await makeDirectoryAsync(AUDIO_DIR, { intermediates: true });
  }
}

/** 오디오 세션 설정 (앱 시작 시 호출) */
export async function setupAudioSession() {
  if (isWeb) return;
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: true,
    shouldDuckAndroid: true,
  });
}

/** 마이크 권한 요청 */
export async function requestMicPermission(): Promise<boolean> {
  if (isWeb) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      return false;
    }
  }
  const { granted } = await Audio.requestPermissionsAsync();
  return granted;
}

/** 녹음 시작 */
export async function startRecording(enableMetering = false): Promise<Audio.Recording> {
  await setupAudioSession();
  const recording = new Audio.Recording();
  const options = {
    ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
    isMeteringEnabled: enableMetering,
  };
  await recording.prepareToRecordAsync(options as Audio.RecordingOptions);
  await recording.startAsync();
  return recording;
}

/** 녹음 중지 및 파일 반환 */
export async function stopRecording(recording: Audio.Recording): Promise<{
  uri: string;
  duration: number;
}> {
  await recording.stopAndUnloadAsync();
  const status = await recording.getStatusAsync();
  const uri = recording.getURI()!;

  return {
    uri,
    duration: (status as unknown as { durationMillis: number }).durationMillis / 1000,
  };
}

/** base64 오디오를 로컬 파일로 저장 */
export async function saveAudioLocally(
  base64Data: string,
  messageId: string,
  format: string = 'mp3',
): Promise<string> {
  if (isWeb) {
    // 웹에서는 data URL로 반환
    return `data:audio/${format};base64,${base64Data}`;
  }
  await ensureAudioDir();
  const filePath = `${AUDIO_DIR}${messageId}.${format}`;
  await writeAsStringAsync(filePath, base64Data, {
    encoding: EncodingType.Base64,
  });
  return filePath;
}

/** 로컬 오디오 파일 경로 가져오기 */
export function getLocalAudioPath(messageId: string, format: string = 'mp3'): string {
  return `${AUDIO_DIR}${messageId}.${format}`;
}

/** 로컬 오디오 파일 존재 여부 확인 */
export async function isAudioCached(messageId: string, format: string = 'mp3'): Promise<boolean> {
  if (isWeb) return false;
  const path = getLocalAudioPath(messageId, format);
  const info = await getInfoAsync(path);
  return info.exists;
}

/** 오디오 재생 */
export async function playAudio(uri: string): Promise<Audio.Sound> {
  if (!isWeb) {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
    });
  }

  const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });

  return sound;
}

/** 로컬에 저장된 오디오 삭제 */
export async function deleteLocalAudio(messageId: string, format: string = 'mp3') {
  if (isWeb) return;
  const path = getLocalAudioPath(messageId, format);
  const info = await getInfoAsync(path);
  if (info.exists) {
    await deleteAsync(path);
  }
}

/** 오디오 캐시 전체 크기 */
export async function getAudioCacheSize(): Promise<number> {
  if (isWeb) return 0;
  await ensureAudioDir();
  const files = await readDirectoryAsync(AUDIO_DIR);
  let totalSize = 0;
  for (const file of files) {
    const info = await getInfoAsync(`${AUDIO_DIR}${file}`);
    if (info.exists && info.size != null) {
      totalSize += info.size;
    }
  }
  return totalSize;
}
