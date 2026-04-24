export interface Env {
  PERSO_API_KEY: string;
  ELEVENLABS_API_KEY: string;
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  GOOGLE_CLIENT_ID: string;
  JWT_SECRET: string;
  PASSWORD_PEPPER: string;
  ENVIRONMENT: string;
  SENTRY_DSN?: string;
  VOICE_BUCKET?: R2Bucket;
}

export type AuthVariables = {
  userId: string;
  userEmail: string;
  userName: string;
  userPicture: string;
};

export type AppEnv = { Bindings: Env; Variables: AuthVariables };

export interface VoiceProfile {
  id: string;
  user_id: string;
  name: string;
  perso_voice_id: string | null;
  elevenlabs_voice_id: string | null;
  avatar_url: string | null;
  status: 'processing' | 'ready' | 'failed';
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  user_id: string;
  voice_profile_id: string;
  text: string;
  audio_url: string | null;
  category: 'morning' | 'lunch' | 'afternoon' | 'evening' | 'night' | 'cheer' | 'love' | 'health' | 'custom';
  is_preset: boolean;
  created_at: string;
}

export interface Alarm {
  id: string;
  user_id: string;
  target_user_id: string | null;
  message_id: string;
  time: string; // HH:mm
  repeat_days: string; // JSON array: [0,1,2,3,4,5,6] (0=Sun)
  is_active: boolean;
  snooze_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  google_id: string | null;
  email: string;
  password_hash: string | null;
  name: string | null;
  picture: string | null;
  plan: 'free' | 'plus' | 'family';
  daily_tts_count: number;
  daily_tts_reset_at: string;
  created_at: string;
}

export interface Friendship {
  id: string;
  user_a: string;
  user_b: string;
  status: 'pending' | 'accepted' | 'blocked';
  created_at: string;
}

export interface Gift {
  id: string;
  sender_id: string;
  recipient_id: string;
  message_id: string;
  status: 'pending' | 'accepted' | 'rejected';
  note: string | null;
  created_at: string;
}

export interface DubJob {
  id: string;
  user_id: string;
  source_message_id: string | null;
  source_language: string;
  target_language: string;
  status: 'uploading' | 'processing' | 'ready' | 'failed';
  perso_space_seq: number | null;
  perso_project_seq: number | null;
  perso_media_seq: number | null;
  result_message_id: string | null;
  progress: number;
  error_message: string | null;
  created_at: string;
}
