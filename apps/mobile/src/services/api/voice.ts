import type { VoiceProfile, Message, Speaker, DubLanguage, DubJob, DubResult } from '../../types';
import { get, post, patch, del } from './core';

// ===== Voice Profile API =====

export async function getVoiceProfiles() {
  const data = await get<{ profiles: VoiceProfile[] }>('/voice');
  return data.profiles;
}

export async function getVoiceProfile(id: string) {
  const data = await get<{ profile: VoiceProfile }>(`/voice/${id}`);
  return data.profile;
}

export async function createVoiceClone(
  audioFile: { uri: string; name: string; type: string },
  name: string,
) {
  const formData = new FormData();
  formData.append('audio', audioFile as unknown as Blob);
  formData.append('name', name);

  const data = await post<{ profile: VoiceProfile }>('/voice/clone', formData, {
    isFormData: true,
  });
  return data.profile;
}

export async function diarizeAudio(audioFile: { uri: string; name: string; type: string }) {
  const formData = new FormData();
  formData.append('audio', audioFile as unknown as Blob);

  const data = await post<{ speakers: Speaker[] }>('/voice/diarize', formData, {
    isFormData: true,
  });
  return data.speakers;
}

export async function deleteVoiceProfile(id: string) {
  await del(`/voice/${id}`);
}

export interface FamilyVoiceProfile {
  id: string;
  name: string;
  status: string;
  created_at: string;
  user_id: string;
  owner_name: string | null;
}

export async function getFamilyVoiceProfiles() {
  const data = await get<{ profiles: FamilyVoiceProfile[] }>('/voice/family');
  return data.profiles;
}

export async function updateVoiceProfile(id: string, name: string) {
  const data = await patch<{ profile: { id: string; name: string } }>(`/voice/${id}`, { name });
  return data.profile;
}

// ===== Voice upload + speaker picker =====

export interface VoiceUploadMeta {
  id: string;
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  originalName: string | null;
  createdAt: string;
}

export interface SpeakerSegment {
  id: string;
  upload_id: string;
  label: string;
  start_ms: number;
  end_ms: number;
  confidence: number;
  created_at?: string;
}

function normalizeSpeakerSegment(raw: Record<string, unknown>): SpeakerSegment {
  return {
    id: String(raw.id ?? raw['speaker_id'] ?? ''),
    upload_id: String(raw.upload_id ?? raw.uploadId ?? ''),
    label: String(raw.label ?? ''),
    start_ms: Number(raw.start_ms ?? raw.startMs ?? 0),
    end_ms: Number(raw.end_ms ?? raw.endMs ?? 0),
    confidence: Number(raw.confidence ?? 0),
    created_at: raw.created_at as string | undefined,
  };
}

export async function uploadVoiceAudio(
  audioFile: { uri: string; name: string; type: string },
  durationMs?: number,
): Promise<VoiceUploadMeta> {
  const formData = new FormData();
  formData.append('audio', audioFile as unknown as Blob);
  if (durationMs !== undefined) formData.append('durationMs', String(durationMs));
  if (audioFile.name) formData.append('originalName', audioFile.name);
  const data = await post<{ upload: VoiceUploadMeta }>('/voice/upload', formData, {
    isFormData: true,
  });
  return data.upload;
}

export async function separateUpload(uploadId: string): Promise<SpeakerSegment[]> {
  const data = await post<{ speakers: Array<Record<string, unknown>> }>(
    `/voice/uploads/${uploadId}/separate`,
  );
  return data.speakers.map(normalizeSpeakerSegment);
}

export async function listSpeakers(uploadId: string): Promise<SpeakerSegment[]> {
  const data = await get<{ speakers: Array<Record<string, unknown>> }>(
    `/voice/uploads/${uploadId}/speakers`,
  );
  return data.speakers.map(normalizeSpeakerSegment);
}

export async function renameSpeaker(
  uploadId: string,
  speakerId: string,
  label: string,
): Promise<{ id: string; label: string }> {
  const data = await patch<{ speaker: { id: string; label: string } }>(
    `/voice/uploads/${uploadId}/speakers/${speakerId}`,
    { label },
  );
  return data.speaker;
}

// ===== TTS API =====

export async function generateTTS(params: {
  voice_profile_id: string;
  text: string;
  category?: string;
}) {
  return post<{
    message_id: string;
    audio_base64: string;
    audio_format: string;
    text: string;
    voice_profile_id: string;
  }>('/tts/generate', params);
}

export async function getMessages(category?: string) {
  const params = category ? { category } : undefined;
  const data = await get<{ messages: Message[] }>('/tts/messages', params);
  return data.messages;
}

export async function getMessagesByVoice(voiceProfileId: string) {
  const data = await get<{ messages: Message[] }>('/tts/messages', { voice_profile_id: voiceProfileId });
  return data.messages;
}

export async function getPresets() {
  const data = await get<{ presets: Message[] }>('/tts/presets');
  return data.presets;
}

// ===== Dub API =====

export async function getDubLanguages() {
  const data = await get<{ languages: DubLanguage[] }>('/dub/languages');
  return data.languages;
}

export async function startDub(
  audioFile: { uri: string; name: string; type: string },
  sourceLanguage: string,
  targetLanguage: string,
  sourceMessageId?: string,
) {
  const formData = new FormData();
  formData.append('audio', audioFile as unknown as Blob);
  formData.append('source_language', sourceLanguage);
  formData.append('target_language', targetLanguage);
  if (sourceMessageId) {
    formData.append('source_message_id', sourceMessageId);
  }

  const data = await post<{ dub_id: string; status: string }>('/dub', formData, {
    isFormData: true,
  });
  return data;
}

export async function getDubStatus(dubId: string) {
  return get<DubResult>(`/dub/${dubId}`);
}

export async function getDubJobs() {
  const data = await get<{ jobs: DubJob[] }>('/dub/jobs');
  return data.jobs;
}
