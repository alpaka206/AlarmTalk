/**
 * 음성 제공자(Voice Provider) 포트 정의.
 *
 * 백엔드는 특정 벤더(ElevenLabs 등)가 아니라 이 `VoiceProvider` 인터페이스에
 * 의존한다. 세 가지 동작을 추상화한다:
 *  - enroll    : 사용자 음성 샘플로 음성 프로필 등록(클로닝)
 *  - synthesize: 등록된 음성으로 텍스트 → 음성(TTS)
 *  - separate  : 다화자 오디오에서 화자 분리
 *
 * 모든 입출력은 Zod 스키마로 검증한다. 실제 구현은 backend(ElevenLabs),
 * 개발/테스트용 가짜 구현은 {@link MockVoiceProvider} 가 담당한다.
 */
import { z } from 'zod';

export const EnrollInputSchema = z.object({
  userId: z.string().min(1),
  displayName: z.string().min(1).max(32),
  samples: z
    .array(
      z.object({
        uri: z.string().min(1),
        durationMs: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(10),
});
export type EnrollInput = z.infer<typeof EnrollInputSchema>;

export const EnrollResultSchema = z.object({
  voiceId: z.string().min(1),
  status: z.enum(['processing', 'ready', 'failed']),
  provider: z.string().min(1),
});
export type EnrollResult = z.infer<typeof EnrollResultSchema>;

export const SynthesizeInputSchema = z.object({
  voiceId: z.string().min(1),
  text: z.string().min(1).max(2000),
  languageCode: z.string().min(2).max(10).default('ko-KR'),
});
export type SynthesizeInput = z.infer<typeof SynthesizeInputSchema>;

export const SynthesizeResultSchema = z.object({
  audioUri: z.string().min(1),
  durationMs: z.number().int().positive(),
  provider: z.string().min(1),
});
export type SynthesizeResult = z.infer<typeof SynthesizeResultSchema>;

export const SeparateInputSchema = z.object({
  audioUri: z.string().min(1),
  maxSpeakers: z.number().int().min(1).max(6).default(3),
});
export type SeparateInput = z.infer<typeof SeparateInputSchema>;

export const SeparatedSpeakerSchema = z.object({
  speakerId: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
});
export type SeparatedSpeaker = z.infer<typeof SeparatedSpeakerSchema>;

export const SeparateResultSchema = z.object({
  speakers: z.array(SeparatedSpeakerSchema).min(1),
  provider: z.string().min(1),
});
export type SeparateResult = z.infer<typeof SeparateResultSchema>;

export interface VoiceProvider {
  readonly name: string;
  enroll(input: EnrollInput): Promise<EnrollResult>;
  synthesize(input: SynthesizeInput): Promise<SynthesizeResult>;
  separate(input: SeparateInput): Promise<SeparateResult>;
}
